import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const target=new URL(process.argv[2]);assert.equal(target.hostname,'127.0.0.1');
assert.equal((await fetch(target)).headers.get('x-studio-fixture'),'memory','Use a disposable in-memory Studio for this regression.');
const require=createRequire(process.env.PLAYWRIGHT_TOOLING?resolve(process.env.PLAYWRIGHT_TOOLING):new URL('../package.json',import.meta.url));
const engine=process.env.STUDIO_BROWSER||'chromium';assert.ok(['chromium','webkit'].includes(engine));
const runtime=require('playwright-core')[engine];
const directory=process.env.STUDIO_REPORT_DIR?resolve(process.env.STUDIO_REPORT_DIR):fileURLToPath(new URL('../.local/qa/preflight/',import.meta.url));await mkdir(directory,{recursive:true});
const browser=await runtime.launch({headless:true,...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const report={engine,errors:[],writes:[],probes:[]};
const nativeOnly=process.env.STUDIO_PREFLIGHT_NATIVE_ONLY==='1';
try{
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===target.origin?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))report.writes.push(request.url());});
  await page.goto(target.href,{waitUntil:'domcontentloaded'});
  await page.locator('[data-skin="harbor-study"]').waitFor();
  await page.locator('[data-skin="__neutral_arc__"]').click();
  await page.locator('#workspaceReview').click();await page.locator('#runPreflightButton').click();
  await page.waitForFunction(()=>!document.querySelector('#runPreflightButton').disabled,null,{timeout:120000});
  report.native={summary:await page.locator('#preflightSummary').textContent(),screens:await page.locator('#preflightList li').count(),failures:await page.locator('#preflightList .fail').allTextContents()};
  report.samples=[];
  for(const id of nativeOnly?[]:['studio-example-field-notes','studio-example-night-circuit','studio-example-rose-window']){
    if(!await page.locator('[data-skin="'+id+'"]').count())continue;
    await page.locator('[data-skin="'+id+'"]').click();await page.locator('#workspaceReview').click();await page.locator('#runPreflightButton').click();
    await page.waitForFunction(()=>!document.querySelector('#runPreflightButton').disabled,null,{timeout:120000});
    const fonts=await page.locator('#exactPreview').evaluate(frame=>{const doc=frame.contentDocument;return{valueFamily:doc.defaultView.getComputedStyle(doc.querySelector('.main-value')).fontFamily,faces:[...doc.fonts].map(face=>({family:face.family,status:face.status}))};});
    report.samples.push({id,summary:await page.locator('#preflightSummary').textContent(),screens:await page.locator('#preflightList li').count(),failures:await page.locator('#preflightList .fail').allTextContents(),fonts});
  }
  await page.evaluate(async()=>{const frame=document.createElement('iframe');frame.name='preflight-probe';frame.id='preflight-probe';frame.style.cssText='position:fixed;right:5px;bottom:5px;border:0;transform:scale(.2);transform-origin:bottom right;pointer-events:none';frame.src='/index.html?appearance-preview=1';const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));document.body.append(frame);await loaded;});
  async function probe(name,skin,size={width:320,height:700}){
    await page.evaluate(async({skin,size})=>{
      const frame=document.querySelector('#preflight-probe');frame.style.width=size.width+'px';frame.style.height=size.height+'px';
      const requestId=crypto.randomUUID();
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Probe did not acknowledge')),5000);function ready(event){if(event.source===frame.contentWindow&&event.data.type==='fivefold-arc:appearance-rendered'&&event.data.requestId===requestId){clearTimeout(timer);window.removeEventListener('message',ready);resolve();}}window.addEventListener('message',ready);frame.contentWindow.postMessage({type:'fivefold-arc:appearance-skin',skin:{useGameBase:true,previewState:'turn',previewMode:'life',previewPlayers:4,...skin,previewRequestId:requestId}},location.origin);});
    },{skin,size});
    const frame=page.frames().find(frame=>frame.name()==='preflight-probe');
    const result=await frame.evaluate(async size=>{const {measurePreviewDocument,previewGeometryChecks,settlePreviewDocument}=await import('/appearance-preflight.js');await settlePreviewDocument(document);const metrics=measurePreviewDocument(document);return{metrics,failures:previewGeometryChecks(metrics,size).filter(check=>!check.pass)};},size);
    report.probes.push({name,...result});return result;
  }
  for(const style of ['button','dial'])for(const state of ['turn','other','damage','menu','radiationDialog','commanderDialog','longLabels','eliminated','lobby','end'])await probe('native '+style+' '+state,{id:'__neutral_arc__',interfaceStyle:style,previewState:state,previewMode:state==='damage'?'commander':'life'});
  for(const style of ['button','dial'])await probe('native 393 '+style+' lobby',{id:'__neutral_arc__',interfaceStyle:style,previewState:'lobby'},{width:393,height:852});
  const expanded={id:'unsafe-probe',rendererVersion:2};
  await probe('small end turn',{...expanded,modeLayouts:{button:{componentLayout:{turnActions:{scale:70}}}}});
  await probe('shifted navigation',{...expanded,modeLayouts:{button:{componentLayout:{modeNav:{x:100}}}}});
  await probe('overlapping custom life',{...expanded,modeLayouts:{button:{componentLayout:{customLife:{y:-100}}}}});
  await probe('shifted commander',{...expanded,previewMode:'commander',modeLayouts:{button:{componentLayout:{commanderDamage:{x:100}}}}});
  await probe('shifted rotary surface',{...expanded,interfaceStyle:'dial',modeLayouts:{dial:{componentLayout:{dialSurface:{x:100}}}}});
  await probe('large counter offset',{...expanded,previewState:'longLabels',modeLayouts:{button:{lifeNumberOffsetY:14,lifeNumberScale:140}}});
  await probe('clipped navigation type',{...expanded,surfaceDesign:{surfaces:{navigation:{typography:{label:{family:'mono',weight:700,scale:115,tracking:.08,case:'uppercase'}}}}}});
  assert.equal(report.native.screens,200);assert.deepEqual(report.native.failures,[]);
  for(const sample of report.samples){assert.equal(sample.screens,200);assert.deepEqual(sample.failures,[],sample.id);}
  for(const probe of report.probes){
    const safe=probe.name.startsWith('native ')||probe.name==='large counter offset';
    if(safe)assert.deepEqual(probe.failures,[],probe.name);
    else assert.ok(probe.failures.length>0,probe.name+' must reject the unsafe geometry');
  }
  // Exercise the actual publication guard, while independently preventing any
  // mutation even if that guard regresses. No confirmation is accepted.
  if(!nativeOnly){
  await context.route('**/api/**',route=>['GET','HEAD'].includes(route.request().method())?route.continue():route.abort('blockedbyclient'));
  report.confirmations=[];page.on('dialog',dialog=>{report.confirmations.push(dialog.message());dialog.dismiss();});
  await page.locator('[data-skin="harbor-study"]').click();
  await page.locator('#studioNavigation button[aria-controls="edit-layout"]').click();await page.locator('#interfaceStyle').selectOption('button');
  await page.getByText('Place game regions',{exact:true}).click();await page.locator('#componentPlacementControls summary').filter({hasText:'End turn area'}).click();
  const scale=page.locator('[data-placement="turnActions"][data-placement-field="scale"]');await scale.press('Home');assert.equal(await scale.inputValue(),'85');
  await page.locator('#workspaceReview').click();await page.locator('#publishButton').click();
  await page.waitForFunction(()=>!document.querySelector('#publishFeedback').hidden,null,{timeout:120000});
  report.publicationBlocked={feedback:await page.locator('#publishFeedback').textContent(),failures:await page.locator('#preflightList .fail').count(),confirmations:report.confirmations.length,scale:await scale.inputValue()};
  assert.match(report.publicationBlocked.feedback,/layout needs review/i);assert.ok(report.publicationBlocked.failures>0);assert.equal(report.publicationBlocked.scale,'85');assert.equal(report.confirmations.length,0);
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);
  await writeFile(resolve(directory,'REPORT.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({native:report.native,samples:report.samples,probes:report.probes.map(probe=>({name:probe.name,failures:probe.failures})),publicationBlocked:report.publicationBlocked,errors:report.errors,writes:report.writes,report:resolve(directory,'REPORT.json')},null,2));
}finally{await writeFile(resolve(directory,'REPORT.json'),JSON.stringify(report,null,2));await browser.close();}

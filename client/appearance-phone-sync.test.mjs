import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Script, runInNewContext } from 'node:vm';

const app=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
function declaration(name) {
  const start=app.indexOf(`const ${name} =`); assert.ok(start>=0,name);
  for(let end=app.indexOf(';',start);end>=0;end=app.indexOf(';',end+1)){const source=app.slice(start,end+1);try{new Script(source);return source;}catch{/* Complete function declaration. */}}
  assert.fail(name);
}

test('a pending phone save keeps the edited snapshot when an older poll arrives', async () => {
  const sent=[];let timer;
  const context={activeAppearanceSkin:{id:'draft',modeLayouts:{button:{lifeNumberScale:105}}},phoneLayoutSessionId:'temporary-preview',phoneEditPending:false,phoneEditRevision:0,phoneLayoutUpdatedAt:0,phoneSaveTimer:null,structuredClone,
    clearTimeout(){},setTimeout(callback){timer=callback;return 1;},fetch:async(_url,options)=>{sent.push(JSON.parse(options.body));return{ok:true,json:async()=>({updatedAt:200})};}};
  runInNewContext(declaration('savePhoneLayout')+'\nsavePhoneLayout();',context);
  context.activeAppearanceSkin={id:'draft',modeLayouts:{button:{lifeNumberScale:100}}};
  await timer();
  assert.equal(sent[0].skin.modeLayouts.button.lifeNumberScale,105);
  assert.equal(context.phoneLayoutUpdatedAt,200);
  assert.equal(context.phoneEditPending,false);
});

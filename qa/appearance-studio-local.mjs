// Run with node qa/appearance-studio-local.mjs [port]. Memory is the default;
// STUDIO_REVIEW_STORE explicitly opts into one private local snapshot file.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStudioReleases } from '../server/src/studio-release-registry.js';
import { startStudioPhoneShare, phoneNetworks } from './studio-phone-share.mjs';
import { createRealtimeServer } from '../server/src/app.js';

import { designStarters, designStarterValues } from '../client/appearance-design-starters.js';
import { loadDesignReviewArt } from './appearance-design-review-art.mjs';
import { openAppearanceReviewStore } from './appearance-review-store.mjs';

const port = Number(process.argv[2] || 8792);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Choose a valid loopback port.');
const key = randomBytes(24).toString('hex');
async function seedCatalog() {
  let catalog = { schemaVersion:1, selected:'__neutral_arc__', gameDefaultLayout:null, assets:[], skins:[
    { id:'harbor-study', name:'Harbor night', status:'Draft', rendererVersion:2, background:'#081a23',surface:'#143341',accent:'#95ded3',secondary:'#68a6b7',text:'#effaf8',muted:'#c1d8dc',backgroundTreatment:'mist' },
    { id:'ember-library', name:'Ember archive', status:'Approved', background:'#1c1015',surface:'#35202b',accent:'#ffb88a',secondary:'#ae6375',text:'#fff0e6',muted:'#dec7c6',backgroundTreatment:'grain' }
  ]};
  if (process.env.STUDIO_DESIGN_REVIEW === '1') {
    catalog.selected = 'studio-example-night-circuit';
    catalog.skins.unshift(...designStarters.map(recipe => ({...designStarterValues(recipe.id),id:'studio-example-'+recipe.id,name:recipe.name,status:'Draft',sourceSkinId:'__neutral_arc__'})));
  }
  if (process.env.STUDIO_DESIGN_REVIEW_ART === '1') catalog = await loadDesignReviewArt(catalog);
  if (process.env.STUDIO_INHERITED_FIXTURE === '1') catalog.skins.push({...catalog.skins[0],id:'inherited-placement',name:'Inherited placement',rendererVersion:1,modeLayouts:{button:{componentLayout:{turnActions:{x:100,y:-140,scale:140}}}}});
  if (process.env.STUDIO_EXPANDED_FIXTURE === '1') catalog.skins.push({...catalog.skins[1],id:'expanded-study',name:'Expanded study',rendererVersion:2,fontFamily:'serif',fontWeight:600,variants:{dial:'engraved',navigation:'framed'}});
  if (process.env.STUDIO_GLOBAL_LAYOUT_FIXTURE === '1') catalog.gameDefaultLayout={modeLayouts:{button:{componentLayout:{counterReadout:{x:4,y:2,scale:100}}},dial:{componentLayout:{counterReadout:{x:-4,y:3,scale:100}}}}};
  if (process.env.STUDIO_COUNTER_DESIGN_FIXTURE === '1') {
    const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
    catalog.assets.push({id:'counter-face-sample',name:'Counter artwork fixture',source:'Loopback-only generated raster fixture',placement:'dial',status:'Approved',data});
    catalog.skins.push({...catalog.skins[0],id:'counter-design-basis',name:'Counter geometry reference',status:'Approved',counterDesign:{navigationIcons:'native'}});
    catalog.skins.push({...catalog.skins[0],id:'counter-design-study',name:'Counter design study',status:'Approved',counterDesign:{navigationIcons:'native',modes:{
      radiation:{accent:'#a7e978',surface:'#112014',text:'#f0ffe9',face:'radial',markings:'ticks',seal:'mode',captionBacking:'surface',artAsset:'counter-face-sample',artOpacity:15,artScale:90},
      poison:{accent:'#c4a0f0',surface:'#1c1427',text:'#f7eeff',face:'rings',markings:'runes',seal:'mode'},
      energy:{accent:'#ffe18a',surface:'#261e0d',text:'#fff8de',face:'faceted',markings:'ticks',seal:'mode'},
    }}});
  }
  return catalog;
}
let appearanceCatalog;
const fixtureMode = process.env.STUDIO_REVIEW_STORE ? 'file' : 'memory';
if (fixtureMode === 'file') appearanceCatalog = await openAppearanceReviewStore({ path: process.env.STUDIO_REVIEW_STORE, seed: seedCatalog });
else {
  const blobStore = new Map(); let catalog = await seedCatalog();
  appearanceCatalog = {
    read: async () => structuredClone(catalog),
    async write(value) { catalog = structuredClone(value); return structuredClone(catalog); },
    readAsset: async id => structuredClone(blobStore.get(id)),
    async writeAsset(id,value) { blobStore.set(id,structuredClone(value)); return value; },
    async deleteAsset(id) { blobStore.delete(id); }
  };
}
const studioReleaseRegistry = createStudioReleases({ environment:'local',
  directory: process.env.STUDIO_REVIEW_STORE && process.env.STUDIO_REVIEW_STORE + '.releases',
});
const {server} = createRealtimeServer({
  studioReleaseRegistry, studioRewardSkins: studioReleaseRegistry.rewardSkins, studioReservedSkins: studioReleaseRegistry.reservedSkins, startStudioPhoneShare, listStudioPhoneNetworks: phoneNetworks,
  staticDir:fileURLToPath(new URL('../client/',import.meta.url)),appEnv:'test',
  feedbackPortalKey:key,appearanceCatalog,durableRecoveryEnabled:false,autoRecoverRooms:false,
  lookupCommanderIdentity:async()=>null,
  fetchImpl:async()=>{ throw new Error('This local Studio fixture has no external data connection.'); }
});
const handle = server.listeners('request')[0];
server.removeListener('request',handle);
server.on('request',(req,res)=>{
  const origin = 'http://127.0.0.1:' + server.address().port;
  if ('http://' + req.headers.host !== origin || (req.headers.origin && req.headers.origin !== origin)) {
    res.writeHead(403).end(); return;
  }
  res.setHeader('X-Studio-Fixture',fixtureMode);
  res.setHeader('X-Studio-Premium','1');
  if (req.url === '/review' && req.method === 'GET') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'});
    res.end('<!doctype html><title>Local Studio review</title><script>sessionStorage.setItem("fivefold-arc:developer-key",' + JSON.stringify(key) + ');location.replace("/appearance-studio.html")</script>'); return;
  }
  handle.call(server,req,res);
});
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await appearanceCatalog.close?.();
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
server.once('error', async error => { await appearanceCatalog.close?.(); console.error(error.message); process.exitCode = 1; });
server.listen(port,'127.0.0.1',()=>console.log('Local Studio review at http://127.0.0.1:'+server.address().port+'/review (' + (fixtureMode === 'file' ? 'file review store: ' + appearanceCatalog.path : 'in-memory sample catalog') + ').'));

import { color, number, choice, record } from './appearance-design-schema.js';
export const sceneMoments = {
  ownTurn:['Your turn','turn'], otherTurn:['Other player’s turn','other'], lobby:['Lobby','lobby'],
  warning:['Counter warning','status'], eliminated:['Eliminated player','eliminated'],
  complete:['Game complete','end'], offline:['Offline table','offline']
};
const momentSpec = record({tint:color,strength:number(0,22),edge:choice('none','rule','double'),edgeColor:color});
export const sceneDesignSpec = record(Object.fromEntries(Object.keys(sceneMoments).map(key => [key,momentSpec])));
const paint = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function compileSceneDesign(skin,result) {
  let used = false;
  for (const key of Object.keys(sceneMoments)) {
    const moment=skin.sceneDesign?.[key];
    if (!moment || (!paint(moment.tint) && !['rule','double'].includes(moment.edge))) continue;
    const slot=key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
    const prefix='--moment-'+slot+'-';
    const strength = Math.min(22,Math.max(0,Number.isFinite(Number(moment.strength)) ? Number(moment.strength) : 12));
    result.datasets['moment'+key[0].toUpperCase()+key.slice(1)] = 'true';
    result.variables[prefix+'wash'] = paint(moment.tint) ? `color-mix(in srgb,${moment.tint} ${strength}%,transparent)` : 'transparent';
    result.variables[prefix+'edge'] = ['rule','double'].includes(moment.edge)
      ? (moment.edge==='double' ? '3px double ' : '1px solid ') + (paint(moment.edgeColor) ? moment.edgeColor : 'var(--brass)') : '0 solid transparent';
    used = true;
  }
  if (used) result.datasets.sceneDesign = 'true';
  return used;
}

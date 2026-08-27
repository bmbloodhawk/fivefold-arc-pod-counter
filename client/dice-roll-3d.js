import DiceBox from './vendor/dice-box/dice-box.es.js';

let diceBox = null;
let diceContainer = null;
let ready = null;
let activeRoll = 0;

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const scaleForDiceCount = count => count <= 2 ? 7 : count <= 4 ? 5.5 : count <= 6 ? 4.35 : 3.7;

async function getDiceBox(container) {
  if (diceBox && diceContainer === container) return diceBox;
  diceContainer = container;
  if (!container.id) throw new Error('The 3D dice tray needs an element id.');
  diceBox = new DiceBox({
    container: `#${container.id}`,
    assetPath: '/vendor/dice-box/assets/',
    theme: 'default',
    themeColor: '#b88a45',
    scale: 5,
    delay: 90,
    enableShadows: true,
    shadowTransparency: 0.7,
    lightIntensity: 1.15,
    offscreen: true,
  });
  ready = diceBox.init();
  await ready;
  return diceBox;
}

/**
 * Runs physical Dice Box d20s. Results from this function are intentionally
 * cosmetic: Fivefold Arc keeps the server-selected values authoritative.
 */
export async function rollPhysicalD20s({ container, dice = [], onDieSettled = () => {}, onRollSettled = () => {} }) {
  const count = dice.length;
  if (!container || !Number.isInteger(count) || count < 1 || prefersReducedMotion()) return { animated: false, results: [] };
  const sequence = ++activeRoll;
  try {
    const box = await getDiceBox(container);
    if (sequence !== activeRoll) return { animated: false, results: [] };
    box.canvas?.setAttribute('aria-hidden', 'true');
    container.dataset.diceCount = String(count);
    const externalThemes = Object.fromEntries(dice.map(({ theme }) => [theme, `/dice-skins/${theme.replace('fivefold-', '')}`]));
    await box.updateConfig({ scale: scaleForDiceCount(count), externalThemes });
    let settled = 0;
    let complete = false;
    const safetyTimer = setTimeout(() => { if (!complete && sequence === activeRoll) { complete = true; onRollSettled(false); } }, 14_000);
    box.onDieComplete = () => {
      if (sequence !== activeRoll) return;
      onDieSettled(settled);
      settled += 1;
      if (settled >= count && !complete) { complete = true; clearTimeout(safetyTimer); }
    };
    box.clear();
    dice.forEach(({ theme, themeColor }, index) => box.add({ sides: 20, qty: 1, theme, themeColor }, { newStartPoint: index === 0 }));
    return sequence === activeRoll ? { animated: true, results: [] } : { animated: false, results: [] };
  } catch (error) {
    console.warn('3D dice unavailable; showing the locked table result instead.', error);
    return { animated: false, results: [] };
  }
}

export function stopPhysicalD20s() {
  activeRoll += 1;
  diceBox?.clear();
}

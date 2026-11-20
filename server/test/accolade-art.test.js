import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/match-moments.js', import.meta.url), 'utf8');
const catalog = runInNewContext(source.replace(/^export /gm, '') + '\n({ earnedMatchMoments, completionChoices })');
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const newlyIllustrated = ['Table Victor', 'Pod Company', 'Turn Order', 'Table Chronicle', 'Format Finish', 'Starting Line',
  'Clock Record', 'Result Recorded', 'Finish Call', 'Turn Logged', 'Place Recorded', 'Closing Total'];

function allCatalogChoices() {
  const choices = new Map();
  const opponents = Array.from({ length: 5 }, (_, index) => ({ seatId: index + 1, claimed: true, name: 'Opponent',
    counters: { life: 40 }, matchMoment: { turnCount: 8, totalTurnMs: 800_000, commanderDamageReceived: 0, lifeLostOnOwnTurn: 0 } }));
  for (const lowestLife of [1, 2, 5, 40]) for (const tableGameNumber of [1, 3, 5]) for (const finishReason of ['declared_winner', 'last_player_standing']) {
    const seat = { seatId: 0, claimed: true, name: 'Alex', counters: { life: 40 }, matchMoment: {
      startingLife: 40, lowestLife, tableGameNumber, lifeGainedAfterLow: 40, actionsAfterLow: 10, lifeGained: 60,
      reclaimedDuringGame: true, turnsAfterReclaim: 4, actionsAfterReclaim: 5, lifeLostOnOwnTurn: 40,
      peakPoison: 9, poisonGained: 20, energyGained: 40, radiationGained: 30, commanderDamageReceived: 200,
      playerCountAtStart: 6, turnCount: 8, totalTurnMs: 80_000, usedLocalD20: true,
      lostHalfLifeInOneTurn: true, lostAllLifeInOneTurn: true, continuedAfterAllLifeLoss: true, largestLifeLossInTurn: 50,
      commanderDamageBySource: Object.fromEntries(opponents.flatMap(other => [
        [`seat-${other.seatId}-commander-a`, 20], [`seat-${other.seatId}-commander-b`, 20],
      ])),
    } };
    const seats = [seat, ...opponents];
    const context = { startingSeatId: 0, gameFormat: 'commander', durationMs: 4_000_000, finishReason,
      finishingOrder: [0, 1, 2, 3, 4, 5], everyStarterTwoTurns: true, eliminatedSeatIds: [1, 2, 3, 4, 5] };
    for (const choice of [...catalog.earnedMatchMoments({ seat, seats, winnerSeatId: 0, context }),
      ...catalog.completionChoices(seat, seats, 0, context)]) choices.set(choice.titles[0], choice);
  }
  return choices;
}

test('every earned and completion category defines nonempty PNG artwork, including declared wins', async () => {
  const choices = allCatalogChoices();
  const earnedTitles = [...source.matchAll(/add\(\['([^']+)'/g)].map(match => match[1]);
  for (const title of earnedTitles) assert.ok(choices.has(title), `Fixture must exercise ${title}`);
  assert.equal(choices.size, earnedTitles.length + 12, 'All twelve completion options must be exercised');
  const blank = [...choices].filter(([, choice]) => typeof choice.art !== 'string' || !choice.art.trim()).map(([title]) => title);
  assert.deepEqual(blank, [], 'No reachable accolade category may omit artwork');
  for (const title of newlyIllustrated) assert.equal(choices.get(title).art, slug(title), title);
  assert.equal(choices.get('Arc Complete').art, 'arc-complete');
  for (const [title, choice] of choices) {
    const png = await readFile(new URL(`../../client/assets/accolades/${slug(choice.art)}.png`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${title} must resolve to PNG artwork`);
    assert.equal(png.subarray(12, 16).toString(), 'IHDR');
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, `${title} must have image dimensions`);
    assert.equal(png.subarray(-8, -4).toString(), 'IEND');
  }
});

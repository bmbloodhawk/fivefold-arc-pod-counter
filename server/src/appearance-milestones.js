export const NIGHT_WATCH_SKIN_ID = 'skin-8d464cbe-0dd5-4010-87eb-937dcced76eb';
export const PRISMATIC_CONFLUENCE_SKIN_ID = 'skin-8dcb5aaa-565f-459b-8cb7-5091b023abe0';

export const NIGHT_SHIFT_ID = 'long-endurance-4';
export const DEEP_NIGHT_ACHIEVEMENT = Object.freeze({
  id: 'deep-into-the-night', title: 'Deep Into the Night', detail: 'Completed a Commander game that reached 20 table turns.',
});
export const NIGHT_WATCH_REWARD = Object.freeze({
  id: 'appearance-night-watch', title: 'Night Watch', rarity: 'rare', detail: 'Earn Night Shift and Deep Into the Night.',
});

export const PRISMATIC_PREREQUISITES = Object.freeze([
  ['color-wheel', 'Color Wheel', 'Played commanders whose color identities cover all five colors across saved games.'],
  ['trusted-blade', 'Trusted Blade', 'Saved ten games with the same deck.'],
  ['armory', 'Full Armory', 'Won with three different saved decks.'],
  ['ten-crowns', 'Ten Crowns', 'Recorded ten victories.'],
  ['seasoned', 'Seasoned', 'Saved twenty-five completed games.'],
].map(([id, title, detail]) => Object.freeze({ id, title, detail })));

export const PRISMATIC_PATH_ACHIEVEMENT = Object.freeze({
  id: 'appearance-prismatic-confluence', title: 'The Prismatic Path', rarity: 'legendary',
  detail: 'Earn Color Wheel, Trusted Blade, Full Armory, Ten Crowns, and Seasoned.',
});

const milestones = [
  ["field-notes", "Field Journal", 10, "common"],
  ["rosewood", "Kitchen Table Regular", 20, "uncommon",
    ", including a rematch at the same table",
    ({ games }) => games.some(game => game.achievementFacts?.tableGameNumber >= 2)],
  ["tideglass", "Turn the Tide", 35, "uncommon",
    ", including five wins at tables of four or more",
    ({ wins }) => wins.filter(game => game.tableSize >= 4).length >= 5],
  ["ember-vault", "Rise from the Ashes", 55, "rare",
    ", including a win after reaching 5 life or less",
    ({ wins }) => wins.some(game => Number.isFinite(game.achievementFacts?.lowestLife) && game.achievementFacts.lowestLife <= 5)],
  ["long-table", "A Regular Seat", 75, "rare",
    " across at least 30 separate UTC play dates",
    ({ completionDays }) => completionDays.size >= 30],
  ["crown-alloy", "Tempered Crown", 100, "epic",
    ", including ten wins with the same saved deck",
    ({ deckWins }) => [...deckWins.values()].some(wins => wins >= 10)],
].map(([skinId, title, minimumGames, rarity, conditionText = "", qualifies = () => true]) => ({
  skinId, minimumGames, qualifies,
  award: Object.freeze({
    id: `appearance-${skinId}`,
    title, rarity,
    detail: `Save ${minimumGames} verified Commander games${conditionText}.`,
  }),
}));

export const APPEARANCE_ACHIEVEMENTS = Object.freeze(
  Object.fromEntries(milestones.map(({ skinId, award }) => [skinId, award])),
);

export function nextAppearanceAchievement(context, approvedIds, awards) {
  return milestones.find(({ award, minimumGames, qualifies }) =>
    approvedIds.includes(award.id) && !Object.hasOwn(awards, award.id)
    && context.games.length >= minimumGames && qualifies(context),
  )?.award;
}

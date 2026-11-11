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

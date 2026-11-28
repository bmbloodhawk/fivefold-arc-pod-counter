import eligibilityList from '../static-data/star-trek-commanders.v1.json' with { type: 'json' };
import cardIdentityIndex from '../static-data/card-identity-index.json' with { type: 'json' };

// Identity evidence deliberately uses only exact names from reviewed sources.
// The gameplay autocomplete's punctuation folding and fuzzy suggestions are not proof.
const exactName = value => typeof value === 'string' ? value.normalize('NFC').trim().toLocaleLowerCase('en-US') : '';

export function createStartingCommanderEvidenceResolver({ eligibility = eligibilityList, cardIndex = cardIdentityIndex } = {}) {
  const names = new Map();
  const addName = (name, card) => {
    const key = exactName(name);
    if (!key) return;
    const existing = names.get(key);
    if (existing === undefined) names.set(key, card);
    else if (existing?.identity !== card.identity) names.set(key, null);
  };
  const reviewed = new Map();
  for (const card of eligibility.cards) {
    const identity = { identity: `oracle:${card.oracleId}`, oracleId: card.oracleId, name: card.name };
    for (const name of [card.name, ...(card.aliases || []), ...(card.eligibleNames || [])]) {
      addName(name, identity);
      reviewed.set(exactName(name), identity);
    }
  }
  for (const card of cardIndex.cards) {
    // The same mechanical card can have a themed printing. Its generic name
    // resolves to the canonical identity but is not automatically mission eligible.
    const identity = reviewed.get(exactName(card.name)) || { identity: `name:${card.name}`, name: card.name };
    for (const name of [card.name, ...(card.aliases || [])]) addName(name, identity);
  }
  return commanderNames => {
    const sourceNames = Array.isArray(commanderNames) ? commanderNames : [];
    const cards = sourceNames.map(name => {
      const matchedName = exactName(name);
      const card = names.get(matchedName);
      return card ? { ...card, matchedName } : null;
    });
    const resolved = cards.length >= 1 && cards.length <= 2 && cards.every(Boolean)
      && new Set(cards.map(card => card.identity)).size === cards.length;
    return {
      schemaVersion: 1,
      eligibilityVersion: eligibility.version,
      cardIndexVersion: cardIndex.sourceSha256,
      resolved,
      cards: resolved ? cards : [],
    };
  };
}

export const startingCommanderEvidenceFor = createStartingCommanderEvidenceResolver();

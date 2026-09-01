// A deliberately conservative presentation layer. Card lookup is kept
// elsewhere so Oracle/ruling data can be refreshed without changing advice.
function targetableTypes(text) {
  const source = String(text || '');
  if (/\bany target\b/i.test(source)) return 'any target';
  const match = source.match(/\btarget (?:another )?(?:artifact|creature|enchantment|land|planeswalker|permanent|spell|player|card)(?:\s+or\s+(?:artifact|creature|enchantment|land|planeswalker|permanent|spell|player|card))*/i);
  return match ? match[0] : null;
}

function directTarget(source, other) {
  const phrase = targetableTypes(source.oracleText);
  if (!phrase) return null;
  const type = String(other.typeLine || '').toLowerCase();
  const target = phrase.toLowerCase();
  if (target === 'any target') return ['creature', 'planeswalker', 'battle'].some((word) => type.includes(word)) ? phrase : null;
  return ['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'permanent', 'spell'].some((word) => target.includes(word) && type.includes(word)) ? phrase : null;
}

export function createInteractionAdvice(first, second, situation = '') {
  const statedSituation = String(situation || '').trim();
  const assumptions = statedSituation
    ? `Using the supplied situation: ${statedSituation}`
    : 'No game situation was supplied. Zone, timing, targets, costs, choices, counters, copy effects, and replacement effects can change the result.';
  const forward = directTarget(first, second);
  const backward = directTarget(second, first);
  const links = [forward && { source: first, target: second, phrase: forward }, backward && { source: second, target: first, phrase: backward }].filter(Boolean);
  if (!links.length) return {
    kind: 'context_required',
    result: 'Cannot be determined from the card names alone.',
    assumptions,
    steps: ['Read the current Oracle text for both cards.', 'Check the cards’ zones, timing, targets, costs, and other effects on the table before applying either effect.'],
    why: 'Cards can interact through abilities, choices, and other game objects that two names alone do not reveal.',
    limitations: 'Best-effort reference only. This tool does not simulate a game or issue a binding judge ruling.',
    questions: ['Which zone is each card in?', 'Whose turn is it, and what are you trying to do?'],
  };
  const link = links[0];
  return {
    kind: 'possible_direct_target',
    result: `Works only under the stated conditions: ${link.source.name} may affect ${link.target.name} because its Oracle text includes “${link.phrase}.”`,
    assumptions,
    steps: [`Cast or activate ${link.source.name}.`, `Choose ${link.target.name} only if it is a legal target under that exact sentence.`, 'Resolve only if every required target is still legal.'],
    why: 'A spell or ability can affect another card only when its current Oracle wording permits that target and the game’s targeting rules are met.',
    limitations: 'Best-effort reference only, not a guaranteed outcome. Protections, “another” restrictions, zones, timing, costs, and other effects can change the outcome; this is not a binding judge ruling.',
    questions: ['Where is the target card now?', 'What exact ability or spell are you using?'],
  };
}

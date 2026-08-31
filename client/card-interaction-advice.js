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

export function createInteractionAdvice(first, second) {
  const forward = directTarget(first, second);
  const backward = directTarget(second, first);
  const links = [forward && { source: first, target: second, phrase: forward }, backward && { source: second, target: first, phrase: backward }].filter(Boolean);
  if (!links.length) return { kind: 'context_required', conclusion: 'No automatic two-card result is established from the names alone.', sequence: 'Check the current zone, targets, timing, costs, and any other permanents or effects before applying either card.', limitations: 'This tool does not simulate a game or issue judge rulings. It intentionally does not guess at a combo, conflict, or hidden interaction.', questions: ['Which zone is each card in?', 'Whose turn is it, and what are you trying to do?'] };
  const link = links[0];
  return { kind: 'possible_direct_target', conclusion: `${link.source.name} may be able to affect ${link.target.name}: its Oracle text includes “${link.phrase}.”`, sequence: `Cast or activate ${link.source.name}, then choose ${link.target.name} only if it is a legal target under that exact sentence. Resolve the ability or spell only if every required target is still legal.`, limitations: 'This is a possible direct target, not a guaranteed outcome. The exact target zone, timing, costs, protections, and any “another” or additional restrictions still apply.', questions: ['Where is the target card now?', 'What exact ability or spell are you using?'] };
}

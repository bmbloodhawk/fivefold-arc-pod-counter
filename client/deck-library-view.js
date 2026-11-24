export function deckMatchesSearch(deck, query) {
  const terms = String(query || '').normalize('NFKC').trim().toLowerCase().split(/\s+/u).filter(Boolean);
  const names = [deck.name || '', deck.commanderName || '', ...(deck.commanderNames || [])]
    .join(' ').normalize('NFKC').toLowerCase();
  return terms.every(term => names.includes(term));
}

export function renderDeckLibrary({ content, status }, { decks, query, editorOpen, escapeHtml }) {
  const searchQuery = query.trim();
  const visibleDecks = decks.filter(deck => deckMatchesSearch(deck, searchQuery));
  content.innerHTML = visibleDecks.length ? `<ul>${visibleDecks.map(deck => `<li><strong>${deck.favorite ? '★ ' : ''}${escapeHtml(deck.commanderName)}</strong>${deck.archived ? ' <small>Archived</small>' : ''}${deck.name ? `<br><small>${escapeHtml(deck.name)}</small>` : ''}${deck.colors?.length ? `<br><small>${escapeHtml(deck.colors.join(' '))}</small>` : ''}${deck.notes ? `<br><small>${escapeHtml(deck.notes)}</small>` : ''}<br><button type="button" class="text-action" data-edit-deck="${escapeHtml(deck.deckId)}">Edit</button> <button type="button" class="text-action" data-toggle-favorite="${escapeHtml(deck.deckId)}">${deck.favorite ? 'Unfavorite' : 'Favorite'}</button> <button type="button" class="text-action" data-toggle-archive="${escapeHtml(deck.deckId)}">${deck.archived ? 'Restore' : 'Archive'}</button> <button type="button" class="text-action" data-export-deck="${escapeHtml(deck.deckId)}">Export deck</button> <button type="button" class="text-action" data-remove-deck="${escapeHtml(deck.deckId)}">Remove</button></li>`).join('')}</ul>` : '';
  content.hidden = !visibleDecks.length;
  if (!editorOpen) status.textContent = !decks.length ? 'No saved decks yet. Choose Add deck to save your first deck.'
    : !visibleDecks.length ? `No decks match “${searchQuery}”. Try a deck or commander name.`
      : searchQuery ? `${visibleDecks.length} of ${decks.length} saved decks` : `${visibleDecks.length} saved deck${visibleDecks.length === 1 ? '' : 's'}`;
}

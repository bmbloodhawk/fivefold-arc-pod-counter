const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const number = value => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(3)) : 0;
const label = status => ({ draft: 'Reviewing seats', complete: 'Complete', playing: 'Playing', ready: 'Waiting for Table', confirmed: 'Confirmed',
  cancelled: 'Cancelled · no points', awaiting_confirmation: 'Awaiting host confirmation', registration: 'Registration open', between_rounds: 'Between rounds', completed: 'Completed' })[status] || 'Waiting';

export function spectatorClockText(board, now = board.serverNow) {
  if (board.status === 'completed') return 'Tournament completed.';
  if (board.status === 'registration') return 'Waiting for the first round.';
  if (board.status === 'between_rounds') return 'Waiting for the next round.';
  if (!board.timing?.endsAt) return board.status === 'playing' ? 'Untimed round.' : 'Waiting for the next round.';
  const seconds = Math.max(0, Math.ceil((board.timing.endsAt - now) / 1000));
  return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Round time has ended. Tables finish their final turns.';
}
function finalTurns(clock) {
  return !clock ? '' : clock.phase === 'current_turn' ? 'Finishing the current turn.' : clock.phase === 'extra_turns'
    ? `${number(clock.remaining)} additional turn${clock.remaining === 1 ? '' : 's'} remaining.` : 'Final turns finished.';
}
export function spectatorBoardHtml(board) {
  const counts = board.resultCounts || {};
  return `<p class="competition-eyebrow">Private spectator board · Read only</p>
    <p>${escape(label(board.status))}${board.roundNumber ? ` · Round ${number(board.roundNumber)} of ${number(board.plannedRounds)}` : ''}</p>
    <p class="competition-clock" id="spectatorRoundClock">${escape(spectatorClockText(board))}</p>
    <p class="competition-help">Only people with this private link can view this board. It does not enter the tournament. Live life totals are not shown.</p>
    <p class="competition-help">Link expires ${escape(new Date(board.expiresAt).toLocaleString())}.</p>
    <h3>Results</h3><p>${number(counts.confirmed)} confirmed · ${number(counts.awaitingConfirmation)} awaiting confirmation · ${number(counts.playing)} playing${counts.cancelled ? ` · ${number(counts.cancelled)} cancelled` : ''}</p>
    <h3>Tables by round</h3>${(board.rounds || []).map(round => `<section><h4>Round ${number(round.number)} · ${escape(label(round.status))}</h4>${round.assignments.map(table => `<article class="competition-table-card"><h5>Table ${number(table.tableNumber)}</h5><p>${table.participants.map(escape).join(' · ')}</p><strong>${escape(label(table.status))}</strong>${table.clock ? `<p>${escape(finalTurns(table.clock))}</p>` : ''}</article>`).join('')}</section>`).join('') || '<p>No round prepared yet.</p>'}
    <h3>Confirmed standings</h3><p class="competition-help">Only confirmed results count. Pending results can change these placings.</p>
    ${(board.standings || []).length ? `<ol class="competition-ranks" role="list">${board.standings.map(row => `<li><span class="competition-rank">${number(row.rank)}</span><span><strong>${escape(row.alias)}</strong><small>${number(row.gamesPlayed)} confirmed game${row.gamesPlayed === 1 ? '' : 's'}</small></span><b>${number(row.points)}<small>points</small></b></li>`).join('')}</ol>` : '<p>No confirmed standings yet.</p>'}`;
}
export function spectatorFailure(error) {
  if (/expir/i.test(error.code || '')) return 'This private spectator link has expired. Ask the host for a new link.';
  if (/revok/i.test(error.code || '')) return 'This private spectator link was revoked by the host. Ask the host for a new link.';
  if ([401, 403, 404, 410].includes(error.status)) return 'This private spectator link is unavailable, expired or revoked. Ask the host for a new link.';
  return 'Could not update the private spectator board. Refresh has stopped. Try again when your connection is available.';
}

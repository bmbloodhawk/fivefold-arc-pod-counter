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
  const standings = (board.standings || []).filter(row => row.gamesPlayed > 0);
  return `<p class="competition-eyebrow">Private event board · Read only</p>
    <p>${escape(label(board.status))}${board.roundNumber ? ` · Round ${number(board.roundNumber)} of ${number(board.plannedRounds)}` : ''}</p>
    <p class="competition-clock" id="spectatorRoundClock">${escape(spectatorClockText(board))}</p>
    <p class="competition-help">This private link opens the event board and live Tables. Watching does not enter the tournament or take a seat.</p>
    <p class="competition-help">Link expires ${escape(new Date(board.expiresAt).toLocaleString())}.</p>
    <h3>Results</h3><p>${number(counts.confirmed)} confirmed · ${number(counts.awaitingConfirmation)} awaiting confirmation · ${number(counts.playing)} playing${counts.cancelled ? ` · ${number(counts.cancelled)} cancelled` : ''}</p>
    <h3>Tables by round</h3>${(board.rounds || []).map(round => `<section><h4>Round ${number(round.number)} · ${escape(label(round.status))}</h4>${round.assignments.map(table => `<article class="competition-table-card"><h5>Table ${number(table.tableNumber)}</h5><p>${table.participants.map(escape).join(' · ')}</p><strong>${escape(label(table.status))}</strong>${table.clock ? `<p>${escape(finalTurns(table.clock))}</p>` : ''}<button type="button" class="secondary-action" data-watch-round="${number(round.number)}" data-watch-table="${number(table.tableNumber)}" aria-label="Watch Table ${number(table.tableNumber)} · Round ${number(round.number)}">Watch Table ${number(table.tableNumber)}</button></article>`).join('')}</section>`).join('') || '<p>No round prepared yet.</p>'}
    <h3>Confirmed standings</h3><p class="competition-help">Only confirmed results count. Pending results can change these placings.</p>
    ${standings.length ? `<ol class="competition-ranks" role="list">${standings.map(row => `<li><span class="competition-rank">${number(row.rank)}</span><span><strong>${escape(row.alias)}</strong><small>${number(row.gamesPlayed)} confirmed game${row.gamesPlayed === 1 ? '' : 's'}</small></span><b>${number(row.points)}<small>points</small></b></li>`).join('')}</ol>` : '<p>No confirmed standings yet.</p>'}`;
}
const duration = milliseconds => {
  const seconds = Math.max(0, Math.floor(number(milliseconds) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
const seatAlias = (table, seatNumber) => table.seats?.find(seat => seat.seatNumber === seatNumber)?.alias
  || table.participants?.find(seat => seat.seatNumber === seatNumber)?.alias || `Player ${number(seatNumber)}`;

export function spectatorTableClockText(table, now = table.serverNow) {
  if (!table.turn) return table.status === 'ready' ? 'The game has not started.' : 'Game timing is unavailable.';
  const turn = table.turn;
  const elapsed = table.status === 'playing' && !turn.pausedAt && !table.pendingFinish ? Math.max(0, now - table.serverNow) : 0;
  const game = `Game elapsed ${duration(turn.gameElapsedMs + elapsed)}`;
  if (!turn.trackingEnabled) return `${game} · Turn tracking is off.`;
  return `${game} · Turn ${number(turn.turnNumber)} · ${seatAlias(table, turn.activeSeatNumber)} · ${duration(turn.turnElapsedMs + elapsed)}${turn.pausedAt || table.pendingFinish ? ' · Paused' : ''}`;
}

function tableAvailability(table) {
  if (table.status === 'cancelled') return 'This Table was cancelled. No game result counts.';
  if (table.availabilityReason === 'replaced') return 'This Table was replaced. Return to the event board for the current assignment.';
  if (table.status === 'ready' || table.availabilityReason === 'not_started') return 'This game has not started. Live totals appear after the assigned game begins.';
  if (table.status === 'complete' || table.availabilityReason === 'finished') return 'This game has finished. Its life totals are no longer available.';
  return 'This assigned game is unavailable. Live totals cannot be shown. Return to the event board for its current status.';
}

function tableResult(table) {
  if (table.pendingFinish) return '<p class="competition-watch-result">Finish is pending. The Table can still undo this finish.</p>';
  if (!table.result) return '';
  const confirmed = table.resultStatus === 'confirmed';
  const winner = table.result.winnerAlias || (table.result.winnerSeatNumber ? seatAlias(table, table.result.winnerSeatNumber) : null);
  return `<section class="competition-watch-result"><h3>${confirmed ? 'Confirmed result' : 'Awaiting host confirmation'}</h3><p>${winner
    ? `${confirmed ? 'Confirmed winner' : 'Reported winner'}: ${escape(winner)}`
    : `${confirmed ? 'Confirmed' : 'Reported'} finish · no single winner.`}</p>${confirmed ? '' : '<p class="competition-help">The host must confirm this result before standings update.</p>'}</section>`;
}

export function spectatorTableHtml(table) {
  const seats = table.seats || [];
  const status = table.status === 'complete' ? 'Game finished' : table.status === 'unavailable' ? 'Live game unavailable' : label(table.status);
  return `<p class="competition-eyebrow">Watch Table ${number(table.tableNumber)} · Read only</p>
    <p>Round ${number(table.roundNumber)} · ${escape(status)}</p>
    ${table.hasLiveTotals ? `<section class="competition-watch-overview"><h3>Life totals</h3><ul class="competition-watch-summary" role="list">${seats.map(seat => `<li data-watch-summary-seat="${number(seat.seatNumber)}" class="${seat.eliminated ? 'is-eliminated' : table.status === 'playing' && table.turn?.trackingEnabled && table.turn.activeSeatNumber === seat.seatNumber ? 'is-active' : ''}"><span>${escape(seat.alias)}</span><strong>${number(seat.counters?.life)}</strong><small>${seat.eliminated ? 'Eliminated' : table.status === 'complete' ? 'Game finished' : table.turn?.trackingEnabled && table.turn.activeSeatNumber === seat.seatNumber ? 'Active turn' : 'In game'}</small></li>`).join('')}</ul></section>` : ''}
    <p id="spectatorRoundClock" class="competition-clock">Official round · ${escape(spectatorClockText({ ...table, status: table.status === 'complete' ? 'playing' : table.status }))}</p>
    ${table.timing?.phase ? `<p>${escape(finalTurns(table.timing))}</p>` : ''}
    ${tableResult(table)}
    ${table.hasLiveTotals ? `<p id="spectatorTableTurn" class="competition-watch-timer">${escape(spectatorTableClockText(table))}</p>
    <div class="competition-watch-seats">${seats.map(seat => `<article data-watch-seat="${number(seat.seatNumber)}" class="competition-watch-seat${seat.eliminated ? ' is-eliminated' : ''}${!seat.eliminated && table.status === 'playing' && table.turn?.trackingEnabled && table.turn.activeSeatNumber === seat.seatNumber ? ' is-active' : ''}">
      <div class="competition-watch-seat-heading"><h3>${escape(seat.alias)}</h3><span>${seat.eliminated ? 'Eliminated' : table.status === 'playing' && table.turn?.trackingEnabled && table.turn.activeSeatNumber === seat.seatNumber ? 'Active turn' : `Player ${number(seat.seatNumber)}`}</span></div>
      <p class="competition-watch-life"><span>Life</span><strong data-watch-life>${number(seat.counters?.life)}</strong></p>
      <ul class="competition-watch-commanders" role="list">${(seat.commanders || []).map(commander => `<li data-watch-commander="${number(commander.commanderNumber)}"><strong>${escape(commander.name || `Commander ${commander.commanderNumber}`)}</strong><small>Commander tax <b data-watch-tax>${number(commander.tax)}</b> · Cast ${number(commander.castCount)} time${commander.castCount === 1 ? '' : 's'}</small></li>`).join('')}</ul>
      <details><summary aria-label="Counters &amp; commander damage for ${escape(seat.alias)}">Counters &amp; commander damage</summary><dl class="competition-watch-counters">${[['poison', 'Poison'], ['energy', 'Energy'], ['radiation', 'Radiation'], ['generic', 'Generic']].map(([key, name]) => `<div><dt>${name}</dt><dd data-watch-counter="${key}">${number(seat.counters?.[key])}</dd></div>`).join('')}</dl>
      <h4>Incoming commander damage</h4>${seat.commanderDamageReceived?.length ? `<ul class="competition-watch-damage" role="list">${seat.commanderDamageReceived.map(source => {
        const commander = seats.find(row => row.seatNumber === source.seatNumber)?.commanders?.find(row => row.commanderNumber === source.commanderNumber);
        return `<li data-watch-damage-seat="${number(source.seatNumber)}" data-watch-damage-commander="${number(source.commanderNumber)}"><span>${escape(seatAlias(table, source.seatNumber))} · ${escape(commander?.name || `Commander ${number(source.commanderNumber)}`)}</span><b>${number(source.damage)}</b></li>`;
      }).join('')}</ul>` : '<p class="competition-help">No commander damage recorded.</p>'}</details></article>`).join('')}</div>`
      : `<p class="competition-watch-result">${escape(tableAvailability(table))}</p><p>${(table.participants || []).map(row => escape(typeof row === 'string' ? row : row.alias)).join(' · ')}</p>`}`;
}
export function spectatorFailure(error) {
  if (/expir/i.test(error.code || '')) return 'This private spectator link has expired. Ask the host for a new link.';
  if (/revok/i.test(error.code || '')) return 'This private spectator link was revoked by the host. Ask the host for a new link.';
  if ([401, 403, 404, 410].includes(error.status)) return 'This private spectator link is unavailable, expired or revoked. Ask the host for a new link.';
  return 'Could not update the private spectator board. Refresh has stopped. Try again when your connection is available.';
}

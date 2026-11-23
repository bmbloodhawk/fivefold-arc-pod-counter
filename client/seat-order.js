export function renderSeatOrder(container, rosterIds, {
  players, readyIds = [], isHost, hostSeatId, intermission = false,
  displayName, escapeHtml, onSkipSeat, onMoveSeat,
}) {
  container.innerHTML = rosterIds.map((seatId, position) => {
    const player = players.find(item => item.id === `P${seatId + 1}`);
    const ready = readyIds.includes(seatId);
    const skip = intermission && isHost && seatId !== hostSeatId ? `<button type="button" class="text-action" data-skip-next-seat="${seatId}">Remove</button>` : '';
    const move = isHost ? `<span class="intermission-move"><button type="button" class="text-action" data-move-seat="${seatId}" data-direction="-1" ${position === 0 ? 'disabled' : ''} aria-label="Move ${escapeHtml(displayName(player))} earlier">↑</button><button type="button" class="text-action" data-move-seat="${seatId}" data-direction="1" ${position === rosterIds.length - 1 ? 'disabled' : ''} aria-label="Move ${escapeHtml(displayName(player))} later">↓</button></span>` : '';
    const status = intermission ? (ready ? 'Ready' : 'Waiting for ready') : 'Table order';
    return `<div class="intermission-seat"><span><strong>P${seatId + 1} · ${escapeHtml(displayName(player))}</strong><small>${status}</small></span><span class="intermission-actions">${move}${skip}</span></div>`;
  }).join('');
  container.querySelectorAll('[data-skip-next-seat]').forEach(button => button.addEventListener('click', () => void onSkipSeat(Number(button.dataset.skipNextSeat))));
  container.querySelectorAll('[data-move-seat]').forEach(button => button.addEventListener('click', () => void onMoveSeat(Number(button.dataset.moveSeat), Number(button.dataset.direction))));
}

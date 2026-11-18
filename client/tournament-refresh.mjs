// One bounded request at a time. The owner stops this when its view changes.
export function createTournamentRefresh({ visible, timer = globalThis, interval = 15000 }) {
  let timeout = null, generation = 0, current = null, inFlight = false;
  const cancelTimer = () => { if (timeout !== null) timer.clearTimeout(timeout); timeout = null; };
  const schedule = () => {
    cancelTimer();
    if (!current || inFlight || !visible()) return;
    const epoch = generation;
    timeout = timer.setTimeout(async () => {
      timeout = null;
      if (epoch !== generation || !current || !visible()) return;
      const work = current; inFlight = true;
      try { await work.refresh(); }
      catch (error) { if (epoch === generation) { current = null; generation++; work.onError?.(error); } }
      finally { inFlight = false; schedule(); }
    }, Math.max(15000, interval));
  };
  return {
    start(refresh, onError) { generation++; current = { refresh, onError }; schedule(); },
    stop() { generation++; current = null; cancelTimer(); },
    visibilityChanged() { schedule(); },
  };
}

// A restored collection is one profile notice. Reading it never consumes it.
export function createAppearanceCatchUp({ getToken, requestNotice, acknowledge, canShow, show, close }) {
  let epoch = 0, busy = false, active = null, pendingAcknowledgement = null;
  const shown = new Set();
  async function flushAcknowledgement(version) {
    const pending = pendingAcknowledgement;
    if (!pending || version !== epoch) return;
    const token = await getToken();
    if (!token || version !== epoch || pendingAcknowledgement !== pending) return;
    await acknowledge(pending.notice.id, token);
    if (version === epoch && pendingAcknowledgement === pending) pendingAcknowledgement = null;
  }
  return {
    async check() {
      if (busy || active) return;
      const version = epoch;
      busy = true;
      try {
        await flushAcknowledgement(version);
        const token = await getToken();
        if (!token || version !== epoch) return;
        const notice = await requestNotice(token);
        if (version !== epoch || !notice?.skins?.length || shown.has(notice.id) || !canShow()) return;
        active = { notice };
        shown.add(notice.id);
        show(notice);
      } catch { /* A notice must never block the profile or a game. */ }
      finally { if (version === epoch) busy = false; }
    },
    async dismiss() {
      if (!active) return;
      const version = epoch;
      pendingAcknowledgement = active;
      active = null;
      try { await flushAcknowledgement(version); } catch { /* Retry on the next profile visit. */ }
    },
    reset() {
      epoch += 1; busy = false; pendingAcknowledgement = null; shown.clear();
      if (active) { active = null; close(); }
    },
  };
}

export const RELEASE_ID = '2026-10-30-safe-reclaim-6';
export const RELEASE_STATUS_REQUEST = 'fivefold-arc:release-status-request';
export const RELEASE_STATUS_REPLY = 'fivefold-arc:release-status-reply';
export const ACTIVATE_WHEN_SAFE = 'fivefold-arc:activate-when-safe';

export function refreshIsAllowed({ lifecycle, connectionStatus }) {
  if (connectionStatus === 'reconnecting' || connectionStatus === 'connecting') return false;
  return !lifecycle || lifecycle === 'lobby' || lifecycle === 'intermission';
}

export function releaseUpdatePresentation({ waiting, lifecycle, connectionStatus }) {
  if (!waiting) return { kind: 'hidden', message: '' };
  if (refreshIsAllowed({ lifecycle, connectionStatus })) return { kind: 'ready', message: lifecycle ? 'This game is complete. Refresh when you are ready to use the update.' : 'A new version is ready. Refresh when convenient.' };
  if (lifecycle === 'complete') return { kind: 'deferred', message: 'An update is ready. Review the result, then move to next-game setup.' };
  return { kind: 'deferred', message: 'An update is ready and will wait until this game is over.' };
}

export function replyToReleaseStatusRequest(event, safety) {
  if (event.data?.type !== RELEASE_STATUS_REQUEST || !event.data.requestId) return false;
  event.source?.postMessage?.({
    type: RELEASE_STATUS_REPLY,
    requestId: event.data.requestId,
    safe: refreshIsAllowed(safety)
  });
  return true;
}

export function watchForReleaseUpdate({ serviceWorker, getSafetyState, onChange }) {
  let registration = null;
  const notify = () => onChange({ waiting: Boolean(registration?.waiting), releaseId: RELEASE_ID });
  const watchInstallingWorker = () => {
    const installing = registration?.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => { if (installing.state === 'installed') notify(); });
  };

  serviceWorker.addEventListener?.('message', event => {
    replyToReleaseStatusRequest(event, getSafetyState?.() || { lifecycle: null, connectionStatus: 'idle' });
  });

  return serviceWorker.register('./sw.js').then(result => {
    registration = result;
    registration.addEventListener('updatefound', watchInstallingWorker);
    watchInstallingWorker();
    notify();
    return {
      refreshAtSafeBoundary({ lifecycle, connectionStatus, reload }) {
        if (!registration?.waiting || !refreshIsAllowed({ lifecycle, connectionStatus })) return false;
        const waiting = registration.waiting;
        return new Promise(resolve => {
          let settled = false;
          const finish = updated => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            waiting.removeEventListener?.('statechange', onStateChange);
            if (updated) reload();
            resolve(updated);
          };
          const onStateChange = () => {
            if (waiting.state === 'activating' || waiting.state === 'activated' || registration.waiting !== waiting) finish(true);
          };
          const timeout = setTimeout(() => finish(false), 2500);
          waiting.addEventListener?.('statechange', onStateChange);
          waiting.postMessage?.({ type: ACTIVATE_WHEN_SAFE });
        });
      },
      checkNow() { return registration?.update?.(); }
    };
  });
}

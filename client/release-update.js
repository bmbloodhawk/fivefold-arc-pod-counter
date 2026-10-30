export const RELEASE_ID = '2026-10-30-safe-reclaim-1';

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

export function watchForReleaseUpdate({ serviceWorker, onChange }) {
  let registration = null;
  const notify = () => onChange({ waiting: Boolean(registration?.waiting), releaseId: RELEASE_ID });
  const watchInstallingWorker = () => {
    const installing = registration?.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => { if (installing.state === 'installed') notify(); });
  };

  return serviceWorker.register('./sw.js').then(result => {
    registration = result;
    registration.addEventListener('updatefound', watchInstallingWorker);
    watchInstallingWorker();
    notify();
    return {
      refreshAtSafeBoundary({ lifecycle, connectionStatus, reload }) {
        if (!registration?.waiting || !refreshIsAllowed({ lifecycle, connectionStatus })) return false;
        reload();
        return true;
      },
      checkNow() { return registration?.update?.(); }
    };
  });
}

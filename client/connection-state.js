export function connectionPresentation({ status, resynced = false } = {}) {
  if (status === 'disconnected' || status === 'waiting') {
    return {
      label: status === 'waiting' ? 'Reconnecting…' : 'Offline',
      detail: 'Offline — showing confirmed table state. Shared counter changes are paused; nothing entered here will be queued or synced later.',
      showOffline: true,
      syncMessage: ''
    };
  }
  if (status === 'connected' && resynced) {
    return {
      label: 'Synced',
      detail: 'Synced to the confirmed shared table state.',
      showOffline: false,
      syncMessage: 'Synced · confirmed table state just now'
    };
  }
  return {
    label: status === 'local' ? 'Local' : 'Connected',
    detail: status === 'local' ? 'This game is running entirely on this phone. Nothing is uploaded.' : 'Connected to the confirmed shared table state.',
    showOffline: false,
    syncMessage: ''
  };
}

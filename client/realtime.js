/** HTTP + SSE transport. Shared writes use exact versions and are never queued. */
const SNAPSHOT_SAFETY_REFRESH_MS = 30_000;
const CONNECTION_INCIDENT_REPORT_INTERVAL_MS = 30_000;
const SUPPORTED_TABLE_PROTOCOLS = [1];

export class RealtimeAdapter extends EventTarget {
  constructor({ apiBase = location.origin } = {}) {
    super();
    this.apiBase = String(apiBase).replace(/\/$/, '');
    this.connectionId = null; this.roomCode = null; this.seatId = null;
    this.reclaimToken = null; this.snapshot = null; this.events = null;
    this.heartbeatTimer = null; this.reconnectTimer = null; this.snapshotRefreshTimer = null;
    this.sseRecoveryInFlight = false; this.resumePromise = null;
    this.connectionIncident = null; this.connectionRecoveryTimer = null;
    this.status = 'local'; this.localMode = true; this.stopped = false; this.sessionEpoch = 0;
  }

  async createRoom({ playerCount, seatCapacity = playerCount, startingLife, gameFormat = 'commander', commanderCount = 1, commanderNames = Array.from({ length: commanderCount }, () => ''), commanderColors = Array.from({ length: commanderCount }, () => []), name = 'P1', roundLimitMinutes = null, tableSkinId = null, accountToken = null }) {
    const epoch = this.#beginSession();
    try {
      if (!await this.#startConnection(epoch)) return { ignored: true };
      const result = await this.#request('/api/rooms', { method: 'POST', authenticated: true, accountToken, body: { playerCount, seatCapacity, startingLife, gameFormat, commanderCount, commanderNames, commanderColors, name, ...(roundLimitMinutes ? { roundLimitMinutes } : {}), ...(tableSkinId ? { tableSkinId } : {}) } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#adoptSeat(result.snapshot.code, result.seatId, result.reclaimToken, result.snapshot, epoch);
      if (result.hostRecoveryKey) { try { localStorage.setItem(this.#recoveryKey(result.snapshot.code), result.hostRecoveryKey); } catch { /* storage optional */ } }
      return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; throw error; }
  }

  inspectRoom(code) { return this.#request(`/api/rooms/${encodeURIComponent(code)}`); }
  hasStoredReclaimToken(code, seatId) { return Boolean(this.#storedToken(String(code).toUpperCase(), seatId)); }
  hostRecoveryPodCodes() {
    const prefix = 'fivefold-arc:host-recovery:';
    try {
      return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter(key => key?.startsWith(prefix))
        .map(key => key.slice(prefix.length))
        .filter(code => /^[A-Z0-9]{6}$/.test(code) && Boolean(this.#storedRecoveryKey(code)));
    } catch { return []; }
  }
  async refreshRoom() {
    if (this.localMode || !this.roomCode) return { snapshot: this.snapshot, local: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.inspectRoom(this.roomCode);
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      if (!result.snapshot) return result;
      this.#acceptSnapshot(result.snapshot, epoch);
      return { ...result, snapshot: this.snapshot };
    } catch (error) {
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      throw error;
    }
  }

  /** Re-establish one confirmed connection after a phone returns to the foreground. */
  resume() {
    if (this.localMode || this.stopped || !this.roomCode || document.visibilityState === 'hidden') return Promise.resolve({ ignored: true });
    if (this.resumePromise) return this.resumePromise;
    if (this.sseRecoveryInFlight) return Promise.resolve({ recovering: true });
    clearTimeout(this.reconnectTimer); this.reconnectTimer = null;
    const epoch = this.sessionEpoch;
    let resume;
    // A foreground event can fire even though this browser still owns a
    // healthy seat. Verify that connection and refresh only its stream first;
    // reclaiming here would replace a good connection and create version churn.
    const recovery = this.status === 'connected' && this.connectionId ? this.#resumeHealthySession(epoch) : this.#resumeSession(epoch);
    resume = recovery.finally(() => { if (this.resumePromise === resume) this.resumePromise = null; });
    this.resumePromise = resume;
    return resume;
  }

  async claimRoom({ code, seatId, name, commanderCount = 1, commanderNames = Array.from({ length: commanderCount }, () => ''), commanderColors = Array.from({ length: commanderCount }, () => []) }) {
    const epoch = this.#beginSession();
    try {
      if (!await this.#startConnection(epoch)) return { ignored: true };
      const normalizedCode = code.toUpperCase();
      const savedToken = this.#storedToken(normalizedCode, seatId);
      const result = await this.#request(`/api/rooms/${encodeURIComponent(normalizedCode)}/claim`, {
        method: 'POST', authenticated: true, body: { seatId, ...(savedToken ? { reclaimToken: savedToken } : { name, commanderCount, commanderNames, commanderColors }) }
      });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#adoptSeat(normalizedCode, result.seatId, result.reclaimToken || savedToken, result.snapshot, epoch);
      return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; throw error; }
  }

  useLocal() { this.clearSession(); this.stopped = false; }

  /** Stop a room session without discarding its locally stored reclaim token. */
  clearSession() {
    this.sessionEpoch += 1;
    this.disconnect(); this.localMode = true; this.stopped = true;
    this.roomCode = null; this.seatId = null; this.reclaimToken = null; this.snapshot = null;
    this.#setStatus('local');
  }

  async mutate({ name, counters, commanderDamageReceived, commanderCount, commanderNames, commanderColors, commanderCastCounts } = {}) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}/me`, {
        method: 'PATCH', authenticated: true,
        body: { baseVersion: this.snapshot.version, ...(name !== undefined ? { name } : {}), ...(counters && Object.keys(counters).length ? { counters } : {}), ...(commanderDamageReceived && Object.keys(commanderDamageReceived).length ? { commanderDamageReceived } : {}), ...(commanderCount !== undefined ? { commanderCount } : {}), ...(commanderNames !== undefined ? { commanderNames } : {}), ...(commanderColors !== undefined ? { commanderColors } : {}), ...(commanderCastCounts && Object.keys(commanderCastCounts).length ? { commanderCastCounts } : {}) }
      });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

  /** Atomic live delta for rapid counter entry; it intentionally does not use a stale absolute total. */
  async adjust({ counter, delta, commanderSourceId, operationId } = {}) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const body = { counter, delta, ...(commanderSourceId ? { commanderSourceId } : {}), ...(operationId ? { operationId } : {}) };
      let result;
      try { result = await this.#request(`/api/rooms/${this.roomCode}/adjust`, { method: 'POST', authenticated: true, body }); }
      catch (error) {
        if (!this.#isCurrentSession(epoch)) return { ignored: true };
        if (!operationId || error.status) throw error;
        result = await this.#request(`/api/rooms/${this.roomCode}/adjust`, { method: 'POST', authenticated: true, body });
      }
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) {
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      if (error.status === 409 && error.code === 'GAME_NOT_PLAYING' && error.payload?.snapshot) {
        this.#acceptSnapshot(error.payload.snapshot, epoch);
        return { locked: true };
      }
      throw error;
    }
  }

  /** Owner-only commander count mutation. The server rejects a stale snapshot with 409. */
  async setCommanderCount(commanderCount) {
    return this.mutate({ commanderCount });
  }
  async setCommanderSetup(commanderCount, commanderNames, commanderColors) { return this.mutate({ commanderCount, commanderNames, commanderColors }); }

  /** Owner-only commander tax mutation, keyed by a stable commander source ID. */
  async setCommanderCastCount(sourceId, count) {
    return this.mutate({ commanderCastCounts: { [sourceId]: count } });
  }

  async reset() {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}/reset`, { method: 'POST', authenticated: true, body: { baseVersion: this.snapshot.version } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

  async resolveRadiation(nonlandCount) { return this.#turnRequest('/resolve-radiation', { nonlandCount }); }

  async listPlaytestNotes() { return this.#request(`/api/rooms/${this.roomCode}/playtest-notes`, { authenticated: true }); }
  async addPlaytestNote(text) {
    if (this.localMode) throw new Error('Playtest notes are available in a shared pod.');
    if (this.status !== 'connected') throw new Error('Reconnect before saving a note. Your draft has not been saved.');
    return this.#request(`/api/rooms/${this.roomCode}/playtest-notes`, { method: 'POST', authenticated: true, body: { text } });
  }
  async getPlaytestRecap() { return this.#request(`/api/rooms/${this.roomCode}/playtest-recap`, { authenticated: true }); }
  getPersonalMatchMoment(recentAccoladeIds = [], gameId) {
    const query = new URLSearchParams();
    const ids = recentAccoladeIds.filter(id => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)).slice(0, 5);
    if (ids.length) query.set('recentAccoladeIds', ids.join(','));
    if (gameId) query.set('gameId', gameId);
    const suffix = query.size ? '?' + query.toString() : '';
    return this.#request(`/api/rooms/${this.roomCode}/match-moment${suffix}`, { authenticated: true });
  }
  async recordFieldTest(input) { return this.#request(`/api/rooms/${this.roomCode}/field-test`, { method: 'POST', authenticated: true, body: input }); }
  async recordClientDiagnostic(input) {
    if (this.localMode || this.status !== 'connected' || !this.roomCode) return { skipped: true };
    return this.#request(`/api/rooms/${this.roomCode}/client-diagnostics`, { method: 'POST', authenticated: true, body: input });
  }
  async recordQuickFeedback(input) { return this.#request(`/api/rooms/${this.roomCode}/quick-feedback`, { method: 'POST', authenticated: true, body: input }); }
  async getSavedPlaytests() { return this.#request(`/api/rooms/${this.roomCode}/saved-playtests`, { authenticated: true }); }
  async restoreRoom(code) {
    const normalizedCode = String(code).toUpperCase(); const hostRecoveryKey = this.#storedRecoveryKey(normalizedCode);
    if (!hostRecoveryKey) throw new Error('This device does not have the host recovery key for that room.');
    return this.#request(`/api/recovery/${encodeURIComponent(normalizedCode)}`, { method: 'POST', body: { hostRecoveryKey } });
  }

  async tossCoin() {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    const result = await this.#request(`/api/rooms/${this.roomCode}/coin-toss`, { method: 'POST', authenticated: true, body: {} });
    if (!this.#isCurrentSession(epoch)) return { ignored: true };
    this.#acceptSnapshot(result.snapshot, epoch);
    return result;
  }

  async handoffTurn() { return this.#turnRequest('/turn-handoff'); }

  async undoTurnHandoff() { return this.#turnRequest('/turn-handoff/undo'); }
  async setTurnTracking(enabled) { return this.#hostGameRequest('/turn-tracking', { enabled }); }
  async setTurnCues(cueMode) { return this.#hostGameRequest('/turn-cues', { cueMode }); }
  async setSessionKind(sessionKind) { return this.#hostGameRequest('/session-kind', { sessionKind }); }
  async setTableSkin(tableSkinId, accountToken = null) {
    return this.#hostGameRequest('/table-skin', { tableSkinId: tableSkinId || null }, accountToken);
  }
  async sharedAchievementSkin() {
    const { skin } = await this.#request('/api/rooms/' + this.roomCode + '/table-skin', { authenticated: true });
    return skin;
  }
  async setTurnPaused(paused) { return this.#hostGameRequest('/turn-pause', { paused }); }

  async declareWinner(winnerSeatId, declarationDetail = '', winCondition = 'other_declared') {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}/declare-winner`, { method: 'POST', authenticated: true, body: { baseVersion: this.snapshot.version, winnerSeatId, declarationDetail, winCondition } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

  async beginIntermission() { return this.#hostGameRequest('/begin-intermission'); }
  async setNextGameReady(ready = true) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}/next-game-ready`, { method: 'POST', authenticated: true, body: { baseVersion: this.snapshot.version, ready } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }
  async skipNextGameSeat(seatId) { return this.#hostGameRequest('/next-game-skip', { seatId }); }
  async leaveIntermission() {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}/leave-intermission`, { method: 'POST', authenticated: true, body: { baseVersion: this.snapshot.version } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }
  async reorderNextGameSeats(seatIds) { return this.#hostGameRequest('/next-game-reorder', { seatIds }); }

  async eliminatePlayer(targetSeatId, reason, detail = '') { return this.#hostGameRequest('/eliminate-player', { targetSeatId, reason, detail }); }

  async chooseStartingPlayer(startingSeatId) { return this.#hostGameRequest('/choose-starting-player', startingSeatId === undefined ? {} : { startingSeatId }); }

  async reportStartingPlayerRoll(value) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}/report-starting-player-roll`, { method: 'POST', authenticated: true, body: { value } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

  async startGame() { return this.#hostGameRequest('/start-game'); }

  async #hostGameRequest(path, extra = {}, accountToken = null) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}${path}`, { method: 'POST', authenticated: true, accountToken, body: { baseVersion: this.snapshot.version, ...extra } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

  async #turnRequest(path, extra = {}) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}${path}`, { method: 'POST', authenticated: true, body: { baseVersion: this.snapshot.version, ...extra } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

  disconnect() {
    this.stopped = true; this.events?.close(); this.events = null;
    clearInterval(this.heartbeatTimer); clearTimeout(this.reconnectTimer); clearInterval(this.snapshotRefreshTimer); clearTimeout(this.connectionRecoveryTimer);
    this.heartbeatTimer = null; this.reconnectTimer = null; this.snapshotRefreshTimer = null; this.connectionRecoveryTimer = null; this.connectionId = null;
    if (!this.localMode) this.#setStatus('disconnected');
  }

  #handleConflict(error, epoch) {
    if (error.status === 409 && error.payload?.snapshot) {
      this.#acceptSnapshot(error.payload.snapshot, epoch);
      return { conflict: true, snapshot: error.payload.snapshot };
    }
    throw error;
  }

  #adoptSeat(code, seatId, reclaimToken, snapshot, epoch) {
    if (!this.#isCurrentSession(epoch)) return;
    this.roomCode = code; this.seatId = seatId; this.reclaimToken = reclaimToken;
    if (reclaimToken) { try { localStorage.setItem(this.#tokenKey(code, seatId), reclaimToken); } catch { /* storage optional */ } }
    this.#acceptSnapshot(snapshot, epoch); this.#subscribe(epoch); this.#startHeartbeat(epoch); this.#startSnapshotRefresh(epoch); this.#setStatus('connected');
  }

  async #startConnection(epoch) {
    const result = await this.#request('/api/connections', { method: 'POST', body: { supportedTableProtocols: SUPPORTED_TABLE_PROTOCOLS } });
    if (!this.#isCurrentSession(epoch)) return false;
    this.connectionId = result.connectionId;
    return true;
  }

  #subscribe(epoch) {
    if (!this.#isCurrentSession(epoch)) return;
    if (this.connectionIncident) this.connectionIncident.reconnectAttempts = Math.min(100, this.connectionIncident.reconnectAttempts + 1);
    const previousEvents = this.events; this.events = null; previousEvents?.close();
    const url = `${this.apiBase}/api/rooms/${encodeURIComponent(this.roomCode)}/events?connectionId=${encodeURIComponent(this.connectionId)}`;
    const events = new EventSource(url); this.events = events;
    events.addEventListener('open', () => { if (this.#isCurrentSession(epoch) && this.events === events) this.#setStatus('connected'); });
    events.addEventListener('snapshot', event => { if (!this.#isCurrentSession(epoch) || this.events !== events) return; try { this.#acceptSnapshot(JSON.parse(event.data), epoch); } catch { if (this.#isCurrentSession(epoch) && this.events === events) this.dispatchEvent(new CustomEvent('protocolerror')); } });
    events.addEventListener('close', () => { if (!this.#isCurrentSession(epoch) || this.events !== events) return; events.close(); this.#scheduleReconnect(epoch); });
    events.addEventListener('error', () => {
      if (!this.#isCurrentSession(epoch) || this.events !== events) return;
      this.#recordConnectionFailure('sse', 'event_source_error');
      events.close(); this.events = null;
      // Android WebViews and mobile proxies can drop an otherwise healthy SSE
      // stream. Confirm the ordinary read path first so scoring is not
      // unnecessarily disabled while we replace only that stream.
      void this.#recoverSse(epoch);
    });
  }

  #startHeartbeat(epoch) {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      if (!this.#isCurrentSession(epoch) || document.visibilityState === 'hidden' || !this.connectionId) return;
      try { await this.#request('/api/connections/heartbeat', { method: 'POST', authenticated: true, body: {} }); }
      // A heartbeat can be the only request a mobile proxy rejects. Confirm
      // the ordinary room read before tearing down a healthy table session;
      // #recoverSse reclaims only when that confirmation also fails.
      catch (error) { this.#recordConnectionFailure('heartbeat', this.#connectionFailureReason(error), error); if (this.#isCurrentSession(epoch)) void this.#recoverSse(epoch); }
    }, 40000);
  }

  // A mobile network or proxy can leave SSE open while delaying events. This
  // read-only refresh keeps displayed seat state current; it never queues or
  // sends a mutation.
  #startSnapshotRefresh(epoch) {
    clearInterval(this.snapshotRefreshTimer);
    const refresh = async () => {
      if (!this.#isCurrentSession(epoch) || this.status !== 'connected' || this.sseRecoveryInFlight || !this.roomCode || document.visibilityState === 'hidden') return;
      try {
        // The cache-buster protects this safety net from an intermediary that
        // incorrectly reuses a public room GET despite the server's no-store.
        const result = await this.#request(`/api/rooms/${this.roomCode}?refresh=${Date.now()}`);
        if (this.#isCurrentSession(epoch)) this.#acceptSnapshot(result.snapshot, epoch);
      } catch { /* The SSE reconnect/heartbeat paths handle connection state. */ }
    };
    void refresh();
    this.snapshotRefreshTimer = setInterval(() => { void refresh(); }, SNAPSHOT_SAFETY_REFRESH_MS);
  }

  async #resumeSession(epoch) {
    try {
      if (!await this.#startConnection(epoch)) return { ignored: true };
      const result = await this.#request(`/api/rooms/${this.roomCode}/claim`, { method: 'POST', authenticated: true, body: { seatId: this.seatId, reclaimToken: this.reclaimToken } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch);
      this.#subscribe(epoch); this.#startHeartbeat(epoch); this.#startSnapshotRefresh(epoch); this.#setStatus('connected');
      return { resumed: true, snapshot: result.snapshot };
    } catch (error) {
      this.#recordConnectionFailure('seat_reclaim', this.#connectionFailureReason(error), error);
      if (this.#isCurrentSession(epoch)) {
        this.events?.close(); this.events = null;
        this.#setStatus('disconnected'); this.#scheduleReconnect(epoch);
      }
      return { reconnecting: true };
    }
  }

  async #resumeHealthySession(epoch) {
    try {
      await this.#request('/api/connections/heartbeat', { method: 'POST', authenticated: true, body: {} });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      const result = await this.#request(`/api/rooms/${this.roomCode}?refresh=${Date.now()}`);
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch);
      this.#subscribe(epoch); this.#setStatus('connected');
      return { refreshed: true, snapshot: this.snapshot };
    } catch {
      return this.#resumeSession(epoch);
    }
  }

  #scheduleReconnect(epoch) {
    if (!this.#isCurrentSession(epoch) || this.reconnectTimer) return;
    this.#setStatus('disconnected');
    const timer = setTimeout(async () => {
      if (this.reconnectTimer === timer) this.reconnectTimer = null;
      if (!this.#isCurrentSession(epoch)) return;
      if (document.visibilityState === 'hidden') return this.#scheduleReconnect(epoch);
      this.#setStatus('waiting');
      try {
        if (!await this.#startConnection(epoch)) return;
        const result = await this.#request(`/api/rooms/${this.roomCode}/claim`, { method: 'POST', authenticated: true, body: { seatId: this.seatId, reclaimToken: this.reclaimToken } });
        if (!this.#isCurrentSession(epoch)) return;
        this.#acceptSnapshot(result.snapshot, epoch); this.#subscribe(epoch); this.#startHeartbeat(epoch); this.#startSnapshotRefresh(epoch); this.#setStatus('connected');
      } catch (error) { this.#recordConnectionFailure('seat_reclaim', this.#connectionFailureReason(error), error); if (this.#isCurrentSession(epoch)) { this.#setStatus('disconnected'); this.#scheduleReconnect(epoch); } }
    }, 3000);
    this.reconnectTimer = timer;
  }

  async #recoverSse(epoch) {
    // Foreground resume owns recovery until its new claim and stream are in
    // place. An error from the old background stream must not start a second
    // recovery that briefly marks the same phone offline.
    if (!this.#isCurrentSession(epoch) || this.sseRecoveryInFlight || this.resumePromise) return;
    this.sseRecoveryInFlight = true;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}?refresh=${Date.now()}`, { authenticated: true });
      if (!this.#isCurrentSession(epoch)) return;
      this.#acceptSnapshot(result.snapshot, epoch);
      // A server restart can restore the room while discarding every in-memory
      // connection. A public room read still succeeds in that case, but the
      // old connection cannot change life. Reclaim before calling it connected.
      if (result.ownership?.ownsSeat === false) return this.#resumeSession(epoch);
      this.#subscribe(epoch);
      this.#setStatus('connected');
    } catch (error) {
      this.#recordConnectionFailure('room_read', this.#connectionFailureReason(error), error);
      if (this.#isCurrentSession(epoch)) {
        this.#setStatus('disconnected');
        this.#scheduleReconnect(epoch);
      }
    } finally {
      this.sseRecoveryInFlight = false;
    }
  }

  #acceptSnapshot(snapshot, epoch = this.sessionEpoch) {
    // The mobile safety refresh polls frequently, but an unchanged authoritative
    // snapshot must not rebuild the entire table UI. On Android that repeated
    // layout work can present as a visible flicker during otherwise idle play.
    if (!this.#isCurrentSession(epoch) || !snapshot || (this.snapshot && snapshot.version <= this.snapshot.version)) return;
    this.snapshot = snapshot; this.dispatchEvent(new CustomEvent('state', { detail: snapshot }));
  }

  #beginSession() {
    this.sessionEpoch += 1;
    this.events?.close(); this.events = null;
    clearInterval(this.heartbeatTimer); clearTimeout(this.reconnectTimer); clearInterval(this.snapshotRefreshTimer);
    clearTimeout(this.connectionRecoveryTimer);
    this.heartbeatTimer = null; this.reconnectTimer = null; this.snapshotRefreshTimer = null; this.connectionRecoveryTimer = null;
    this.connectionId = null; this.roomCode = null; this.seatId = null; this.reclaimToken = null; this.snapshot = null;
    this.connectionIncident = null;
    this.localMode = false; this.stopped = false; this.#setStatus('waiting');
    return this.sessionEpoch;
  }

  #isCurrentSession(epoch) { return epoch === this.sessionEpoch && !this.stopped; }

  async #request(path, { method = 'GET', authenticated = false, accountToken = null, body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated && this.connectionId) headers['X-Connection-Id'] = this.connectionId;
    if (accountToken) headers.Authorization = 'Bearer ' + accountToken;
    let response;
    try { response = await fetch(`${this.apiBase}${path}`, { method, headers, cache: 'no-store', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
    catch (cause) { const error = new Error('The pod server could not be reached.'); error.cause = cause; throw error; }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Server request failed (${response.status}).`);
      error.status = response.status; error.code = payload.error?.code; error.payload = payload; throw error;
    }
    return payload;
  }

  #tokenKey(code, seatId) { return `fivefold-arc:reclaim:${code}:${seatId}`; }
  #recoveryKey(code) { return `fivefold-arc:host-recovery:${code}`; }
  #storedToken(code, seatId) { try { return localStorage.getItem(this.#tokenKey(code, seatId)); } catch { return null; } }
  #storedRecoveryKey(code) { try { return localStorage.getItem(this.#recoveryKey(code)); } catch { return null; } }
  #setStatus(status) {
    if (status === 'connected') this.#recordConnectionRecovery();
    if (this.status === status) return;
    this.status = status; this.dispatchEvent(new CustomEvent('status', { detail: status }));
  }

  #connectionFailureReason(error) { return Number.isInteger(error?.status) ? 'http_error' : 'network_error'; }

  #connectionErrorCode(error) {
    const codes = new Set(['CONNECTION_EXPIRED', 'NOT_SEAT_OWNER', 'ROOM_NOT_FOUND', 'VERSION_CONFLICT', 'NOT_FOUND']);
    return codes.has(error?.code) ? `SERVER_${error.code}` : error?.code ? 'SERVER_OTHER_ERROR' : null;
  }

  #recordConnectionFailure(operation, reason, error = null) {
    const now = Date.now();
    clearTimeout(this.connectionRecoveryTimer); this.connectionRecoveryTimer = null;
    let incident = this.connectionIncident;
    if (!incident) {
      incident = { operation, reason, startedAt: now, lastFailureAt: now, reconnectAttempts: 0, occurrences: 0, lastReportedAt: 0, httpStatus: null, errorCode: null };
      this.connectionIncident = incident;
    }
    incident.lastFailureAt = now;
    incident.occurrences = Math.min(10_000, incident.occurrences + 1);
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599) incident.httpStatus = error.status;
    const errorCode = this.#connectionErrorCode(error);
    if (errorCode) incident.errorCode = errorCode;
    if (incident.occurrences === 1 || now - incident.lastReportedAt >= CONNECTION_INCIDENT_REPORT_INTERVAL_MS) {
      incident.lastReportedAt = now;
      this.#sendConnectionIncident(incident, 'failed', now);
    }
  }

  #recordConnectionRecovery() {
    const incident = this.connectionIncident;
    if (!incident) return;
    clearTimeout(this.connectionRecoveryTimer);
    const observedFailureAt = incident.lastFailureAt;
    const timer = setTimeout(() => {
      if (this.connectionRecoveryTimer !== timer || this.connectionIncident !== incident || incident.lastFailureAt !== observedFailureAt) return;
      this.connectionRecoveryTimer = null; this.connectionIncident = null;
      this.#sendConnectionIncident(incident, 'recovered', Date.now());
    }, CONNECTION_INCIDENT_REPORT_INTERVAL_MS);
    this.connectionRecoveryTimer = timer;
  }

  #sendConnectionIncident(incident, outcome, now) {
    void this.recordClientDiagnostic({
      kind: 'connection_incident', operation: incident.operation, outcome, reason: incident.reason,
      reconnectAttempts: incident.reconnectAttempts, occurrences: incident.occurrences,
      durationMs: Math.min(3_600_000, Math.max(0, now - incident.startedAt)),
      httpStatus: incident.httpStatus, errorCode: incident.errorCode,
    }).catch(() => {});
  }
}

export function apiBaseFromPage() {
  const requested = new URLSearchParams(location.search).get('api');
  return (requested || location.origin).replace(/\/$/, '');
}

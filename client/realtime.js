/** HTTP + SSE transport. Shared writes use exact versions and are never queued. */
export class RealtimeAdapter extends EventTarget {
  constructor({ apiBase = location.origin } = {}) {
    super();
    this.apiBase = String(apiBase).replace(/\/$/, '');
    this.connectionId = null; this.roomCode = null; this.seatId = null;
    this.reclaimToken = null; this.snapshot = null; this.events = null;
    this.heartbeatTimer = null; this.reconnectTimer = null; this.snapshotRefreshTimer = null;
    this.status = 'local'; this.localMode = true; this.stopped = false; this.sessionEpoch = 0;
  }

  async createRoom({ playerCount, startingLife, commanderCount = 1, commanderNames = Array.from({ length: commanderCount }, () => ''), commanderColors = Array.from({ length: commanderCount }, () => []), name = 'P1', roundLimitMinutes = null }) {
    const epoch = this.#beginSession();
    try {
      if (!await this.#startConnection(epoch)) return { ignored: true };
      const result = await this.#request('/api/rooms', { method: 'POST', authenticated: true, body: { playerCount, startingLife, commanderCount, commanderNames, commanderColors, name, ...(roundLimitMinutes ? { roundLimitMinutes } : {}) } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#adoptSeat(result.snapshot.code, result.seatId, result.reclaimToken, result.snapshot, epoch);
      if (result.hostRecoveryKey) { try { localStorage.setItem(this.#recoveryKey(result.snapshot.code), result.hostRecoveryKey); } catch { /* storage optional */ } }
      return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; throw error; }
  }

  inspectRoom(code) { return this.#request(`/api/rooms/${encodeURIComponent(code)}`); }
  hasStoredReclaimToken(code, seatId) { return Boolean(this.#storedToken(String(code).toUpperCase(), seatId)); }
  async refreshRoom() {
    if (this.localMode || !this.roomCode) return { snapshot: this.snapshot, local: true };
    const result = await this.inspectRoom(this.roomCode);
    if (result.snapshot) this.#acceptSnapshot(result.snapshot);
    return result;
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

  async mutate({ counters, commanderDamageReceived, commanderCount, commanderNames, commanderColors, commanderCastCounts } = {}) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}/me`, {
        method: 'PATCH', authenticated: true,
        body: { baseVersion: this.snapshot.version, ...(counters && Object.keys(counters).length ? { counters } : {}), ...(commanderDamageReceived && Object.keys(commanderDamageReceived).length ? { commanderDamageReceived } : {}), ...(commanderCount !== undefined ? { commanderCount } : {}), ...(commanderNames !== undefined ? { commanderNames } : {}), ...(commanderColors !== undefined ? { commanderColors } : {}), ...(commanderCastCounts && Object.keys(commanderCastCounts).length ? { commanderCastCounts } : {}) }
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
        if (!operationId || error.status) throw error;
        result = await this.#request(`/api/rooms/${this.roomCode}/adjust`, { method: 'POST', authenticated: true, body });
      }
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; throw error; }
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

  async listPlaytestNotes() { return this.#request(`/api/rooms/${this.roomCode}/playtest-notes`, { authenticated: true }); }
  async addPlaytestNote(text) {
    if (this.localMode) throw new Error('Playtest notes are available in a shared pod.');
    if (this.status !== 'connected') throw new Error('Reconnect before saving a note. Your draft has not been saved.');
    return this.#request(`/api/rooms/${this.roomCode}/playtest-notes`, { method: 'POST', authenticated: true, body: { text } });
  }
  async getPlaytestRecap() { return this.#request(`/api/rooms/${this.roomCode}/playtest-recap`, { authenticated: true }); }
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
  async setTurnCues(enabled) { return this.#hostGameRequest('/turn-cues', { enabled }); }
  async setTurnPaused(paused) { return this.#hostGameRequest('/turn-pause', { paused }); }

  async declareWinner(winnerSeatId) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}/declare-winner`, { method: 'POST', authenticated: true, body: { baseVersion: this.snapshot.version, winnerSeatId } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

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

  async #hostGameRequest(path, extra = {}) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}${path}`, { method: 'POST', authenticated: true, body: { baseVersion: this.snapshot.version, ...extra } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

  async #turnRequest(path) {
    if (this.localMode) return { local: true };
    if (this.status !== 'connected' || !this.snapshot) return { blocked: true };
    const epoch = this.sessionEpoch;
    try {
      const result = await this.#request(`/api/rooms/${this.roomCode}${path}`, { method: 'POST', authenticated: true, body: { baseVersion: this.snapshot.version } });
      if (!this.#isCurrentSession(epoch)) return { ignored: true };
      this.#acceptSnapshot(result.snapshot, epoch); return result;
    } catch (error) { if (!this.#isCurrentSession(epoch)) return { ignored: true }; return this.#handleConflict(error, epoch); }
  }

  disconnect() {
    this.stopped = true; this.events?.close(); this.events = null;
    clearInterval(this.heartbeatTimer); clearTimeout(this.reconnectTimer); clearInterval(this.snapshotRefreshTimer);
    this.heartbeatTimer = null; this.reconnectTimer = null; this.snapshotRefreshTimer = null; this.connectionId = null;
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
    const result = await this.#request('/api/connections', { method: 'POST', body: {} });
    if (!this.#isCurrentSession(epoch)) return false;
    this.connectionId = result.connectionId;
    return true;
  }

  #subscribe(epoch) {
    if (!this.#isCurrentSession(epoch)) return;
    const previousEvents = this.events; this.events = null; previousEvents?.close();
    const url = `${this.apiBase}/api/rooms/${encodeURIComponent(this.roomCode)}/events?connectionId=${encodeURIComponent(this.connectionId)}`;
    const events = new EventSource(url); this.events = events;
    events.addEventListener('open', () => { if (this.#isCurrentSession(epoch) && this.events === events) this.#setStatus('connected'); });
    events.addEventListener('snapshot', event => { if (!this.#isCurrentSession(epoch) || this.events !== events) return; try { this.#acceptSnapshot(JSON.parse(event.data), epoch); } catch { if (this.#isCurrentSession(epoch) && this.events === events) this.dispatchEvent(new CustomEvent('protocolerror')); } });
    events.addEventListener('close', () => { if (!this.#isCurrentSession(epoch) || this.events !== events) return; events.close(); this.#scheduleReconnect(epoch); });
    events.addEventListener('error', () => { if (!this.#isCurrentSession(epoch) || this.events !== events) return; events.close(); this.#setStatus('disconnected'); this.#scheduleReconnect(epoch); });
  }

  #startHeartbeat(epoch) {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      if (!this.#isCurrentSession(epoch) || document.visibilityState === 'hidden' || !this.connectionId) return;
      try { await this.#request('/api/connections/heartbeat', { method: 'POST', authenticated: true, body: {} }); }
      catch { if (this.#isCurrentSession(epoch)) this.#scheduleReconnect(epoch); }
    }, 40000);
  }

  // A mobile network or proxy can leave SSE open while delaying events. This
  // read-only refresh keeps displayed seat state current; it never queues or
  // sends a mutation.
  #startSnapshotRefresh(epoch) {
    clearInterval(this.snapshotRefreshTimer);
    const refresh = async () => {
      if (!this.#isCurrentSession(epoch) || !this.roomCode || document.visibilityState === 'hidden') return;
      try {
        // The cache-buster protects this safety net from an intermediary that
        // incorrectly reuses a public room GET despite the server's no-store.
        const result = await this.#request(`/api/rooms/${this.roomCode}?refresh=${Date.now()}`);
        if (this.#isCurrentSession(epoch)) this.#acceptSnapshot(result.snapshot, epoch);
      } catch { /* The SSE reconnect/heartbeat paths handle connection state. */ }
    };
    void refresh();
    this.snapshotRefreshTimer = setInterval(() => { void refresh(); }, 750);
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
      } catch { if (this.#isCurrentSession(epoch)) { this.#setStatus('disconnected'); this.#scheduleReconnect(epoch); } }
    }, 3000);
    this.reconnectTimer = timer;
  }

  #acceptSnapshot(snapshot, epoch = this.sessionEpoch) {
    if (!this.#isCurrentSession(epoch) || !snapshot || (this.snapshot && snapshot.version < this.snapshot.version)) return;
    this.snapshot = snapshot; this.dispatchEvent(new CustomEvent('state', { detail: snapshot }));
  }

  #beginSession() {
    this.sessionEpoch += 1;
    this.events?.close(); this.events = null;
    clearInterval(this.heartbeatTimer); clearTimeout(this.reconnectTimer); clearInterval(this.snapshotRefreshTimer);
    this.heartbeatTimer = null; this.reconnectTimer = null; this.snapshotRefreshTimer = null;
    this.connectionId = null; this.roomCode = null; this.seatId = null; this.reclaimToken = null; this.snapshot = null;
    this.localMode = false; this.stopped = false; this.#setStatus('waiting');
    return this.sessionEpoch;
  }

  #isCurrentSession(epoch) { return epoch === this.sessionEpoch && !this.stopped; }

  async #request(path, { method = 'GET', authenticated = false, body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated && this.connectionId) headers['X-Connection-Id'] = this.connectionId;
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
  #setStatus(status) { this.status = status; this.dispatchEvent(new CustomEvent('status', { detail: status })); }
}

export function apiBaseFromPage() {
  const requested = new URLSearchParams(location.search).get('api');
  return (requested || location.origin).replace(/\/$/, '');
}

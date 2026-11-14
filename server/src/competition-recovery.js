// Independent timer, never called by a life adjustment. Durable accepted starts
// provide known source IDs; completed capture and numeric publication are separate.
export class CompetitionRecovery {
  constructor({ domain, tables, logger = console, workerId = 'competition' }) {
    this.domain = domain; this.tables = tables; this.logger = logger; this.running = false; this.discovered = false;
    this.workerId = workerId;
  }
  async discover() {
    if (this.domain.scopeStore) {
      const progress = await this.domain.scopeStore.recover({ workerId: this.workerId, limit: 10, maxWrites: 64 });
      for (const binding of progress.bindings) this.tables.pendingScopes.set(`${binding.kind}:${binding.id}`, binding);
      for (const error of progress.errors) this.logger.error('Competition control remains pending', error.id, error.message);
      this.discovered = true;
      return;
    }
    const directory = await this.domain.directory();
    for (const binding of Object.values(directory.tables)) this.tables.pendingScopes.set(`${binding.kind}:${binding.id}`, binding);
    this.discovered = true;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      if (this.domain.scopeStore || !this.discovered) {
        try { await this.discover(); }
        catch (error) { this.logger.error('Competition recovery discovery remains pending', error.message); return; }
      }
      const work = [...this.tables.pendingScopes];
      for (const [key, binding] of this.domain.scopeStore ? work.slice(0, 20) : work) {
        try {
          await this.tables.reconcile(binding.kind, binding.id);
          const scope = await this.domain.readScope(binding.kind, binding.id);
          if (!Object.values(scope.tables).some(table => Object.values(table.captures).some(command => command.status === 'accepted'))) this.tables.pendingScopes.delete(key);
        } catch (error) {
          if (error.code === 'POD_DELETED') this.tables.pendingScopes.delete(key);
          else this.logger.error('Competition capture remains pending', error.message);
        }
        finally {
          if (this.domain.scopeStore && this.tables.pendingScopes.has(key)) {
            this.tables.pendingScopes.delete(key); this.tables.pendingScopes.set(key, binding);
          }
        }
      }
    } finally { this.running = false; }
  }
}

// Independent timer, never called by a life adjustment. Durable accepted starts
// provide known source IDs; completed capture and numeric publication are separate.
export class CompetitionRecovery {
  constructor({ domain, tables, logger = console }) {
    this.domain = domain; this.tables = tables; this.logger = logger; this.running = false; this.discovered = false;
  }
  async discover() {
    const directory = await this.domain.directory();
    for (const binding of Object.values(directory.tables)) this.tables.pendingScopes.set(`${binding.kind}:${binding.id}`, binding);
    this.discovered = true;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      if (!this.discovered) {
        try { await this.discover(); }
        catch (error) { this.logger.error('Competition recovery discovery remains pending', error.message); return; }
      }
      for (const [key, binding] of [...this.tables.pendingScopes]) {
        try {
          await this.tables.reconcile(binding.kind, binding.id);
          const scope = await this.domain.readScope(binding.kind, binding.id);
          if (!Object.values(scope.tables).some(table => Object.values(table.captures).some(command => command.status === 'accepted'))) this.tables.pendingScopes.delete(key);
        } catch (error) { this.logger.error('Competition capture remains pending', error.message); }
      }
    } finally { this.running = false; }
  }
}

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_CACHE_AGE_MS = 2 * 60 * 60 * 1000;

// A cache generation expires two hours after creation, even while it is written.
// Only direct match_* directories belong to this cache; settings and logs do not.
class CachePolicy {
  constructor({rootDir, activeDir, beforeRemove, afterRemove, clock = Date.now,
    schedule = setTimeout, cancel = clearTimeout, onError = console.error}) {
    this.rootDir = path.resolve(rootDir);
    this.activeDir = path.resolve(activeDir);
    this.beforeRemove = beforeRemove;
    this.afterRemove = afterRemove;
    this.clock = clock;
    this.schedule = schedule;
    this.cancel = cancel;
    this.onError = onError;
    this.pending = null;
    this.timer = null;
    this.closed = false;
    this.nextExpiry = 0;
    this.lastCheck = 0;
  }
  async directories() {
    await fs.mkdir(this.rootDir, {recursive:true});
    const entries = await fs.readdir(this.rootDir, {withFileTypes:true});
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^match_[a-zA-Z0-9_.-]+$/.test(entry.name)) continue;
      const dir = path.resolve(this.rootDir, entry.name);
      if (path.dirname(dir) !== this.rootDir) throw Error('Invalid cache directory');
      const stat = await fs.lstat(dir);
      if (stat.isSymbolicLink()) throw Error('Cache directory cannot be a symbolic link');
      let createdAt = stat.birthtimeMs || stat.mtimeMs;
      try {
        const data = JSON.parse(await fs.readFile(path.join(dir, 'cache-age.json'), 'utf8'));
        if (Number.isFinite(data.createdAt) && data.createdAt > 0) createdAt = data.createdAt;
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      // A clock rollback must never grant an old cache another two hours.
      if (createdAt > this.clock()) createdAt = 0;
      result.push({dir, createdAt});
    }
    return result;
  }
  async markActive(createdAt) {
    await fs.mkdir(this.activeDir, {recursive:true});
    const stat = await fs.lstat(this.activeDir);
    if (stat.isSymbolicLink() || path.dirname(this.activeDir) !== this.rootDir) throw Error('Invalid active cache directory');
    try {
      await fs.writeFile(path.join(this.activeDir, 'cache-age.json'), JSON.stringify({createdAt:createdAt ?? (stat.birthtimeMs || stat.mtimeMs)}), {flag:'wx'});
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  async ensure(clearAll = false) {
    if (this.pending) {
      await this.pending;
      return clearAll ? this.ensure(true) : undefined;
    }
    if (this.closed) return;
    const now = this.clock();
    if (!clearAll && now >= this.lastCheck && now < this.nextExpiry) return;
    this.lastCheck = now;
    this.cancel(this.timer);
    this.pending = this.sweep(clearAll);
    try { return await this.pending; }
    finally { this.pending = null; }
  }
  async sweep(clearAll) {
    try {
      const entries = await this.directories();
      const expired = entries.filter(item => clearAll || this.clock() - item.createdAt >= MAX_CACHE_AGE_MS);
      const active = expired.some(item => item.dir === this.activeDir);
      if (active) await this.beforeRemove?.();
      try {
        for (const {dir} of expired) await fs.rm(dir, {recursive:true, force:true});
      } finally {
        if (active) await this.afterRemove?.();
      }
      await this.markActive(active ? this.clock() : undefined);
      return {ok:true, cleared:expired.length, maxAgeMs:MAX_CACHE_AGE_MS};
    } finally {
      if (!this.closed) {
        const entries = await this.directories();
        const next = Math.min(...entries.map(item => item.createdAt + MAX_CACHE_AGE_MS));
        this.nextExpiry = next;
        this.timer = this.schedule(() => this.ensure().catch(this.onError), Math.max(100, Math.min(MAX_CACHE_AGE_MS, next - this.clock())));
        this.timer?.unref?.();
      }
    }
  }
  async close() { this.closed = true; this.cancel(this.timer); await this.pending; }
}
module.exports = {CachePolicy, MAX_CACHE_AGE_MS};

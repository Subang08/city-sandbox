/**
 * EventBus - decoupled pub/sub used to wire systems without direct references.
 * Supports wildcard listeners ('*') for debug logging / analytics overlays.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map();
    this.log = [];
    this.logLimit = 60;
  }

  on(type, handler, { once = false } = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const entry = { handler, once };
    this.listeners.get(type).add(entry);
    return () => this.off(type, entry);
  }

  once(type, handler) {
    return this.on(type, handler, { once: true });
  }

  off(type, entry) {
    const set = this.listeners.get(type);
    if (!set) return;
    if (entry && typeof entry === 'object') set.delete(entry);
  }

  emit(type, payload = null) {
    this.log.push({ type, payload, t: Date.now() });
    if (this.log.length > this.logLimit) this.log.shift();
    const set = this.listeners.get(type);
    if (set) {
      for (const entry of [...set]) {
        entry.handler(payload, type);
        if (entry.once) set.delete(entry);
      }
    }
    const wild = this.listeners.get('*');
    if (wild) {
      for (const entry of [...wild]) {
        entry.handler(payload, type);
        if (entry.once) wild.delete(entry);
      }
    }
  }

  clear(type) {
    if (type) this.listeners.delete(type);
    else this.listeners.clear();
  }
}

/**
 * Tiny hierarchical finite state machine.
 * States: { enter(ctx, payload), update(ctx, dt), exit(ctx), }
 */
export class StateMachine {
  constructor(owner, states, initial, ctx = {}) {
    this.owner = owner;
    this.states = states;
    this.ctx = ctx;
    this.current = null;
    this.previous = null;
    this.time = 0;
    this.payload = null;
    this.history = [];
    if (initial) this.change(initial);
  }

  get name() {
    return this.current;
  }

  has(name) {
    return Boolean(this.states[name]);
  }

  change(name, payload = null) {
    if (!this.states[name]) throw new Error(`StateMachine: unknown state "${name}"`);
    const prev = this.current;
    if (prev && this.states[prev] && this.states[prev].exit) this.states[prev].exit(this.owner, this.ctx);
    this.previous = prev;
    this.current = name;
    this.time = 0;
    this.payload = payload;
    this.history.push({ name, at: performance.now() });
    if (this.history.length > 24) this.history.shift();
    const state = this.states[name];
    if (state.enter) state.enter(this.owner, this.ctx, payload);
    return this;
  }

  /** Change only if not already in that state. */
  ensure(name, payload = null) {
    if (this.current !== name) this.change(name, payload);
    else if (payload !== null) this.payload = payload;
    return this;
  }

  update(dt) {
    this.time += dt;
    const state = this.states[this.current];
    if (state && state.update) state.update(this.owner, dt, this.ctx);
  }

  get stateTime() {
    return this.time;
  }
}

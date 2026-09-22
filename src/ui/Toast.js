import { el } from './dom.js';

/** Toast stack for world events (floor completed, weather change, camera mode...). */
export class ToastLayer {
  constructor(root) {
    this.root = el('div', { className: 'toast-stack' });
    root.append(this.root);
    this.items = [];
  }

  push(message, { kind = 'info', timeout = 3200, detail = null } = {}) {
    const node = el('div', { className: `toast toast-${kind}` }, [
      el('div', { className: 'toast-msg', text: message }),
      detail ? el('div', { className: 'toast-detail', text: detail }) : null,
    ]);
    this.root.append(node);
    requestAnimationFrame(() => node.classList.add('is-in'));
    const entry = { node, timer: null };
    entry.timer = setTimeout(() => this.remove(entry), timeout);
    this.items.push(entry);
    if (this.items.length > 5) this.remove(this.items[0]);
    return entry;
  }

  remove(entry) {
    const index = this.items.indexOf(entry);
    if (index < 0) return;
    this.items.splice(index, 1);
    clearTimeout(entry.timer);
    entry.node.classList.remove('is-in');
    setTimeout(() => entry.node.remove(), 320);
  }
}

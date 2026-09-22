import { el, button } from './dom.js';
import { clamp } from '../lib/mathx.js';

const TRADES = [
  { id: 'excavation', label: '土方', color: '#b98a4f' },
  { id: 'foundation', label: '基础', color: '#9aa0a6' },
  { id: 'core', label: '结构', color: '#6f9fd8' },
  { id: 'facade', label: '外墙', color: '#7fb069' },
  { id: 'glazing', label: '幕墙', color: '#5fc8d8' },
  { id: 'roofing', label: '屋面', color: '#c98b5a' },
  { id: 'fitout', label: '机电', color: '#b48ad8' },
  { id: 'cleanup', label: '清理', color: '#8a9aa8' },
];

/**
 * TimelineWidget - the construction scrubber. Dragging it rewinds/forwards the
 * whole world (buildings, crews, loads) because everything derives from the clock.
 */
export class TimelineWidget {
  constructor(root, { time, construction, bus, onScrub }) {
    this.time = time;
    this.construction = construction;
    this.bus = bus;
    this.onScrub = onScrub;
    this.dragging = false;
    this.range = construction.timeline || { from: 1, to: 16 };

    this.markerLayer = el('div', { className: 'timeline-markers' });
    this.output = el('div', { className: 'timeline-readout' });
    this.track = el('div', { className: 'timeline-track' });
    this.fill = el('div', { className: 'timeline-fill' });
    this.handle = el('div', { className: 'timeline-handle' }, [el('span', { className: 'timeline-handle-label', text: 'DAY' })]);
    this.track.append(this.fill, this.handle, this.markerLayer);

    this.dayTicks = el('div', { className: 'timeline-ticks' });
    for (let day = this.range.from; day <= this.range.to; day++) {
      const tick = el('span', { className: 'timeline-tick', text: String(day) });
      tick.style.left = `${((day - this.range.from) / (this.range.to - this.range.from)) * 100}%`;
      this.dayTicks.append(tick);
    }

    this.playButton = button('⏸', () => this.togglePlay(), { className: 'timeline-play', title: '播放/暂停 (Space)' });
    this.backButton = button('«', () => this.step(-1), { className: 'timeline-step', title: '后退 1 天 (←)' });
    this.fwdButton = button('»', () => this.step(1), { className: 'timeline-step', title: '前进 1 天 (→)' });
    this.speedLabel = el('span', { className: 'timeline-speed', text: '1.0x' });

    const legend = el('div', { className: 'timeline-legend' });
    for (const trade of TRADES) {
      const chip = el('span', { className: 'legend-chip' }, [
        el('i', { className: 'legend-dot', style: { background: trade.color } }),
        el('span', { text: trade.label }),
      ]);
      chip.dataset.trade = trade.id;
      chip.title = trade.label;
      legend.append(chip);
      this.tradeTrades = this.tradeTrades || {};
      this.tradeTrades[trade.id] = chip;
    }

    this.wrap = el('div', { className: 'timeline' }, [
      el('div', { className: 'timeline-left' }, [this.backButton, this.playButton, this.fwdButton, this.speedLabel]),
      el('div', { className: 'timeline-center' }, [
        el('div', { className: 'timeline-head-row' }, [
          el('span', { className: 'timeline-title', text: '施工时间轴' }),
          this.output,
        ]),
        this.track,
        this.dayTicks,
        legend,
      ]),
    ]);
    root.append(this.wrap);

    this._bindPointer();
    bus.on('construction:progress', () => this.refreshMarkers());
    bus.on('time:paused', ({ paused }) => {
      this.playButton.textContent = paused ? '▶' : '⏸';
      this.wrap.classList.toggle('is-paused', paused);
    });
    bus.on('time:speed', ({ speed }) => {
      this.speedLabel.textContent = `${speed.toFixed(speed < 1 ? 1 : 0)}x`;
    });
    this.refreshMarkers();
    this.update();
  }

  _bindPointer() {
    const positionToDay = (clientX) => {
      const rect = this.track.getBoundingClientRect();
      const t = clamp((clientX - rect.left) / rect.width, 0, 1);
      return this.range.from + t * (this.range.to - this.range.from);
    };
    const move = (event) => {
      if (!this.dragging) return;
      this.onScrub(positionToDay(event.clientX));
    };
    const up = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.wrap.classList.remove('is-dragging');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    this.track.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.wrap.classList.add('is-dragging');
      this.onScrub(positionToDay(event.clientX));
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    this.track.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.step(event.deltaY > 0 ? 0.25 : -0.25);
    }, { passive: false });
  }

  togglePlay() {
    this.time.togglePause();
  }

  step(days) {
    this.onScrub(this.time.day + days);
  }

  /** Trade markers are derived from the config so the timeline always matches. */
  refreshMarkers() {
    this.markerLayer.replaceChildren();
    const trades = this.construction.trades || [];
    const span = this.range.to - this.range.from;
    for (const trade of trades) {
      const left = ((trade.start - this.range.from) / span) * 100;
      const width = ((trade.end - trade.start) / span) * 100;
      const meta = TRADES.find((t) => t.id === trade.id);
      const bar = el('div', {
        className: 'timeline-marker',
        style: { left: `${left}%`, width: `${width}%`, background: meta ? meta.color : '#7f8c9b' },
        attrs: { title: `${trade.label}  Day ${trade.start.toFixed(1)} - ${trade.end.toFixed(1)}` },
      });
      this.markerLayer.append(bar);
    }
  }

  update() {
    if (this.dragging) return;
    const { day } = this.time;
    const t = clamp((day - this.range.from) / (this.range.to - this.range.from), 0, 1);
    this.fill.style.width = `${t * 100}%`;
    this.handle.style.left = `${t * 100}%`;
    this.handle.querySelector('.timeline-handle-label').textContent = `DAY ${Math.floor(day)}`;
    const snapshots = this.construction.snapshot();
    const main = snapshots[0];
    const stageNames = {
      excavation: '土方开挖',
      foundation: '基础施工',
      structure: '主体结构',
      facade: '外墙施工',
      glazing: '幕墙安装',
      complete: '竣工收尾',
    };
    const stage = main ? stageNames[main.stage] || main.stage : '—';
    this.output.textContent = main
      ? `${this.time.formatted}  ·  ${stage}  ·  ${main.floors}/${main.target}F`
      : this.time.formatted;
    this.wrap.classList.toggle('is-late', day > this.range.to - 1.5);
  }
}

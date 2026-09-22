import { el, button } from './dom.js';
import { ToastLayer } from './Toast.js';
import { TimelineWidget } from './Timeline.js';
import { worldPanel, constructionPanel, cameraPanel, debugPanel } from './Panels.js';

const CAMERA_QUICK = [
  { id: 'overlook', label: '全景' },
  { id: 'tower', label: '主楼' },
  { id: 'street', label: '街道' },
  { id: 'yard', label: '堆场' },
  { id: 'crane', label: '塔吊' },
  { id: 'tour', label: '游览' },
  { id: 'followForeman', label: '跟随' },
  { id: 'flyover', label: '电影' },
];

const QUALITY_PRESETS = {
  high: { pixelRatio: 1.5, shadows: true, shadowMap: 2048, aa: true },
  balanced: { pixelRatio: 1.15, shadows: true, shadowMap: 1536, aa: true },
  perf: { pixelRatio: 1, shadows: false, shadowMap: 1024, aa: false },
};

/**
 * UISystem - owns every DOM surface. Panels are rebuilt from system snapshots at
 * a low cadence (6 Hz) so the render loop stays untouched by DOM work.
 */
export class UISystem {
  constructor({ bus, systems, host = null, weatherOrder = [] }) {
    this.bus = bus;
    this.systems = systems;
    this.root = host || document.getElementById('ui-root');
    this.debugVisible = false;
    this.cinematic = false;
    this.timeCycle = true;
    this.quality = 'high';
    this._uiTimer = 0;
    this._avgFps = 60;
    this._build();
    this._bindEvents();
    this._bindKeys();
  }

  _build() {
    this.toasts = new ToastLayer(this.root);

    const brand = el('div', { className: 'brand' }, [
      el('div', { className: 'brand-mark', text: '◳' }),
      el('div', { className: 'brand-text' }, [
        el('div', { className: 'brand-title', text: '河畔塔楼 · 施工沙盘' }),
        el('div', { className: 'brand-sub', text: 'RIVERSIDE TOWER · CONSTRUCTION DIORAMA' }),
      ]),
    ]);
    this.brandSub = brand.querySelector('.brand-sub');

    this.clockChip = el('div', { className: 'chip chip-clock', text: 'DAY 06 · 08:20' });
    this.weatherChip = el('div', { className: 'chip chip-weather', text: '晴' });
    this.statsChip = el('div', { className: 'chip chip-stats', text: '60 FPS · 0 DC · 0.0M TRI' });
    this.modeChip = el('div', { className: 'chip chip-mode', text: '沙盘视角' });
    this.followChip = el('div', { className: 'chip chip-follow is-hidden', text: '跟随: worker-01' });
    this.audioChip = el('button', {
      className: 'chip chip-btn',
      text: '🔊',
      attrs: { title: '声音 (M)' },
      on: { click: () => this.systems.audio.toggleMute() },
    });
    this.cineChip = button('🎬 Cinematic F9', () => this.toggleCinematic(), { className: 'chip chip-btn accent' });
    this.helpChip = button('? 快捷键', () => this._toggleHelp(), { className: 'chip chip-btn' });

    this.topbar = el('header', { className: 'topbar' }, [
      brand,
      el('div', { className: 'topbar-right' }, [
        this.clockChip,
        this.weatherChip,
        this.modeChip,
        this.statsChip,
        this.audioChip,
        this.cineChip,
        this.helpChip,
      ]),
    ]);

    this.panelRack = el('aside', { className: 'panel-rack' });
    this.worldPanel = worldPanel(this._api());
    this.constructionPanel = constructionPanel(this._api());
    this.cameraPanel = cameraPanel(this._api());
    this.debugPanel = debugPanel(this._api());
    this.panelRack.append(this.worldPanel, this.constructionPanel, this.cameraPanel, this.debugPanel);

    this.cameraQuick = el('div', { className: 'camera-quick' });
    for (const preset of CAMERA_QUICK) {
      this.cameraQuick.append(
        button(preset.label, () => this.systems.camera.applyPreset(preset.id), {
          className: 'quick-btn',
          dataset: { preset: preset.id },
        }),
      );
    }

    this.timeline = new TimelineWidget(this.root, {
      time: this.systems.time,
      construction: this.systems.construction,
      bus: this.bus,
      onScrub: (day) => this.systems.scrubTo(day),
    });

    this.debugOverlay = el('div', { className: 'debug-overlay is-hidden' });
    this.followChipEl = this.followChip;
    this.letterboxTop = el('div', { className: 'letterbox top' });
    this.letterboxBottom = el('div', { className: 'letterbox bottom' });

    this.hintBar = el('div', { className: 'hint-bar' }, [
      el('span', { text: 'Space 暂停' }),
      el('span', { className: 'dot' }),
      el('span', { text: '[ ] 速度' }),
      el('span', { className: 'dot' }),
      el('span', { text: '← → 天数' }),
      el('span', { className: 'dot' }),
      el('span', { text: '1-9 机位' }),
      el('span', { className: 'dot' }),
      el('span', { text: 'W 天气' }),
      el('span', { className: 'dot' }),
      el('span', { text: 'F2 调试' }),
      el('span', { className: 'dot' }),
      el('span', { text: 'F9 电影' }),
    ]);

    this.helpOverlay = this._buildHelp();

    this.root.append(
      this.topbar,
      this.panelRack,
      this.cameraQuick,
      this.timeline.wrap,
      this.hintBar,
      this.debugOverlay,
      this.followChipEl,
      this.letterboxTop,
      this.letterboxBottom,
      this.helpOverlay,
    );
  }

  _api() {
    const systems = this.systems;
    return {
      time: systems.time,
      weather: systems.weather,
      construction: systems.construction,
      camera: systems.camera,
      audio: systems.audio,
      bus: this.bus,
      weatherOrder: systems.weatherOrder,
      getDebugState: () => systems.world.getDebugState(),
      setDebugFlag: (key, value) => systems.world.setDebugFlag(key, value),
      getGpuInfo: () => (systems.app ? systems.app.gpuInfo : null),
      getShaderFailures: () => (systems.app && systems.app.shaderFailures ? systems.app.shaderFailures : []),
      setShadows: (value) => systems.world.setShadows(value),
      setQuality: (value) => this.setQuality(value),
      getQuality: () => this.quality,
      onTimeCycle: (value) => {
        this.timeCycle = value;
      },
      getTimeCycle: () => this.timeCycle,
      getCranes: () => systems.world.getCraneStatus(),
      getCrews: () => systems.world.getCrewStatus(),
      getFollowCandidates: () => systems.world.getFollowCandidates(),
      getFollowCandidate: () => (systems.world.getFollowCandidates()[0] || {}).id || null,
      toggleCinematic: () => this.toggleCinematic(),
      camera: systems.camera,
    };
  }

  _buildHelp() {
    const rows = [
      ['Space', '播放 / 暂停'],
      ['← / →', '时间轴前进 / 后退 1 天'],
      ['[ / ]', '播放速度 -/+ (0.5x ~ 20x)'],
      ['1 - 9', '切换镜头预设'],
      ['O', '自动环绕开关'],
      ['W', '循环切换天气'],
      ['F2', '显示路网 / 目标 / 性能'],
      ['F9', '电影模式（隐藏界面）'],
      ['H', '显示 / 隐藏界面'],
      ['M', '静音'],
      ['鼠标', '左键旋转 · 右键平移 · 滚轮缩放'],
    ];
    const list = el('div', { className: 'help-list' });
    for (const [key, text] of rows) {
      list.append(el('div', { className: 'help-row' }, [el('kbd', { text: key }), el('span', { text })]));
    }
    const overlay = el('div', { className: 'help-overlay is-hidden' }, [
      el('div', { className: 'help-card' }, [
        el('div', { className: 'help-head' }, [el('h3', { text: '操作说明' }), button('关闭', () => this._toggleHelp(false), { className: 'ghost' })]),
        list,
      ]),
    ]);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this._toggleHelp(false);
    });
    return overlay;
  }

  _toggleHelp(force = null) {
    const next = force === null ? this.helpOverlay.classList.contains('is-hidden') : force;
    this.helpOverlay.classList.toggle('is-hidden', !next);
    if (next) this.systems.time.setPaused(true);
  }

  _bindEvents() {
    this.bus.on('time:tick', () => {
      this.clockChip.textContent = `${this.systems.time.formatted}`;
    });
    this.bus.on('weather:changed', ({ name, preset }) => {
      this.weatherChip.textContent = preset.label;
      this.toasts.push(`天气切换：${preset.label}`, { kind: 'weather' });
      this.systems.audio.onWeather(name);
    });
    this.bus.on('construction:stage', ({ stage, floors, day }) => {
      const labels = {
        excavation: '土方开挖完成，转入基础施工',
        foundation: '基础底板浇筑完成',
        structure: '主体结构施工中',
        facade: '外墙砌筑开始',
        glazing: '幕墙玻璃安装开始',
        complete: '主体竣工！',
      };
      this.toasts.push(labels[stage] || stage, { kind: 'stage', detail: `Day ${day.toFixed(1)} · ${floors}F` });
    });
    this.bus.on('construction:floorComplete', ({ floor, total }) => {
      this.toasts.push(`第 ${floor} 层结构封顶`, { kind: 'success', detail: `目标 ${total} 层 · 塔吊继续吊运` });
      this.systems.camera.addShake(0.35, 0.5);
      this.systems.audio.hit('impact', { gain: 0.25, freq: 96 });
    });
    this.bus.on('camera:mode', ({ label, mode }) => {
      const labels = {
        diorama: '沙盘视角',
        autoOrbit: '自动环绕',
        streetTour: '街道游览',
        follow: '跟随视角',
        flyover: '电影环绕',
      };
      this.modeChip.textContent = labels[mode] || label || mode;
      for (const btn of this.cameraQuick.children) {
        btn.classList.toggle('is-active', btn.dataset.preset === this.systems.camera.activePreset);
      }
    });
    this.bus.on('camera:follow', ({ entityId }) => {
      this.followChipEl.textContent = `跟随: ${entityId}`;
    });
    this.bus.on('vehicle:beep', () => {});
    this.bus.on('audio:muted', ({ muted }) => {
      this.audioChip.textContent = muted ? '🔇' : '🔊';
    });
    this.bus.on('debug:toggled', ({ visible }) => {
      this.debugVisible = visible;
      this.debugOverlay.classList.toggle('is-hidden', !visible);
    });
  }

  _bindKeys() {
    window.addEventListener('keydown', (event) => {
      if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      const time = this.systems.time;
      switch (event.code) {
        case 'Space':
          event.preventDefault();
          time.togglePause();
          break;
        case 'BracketLeft': {
          const list = time.speedPresets;
          const index = list.indexOf(time.speed);
          time.setSpeed(list[Math.max(0, index - 1)] ?? list[0]);
          break;
        }
        case 'BracketRight': {
          const list = time.speedPresets;
          const index = list.indexOf(time.speed);
          time.setSpeed(list[Math.min(list.length - 1, index + 1)] ?? list[list.length - 1]);
          break;
        }
        case 'ArrowLeft':
          this.systems.scrubTo(time.day - 1);
          break;
        case 'ArrowRight':
          this.systems.scrubTo(time.day + 1);
          break;
        case 'KeyW':
          this.systems.weather.cycleNext(1);
          break;
        case 'KeyM':
          this.systems.audio.toggleMute();
          break;
        case 'KeyH':
          this.toggleUi();
          break;
        case 'KeyO':
          this.systems.camera.toggleAutoOrbit();
          break;
        case 'F2':
          event.preventDefault();
          this.toggleDebug();
          break;
        case 'F9':
          event.preventDefault();
          this.toggleCinematic();
          break;
        default:
          break;
      }
    });
  }

  toggleUi(force = null) {
    const hidden = force === null ? !this.root.classList.contains('ui-hidden') : force;
    this.root.classList.toggle('ui-hidden', hidden);
    this.bus.emit('ui:hidden', { hidden });
    return hidden;
  }

  toggleDebug(force = null) {
    const visible = force === null ? !this.debugVisible : force;
    this.debugVisible = visible;
    this.systems.world.setDebugEnabled(visible);
    this.debugOverlay.classList.toggle('is-hidden', !visible);
    this.bus.emit('debug:toggled', { visible });
    return visible;
  }

  toggleCinematic(force = null) {
    this.cinematic = force === null ? !this.cinematic : force;
    this.root.classList.toggle('cinematic', this.cinematic);
    this.bus.emit('ui:cinematic', { enabled: this.cinematic, preset: 'flyover' });
    if (this.cinematic) {
      this.systems.camera.applyPreset('flyover');
      this.toasts.push('电影模式已开启', { kind: 'info', detail: '按 F9 或 Esc 退出' });
    }
    return this.cinematic;
  }

  setQuality(name) {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return;
    this.quality = name;
    this.systems.world.setQuality(preset);
    this.toasts.push(`画质：${name}`, { kind: 'info', timeout: 1800 });
  }

  /** Called every frame; DOM writes are throttled to ~7 Hz. */
  update(dt, stats) {
    this._avgFps = this._avgFps * 0.9 + (stats.fps || 60) * 0.1;
    this.timeline.update();
    this._uiTimer += dt;
    if (this._uiTimer < 0.14) return;
    this._uiTimer = 0;
    this.statsChip.textContent = `${Math.round(this._avgFps)} FPS · ${stats.drawCalls} DC · ${(stats.triangles / 1e6).toFixed(2)}M TRI`;
    this.modeChip.textContent = this.modeChip.textContent || '';
    this.worldPanel.update();
    this.constructionPanel.update();
    this.cameraPanel.update();
    if (this.debugVisible) {
      this.debugOverlay.textContent = stats.debugText || '';
      this.debugPanel.update(stats.debugText || '');
    }
    if (this.timeCycle) {
      // progress chip shows the virtual clock; provided by events already
    }
  }

  notify(message, options) {
    return this.toasts.push(message, options);
  }
}

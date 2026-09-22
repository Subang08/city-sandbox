import { el, button, toggle, slider, segmented, bar, row, panel } from './dom.js';
import { formatClock } from '../lib/mathx.js';

const STAGE_LABELS = {
  excavation: '土方开挖',
  foundation: '基础施工',
  structure: '主体结构',
  facade: '外墙施工',
  glazing: '幕墙安装',
  complete: '竣工收尾',
};

/** World panel: virtual clock, playback, weather, audio. */
export function worldPanel(api) {
  const { time, weather, audio, bus } = api;
  const clock = el('div', { className: 'big-clock', text: '08:20' });
  const dayLabel = el('div', { className: 'big-day', text: 'DAY 06' });
  const phaseLabel = el('div', { className: 'phase-label', text: '白天 · 施工中' });

  const speedSeg = segmented({
    options: time.speedPresets.map((speed) => ({ value: speed, label: `${speed}x` })),
    value: 1,
    onChange: (value) => time.setSpeed(Number(value)),
  });

  const weatherSeg = segmented({
    options: (api.weatherOrder || []).map((name) => ({
      value: name,
      label: weather.presets[name].label.split(' ')[0],
      title: weather.presets[name].label,
    })),
    value: weather.current,
    onChange: (value) => weather.set(value),
  });

  const timeScrub = slider({
    label: '时刻',
    min: 0,
    max: 1439,
    step: 5,
    value: time.minuteOfDay,
    format: (value) => formatClock(value),
    onInput: (value) => time.setMinuteOfDay(value),
  });

  const cycleToggle = toggle('时间自动循环', true, (value) => api.onTimeCycle(value));
  const audioToggle = toggle('环境音效', !audio.muted, (value) => audio.setMuted(!value));
  const volume = slider({
    label: '音量',
    min: 0,
    max: 1,
    step: 0.05,
    value: audio.volume,
    format: (value) => `${Math.round(value * 100)}%`,
    onInput: (value) => audio.setVolume(value),
  });
  const shadowToggle = toggle('实时阴影', true, (value) => api.setShadows(value));
  const qualityRow = el('div', { className: 'row' }, [
    el('span', { className: 'row-label', text: '画质' }),
    segmented({
      options: [
        { value: 'high', label: '高' },
        { value: 'balanced', label: '均衡' },
        { value: 'perf', label: '性能' },
      ],
      value: api.getQuality(),
      onChange: (value) => api.setQuality(value),
    }),
  ]);

  const wrap = panel('世界 World', { id: 'world' });
  wrap.body.append(
    el('div', { className: 'clock-block' }, [clock, el('div', { className: 'clock-sub' }, [dayLabel, phaseLabel])]),
    row('速度', speedSeg),
    timeScrub,
    cycleToggle,
    el('div', { className: 'divider' }),
    el('div', { className: 'sub-title', text: '天气 Weather' }),
    weatherSeg,
    el('div', { className: 'hint', text: '快捷键 W 切换天气，[ ] 调整速度' }),
    el('div', { className: 'divider' }),
    audioToggle,
    volume,
    shadowToggle,
    qualityRow,
  );

  wrap.update = () => {
    clock.textContent = time.clock;
    dayLabel.textContent = `DAY ${String(Math.floor(time.day)).padStart(2, '0')}`;
    phaseLabel.textContent = time.paused
      ? '已暂停'
      : time.isWorkHours
        ? '白天 · 施工中'
        : '夜间 · 照明中';
    timeScrub.setValue(time.minuteOfDay);
    speedSeg.setValue(time.speed);
    weatherSeg.setValue(weather.current);
    cycleToggle.querySelector('input').checked = api.getTimeCycle();
  };
  return wrap;
}

/** Construction panel: build stage, trade progress, per-building detail. */
export function constructionPanel(api) {
  const { construction, time } = api;
  const stageValue = el('span', { className: 'stat-value', text: '—' });
  const floorValue = el('span', { className: 'stat-value', text: '0/12' });
  const progressBar = bar(0, 'accent');
  const tradeRows = new Map();
  const craneTable = el('div', { className: 'mini-table' });

  const tradeList = el('div', { className: 'trade-list' });
  for (const trade of construction.trades) {
    const fill = bar(0);
    const value = el('span', { className: 'trade-value', text: '0%' });
    tradeRows.set(trade.id, { fill, value });
    tradeList.append(
      el('div', { className: 'trade-row' }, [
        el('div', { className: 'trade-head' }, [el('span', { text: trade.label }), value]),
        fill,
      ]),
    );
  }

  const wrap = panel('施工 Construction', { id: 'construction' });
  wrap.body.append(
    el('div', { className: 'stat-grid' }, [
      el('div', { className: 'stat' }, [el('span', { className: 'stat-label', text: '当前工序' }), stageValue]),
      el('div', { className: 'stat' }, [el('span', { className: 'stat-label', text: '层数' }), floorValue]),
    ]),
    progressBar,
    el('div', { className: 'divider' }),
    tradeList,
    el('div', { className: 'divider' }),
    el('div', { className: 'sub-title', text: '塔吊状态' }),
    craneTable,
    el('div', { className: 'hint', text: '提示：拖动底部时间轴可回溯任意施工阶段' }),
  );

  const updateCranes = () => {
    const cranes = api.getCranes();
    if (!cranes.length) {
      craneTable.replaceChildren(el('div', { className: 'hint', text: '暂无塔吊数据' }));
      return;
    }
    const rows = [
      el('div', { className: 'mini-row head' }, [
        el('span', { text: '设备' }),
        el('span', { text: '状态' }),
        el('span', { text: '载重' }),
      ]),
    ];
    for (const crane of cranes) {
      rows.push(
        el('div', { className: 'mini-row' }, [
          el('span', { text: crane.id }),
          el('span', { text: crane.status }),
          el('span', { text: `${crane.load.toFixed(1)} t` }),
        ]),
      );
    }
    rows.push(
      el('div', { className: 'mini-row head', style: { marginTop: '6px' } }, [
        el('span', { text: '班组' }),
        el('span', { text: '任务' }),
        el('span', { text: '人数' }),
      ]),
    );
    for (const crew of api.getCrews()) {
      rows.push(
        el('div', { className: 'mini-row' }, [
          el('span', { text: crew.role }),
          el('span', { text: crew.task }),
          el('span', { text: String(crew.count) }),
        ]),
      );
    }
    craneTable.replaceChildren(...rows);
  };

  wrap.update = () => {
    const snapshot = construction.snapshot();
    const main = snapshot[0];
    if (!main) return;
    stageValue.textContent = STAGE_LABELS[main.stage] || main.stage;
    floorValue.textContent = `${main.floors}/${main.target}F`;
    progressBar.setValue(main.floors / Math.max(1, main.target));
    for (const trade of main.trades) {
      const entry = tradeRows.get(trade.id);
      if (!entry) continue;
      entry.fill.setValue(trade.progress);
      entry.value.textContent = `${Math.round(trade.progress * 100)}%`;
    }
    updateCranes();
    wrap.querySelector('.panel-title').textContent = `施工 Construction · Day ${Math.floor(time.day)}`;
  };
  return wrap;
}

/** Camera panel: presets, modes, orbit and tour tuning, cinematic. */
export function cameraPanel(api) {
  const { camera, bus } = api;
  const presetGrid = el('div', { className: 'preset-grid' });
  for (const preset of camera.listPresets()) {
    const btn = button(preset.label, () => camera.applyPreset(preset.id), {
      className: 'preset-btn',
      title: `${preset.label} (${preset.mode})`,
    });
    btn.dataset.preset = preset.id;
    presetGrid.append(btn);
  }
  const modeSeg = segmented({
    options: [
      { value: 'diorama', label: '沙盘' },
      { value: 'autoOrbit', label: '环绕' },
      { value: 'streetTour', label: '游览' },
      { value: 'follow', label: '跟随' },
      { value: 'flyover', label: '电影' },
    ],
    value: camera.mode,
    onChange: (value) => {
      if (value === 'follow') camera.setFollowTarget(api.getFollowCandidate());
      else camera.setMode(value);
    },
  });
  const followSelect = el('select', { className: 'select' });
  for (const candidate of api.getFollowCandidates()) {
    followSelect.append(el('option', { text: candidate.label, attrs: { value: candidate.id } }));
  }
  followSelect.addEventListener('change', (event) => camera.setFollowTarget(event.target.value));

  const orbitToggle = toggle('闲置自动环绕', camera.autoOrbit.enabled, (value) => camera.toggleAutoOrbit(value));
  const orbitSpeed = slider({
    label: '环绕速度',
    min: 0.01,
    max: 0.25,
    step: 0.01,
    value: camera.autoOrbit.speed,
    format: (value) => `${(value * 100).toFixed(0)}°/s`,
    onInput: (value) => camera.setAutoOrbitSpeed(value),
  });
  const tourSpeed = slider({
    label: '游览速度',
    min: 0.006,
    max: 0.06,
    step: 0.002,
    value: camera.tour.speed,
    format: (value) => value.toFixed(3),
    onInput: (value) => {
      camera.tour.speed = value;
    },
  });
  const fovSlider = slider({
    label: '焦距 FOV',
    min: 18,
    max: 60,
    step: 1,
    value: camera.camera.fov,
    format: (value) => `${value}°`,
    onInput: (value) => {
      api.camera.camera.fov = value;
      api.camera.camera.updateProjectionMatrix();
    },
  });
  const cineButton = button('🎬 电影模式 (F9)', () => api.toggleCinematic(), { className: 'wide accent' });

  const wrap = panel('镜头 Camera', { id: 'camera' });
  wrap.body.append(
    presetGrid,
    row('模式', modeSeg),
    row('跟随目标', followSelect),
    orbitToggle,
    orbitSpeed,
    tourSpeed,
    fovSlider,
    cineButton,
    el('div', { className: 'hint', text: '鼠标左键旋转 · 右键平移 · 滚轮缩放 · 数字键 1-9 切换机位' }),
  );

  wrap.update = () => {
    modeSeg.setValue(camera.mode);
    orbitToggle.querySelector('input').checked = camera.autoOrbit.enabled;
    for (const btn of presetGrid.children) {
      btn.classList.toggle('is-active', btn.dataset.preset === camera.activePreset);
    }
  };
  return wrap;
}

/** Debug panel: overlays, helpers, GPU identity and a live performance readout. */
export function debugPanel(api) {
  const debugState = api.getDebugState();
  const toggles = {};
  const make = (key, label) =>
    toggle(label, debugState[key], (value) => api.setDebugFlag(key, value), { className: 'debug-toggle' });
  const list = el('div', { className: 'debug-list' }, [
    (toggles.graph = make('showWaypoints', '路网 / 航点 F2')),
    (toggles.road = make('showRoadGraph', '道路中心线')),
    (toggles.paths = make('showPaths', '实体路径与目标')),
    (toggles.bounds = make('showBounds', '包围盒')),
    (toggles.labels = make('showLabels', '实体标签')),
    (toggles.stats = make('showStats', '性能面板')),
  ]);
  const gpuBox = el('div', { className: 'gpu-info', text: 'GPU: …' });
  const statsBox = el('pre', { className: 'stats-box', text: '' });
  const wrap = panel('调试 Debug', { id: 'debug' });
  wrap.body.append(list, el('div', { className: 'divider' }), gpuBox, statsBox);

  const gpu = api.getGpuInfo ? api.getGpuInfo() : null;
  if (gpu) {
    gpuBox.replaceChildren(
      el('div', { className: 'gpu-row', text: `WebGL${gpu.webgl2 ? 2 : 1} · ${gpu.vendor}` }),
      el('div', { className: 'gpu-row strong', text: String(gpu.renderer).slice(0, 90) }),
      el('div', {
        className: `gpu-row ${api.getShaderFailures && api.getShaderFailures().length ? 'bad' : 'good'}`,
        text: api.getShaderFailures && api.getShaderFailures().length
          ? `着色器失败 ${api.getShaderFailures().length} 项`
          : '着色器编译正常',
      }),
    );
  }

  wrap.update = (stats) => {
    statsBox.textContent = stats;
  };
  return wrap;
}

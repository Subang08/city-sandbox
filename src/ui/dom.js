/** Tiny DOM helpers - keeps UI code terse and safe (no innerHTML with data). */
export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, html, attrs, style, on, dataset } = options;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (style) Object.assign(node.style, style);
  if (dataset) for (const [key, value] of Object.entries(dataset)) node.dataset[key] = String(value);
  if (on) {
    for (const [type, handler] of Object.entries(on)) node.addEventListener(type, handler);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function button(label, onClick, options = {}) {
  return el('button', {
    className: `btn ${options.className || ''}`.trim(),
    text: label,
    attrs: { type: 'button', title: options.title || label },
    on: { click: onClick },
    dataset: options.dataset,
  });
}

export function toggle(label, value, onChange, options = {}) {
  const input = el('input', {
    attrs: { type: 'checkbox', checked: value ? 'checked' : null },
    on: { change: (event) => onChange(event.target.checked) },
  });
  const wrap = el('label', { className: `switch ${options.className || ''}`.trim() }, [
    input,
    el('span', { className: 'switch-track' }, [el('span', { className: 'switch-knob' })]),
    el('span', { className: 'switch-label', text: label }),
  ]);
  return wrap;
}

export function slider({ label, min, max, step, value, format, onInput }) {
  const readout = el('span', { className: 'slider-value', text: format ? format(value) : String(value) });
  const input = el('input', {
    className: 'slider-input',
    attrs: { type: 'range', min, max, step, value },
    on: {
      input: (event) => {
        const next = Number(event.target.value);
        readout.textContent = format ? format(next) : String(next);
        onInput(next);
      },
    },
  });
  const wrap = el('div', { className: 'slider-row' }, [
    el('div', { className: 'slider-head' }, [el('span', { className: 'slider-label', text: label }), readout]),
    input,
  ]);
  wrap.setValue = (next) => {
    input.value = String(next);
    readout.textContent = format ? format(next) : String(next);
  };
  return wrap;
}

export function segmented({ options, value, onChange }) {
  const buttons = [];
  const wrap = el('div', { className: 'segmented' });
  for (const option of options) {
    const btn = el('button', {
      className: `seg-btn${option.value === value ? ' is-active' : ''}`,
      text: option.label,
      attrs: { type: 'button', title: option.title || option.label },
      on: {
        click: () => {
          for (const other of buttons) other.classList.toggle('is-active', other === btn);
          onChange(option.value);
        },
      },
    });
    buttons.push(btn);
    wrap.append(btn);
  }
  wrap.setValue = (next) => {
    options.forEach((option, index) => buttons[index].classList.toggle('is-active', option.value === next));
  };
  return wrap;
}

export function bar(value, className = '') {
  const fill = el('div', { className: 'bar-fill' });
  const wrap = el('div', { className: `bar ${className}`.trim() }, [fill]);
  wrap.setValue = (next) => {
    fill.style.width = `${Math.max(0, Math.min(1, next)) * 100}%`;
  };
  wrap.setValue(value);
  return wrap;
}

export function row(label, control, options = {}) {
  return el('div', { className: `row ${options.className || ''}`.trim() }, [
    el('span', { className: 'row-label', text: label }),
    control,
  ]);
}

export function panel(title, { id, collapsed = false, className = '' } = {}) {
  const body = el('div', { className: 'panel-body' });
  const chevron = el('span', { className: 'panel-chevron', text: '▾' });
  const head = el('button', {
    className: 'panel-head',
    attrs: { type: 'button' },
    on: {
      click: () => {
        wrap.classList.toggle('is-collapsed');
        chevron.textContent = wrap.classList.contains('is-collapsed') ? '▸' : '▾';
      },
    },
  }, [el('span', { className: 'panel-title', text: title }), chevron]);
  const wrap = el('section', { className: `panel ${className}`.trim(), dataset: id ? { panel: id } : null }, [head, body]);
  if (collapsed) wrap.classList.add('is-collapsed');
  wrap.body = body;
  return wrap;
}

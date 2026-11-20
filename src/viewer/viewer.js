'use strict';

// The output viewer: lists one run's policies and shows each one's NHI and MRP screenshots. Everything shown comes
// from the server's /api routes and is inserted as text, never as HTML, since issues and OCR text can contain markup.

const filters = {
  different: { label: 'different', test: (policy) => policy.kind === 'different' },
  'different-not-rechecked': {
    label: 'different, not re-checked',
    test: (policy) => policy.kind === 'different' && policy.coverTypeRecheck === undefined
  },
  identical: { label: 'identical', test: (policy) => policy.kind === 'identical' },
  endpoints: {
    label: 'matching end point',
    test: (policy) => ['referred', 'conditional', 'declined'].includes(policy.kind)
  },
  failed: { label: 'failed', test: (policy) => policy.kind === 'failed' },
  all: { label: '', test: () => true }
};

/** How a result is worded where the summary words it differently from its kind. */
const kindLabels = {
  'not-compared': 'both declined before declines were compared (run them again)',
  unrecorded: 'no result yet'
};

const zoomLevels = [0.5, 0.75, 1, 1.5, 2, 3];
const blinkIntervalMs = 500;

const state = { run: undefined, visible: [], selected: undefined, detail: undefined, mode: 'side', zoom: 2 };
let blinkTimer;
let syncingScroll = false;

const element = (id) => document.getElementById(id);

/**
 * Creates an element with text content and optional attributes.
 * @param {string} tag Element name.
 * @param {string} [text] Its text.
 * @param {Record<string, string>} [attributes] Attributes to set.
 * @returns {HTMLElement} The element.
 */
function create(tag, text, attributes = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) {
    node.textContent = text;
  }

  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }

  return response.json();
}

async function loadRun() {
  state.run = await fetchJson('/api/policies');
  const { environment, runName, root } = state.run;
  element('run').textContent = [environment, runName].filter(Boolean).join(' / ') || 'Output';
  element('run').title = root;
  const wanted = decodeURIComponent(location.hash.slice(1)) || state.selected;
  if (wanted && !state.run.policies.some(({ name, ...policy }) => name === wanted && currentFilter().test(policy))) {
    if (state.run.policies.some(({ name }) => name === wanted)) {
      element('filter').value = 'all';
    }
  }

  renderList();
  if (wanted && state.visible.some(({ name }) => name === wanted)) {
    await selectPolicy(wanted);
  }
}

function currentFilter() {
  return filters[element('filter').value] ?? filters.different;
}

function renderList() {
  const filter = currentFilter();
  state.visible = state.run.policies.filter(filter.test);
  const list = element('policy-list');
  list.replaceChildren(...state.visible.map(listItem));
  element('count').textContent = `${state.visible.length} of ${state.run.policies.length}`;
  const empty = element('empty');
  empty.hidden = state.visible.length > 0;
  empty.textContent = `No ${filter.label ? `${filter.label} ` : ''}policies in ${state.run.root}`;
  markSelected();
}

function listItem(policy) {
  const item = create('li', policy.name, { 'data-name': policy.name, title: policy.endpoints ?? '' });
  if (policy.changedPercent !== undefined) {
    item.append(create('span', ` ${policy.changedPercent.toFixed(2)}%`));
  }

  const markers = [];
  if (policy.kind === 'different') {
    markers.push(policy.hasTextDifferences ? 'text' : 'visual only');
  }

  if (policy.coverTypeRecheck !== undefined) {
    markers.push('cover re-checked');
  }

  if (markers.length > 0) {
    item.append(create('span', markers.join(', '), { class: 'marker' }));
  }

  item.addEventListener('click', () => selectPolicy(policy.name));
  return item;
}

function markSelected() {
  for (const item of element('policy-list').children) {
    item.setAttribute('aria-current', String(item.dataset.name === state.selected));
  }
}

async function selectPolicy(name) {
  state.selected = name;
  markSelected();
  history.replaceState(null, '', `#${encodeURIComponent(name)}`);
  element('policy-list').querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  const detail = await fetchJson(`/api/policies/${encodeURIComponent(name)}`);
  if (state.selected !== name) {
    return;
  }

  state.detail = detail;
  renderPolicy();
}

function fileUrl(file) {
  return `/files/${encodeURIComponent(state.detail.name)}/${encodeURIComponent(file)}`;
}

function renderPolicy() {
  const { detail } = state;
  const failed = detail.kind === 'failed';
  element('toolbar').hidden = false;
  element('mode').hidden = failed;
  element('region-text').textContent = '';
  renderPane('pane-nhi', 'NHI', failed ? detail.images.failedNhi : detail.images.nhi, failed);
  renderPane('pane-mrp', 'MRP', failed ? detail.images.failedMrp : detail.images.mrp, failed);
  renderOverlay();
  renderPane('pane-diff', 'diff.png', detail.images.diff, false);
  renderRegions();
  renderDetails();
  setMode(failed ? 'side' : state.mode);
}

function renderPane(id, label, file, failed) {
  const pane = element(id);
  const title = failed ? `${label} failure` : label;
  if (file === undefined) {
    pane.replaceChildren(create('h2', title), create('p', `${title} screenshot not saved`, { class: 'missing' }));
    return;
  }

  const stage = create('div', undefined, { class: 'stage' });
  const image = create('img', undefined, { src: fileUrl(file), alt: `${title} screenshot` });
  image.addEventListener('load', drawRegionOutlines);
  stage.append(image);
  pane.replaceChildren(create('h2', title), stage);
}

function renderOverlay() {
  const { nhi, mrp } = state.detail.images;
  const pane = element('pane-overlay');
  if (nhi === undefined || mrp === undefined) {
    pane.replaceChildren(create('p', 'Slider and blink need both screenshots', { class: 'missing' }));
    return;
  }

  const stage = create('div', undefined, { class: 'stage' });
  stage.append(
    create('img', undefined, { src: fileUrl(nhi), alt: 'NHI screenshot' }),
    create('img', undefined, { src: fileUrl(mrp), alt: 'MRP screenshot', class: 'overlay-top' })
  );
  pane.replaceChildren(create('h2', 'NHI under MRP'), stage);
  applySlider();
}

function renderRegions() {
  const container = element('regions');
  const { regions } = state.detail;
  container.replaceChildren(...(regions.length > 0 ? [create('span', 'Regions: ')] : []));
  for (const region of regions) {
    const button = create('button', String(region.id), { type: 'button', 'data-region': String(region.id) });
    if (region.removed.length + region.added.length > 0) {
      button.title = 'Text changed';
      button.style.fontWeight = '700';
    }

    button.addEventListener('click', () => showRegion(region));
    container.append(button);
  }
}

function drawRegionOutlines() {
  for (const id of ['pane-nhi', 'pane-mrp']) {
    const stage = element(id).querySelector('.stage');
    const image = stage?.querySelector('img');
    if (!image?.complete || image.naturalWidth === 0) {
      continue;
    }

    const scale = image.clientWidth / image.naturalWidth;
    stage.querySelectorAll('.region').forEach((outline) => outline.remove());
    for (const { id: regionId, bounds } of state.detail.regions) {
      const outline = create('div', undefined, { class: 'region', 'data-region': String(regionId) });
      Object.assign(outline.style, {
        left: `${bounds.left * scale}px`,
        top: `${bounds.top * scale}px`,
        width: `${bounds.width * scale}px`,
        height: `${bounds.height * scale}px`
      });
      stage.append(outline);
    }
  }
}

function showRegion(region) {
  const text = element('region-text');
  text.replaceChildren(create('strong', `Region ${region.id}: `));
  if (region.removed.length + region.added.length === 0) {
    text.append('no text change');
  }

  region.removed.forEach((line) => text.append(create('div', `− ${line}`, { class: 'removed' })));
  region.added.forEach((line) => text.append(create('div', `+ ${line}`, { class: 'added' })));
  if (region.lowConfidence) {
    text.append(create('div', '(low OCR confidence: may be misread)'));
  }

  document.querySelectorAll('.region').forEach((outline) => {
    outline.classList.toggle('current', outline.dataset.region === String(region.id));
  });
  // The scale of whichever view is showing: a hidden pane's image has no width
  const image = [...document.querySelectorAll('#panes .pane:not([hidden]) img')].find(
    (candidate) => candidate.naturalWidth > 0 && candidate.clientWidth > 0
  );
  const scale = image ? image.clientWidth / image.naturalWidth : 1;
  for (const id of ['pane-nhi', 'pane-overlay', 'pane-diff']) {
    element(id).scrollTop = Math.max(0, region.bounds.top * scale - 40);
  }
}

function renderDetails() {
  const { detail } = state;
  const list = create('dl');
  const add = (term, value) => {
    if (value !== undefined && value !== '') {
      list.append(create('dt', term), create('dd', value));
    }
  };
  add('Policy', detail.name);
  add('Result', kindLabels[detail.kind] ?? detail.kind);
  add('Changed', detail.changedPercent === undefined ? undefined : `${detail.changedPercent.toFixed(2)}% of pixels`);
  add('Page sizes differ', detail.sizeDifference);
  add('End points', detail.endpoints);
  add('Cover type re-checked', detail.coverTypeRecheck);
  if (detail.endorsementOrderDiffers) {
    add('Endorsements', 'NHI and MRP listed them in different orders (put in standard order before comparing)');
  }

  detail.issues.forEach((issue) => add('Issue', issue));
  describeAnswerChanges(detail.answerChanges).forEach((change) => add('Answer changed', change));
  element('details').replaceChildren(list);
}

/** Flattens answer-changes.json into lines such as `NHI, Property circumstances: rebuilding cost 285,000 → 249995`. */
function describeAnswerChanges(answerChanges) {
  const lines = [];
  for (const [flow, sections] of Object.entries(answerChanges?.changes ?? {})) {
    for (const [section, changes] of Object.entries(sections ?? {})) {
      for (const change of changes ?? []) {
        lines.push(`${flow.toUpperCase()}, ${section}: ${change.question} ${change.before} → ${change.after}`);
      }
    }
  }

  return lines;
}

function setMode(mode) {
  state.mode = mode === 'side' || state.detail?.kind !== 'failed' ? mode : 'side';
  for (const button of element('mode').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  }

  const overlay = state.mode === 'slider' || state.mode === 'blink';
  element('pane-nhi').hidden = state.mode !== 'side';
  element('pane-mrp').hidden = state.mode !== 'side';
  element('pane-overlay').hidden = !overlay;
  element('pane-diff').hidden = state.mode !== 'diff';
  element('slider').hidden = state.mode !== 'slider';
  clearInterval(blinkTimer);
  const top = element('pane-overlay').querySelector('.overlay-top');
  if (top) {
    top.style.visibility = 'visible';
    top.style.clipPath = '';
  }

  if (state.mode === 'slider') {
    applySlider();
  } else if (state.mode === 'blink' && top) {
    blinkTimer = setInterval(() => {
      top.style.visibility = top.style.visibility === 'hidden' ? 'visible' : 'hidden';
    }, blinkIntervalMs);
  }

  drawRegionOutlines();
}

function applySlider() {
  const top = element('pane-overlay').querySelector('.overlay-top');
  if (top && state.mode === 'slider') {
    top.style.clipPath = `inset(0 0 0 ${element('slider').value}%)`;
  }
}

function setZoom(step) {
  state.zoom = Math.min(zoomLevels.length - 1, Math.max(0, state.zoom + step));
  document.documentElement.style.setProperty('--zoom', String(zoomLevels[state.zoom]));
  element('zoom-level').textContent = `${zoomLevels[state.zoom] * 100}%`;
  drawRegionOutlines();
}

/** Scrolls the other side-by-side pane to the same place, so pixel rows stay lined up. */
function syncScroll(event) {
  if (syncingScroll) {
    return;
  }

  syncingScroll = true;
  const other = element(event.target.id === 'pane-nhi' ? 'pane-mrp' : 'pane-nhi');
  other.scrollTop = event.target.scrollTop;
  other.scrollLeft = event.target.scrollLeft;
  requestAnimationFrame(() => {
    syncingScroll = false;
  });
}

function moveSelection(step) {
  const index = state.visible.findIndex(({ name }) => name === state.selected);
  const next = state.visible[index === -1 ? 0 : index + step];
  if (next !== undefined) {
    selectPolicy(next.name);
  }
}

function onKey(event) {
  if (event.target.closest('input, select, textarea') || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.key === 'j') {
    moveSelection(1);
  } else if (event.key === 'k') {
    moveSelection(-1);
  }
}

element('filter').addEventListener('change', renderList);
element('previous').addEventListener('click', () => moveSelection(-1));
element('next').addEventListener('click', () => moveSelection(1));
element('refresh').addEventListener('click', loadRun);
element('slider').addEventListener('input', applySlider);
element('mode').addEventListener('click', (event) => {
  const mode = event.target.closest('button')?.dataset.mode;
  if (mode) {
    setMode(mode);
  }
});
element('zoom').addEventListener('click', (event) => {
  const step = Number(event.target.closest('button')?.dataset.zoom);
  if (step) {
    setZoom(step);
  }
});
element('pane-nhi').addEventListener('scroll', syncScroll);
element('pane-mrp').addEventListener('scroll', syncScroll);
window.addEventListener('resize', drawRegionOutlines);
window.addEventListener('hashchange', () => {
  const name = decodeURIComponent(location.hash.slice(1));
  if (name && name !== state.selected) {
    selectPolicy(name);
  }
});
document.addEventListener('keydown', onKey);
loadRun().catch((error) => {
  element('empty').hidden = false;
  element('empty').textContent = `Could not load the policies: ${error.message}`;
});

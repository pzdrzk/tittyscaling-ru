import { LENGTH, VOLUME, MASS, TIME, POPULATION, calculate, quantity, number, clamp } from './math.mjs';
import { createState, defaultRulers, projectData, readProject } from './state.mjs';
import { paint, paintSummary } from './render.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const stage = $('#stage'), area = $('#drop-zone'), ctx = stage.getContext('2d');
const imageInput = $('#image-input'), projectInput = $('#project-input');
const catalogs = { length: LENGTH, volume: VOLUME, mass: MASS, time: TIME, population: POPULATION };
let state = createState(), image = null, view = { zoom: 1, panX: 0, panY: 0, scale: 1, x: 0, y: 0 };
let hitBoxes = { labels: [], annotations: [] }, drag = null, spacePressed = false;
let toastTimer, exportCanvas = null, projectLoad = 0, settingBefore = null;
let clipboardLoading = false;
const undoStack = [], redoStack = [];

function notify(message, error = false) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('error', error); toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 7500 : 3500);
}
function snapshot() { return { ...state, image: { ...state.image }, settings: { ...state.settings }, rulers: structuredClone(state.rulers), annotations: structuredClone(state.annotations), frozen: state.frozen ? structuredClone(state.frozen) : null }; }
function remember(previous = snapshot()) {
  undoStack.push(previous); if (undoStack.length > 30) undoStack.shift(); redoStack.length = 0;
  updateHistory();
}
function updateHistory() { $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }
async function historyStep(from, to) {
  if (!from.length) return;
  const target = from[from.length - 1];
  try {
    const nextImage = target.image.src ? await loadImage(target.image.src) : null;
    to.push(snapshot()); from.pop(); state = target; image = nextImage;
    $('#freeze').checked = !!state.frozen; syncAll(); fit(); updateHistory();
  } catch (e) { notify(e.message, true); }
}
function loadImage(src, cors = false) {
  return new Promise((resolve, reject) => {
    const img = new Image(); if (cors) img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { img.src = ''; reject(new Error('Загрузка заняла слишком много времени. Попробуйте загрузить файл.')); }, 25000);
    img.onload = () => { clearTimeout(timer); img.naturalWidth > 0 ? resolve(img) : reject(new Error('Изображение пустое.')); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('Не удалось открыть изображение. Для ссылок сервер должен разрешать CORS.')); };
    img.src = src;
  });
}
function normalizeImage(img) {
  const ratio = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight), Math.sqrt(16_000_000 / (img.naturalWidth * img.naturalHeight)));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  let src;
  try { src = canvas.toDataURL('image/png'); } catch { throw new Error('Сервер запрещает экспорт этого изображения. Скачайте его и загрузите как файл.'); }
  return { src, width: canvas.width, height: canvas.height, resized: ratio < 1 };
}
async function addImage(src, name, cors = false) {
  const ticket = ++projectLoad;
  $('#inspector-status').textContent = 'Загружаем изображение…';
  try {
    const img = await loadImage(src, cors); if (ticket !== projectLoad) return;
    const normalized = normalizeImage(img);
    const nextImage = await loadImage(normalized.src); if (ticket !== projectLoad) return;
    remember();
    state.image = { src: normalized.src, width: normalized.width, height: normalized.height, name };
    state.rulers = defaultRulers(); state.annotations = []; state.selected = 'reference'; state.frozen = null;
    image = nextImage; $('#freeze').checked = false; syncAll(); fit();
    notify(normalized.resized ? 'Изображение открыто. Большой файл уменьшен для удобной работы.' : 'Изображение открыто. Задайте масштаб светлой линейкой.');
    return true;
  } catch (e) { if (ticket === projectLoad) { notify(e.message, true); updateUI(); } return false; }
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Не удалось прочитать файл.')); reader.readAsDataURL(file); });
}
async function openImageFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|gif|avif|bmp)$/i.test(file.type) && !/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name)) return notify('Выберите PNG, JPG, WebP, GIF, AVIF или BMP.', true);
  if (file.size > 20 * 1024 * 1024) return notify('Файл больше 20 МБ. Уменьшите его перед загрузкой.', true);
  try { await addImage(await fileToDataURL(file), file.name || 'Изображение'); } catch (e) { notify(e.message, true); }
}

async function pasteImageFromClipboard() {
  if (clipboardLoading) return;
  const shortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘+V' : 'Ctrl+V';
  if (!navigator.clipboard?.read) return notify(`Браузер не поддерживает кнопку вставки. Скопируйте изображение и нажмите ${shortcut} на странице.`, true);
  clipboardLoading = true;
  const buttons = $$('[data-paste-image]');
  buttons.forEach(button => { button.disabled = true; button.setAttribute('aria-busy', 'true'); });
  try {
    // Read directly from the click so Safari and Chromium retain user activation.
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const types = [...item.types].filter(type => /^image\/(png|jpeg|webp|gif|avif|bmp)$/i.test(type));
      types.sort((a, b) => Number(b === 'image/png') - Number(a === 'image/png'));
      for (const type of types) {
        let blob;
        try { blob = await item.getType(type); } catch (error) {
          if (error.name === 'NotFoundError') continue;
          throw error;
        }
        if (!blob.size) continue;
        const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
        await openImageFile(new File([blob], `Из буфера обмена.${extension}`, { type }));
        return;
      }
    }
    notify('В буфере нет изображения. Скопируйте саму картинку или сделайте снимок экрана, затем попробуйте ещё раз.', true);
  } catch (error) {
    notify(error.name === 'NotAllowedError' || error.name === 'SecurityError'
      ? `Браузер не разрешил доступ к буферу. Разрешите чтение или вставьте изображение через ${shortcut} на странице.`
      : `Не удалось прочитать изображение из буфера. Попробуйте ${shortcut} или загрузку файла.`, true);
  } finally {
    clipboardLoading = false;
    buttons.forEach(button => { button.disabled = false; button.removeAttribute('aria-busy'); });
  }
}

function buildRulers() {
  const list = $('#ruler-list'); list.replaceChildren();
  state.rulers.slice(1).forEach(r => {
    const card = document.createElement('div'); card.className = 'ruler-card'; card.dataset.ruler = r.id; card.style.setProperty('--ruler-color', r.color);
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = r.enabled; check.dataset.rulerToggle = r.id; check.setAttribute('aria-label', `Учитывать ${r.name.toLowerCase()}`);
    const color = document.createElement('input'); color.type = 'color'; color.value = r.color; color.dataset.rulerColor = r.id; color.setAttribute('aria-label', `Цвет: ${r.name.toLowerCase()}`);
    const button = document.createElement('button'); button.className = 'ruler-name'; button.textContent = r.name; button.dataset.select = r.id; button.title = `Выбрать: ${r.name.toLowerCase()}`;
    const output = document.createElement('output'); output.dataset.rulerValue = r.id; output.textContent = '—';
    card.append(check, color, button, output); list.append(card);
  });
}
function buildAnnotations() {
  const list = $('#annotation-list'); list.replaceChildren();
  state.annotations.forEach(a => {
    const item = document.createElement('div'); item.className = 'annotation-item'; item.classList.toggle('selected', state.selected === a.id);
    const text = document.createElement('button'); text.textContent = a.text; text.dataset.selectAnnotation = a.id;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.className = 'icon-button'; remove.dataset.removeAnnotation = a.id; remove.setAttribute('aria-label', `Удалить подпись: ${a.text.slice(0, 30)}`);
    item.append(text, remove); list.append(item);
  });
  const selected = state.annotations.find(a => a.id === state.selected); $('#update-annotation').disabled = !selected;
}
function syncAll() {
  buildRulers(); buildAnnotations(); syncSettings(); updateUI();
}
function syncSettings() {
  $$('[data-setting]').forEach(el => {
    const value = state.settings[el.dataset.setting];
    if (document.activeElement === el) return;
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
  });
  $$('#count-segments button').forEach(b => b.classList.toggle('active', b.dataset.count === String(state.settings.count) || (b.dataset.count === 'custom' && ![1, 2].includes(state.settings.count))));
  $('#custom-count-label').hidden = [1, 2].includes(state.settings.count);
  $('#custom-count').value = state.settings.count;
}
function updateUI() {
  const ready = !!image, s = state.settings, r = ready ? state.frozen || calculate(state) : null;
  $('#empty-state').hidden = ready; stage.hidden = !ready; $('#zoom-toolbar').hidden = !ready;
  $('#save-project').disabled = !ready; $('#export-open').disabled = !ready; $('#toggle-rulers').disabled = !ready;
  $('#project-title').textContent = ready ? state.image.name.replace(/\.[a-z\d]+$/i, '') || 'Без названия' : 'Новый проект';
  $('#image-info').textContent = ready ? state.image.name : 'Рабочий холст';
  $('#canvas-size').textContent = ready ? `${state.image.width} × ${state.image.height}` : '— × —';
  $('#inspector-status').textContent = state.frozen ? 'Результаты зафиксированы' : ready ? 'Расчёты обновляются автоматически' : 'Готов к вашему изображению';
  $('#stage-tip').textContent = ready ? 'Тяните точки · Shift — ровный угол · Пробел — панорама' : 'PNG, JPG, WebP, GIF, AVIF · до 20 МБ';
  const output = {
    volume: r ? quantity(r.volume, VOLUME, s.volumeUnit) : '— л', mass: r ? quantity(r.mass, MASS, s.massUnit) : '— кг',
    growthMass: r ? `${quantity(r.growthMass, MASS, s.massUnit)} / ${TIME[s.growthOutputTime][1]}` : '—',
    surface: r ? `${number(r.surface)} м²` : '—', fabric: r ? `${number(r.fabric)} м²` : '—',
    fabricCost: r ? money(r.fabricCost) : '—', milk: r ? `${quantity(r.milkLitres / 1000, VOLUME, s.volumeUnit)} / ${TIME[s.milkTime][1]}` : '—',
    milkValue: r ? `${money(r.milkValue)} / ${TIME[s.milkTime][1]}` : '—',
    milkCalories: r ? `${number(r.milkCalories)} ккал` : '—', population: r ? `${number(r.population)} ${POPULATION[s.population][1]}` : '—',
  };
  $$('[data-output]').forEach(el => { el.textContent = output[el.dataset.output]; });
  $$('[data-count-label]').forEach(el => { el.textContent = s.count === 1 ? 'одной груди' : s.count === 2 ? 'всего бюста' : `для ${s.count} шт.`; });
  $$('[data-ruler-value]').forEach(el => { const i = state.rulers.findIndex(line => line.id === el.dataset.rulerValue); el.textContent = r ? quantity(r.diameters[i - 1], LENGTH, s.lengthUnit) : '—'; });
  $$('.ruler-card').forEach(el => {
    const ruler = state.rulers.find(line => line.id === el.dataset.ruler); el.classList.toggle('selected', state.selected === ruler.id); el.classList.toggle('disabled', !ruler.enabled);
    el.style.setProperty('--ruler-color', ruler.color); $('input[type="checkbox"]', el).checked = ruler.enabled;
  });
  $('.reference-card').style.borderColor = state.selected === 'reference' ? '#c8d7e4' : '';
  $('#formula').textContent = s.model === 'average' ? 'V = π / 6 × d³ × n' : 'V = π / 6 × a × b × c × n';
  $('#model-description').textContent = s.model === 'average' ? 'd — среднее включённых диаметров; n — количество.' : 'a, b, c — диаметры; недостающие оси заменяются средним.';
  $('#line-width-output').textContent = number(s.lineWidth); $('#font-size-output').textContent = number(s.fontSize);
  $('#toggle-rulers').setAttribute('aria-label', s.showRulers ? 'Скрыть линейки' : 'Показать линейки');
  syncSettings(); updateHistory(); draw();
}
function money(value) { return `${number(value)} ${ { RUB: '₽', USD: '$', EUR: '€' }[state.settings.currency] }`; }
function setTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(el => { const selected = el.dataset.tab === tab; el.classList.toggle('active', selected); el.setAttribute('aria-selected', String(selected)); el.tabIndex = selected ? 0 : -1; });
  $$('.pane').forEach(pane => { pane.hidden = pane.id !== `pane-${tab}`; });
  $('#inspector-scroll').scrollTop = 0;
}

function draw() {
  if (!image) return;
  const box = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(box.width * dpr), height = Math.round(box.height * dpr);
  if (!width || !height) return;
  if (stage.width !== width || stage.height !== height) { stage.width = width; stage.height = height; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, box.width, box.height);
  const fitScale = Math.min((box.width - 66) / state.image.width, (box.height - 140) / state.image.height);
  view.scale = Math.max(0.0001, fitScale * view.zoom);
  view.x = (box.width - state.image.width * view.scale) / 2 + view.panX;
  view.y = (box.height - state.image.height * view.scale) / 2 + view.panY - 5;
  ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, state.image.width, state.image.height); ctx.clip();
  hitBoxes = paint(ctx, image, state, { handles: true, scale: view.scale }); ctx.restore();
  $('#zoom-value').textContent = `${Math.round(view.zoom * 100)}%`;
}
function fit() { view.zoom = 1; view.panX = 0; view.panY = 0; draw(); }
function zoom(factor, anchor) {
  const oldScale = view.scale, oldX = view.x, oldY = view.y;
  const oldZoom = view.zoom; view.zoom = clamp(view.zoom * factor, 0.25, 12);
  if (anchor && oldZoom !== view.zoom) {
    const ratio = view.zoom / oldZoom;
    // Preserve the point beneath the wheel or pinch centre.
    const rect = stage.getBoundingClientRect();
    const baseX = (rect.width - state.image.width * oldScale * ratio) / 2;
    const baseY = (rect.height - state.image.height * oldScale * ratio) / 2 - 5;
    view.panX = anchor.x - (anchor.x - oldX) * ratio - baseX;
    view.panY = anchor.y - (anchor.y - oldY) * ratio - baseY;
  }
  draw();
}
function localPoint(event) {
  const rect = stage.getBoundingClientRect();
  return { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale };
}
function findHit(point) {
  const w = state.image.width, h = state.image.height, threshold = 13 / view.scale;
  for (const box of [...hitBoxes.annotations].reverse()) if (point.x >= box.x - threshold / 2 && point.x <= box.x + box.width && point.y >= box.y - threshold / 2 && point.y <= box.y + box.height) return { kind: 'text', id: box.id };
  if (!state.settings.showRulers) return null;
  // Endpoints take priority over labels where they overlap.
  for (const r of [...state.rulers].reverse()) {
    if (!r.enabled) continue;
    for (const endpoint of [1, 2]) if (Math.hypot(point.x - r[`x${endpoint}`] * w, point.y - r[`y${endpoint}`] * h) < threshold) return { kind: 'endpoint', id: r.id, endpoint };
  }
  for (const box of [...hitBoxes.labels].reverse()) if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) return { kind: 'label', id: box.id };
  for (const r of [...state.rulers].reverse()) {
    if (!r.enabled) continue;
    const x = r.x1 * w, y = r.y1 * h, dx = (r.x2 - r.x1) * w, dy = (r.y2 - r.y1) * h;
    const t = clamp(((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    if (Math.hypot(point.x - x - t * dx, point.y - y - t * dy) < threshold * .65) return { kind: 'line', id: r.id };
  }
  return null;
}
function select(id) {
  state.selected = id; const annotation = state.annotations.find(a => a.id === id);
  if (annotation) $('#annotation-text').value = annotation.text;
  buildAnnotations(); updateUI();
}
stage.addEventListener('pointerdown', e => {
  if (!image || ![0, 1].includes(e.button)) return;
  const point = localPoint(e), hit = findHit(point);
  if (spacePressed || e.button === 1 || !hit) {
    drag = { kind: 'pan', clientX: e.clientX, clientY: e.clientY, panX: view.panX, panY: view.panY };
    stage.style.cursor = 'grabbing';
  } else {
    select(hit.id); remember();
    const object = state.rulers.find(r => r.id === hit.id) || state.annotations.find(a => a.id === hit.id);
    drag = { ...hit, origin: { ...object }, start: point };
    stage.style.cursor = 'grabbing';
  }
  stage.setPointerCapture(e.pointerId); stage.focus({ preventScroll: true }); e.preventDefault();
});
stage.addEventListener('pointermove', e => {
  if (!image) return;
  if (!drag) { stage.style.cursor = spacePressed ? 'grab' : findHit(localPoint(e)) ? 'grab' : 'crosshair'; return; }
  if (drag.kind === 'pan') { view.panX = drag.panX + e.clientX - drag.clientX; view.panY = drag.panY + e.clientY - drag.clientY; return draw(); }
  const point = localPoint(e), w = state.image.width, h = state.image.height;
  const r = state.rulers.find(line => line.id === drag.id), o = drag.origin;
  const dx = (point.x - drag.start.x) / w, dy = (point.y - drag.start.y) / h;
  if (drag.kind === 'endpoint') {
    let x = point.x, y = point.y;
    if (e.shiftKey) {
      const other = drag.endpoint === 1 ? 2 : 1, ox = r[`x${other}`] * w, oy = r[`y${other}`] * h;
      const angle = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 12)) * (Math.PI / 12), length = Math.hypot(x - ox, y - oy);
      x = ox + Math.cos(angle) * length; y = oy + Math.sin(angle) * length;
    }
    r[`x${drag.endpoint}`] = clamp(x / w, 0, 1); r[`y${drag.endpoint}`] = clamp(y / h, 0, 1);
  } else if (drag.kind === 'line') {
    const mx = clamp(dx, -Math.min(o.x1, o.x2), 1 - Math.max(o.x1, o.x2));
    const my = clamp(dy, -Math.min(o.y1, o.y2), 1 - Math.max(o.y1, o.y2));
    r.x1 = o.x1 + mx; r.x2 = o.x2 + mx; r.y1 = o.y1 + my; r.y2 = o.y2 + my;
  } else if (drag.kind === 'label') { r.labelX = clamp(o.labelX + dx, -1, 1); r.labelY = clamp(o.labelY + dy, -1, 1); }
  else if (drag.kind === 'text') {
    const a = state.annotations.find(item => item.id === drag.id); a.x = clamp(o.x + dx, 0, 1); a.y = clamp(o.y + dy, 0, 1);
  }
  updateUI();
});
function endDrag(e) { drag = null; if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId); stage.style.cursor = spacePressed ? 'grab' : 'crosshair'; }
stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('wheel', e => { if (!image) return; e.preventDefault(); const rect = stage.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX - rect.left, y: e.clientY - rect.top }); }, { passive: false });
new ResizeObserver(draw).observe(area);

// Populate native selects; no external fonts, scripts, or libraries are fetched.
$$('[data-options]').forEach(select => {
  const catalog = catalogs[select.dataset.options];
  if (select.dataset.auto) select.add(new Option('Автоматически', 'auto'));
  Object.entries(catalog).forEach(([key, value]) => select.add(new Option(value[1], key)));
});
document.addEventListener('focusin', e => { if (e.target.dataset.setting) settingBefore = snapshot(); });
document.addEventListener('input', e => {
  const el = e.target, key = el.dataset.setting;
  if (key) {
    if (!settingBefore) settingBefore = snapshot();
    let value = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' || key === 'exportScale' ? Number(el.value) : el.value;
    if ((el.type === 'number' || el.type === 'range') && (!el.validity.valid || el.value === '' || !Number.isFinite(value))) return;
    state.settings[key] = value; updateUI();
    if ($('#export-dialog').open) refreshExport();
  }
  if (el.dataset.rulerColor) {
    state.rulers.find(r => r.id === el.dataset.rulerColor).color = el.value; updateUI();
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.setting) { remember(settingBefore || snapshot()); settingBefore = null; updateUI(); }
  if (el.dataset.rulerToggle) {
    const r = state.rulers.find(ruler => ruler.id === el.dataset.rulerToggle);
    if (r.enabled && state.rulers.slice(1).filter(line => line.enabled).length === 1) { el.checked = true; return notify('Оставьте включённым хотя бы один диаметр.'); }
    remember(); r.enabled = el.checked; updateUI();
  }
  if (el.dataset.rulerColor) { /* The colour input has a separate pre-edit snapshot. */ if (colourBefore) remember(colourBefore); colourBefore = null; }
});
let colourBefore = null;
document.addEventListener('pointerdown', e => { if (e.target.dataset.rulerColor) colourBefore = snapshot(); });
document.addEventListener('focusout', e => { const el = e.target; if (el.dataset.setting && el.type === 'number' && (!el.validity.valid || el.value === '')) el.value = state.settings[el.dataset.setting]; });
$$('.tab').forEach(button => {
  button.addEventListener('click', () => setTab(button.dataset.tab));
  button.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); const buttons = $$('.tab'), i = buttons.indexOf(button);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    setTab(buttons[next].dataset.tab); buttons[next].focus();
  });
});
$('#ruler-list').addEventListener('click', e => { const card = e.target.closest('[data-ruler]'); if (card && !e.target.matches('input')) select(card.dataset.ruler); });
$('.reference-card').addEventListener('click', () => { state.selected = 'reference'; updateUI(); });
$('#count-segments').addEventListener('click', e => {
  const value = e.target.dataset.count; if (!value) return; remember();
  state.settings.count = value === 'custom' ? 3 : Number(value); updateUI();
});
$('#custom-count').addEventListener('change', e => { remember(); state.settings.count = clamp(Math.round(Number(e.target.value) || 1), 1, 1000); updateUI(); });
$('#reset-rulers').addEventListener('click', () => { remember(); state.rulers = defaultRulers(); state.selected = 'reference'; syncAll(); });
$('#freeze').addEventListener('change', e => {
  if (e.target.checked && (!image || !calculate(state))) { e.target.checked = false; return notify('Сначала добавьте изображение и задайте ненулевые размеры.'); }
  remember(); state.frozen = e.target.checked ? calculate(state) : null; updateUI();
});
$('#toggle-rulers').addEventListener('click', () => { remember(); state.settings.showRulers = !state.settings.showRulers; updateUI(); });
$('#add-annotation').addEventListener('click', () => {
  if (!image) return notify('Сначала добавьте изображение.');
  const text = $('#annotation-text').value.trim(); if (!text) return notify('Введите текст подписи.');
  if (state.annotations.length >= 50) return notify('В одном проекте может быть не больше 50 подписей.');
  remember(); const id = `text-${Date.now()}-${state.annotations.length}`;
  state.annotations.push({ id, text, x: .1, y: .1, size: state.settings.fontSize, color: state.settings.textColor }); select(id);
});
$('#update-annotation').addEventListener('click', () => {
  const a = state.annotations.find(item => item.id === state.selected), text = $('#annotation-text').value.trim();
  if (!a || !text) return notify('Выберите подпись и введите текст.');
  remember(); a.text = text; a.color = state.settings.textColor; a.size = state.settings.fontSize; buildAnnotations(); draw();
});
$('#annotation-list').addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button) return;
  if (button.dataset.selectAnnotation) select(button.dataset.selectAnnotation);
  if (button.dataset.removeAnnotation) { remember(); state.annotations = state.annotations.filter(a => a.id !== button.dataset.removeAnnotation); state.selected = 'reference'; buildAnnotations(); draw(); }
});

for (const id of ['upload-main', 'replace-image']) $(`#${id}`).addEventListener('click', () => imageInput.click());
$$('[data-paste-image]').forEach(button => button.addEventListener('click', pasteImageFromClipboard));
imageInput.addEventListener('change', async () => { await openImageFile(imageInput.files[0]); imageInput.value = ''; });
$('#demo').addEventListener('click', () => addImage(new URL('../assets/demo.svg', import.meta.url).href, 'Геометрический пример.png'));
$('#url-open').addEventListener('click', () => $('#url-dialog').showModal());
$('#url-form').addEventListener('submit', async e => {
  e.preventDefault(); const url = $('#image-url').value.trim();
  if (!/^https?:\/\//i.test(url)) return notify('Нужна ссылка http:// или https://.', true);
  const button = $('#url-submit'); button.disabled = true; button.textContent = 'Загружаем…';
  const success = await addImage(url, 'Изображение по ссылке.png', true); button.disabled = false; button.textContent = 'Загрузить';
  if (success) $('#url-dialog').close();
});
let dragDepth = 0;
area.addEventListener('dragenter', e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; });
area.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
area.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
area.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true; openImageFile(e.dataTransfer.files[0]); });
document.addEventListener('paste', e => {
  if (e.target.closest('input,textarea,[contenteditable="true"]')) return;
  const file = [...(e.clipboardData?.items || [])].filter(item => item.type.startsWith('image/')).map(item => item.getAsFile()).find(Boolean)
    || [...(e.clipboardData?.files || [])].find(item => item.type.startsWith('image/'));
  if (file) { e.preventDefault(); openImageFile(file); }
});
$('#fit').addEventListener('click', fit); $('#zoom-in').addEventListener('click', () => zoom(1.25)); $('#zoom-out').addEventListener('click', () => zoom(.8));
$('#undo').addEventListener('click', () => historyStep(undoStack, redoStack)); $('#redo').addEventListener('click', () => historyStep(redoStack, undoStack));
$('#help-open').addEventListener('click', () => $('#help-dialog').showModal()); $('#about-open').addEventListener('click', () => $('#about-dialog').showModal());
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function baseName() { return (state.image.name.replace(/\.[a-z\d]+$/i, '') || 'tittyscale').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100); }
$('#save-project').addEventListener('click', () => {
  if (!image) return; downloadBlob(new Blob([JSON.stringify(projectData(state))], { type: 'application/json' }), `${baseName()}.tittyscale.json`);
  notify('Проект сохранён вместе с изображением и разметкой.');
});
$('#open-project').addEventListener('click', () => projectInput.click());
projectInput.addEventListener('change', async () => {
  const file = projectInput.files[0]; projectInput.value = ''; if (!file) return;
  if (file.size > 65_000_000) return notify('Проект больше 65 МБ.', true);
  const ticket = ++projectLoad;
  try {
    const parsed = readProject(JSON.parse(await file.text())); const loaded = await loadImage(parsed.image.src); if (ticket !== projectLoad) return;
    const normalized = normalizeImage(loaded); parsed.image = { ...parsed.image, src: normalized.src, width: normalized.width, height: normalized.height };
    const nextImage = await loadImage(normalized.src); if (ticket !== projectLoad) return;
    remember(); state = parsed; image = nextImage; $('#freeze').checked = false; setTab('dimensions'); syncAll(); fit(); notify('Проект открыт. Можно продолжать измерения.');
  } catch (e) { notify(e instanceof SyntaxError ? 'Не удалось прочитать JSON проекта.' : e.message, true); }
});
function makeExport() {
  if (!image) return null;
  const w = state.image.width, h = state.image.height, extra = state.settings.exportStats ? w / 6 : 0;
  const scale = Math.min(state.settings.exportScale, 8192 / Math.max(w, h + extra), Math.sqrt(20_000_000 / (w * (h + extra))));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(w * scale); canvas.height = Math.round((h + extra) * scale);
  const exportCtx = canvas.getContext('2d'); exportCtx.scale(scale, scale); paint(exportCtx, image, state);
  if (extra) paintSummary(exportCtx, state, h, w, extra);
  return canvas;
}
function refreshExport() {
  try {
    exportCanvas = makeExport(); if (!exportCanvas) return;
    $('#export-preview').src = exportCanvas.toDataURL('image/png');
    $('#export-size').textContent = `${exportCanvas.width} × ${exportCanvas.height} px · PNG · без элементов управления${state.frozen ? ' · значения зафиксированы' : ''}`;
  } catch { notify('Не удалось подготовить экспорт. Попробуйте меньшее разрешение.', true); }
}
$('#export-open').addEventListener('click', () => { if (!image) return; refreshExport(); $('#export-dialog').showModal(); });
$('#download-png').addEventListener('click', () => {
  if (!exportCanvas) return;
  exportCanvas.toBlob(blob => { if (!blob) return notify('Не удалось создать PNG.', true); downloadBlob(blob, `${baseName()}-measurements.png`); notify('PNG готов.'); }, 'image/png');
});
$('#copy-png').addEventListener('click', async () => {
  if (!exportCanvas || !navigator.clipboard?.write || !window.ClipboardItem) return notify('Этот браузер не поддерживает копирование PNG. Используйте «Скачать PNG».', true);
  try {
    const blob = new Promise((resolve, reject) => exportCanvas.toBlob(value => value ? resolve(value) : reject(new Error()), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); notify('Изображение скопировано.');
  } catch { notify('Браузер не разрешил копирование. Используйте «Скачать PNG».', true); }
});

document.addEventListener('keydown', e => {
  const editing = e.target.closest('input,textarea,select,[contenteditable="true"]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !editing) { e.preventDefault(); $('#save-project').click(); return; }
  if (editing || $('dialog[open]')) return;
  if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); e.key.toLowerCase() === 'y' || e.shiftKey ? historyStep(redoStack, undoStack) : historyStep(undoStack, redoStack); return; }
  if (e.code === 'Space') { e.preventDefault(); spacePressed = true; stage.style.cursor = 'grab'; }
  if (e.key === '0') fit();
  if (e.target === stage && image && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault(); const r = state.rulers.find(item => item.id === state.selected), a = state.annotations.find(item => item.id === state.selected);
    if (!r && !a) return; remember();
    const step = e.shiftKey ? 10 : 1, dx = (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0) / state.image.width;
    const dy = (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) / state.image.height;
    if (r) { const mx = clamp(dx, -Math.min(r.x1, r.x2), 1 - Math.max(r.x1, r.x2)), my = clamp(dy, -Math.min(r.y1, r.y2), 1 - Math.max(r.y1, r.y2)); r.x1 += mx; r.x2 += mx; r.y1 += my; r.y2 += my; }
    if (a) { a.x = clamp(a.x + dx, 0, 1); a.y = clamp(a.y + dy, 0, 1); } updateUI();
  }
});
document.addEventListener('keyup', e => { if (e.code === 'Space') { spacePressed = false; stage.style.cursor = 'crosshair'; } });
window.addEventListener('blur', () => { spacePressed = false; drag = null; });
window.addEventListener('beforeunload', e => { if (image) { e.preventDefault(); e.returnValue = ''; } });
setTab('dimensions'); syncAll();

import { LENGTH, MASS, VOLUME, TIME, POPULATION, clamp } from './math.mjs';

export const DEFAULT_SETTINGS = {
  reference: 170, referenceUnit: 'cm', lengthUnit: 'auto', volumeUnit: 'auto', massUnit: 'auto',
  count: 1, density: 0.945, model: 'average', growth: 1, growthUnit: 'cm', growthTime: 'hour',
  growthOutputTime: 'min', production: 5, milkTime: 'hour', milkPrice: 100, currency: 'RUB',
  population: 'adult', waste: 15, fabricPrice: 500, lineWidth: 2.5, fontSize: 2.6,
  textColor: '#ffffff', showLabels: true, showRulers: true, exportStats: true, exportScale: 1,
};
export function defaultRulers() {
  return [
    { id: 'reference', name: 'Эталон', color: '#d7e0ec', enabled: true, x1: 0.13, y1: 0.14, x2: 0.13, y2: 0.86, labelX: -0.015, labelY: 0 },
    { id: 'a', name: 'Диаметр A', color: '#ff9b8a', enabled: true, x1: 0.37, y1: 0.5, x2: 0.73, y2: 0.5, labelX: 0, labelY: -0.04 },
    { id: 'b', name: 'Диаметр B', color: '#83ddc2', enabled: true, x1: 0.55, y1: 0.29, x2: 0.55, y2: 0.71, labelX: 0.06, labelY: 0 },
    { id: 'c', name: 'Диаметр C', color: '#b7a2f7', enabled: true, x1: 0.42, y1: 0.35, x2: 0.68, y2: 0.65, labelX: 0, labelY: 0.07 },
  ];
}
export function createState() {
  return {
    image: { width: 1200, height: 1000, name: '', src: '' },
    settings: { ...DEFAULT_SETTINGS }, rulers: defaultRulers(), annotations: [],
    selected: 'reference', tab: 'dimensions', frozen: null,
  };
}
export function projectData(state) {
  return {
    type: 'tittyscale-ru/project', version: 1,
    image: { ...state.image }, settings: { ...state.settings },
    rulers: structuredClone(state.rulers), annotations: structuredClone(state.annotations),
  };
}
export function readProject(raw) {
  if (!raw || raw.type !== 'tittyscale-ru/project' || raw.version !== 1) throw new Error('Неподдерживаемый формат проекта.');
  if (!raw.image || typeof raw.image.src !== 'string' || !/^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,[A-Za-z0-9+/=\r\n]+$/.test(raw.image.src)) {
    throw new Error('В проекте нет корректного изображения.');
  }
  if (raw.image.src.length > 65_000_000) throw new Error('Изображение в проекте слишком большое.');
  const out = createState();
  out.image = { src: raw.image.src, name: String(raw.image.name || 'Изображение').slice(0, 200), width: 1200, height: 1000 };
  const settings = raw.settings || {};
  for (const [key, initial] of Object.entries(DEFAULT_SETTINGS)) {
    const value = settings[key];
    if (typeof initial === 'number' && typeof value === 'number' && Number.isFinite(value)) out.settings[key] = value;
    if (typeof initial === 'boolean' && typeof value === 'boolean') out.settings[key] = value;
  }
  const enums = { referenceUnit: Object.keys(LENGTH), lengthUnit: ['auto', ...Object.keys(LENGTH)],
    volumeUnit: ['auto', ...Object.keys(VOLUME)], massUnit: ['auto', ...Object.keys(MASS)],
    growthUnit: Object.keys(LENGTH), growthTime: Object.keys(TIME), growthOutputTime: Object.keys(TIME),
    milkTime: Object.keys(TIME), population: Object.keys(POPULATION), model: ['average', 'ellipsoid'], currency: ['RUB', 'USD', 'EUR'] };
  for (const [key, values] of Object.entries(enums)) if (values.includes(settings[key])) out.settings[key] = settings[key];
  for (const key of ['reference', 'count', 'density']) out.settings[key] = Math.max(0.000001, out.settings[key]);
  for (const key of ['growth', 'production', 'milkPrice', 'waste', 'fabricPrice']) out.settings[key] = Math.max(0, out.settings[key]);
  for (const key of ['growth', 'production', 'milkPrice', 'waste', 'fabricPrice']) out.settings[key] = Math.min(1e12, out.settings[key]);
  out.settings.count = clamp(Math.round(out.settings.count), 1, 1000);
  out.settings.reference = clamp(out.settings.reference, 0.000001, 1e12);
  out.settings.density = clamp(out.settings.density, 0.000001, 1e6);
  out.settings.lineWidth = clamp(out.settings.lineWidth, 1, 8);
  out.settings.fontSize = clamp(out.settings.fontSize, 1, 6);
  out.settings.exportScale = [1, 2].includes(settings.exportScale) ? settings.exportScale : 1;
  if (/^#[0-9a-f]{6}$/i.test(settings.textColor)) out.settings.textColor = settings.textColor;
  if (!Array.isArray(raw.rulers) || raw.rulers.length !== 4) throw new Error('В проекте должны быть четыре линейки.');
  out.rulers.forEach((r, i) => {
    const source = raw.rulers[i];
    if (!source || ['x1', 'y1', 'x2', 'y2'].some(k => typeof source[k] !== 'number' || !Number.isFinite(source[k]))) throw new Error('Повреждены координаты линеек.');
    for (const key of ['x1', 'y1', 'x2', 'y2']) r[key] = clamp(source[key], 0, 1);
    for (const key of ['labelX', 'labelY']) if (Number.isFinite(source[key])) r[key] = clamp(source[key], -1, 1);
    if (/^#[0-9a-f]{6}$/i.test(source.color)) r.color = source.color;
    r.enabled = i === 0 || source.enabled !== false;
  });
  if (!out.rulers.slice(1).some(r => r.enabled)) out.rulers[1].enabled = true;
  if (Array.isArray(raw.annotations)) {
    out.annotations = raw.annotations.slice(0, 50).filter(a => a && typeof a.text === 'string' && Number.isFinite(a.x) && Number.isFinite(a.y)).map((a, i) => ({
      id: `text-${i}`, text: a.text.slice(0, 500), x: clamp(a.x, 0, 1), y: clamp(a.y, 0, 1),
      size: clamp(Number(a.size) || 2.6, 1, 10), color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#ffffff',
    }));
  }
  return out;
}

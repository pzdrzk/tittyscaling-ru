// Original implementation. All internal lengths are in metres, masses in kilograms.
export const LENGTH = {
  mm: [0.001, 'мм'], cm: [0.01, 'см'], m: [1, 'м'], in: [0.0254, 'дюйм'],
  ft: [0.3048, 'фут'], km: [1000, 'км'], mi: [1609.344, 'миля'],
  earth: [12756000, 'диам. Земли'], au: [149597870700, 'а. е.'],
  ly: [9.4607304725808e15, 'св. лет'], universe: [8.8e26, 'диам. Вселенной'],
};
export const VOLUME = {
  ml: [1e-6, 'мл'], l: [0.001, 'л'], cm3: [1e-6, 'см³'], m3: [1, 'м³'],
  gal: [0.003785411784, 'гал. США'], in3: [0.0254 ** 3, 'дюйм³'],
  ft3: [0.3048 ** 3, 'фут³'], km3: [1e9, 'км³'],
  earth: [4 * Math.PI * (6378000 ** 3) / 3, 'объёмов Земли'],
  au3: [149597870700 ** 3, 'а. е.³'], ly3: [9.4607304725808e15 ** 3, 'св. лет³'],
};
export const MASS = {
  g: [0.001, 'г'], kg: [1, 'кг'], t: [1000, 'т'], oz: [0.028349523125, 'унц.'],
  lb: [0.45359237, 'фунт'], kt: [1e6, 'кт'], mt: [1e9, 'Мт'],
  earth: [5.9722e24, 'масс Земли'], sun: [1.98847e30, 'масс Солнца'],
  galaxy: [3e42, 'масс Галактики'], universe: [1.5e53, 'масс Вселенной'],
};
export const TIME = {
  ms: [0.001, 'мс'], sec: [1, 'с'], min: [60, 'мин'], hour: [3600, 'ч'],
  day: [86400, 'сут.'], week: [604800, 'нед.'], month: [2629800, 'мес.'], year: [31557600, 'год'],
};
export const POPULATION = {
  adult: [1, 'взрослых'], village: [1500, 'сёл по 1 500 жителей'],
  town: [10000, 'городов по 10 тыс. жителей'], city: [1e6, 'городов-миллионников'],
  country: [4e7, 'стран по 40 млн жителей'], planet: [8.3e9, 'планет по 8,3 млрд жителей'],
};
export const positive = (x, fallback = 1) => Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : fallback;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function number(x, digits = 2) {
  if (!Number.isFinite(x)) return '—';
  if (x !== 0 && (Math.abs(x) >= 1e12 || Math.abs(x) < 0.001)) {
    return x.toExponential(2).replace('.', ',').replace('e+', ' × 10^').replace('e-', ' × 10^−');
  }
  return x.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}
export function quantity(value, catalog, selected = 'auto') {
  let key = selected;
  if (!(key in catalog)) {
    const keys = catalog === LENGTH ? ['mm', 'cm', 'm', 'km', 'earth', 'au', 'ly', 'universe']
      : catalog === VOLUME ? ['ml', 'l', 'm3', 'km3', 'earth', 'au3', 'ly3']
        : ['g', 'kg', 't', 'kt', 'mt', 'earth', 'sun', 'galaxy', 'universe'];
    key = keys[0];
    for (const candidate of keys) if (Math.abs(value) >= catalog[candidate][0]) key = candidate;
  }
  return `${number(value / catalog[key][0])} ${catalog[key][1]}`;
}
export function pixelLength(ruler, width, height) {
  return Math.hypot((ruler.x2 - ruler.x1) * width, (ruler.y2 - ruler.y1) * height);
}
export function calculate(state) {
  const { settings: s, rulers, image } = state;
  const referencePixels = pixelLength(rulers[0], image.width, image.height);
  if (referencePixels < 0.00001) return null;
  const metresPerPixel = positive(s.reference) * LENGTH[s.referenceUnit][0] / referencePixels;
  const diameters = rulers.slice(1).map(r => pixelLength(r, image.width, image.height) * metresPerPixel);
  const used = diameters.filter((_, i) => rulers[i + 1].enabled);
  if (!used.length || used.some(d => d <= 0)) return null;
  const diameter = used.reduce((a, b) => a + b, 0) / used.length;
  const axes = [...used];
  while (axes.length < 3) axes.push(diameter);
  const count = positive(s.count);
  const oneVolume = Math.PI / 6 * (s.model === 'ellipsoid' ? axes[0] * axes[1] * axes[2] : diameter ** 3);
  const volume = oneVolume * count;
  const mass = volume * positive(s.density, 0.945) * 1000;
  const delta = Math.max(0, Number(s.growth)) * LENGTH[s.growthUnit][0] / TIME[s.growthTime][0] * TIME[s.growthOutputTime][0];
  const grownVolume = Math.PI / 6 * (s.model === 'ellipsoid'
    ? (axes[0] + delta) * (axes[1] + delta) * (axes[2] + delta)
    : (diameter + delta) ** 3);
  const growthMass = (grownVolume - oneVolume) * count * positive(s.density, 0.945) * 1000;
  const litresPerHour = volume * 1000 * Math.max(0, Number(s.production)) / 100;
  const milkLitres = litresPerHour * TIME[s.milkTime][0] / 3600;
  const milkDaily = litresPerHour * 24;
  const dailyCalories = milkDaily * 676.281;
  const surface = 2 * Math.PI * (diameter / 2) ** 2 * count;
  const fabric = surface * (1 + Math.max(0, Number(s.waste)) / 100);
  return {
    diameters, diameter, volume, mass, oneVolume, growthMass, surface, fabric,
    fabricCost: fabric * Math.max(0, Number(s.fabricPrice)), milkLitres,
    milkValue: milkLitres * Math.max(0, Number(s.milkPrice)),
    milkCalories: milkLitres * 676.281, dailyCalories,
    population: dailyCalories / 2400 / POPULATION[s.population][0],
  };
}

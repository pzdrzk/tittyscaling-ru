import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.mjs';
import { calculate, LENGTH, VOLUME, MASS, TIME, pixelLength, quantity } from '../src/math.mjs';

function sample() {
  const s = createState(); s.image = { width: 1000, height: 500, src: '', name: '' };
  s.settings.reference = 100; s.settings.referenceUnit = 'cm';
  s.rulers[0] = { ...s.rulers[0], x1: 0, y1: 0, x2: 1, y2: 0 };
  s.rulers.slice(1).forEach(r => { r.x1 = 0; r.y1 = 0; r.x2 = .2; r.y2 = 0; });
  return s;
}
const near = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1e-12, Math.abs(b) * 1e-10), `${a} ≠ ${b}`);
test('calibration uses image pixel aspect ratio, not normalised-coordinate distance', () => {
  near(pixelLength({ x1: 0, y1: 0, x2: .2, y2: 0 }, 1000, 500), 200);
  near(pixelLength({ x1: 0, y1: 0, x2: 0, y2: .4 }, 1000, 500), 200);
  const s = sample(); s.rulers[2] = { ...s.rulers[2], x2: 0, y2: .4 }; near(calculate(s).diameters[1], .2);
});
test('20 cm sphere and default density yield correct volume and mass', () => {
  const r = calculate(sample()); near(r.diameter, .2); near(r.volume, 4 / 3 * Math.PI * .1 ** 3); near(r.mass, r.volume * 945);
});
test('whole bust multiplies mass and volume, leaving diameters unchanged', () => {
  const s = sample(), one = calculate(s); s.settings.count = 2; const two = calculate(s);
  near(two.volume, one.volume * 2); near(two.mass, one.mass * 2); near(two.diameter, one.diameter);
});
test('average model averages enabled diameters; ellipsoid uses all three axes', () => {
  const s = sample(); s.rulers[2].x2 = .3; s.rulers[3].x2 = .4;
  near(calculate(s).volume, Math.PI / 6 * .3 ** 3);
  s.settings.model = 'ellipsoid'; near(calculate(s).volume, Math.PI / 6 * .2 * .3 * .4);
  s.rulers[3].enabled = false; near(calculate(s).volume, Math.PI / 6 * .2 * .3 * .25);
  s.rulers[2].enabled = false; near(calculate(s).volume, Math.PI / 6 * .2 ** 3);
});
test('zero-length reference or diameter cannot produce Infinity/NaN output', () => {
  const s = sample(); s.rulers[0].x2 = 0; assert.equal(calculate(s), null);
  s.rulers[0].x2 = 1; s.rulers[1].x2 = 0; assert.equal(calculate(s), null);
  s.rulers.slice(1).forEach(r => { r.enabled = false; }); assert.equal(calculate(s), null);
});
test('growth compares future and current volume with the correct period', () => {
  const s = sample(); s.settings.growth = 1; s.settings.growthUnit = 'cm'; s.settings.growthTime = 'hour'; s.settings.growthOutputTime = 'min';
  near(calculate(s).growthMass, Math.PI / 6 * ((.2 + .01 / 60) ** 3 - .2 ** 3) * 945);
  s.settings.growth = 0; near(calculate(s).growthMass, 0);
});
test('milk, costs and food-energy comparison share a consistent volume and period', () => {
  const s = sample(); s.settings.milkTime = 'day'; const r = calculate(s);
  near(r.milkLitres, r.volume * 1000 * .05 * 24); near(r.milkValue, r.milkLitres * 100);
  near(r.milkCalories, r.milkLitres * 676.281); near(r.population, r.milkCalories / 2400);
});
test('surface and cutting allowance are based on hemispheres', () => {
  const s = sample(), r = calculate(s); near(r.surface, 2 * Math.PI * .1 ** 2); near(r.fabric, r.surface * 1.15); near(r.fabricCost, r.fabric * 500);
});
test('unit conversions use cubic volume factors and accurate US gallon', () => {
  near(LENGTH.in[0], .0254); near(VOLUME.gal[0], .003785411784); near(MASS.lb[0], .45359237); near(TIME.month[0] * 12, TIME.year[0]);
  assert.match(quantity(.001, VOLUME, 'l'), /^1 л$/); assert.match(quantity(.003785411784, VOLUME, 'gal'), /^1 гал/);
});
test('cosmic scales stay finite and auto format remains readable', () => {
  const s = sample(); s.settings.referenceUnit = 'universe'; s.settings.reference = 1; const r = calculate(s);
  assert.ok(Number.isFinite(r.volume)); assert.ok(Number.isFinite(r.mass)); assert.ok(!quantity(r.volume, VOLUME).includes('Infinity'));
});

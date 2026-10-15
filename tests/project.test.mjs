import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, projectData, readProject } from '../src/state.mjs';
const valid = () => { const s = createState(); s.image.src = 'data:image/png;base64,AA=='; s.image.name = 'Пример.png'; return projectData(s); };
test('project roundtrip preserves settings, rulers, unicode text and embedded image', () => {
  const p = valid(); p.settings.count = 2; p.rulers[1].x2 = .45;
  p.annotations = [{ id: 'hello', text: 'Привет! <script>не HTML</script>', x: .2, y: .3, size: 3, color: '#ffffff' }];
  const restored = readProject(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.image.src, p.image.src); assert.equal(restored.settings.count, 2); assert.equal(restored.rulers[1].x2, .45); assert.equal(restored.annotations[0].text, p.annotations[0].text);
});
test('unknown versions, missing rulers, non-finite coordinates and remote image URLs are rejected', () => {
  for (const patch of [{ version: 2 }, { rulers: [] }, { image: { src: 'https://example.com/private.png' } }, { image: { src: 'javascript:alert(1)' } }]) assert.throws(() => readProject({ ...valid(), ...patch }));
  const p = valid(); p.rulers[0].x1 = Infinity; assert.throws(() => readProject(p));
});
test('import bounds coordinates and resets unsupported units and styles', () => {
  const p = valid(); p.rulers[1].x1 = -100; p.rulers[1].y2 = 100; p.settings.referenceUnit = 'INVALID';
  p.settings.lineWidth = 9000; p.settings.textColor = 'url(https://example.com)'; p.settings.count = -5;
  const s = readProject(p); assert.equal(s.rulers[1].x1, 0); assert.equal(s.rulers[1].y2, 1); assert.equal(s.settings.referenceUnit, 'cm');
  assert.equal(s.settings.lineWidth, 8); assert.equal(s.settings.textColor, '#ffffff'); assert.equal(s.settings.count, 1);
});
test('import always enables the reference and at least one diameter', () => {
  const p = valid(); p.rulers.forEach(r => { r.enabled = false; }); const s = readProject(p);
  assert.equal(s.rulers[0].enabled, true); assert.ok(s.rulers.slice(1).some(r => r.enabled));
});
test('malformed and oversized annotations are dropped or bounded', () => {
  const p = valid(); p.annotations = [null, {}, { text: 'a'.repeat(1000), x: -1, y: 50, size: 90, color: 'bad' }];
  const s = readProject(p); assert.equal(s.annotations.length, 1); assert.equal(s.annotations[0].text.length, 500); assert.equal(s.annotations[0].x, 0); assert.equal(s.annotations[0].y, 1); assert.equal(s.annotations[0].size, 10);
});

import { calculate, LENGTH, quantity, VOLUME, MASS, number } from './math.mjs';

export function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
export function rulerLabel(state, index, result) {
  if (index === 0) return `${number(state.settings.reference)} ${LENGTH[state.settings.referenceUnit][1]}`;
  return `${'ABC'[index - 1]} · ${result ? quantity(result.diameters[index - 1], LENGTH, state.settings.lengthUnit) : '—'}`;
}
export function paint(ctx, image, state, options = {}) {
  const { width: w, height: h } = state.image;
  const s = state.settings, base = Math.min(w, h) / 1000;
  const result = state.frozen || calculate(state);
  const labels = [], annotations = [];
  ctx.drawImage(image, 0, 0, w, h);
  if (s.showRulers) state.rulers.forEach((r, index) => {
    if (!r.enabled) return;
    const x1 = r.x1 * w, y1 = r.y1 * h, x2 = r.x2 * w, y2 = r.y2 * h;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const cap = base * 9, selected = state.selected === r.id;
    ctx.save(); ctx.lineWidth = s.lineWidth * base; ctx.strokeStyle = r.color;
    ctx.shadowColor = '#000000'; ctx.shadowBlur = 4 * base;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      ctx.moveTo(x - Math.sin(angle) * cap, y + Math.cos(angle) * cap);
      ctx.lineTo(x + Math.sin(angle) * cap, y - Math.cos(angle) * cap);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
    if (options.handles) {
      const radius = Math.max(6 * base, 5 / (options.scale || 1));
      for (const [x, y] of [[x1, y1], [x2, y2]]) {
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = selected ? r.color : '#14201ee8'; ctx.fill(); ctx.lineWidth = 2 * base; ctx.stroke();
      }
    }
    if (s.showLabels) {
      const font = Math.min(w, h) * s.fontSize / 100;
      ctx.font = `600 ${font}px Arial, sans-serif`;
      const text = rulerLabel(state, index, result);
      const tw = ctx.measureText(text).width + 22 * base, th = font * 1.5;
      let x = (x1 + x2) / 2 + r.labelX * w - tw / 2;
      let y = (y1 + y2) / 2 + r.labelY * h - th / 2;
      x = Math.max(2 * base, Math.min(w - tw - 2 * base, x));
      y = Math.max(2 * base, Math.min(h - th - 2 * base, y));
      roundedRect(ctx, x, y, tw, th, 5 * base);
      ctx.fillStyle = '#131c23ed'; ctx.fill(); ctx.strokeStyle = r.color; ctx.lineWidth = base; ctx.stroke();
      ctx.fillStyle = s.textColor; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 11 * base, y + th / 2 + base);
      labels.push({ id: r.id, x, y, width: tw, height: th });
    }
    ctx.restore();
  });
  state.annotations.forEach(a => {
    const font = Math.min(w, h) * a.size / 100;
    const lines = a.text.split('\n').flatMap(line => line.match(/.{1,50}/gu) || ['']);
    ctx.save(); ctx.font = `500 ${font}px Arial, sans-serif`; ctx.textBaseline = 'top';
    const tw = Math.max(...lines.map(line => ctx.measureText(line).width), 10);
    const x = a.x * w, y = a.y * h;
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4 * base;
    ctx.lineWidth = 3 * base; ctx.strokeStyle = '#152029aa'; ctx.fillStyle = a.color;
    lines.forEach((line, i) => { ctx.strokeText(line, x, y + i * font * 1.3); ctx.fillText(line, x, y + i * font * 1.3); });
    if (options.handles && state.selected === a.id) {
      ctx.shadowBlur = 0; ctx.lineWidth = base; ctx.strokeStyle = '#b0e5ce';
      ctx.setLineDash([5 * base, 4 * base]); ctx.strokeRect(x - 6 * base, y - 6 * base, tw + 12 * base, lines.length * font * 1.3 + 12 * base);
    }
    annotations.push({ id: a.id, x, y, width: tw, height: lines.length * font * 1.3 });
    ctx.restore();
  });
  return { labels, annotations };
}
export function paintSummary(ctx, state, y, w, h) {
  const r = state.frozen || calculate(state), s = state.settings;
  ctx.save(); ctx.translate(0, y); ctx.fillStyle = '#17211e'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#375046'; ctx.lineWidth = Math.max(1, w / 1200); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.stroke();
  const f = w / 1200;
  ctx.fillStyle = '#b0e5ce'; ctx.font = `600 ${20 * f}px Arial, sans-serif`; ctx.fillText('TittyScale RU', 35 * f, 42 * f);
  ctx.fillStyle = '#a4b9af'; ctx.font = `${13 * f}px Arial, sans-serif`;
  const scope = s.count === 1 ? 'Одна грудь' : s.count === 2 ? 'Весь бюст · 2' : `Количество: ${s.count}`;
  ctx.fillText(`${scope} · ${s.model === 'average' ? 'средний диаметр' : 'эллипсоид'}`, 35 * f, 69 * f);
  const items = [ ['ОБЪЁМ', r ? quantity(r.volume, VOLUME, s.volumeUnit) : '—'],
    ['МАССА', r ? quantity(r.mass, MASS, s.massUnit) : '—'],
    ['СРЕДНИЙ ДИАМЕТР', r ? quantity(r.diameter, LENGTH, s.lengthUnit) : '—'] ];
  items.forEach(([label, value], i) => {
    const x = (35 + i * 390) * f;
    ctx.fillStyle = '#a4b9af'; ctx.font = `${11 * f}px Arial, sans-serif`; ctx.fillText(label, x, 110 * f);
    ctx.fillStyle = '#edf5ef'; ctx.font = `500 ${26 * f}px Arial, sans-serif`; ctx.fillText(value, x, 146 * f, 355 * f);
  });
  ctx.fillStyle = '#809b8e'; ctx.font = `${10 * f}px Arial, sans-serif`;
  ctx.fillText(`Плотность: ${number(s.density, 3)} г/см³ · Приблизительная геометрическая оценка${state.frozen ? ' · Значения зафиксированы' : ''}`, 35 * f, 182 * f);
  ctx.restore();
}

/* ===== SVG charts (sized to the element; crisp in PDF/PNG exports) ===== */
const cfmt = v => v == null ? "–" : Math.abs(v) >= 1000 ? compact(v) : (Math.round(v * 10) / 10).toLocaleString("en-IN");
function legendHTML(items, color) {
  return `<div class="rbc-leg">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.name)}${i.extra ? ` <b>${esc(i.extra)}</b>` : ""}</span>`).join("")}</div>`;
}
function axisTicks(max) { const { step, top } = niceTicks(max > 0 ? max : 1); const t = []; for (let v = 0; v <= top + 1e-9; v += step) t.push(v); return { top, t }; }

function svgLine(o) {
  const { w, h, labels, series } = o;
  const leg = o.legend !== false && series.length > 1;
  const H = Math.max(60, h - (leg ? 26 : 0));
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  if (!labels.length || !vals.length) return emptyChart(w, h);
  const { top, t } = axisTicks(Math.max(...vals));
  const L = Math.max(30, cfmt(top).length * 7 + 10), R = 10, T = 10, B = 22;
  const X = i => L + (labels.length < 2 ? (w - L - R) / 2 : (w - L - R) * i / (labels.length - 1));
  const Y = v => T + (H - T - B) * (1 - v / top);
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((w - L) / 58))));
  let g = t.map(v => `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ECEAF3"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end" font-size="10" fill="#8A85A3">${cfmt(v)}</text>`).join("");
  g += labels.map((l, i) => i % every ? "" : `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#8A85A3">${esc(l)}</text>`).join("");
  const paths = series.map(s => {
    const pts = s.values.map((v, i) => v == null ? null : [X(i), Y(v)]);
    const segs = []; let cur = [];
    pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
    return segs.map(sg => {
      const d = sg.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const area = o.area ? `<path d="${d} L${sg[sg.length - 1][0].toFixed(1)} ${Y(0)} L${sg[0][0].toFixed(1)} ${Y(0)} Z" fill="${s.color}" fill-opacity="${series.length > 1 ? .12 : .18}"/>` : "";
      return area + `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>` +
        (sg.length <= 31 ? sg.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="#fff" stroke="${s.color}" stroke-width="1.6"/>`).join("") : "");
    }).join("");
  }).join("");
  return `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" class="rbc-svg">${g}${paths}</svg>${leg ? legendHTML(series) : ""}`;
}
function svgBars(o) {
  const { w, h, labels, series } = o;
  const leg = o.legend !== false && series.length > 1;
  const H = Math.max(60, h - (leg ? 26 : 0));
  const vals = series.flatMap(s => s.values).filter(v => v != null);
  if (!labels.length || !vals.length) return emptyChart(w, h);
  if (o.horizontal) {
    const max = Math.max(...vals, 0) || 1, rowH = Math.min(34, (H - 4) / labels.length), lw = Math.min(w * .38, Math.max(...labels.map(l => String(l).length)) * 6.6 + 8);
    const bars = labels.map((l, i) => {
      const y = 2 + i * rowH, bh = Math.max(6, rowH * .62 / series.length);
      return `<text x="${lw - 6}" y="${y + rowH / 2 + 3.5}" text-anchor="end" font-size="10.5" fill="#4B4766">${esc(String(l).slice(0, 34))}</text>` +
        series.map((s, j) => { const v = s.values[i] || 0, bw = (w - lw - 54) * v / max; return `<rect x="${lw}" y="${y + rowH * .19 + j * bh}" width="${Math.max(1, bw)}" height="${bh - 1}" rx="3" fill="${s.colors ? s.colors[i] : s.color}"/><text x="${lw + bw + 5}" y="${y + rowH * .19 + j * bh + bh / 2 + 3.5}" font-size="10" fill="#4B4766">${cfmt(s.values[i])}</text>`; }).join("");
    }).join("");
    return `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" class="rbc-svg">${bars}</svg>${leg ? legendHTML(series) : ""}`;
  }
  const { top, t } = axisTicks(Math.max(...vals));
  const L = Math.max(30, cfmt(top).length * 7 + 10), R = 8, T = 10, B = labels.length > 8 ? 34 : 22;
  const Y = v => T + (H - T - B) * (1 - v / top);
  const band = (w - L - R) / labels.length, gw = band * (labels.length > 20 ? .86 : .68), bw = gw / series.length;
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((w - L) / 44))));
  let g = t.map(v => `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ECEAF3"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end" font-size="10" fill="#8A85A3">${cfmt(v)}</text>`).join("");
  g += labels.map((l, i) => i % every ? "" : `<text x="${L + band * i + band / 2}" y="${H - (B > 22 ? 18 : 6)}" text-anchor="middle" font-size="10" fill="#8A85A3">${esc(String(l).slice(0, 14))}</text>`).join("");
  const bars = series.map((s, j) => s.values.map((v, i) => v == null ? "" : `<rect x="${(L + band * i + (band - gw) / 2 + j * bw).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${Math.max(1, bw - 1.5).toFixed(1)}" height="${Math.max(0, Y(0) - Y(v)).toFixed(1)}" rx="${Math.min(4, bw / 3).toFixed(1)}" fill="${s.colors ? s.colors[i] : s.color}"/>`).join("")).join("");
  const vl = o.values && labels.length <= 12 ? series.map((s, j) => s.values.map((v, i) => v == null ? "" : `<text x="${(L + band * i + (band - gw) / 2 + j * bw + bw / 2).toFixed(1)}" y="${(Y(v) - 4).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="#4B4766">${cfmt(v)}</text>`).join("")).join("") : "";
  return `<svg viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" class="rbc-svg">${g}${bars}${vl}</svg>${leg ? legendHTML(series) : ""}`;
}
function svgPie(o) {
  const { w, h, items } = o;
  const tot = items.reduce((a, i) => a + Math.max(0, i.value || 0), 0);
  if (!tot) return emptyChart(w, h);
  const side = o.legend !== false && w > h * 1.35;
  const size = Math.max(60, Math.min(side ? w * .55 : w, h - (side || o.legend === false ? 0 : 22 * Math.ceil(items.length / 3))));
  const r = size / 2 - 4, cx = size / 2, cy = size / 2, ir = o.donut ? r * .62 : 0;
  let a0 = -Math.PI / 2;
  const arcs = items.filter(i => i.value > 0).map(i => {
    const a1 = a0 + 2 * Math.PI * i.value / tot, big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rr, a) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1);
    let d;
    if (i.value / tot > .9999) d = `M${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy}` + (ir ? ` M${cx - ir} ${cy} A${ir} ${ir} 0 1 0 ${cx + ir} ${cy} A${ir} ${ir} 0 1 0 ${cx - ir} ${cy}` : "");
    else if (ir) { const [x2, y2] = p(ir, a1), [x3, y3] = p(ir, a0); d = `M${x0} ${y0} A${r} ${r} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${ir} ${ir} 0 ${big} 0 ${x3} ${y3} Z`; }
    else d = `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${big} 1 ${x1} ${y1} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${i.color}" fill-rule="evenodd" stroke="#fff" stroke-width="1.5"/>`;
  }).join("");
  const center = o.donut && o.center ? `<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="${Math.max(12, r * .34)}" font-weight="700" fill="#17132B">${esc(o.center)}</text>${o.sub ? `<text x="${cx}" y="${cy + r * .3}" text-anchor="middle" font-size="${Math.max(9, r * .14)}" fill="#6B6585">${esc(o.sub)}</text>` : ""}` : "";
  const leg = o.legend === false ? "" : legendHTML(items.map(i => ({ ...i, extra: o.pct !== false ? (i.value / tot * 100).toFixed(i.value / tot < .1 ? 1 : 0) + "%" : cfmt(i.value) })));
  return `<div class="rbc-pie${side ? " side" : ""}"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="rbc-svg">${arcs}${center}</svg>${leg}</div>`;
}
function emptyChart(w, h) { return `<div class="rbc-empty" style="height:${Math.max(40, h)}px">No data for this period</div>`; }

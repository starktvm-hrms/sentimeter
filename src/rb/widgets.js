/* ===== Analytics widgets: catalogue, data settings and rendering ===== */
const SENT_C = { pos: "#22C55E", neu: "#F59E0B", neg: "#EF4444" };
const CNET = [["fb", "Facebook"], ["ig", "Instagram"], ["x", "X"], ["li", "LinkedIn"], ["yt", "YouTube"]];
const IC = {
  kpi: '<path d="M3 15h3V9H3zM8.5 15h3V5h-3zM14 15h3v-8h-3z"/>', line: '<path d="M2.5 14l4-5 3.5 3 5.5-7 2 2"/>', bar: '<path d="M3 16V9M8 16V4M13 16v-6M18 16V7"/>',
  pie: '<path d="M10 2.5a7.5 7.5 0 1 0 7.5 7.5H10z"/><path d="M12 1.5v6.5h6.5A6.5 6.5 0 0 0 12 1.5z"/>', donut: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3"/>',
  area: '<path d="M2.5 15.5l4-6 4 3 6.5-8v11z"/>', table: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M2.5 8h15M2.5 12h15M8 3.5v13"/>',
  compare: '<path d="M3 5h9M3 10h14M3 15h6"/>', sentiment: '<circle cx="10" cy="10" r="7.5"/><path d="M7 12c1.6 1.6 4.4 1.6 6 0M7.5 8h0M12.5 8h0"/>',
  competitor: '<path d="M6 3.5h8v4a4 4 0 0 1-8 0zM10 11.5V15M7 16.5h6M6 5H3.5c0 2 1 3 2.6 3.2M14 5h2.5c0 2-1 3-2.6 3.2"/>', sov: '<path d="M10 2.5v7.5l6 4.5A7.5 7.5 0 1 1 10 2.5z"/>',
  posts: '<rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M2.5 13l4-3.5 3 2.5 3-2 5 3.5"/>', mentions: '<path d="M3 4.5h14v9H8l-4 3v-3H3z"/>',
  tags: '<path d="M7 3l-2 14M15 3l-2 14M3.5 7.5h14M2.5 12.5h14"/>', growth: '<path d="M3 15.5l4.5-4.5 3 3L17 7.5M12.5 7.5H17V12"/>', geo: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.2 2.2 12.8 0 15M10 2.5c-2.2 2.2-2.2 12.8 0 15"/>',
  text: '<path d="M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5"/>', heading: '<path d="M5 3.5v13M15 3.5v13M5 10h10"/>', subheading: '<path d="M4 6h12M4 10h12M4 14h7"/>',
  image: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><circle cx="7" cy="8" r="1.5"/><path d="M2.5 14l4-4 3 3 3-2 5 3.5"/>', video: '<rect x="2.5" y="4" width="15" height="12" rx="2"/><path d="M8.5 7.5v5l4.5-2.5z"/>',
  header: '<rect x="2.5" y="3" width="15" height="14" rx="1.5"/><path d="M2.5 7h15"/>', footer: '<rect x="2.5" y="3" width="15" height="14" rx="1.5"/><path d="M2.5 13h15"/>',
  pagebreak: '<path d="M4 3v4h12V3M4 17v-4h12v4M2 10h3M8 10h4M15 10h3"/>', divider: '<path d="M2.5 10h15"/>', spacer: '<path d="M10 3v14M7 6l3-3 3 3M7 14l3 3 3-3"/>',
  container: '<rect x="3" y="3" width="14" height="14" rx="2.5" stroke-dasharray="2.5 2"/>', columns: '<rect x="2.5" y="3.5" width="6.5" height="13" rx="1.5"/><rect x="11" y="3.5" width="6.5" height="13" rx="1.5"/>',
  field: '<path d="M6 4c-2 0-2 1.5-2 3s-1 3-2 3c1 0 2 1.5 2 3s0 3 2 3M14 4c2 0 2 1.5 2 3s1 3 2 3c-1 0-2 1.5-2 3s0 3-2 3"/>', shape: '<circle cx="10" cy="10" r="7"/>'
};
const icon = (k, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${IC[k] || ""}</svg>`;

const WIDGETS = {
  kpi: { label: "KPI / Metric card", ic: "kpi", w: 200, h: 118, cfg: { metric: "reach", label: "", override: "", overrideChg: "" } },
  line: { label: "Line chart", ic: "line", w: 460, h: 260, cfg: { metric: "reach", split: true } },
  bar: { label: "Bar chart", ic: "bar", w: 460, h: 260, cfg: { metric: "engagements", mode: "platform", split: false, manual: "" } },
  pie: { label: "Pie chart", ic: "pie", w: 320, h: 260, cfg: { metric: "engagements", manual: "" } },
  donut: { label: "Donut chart", ic: "donut", w: 320, h: 260, cfg: { metric: "reach", manual: "" } },
  area: { label: "Area chart", ic: "area", w: 460, h: 260, cfg: { metric: "impressions", split: false } },
  table: { label: "Data table", ic: "table", w: 560, h: 220, cfg: { metrics: ["followers", "reach", "impressions", "engagements", "engagement_rate"] } },
  platcompare: { label: "Platform comparison", ic: "compare", w: 460, h: 250, cfg: { metric: "engagements", manual: "" } },
  sentiment: { label: "Sentiment analysis", ic: "sentiment", w: 360, h: 240, cfg: { alert: "", override: "" } },
  competitor: { label: "Competitor comparison", ic: "competitor", w: 520, h: 300, cfg: { net: "ig", group: "all", limit: 10 } },
  sov: { label: "Share of voice", ic: "sov", w: 360, h: 260, cfg: { basis: "followers", net: "ig", group: "all", limit: 6, alert: "", manual: "" } },
  topposts: { label: "Top performing posts", ic: "posts", w: 560, h: 330, cfg: { sort: "eng", limit: 3, campaign: "" } },
  topmentions: { label: "Top mentions", ic: "mentions", w: 520, h: 300, cfg: { sort: "reach", limit: 4, tone: "all", alert: "" } },
  hashtags: { label: "Top hashtags", ic: "tags", w: 360, h: 240, cfg: { source: "listening", limit: 15, style: "cloud", alert: "" } },
  growth: { label: "Audience growth", ic: "growth", w: 460, h: 260, cfg: {} },
  geo: { label: "Geographic insights", ic: "geo", w: 360, h: 260, cfg: { limit: 8, alert: "" } }
};
const WIDGET_GROUPS = [["Metrics", ["kpi", "table", "platcompare", "growth"]], ["Charts", ["line", "bar", "area", "pie", "donut"]],
  ["Listening & competitors", ["sentiment", "topmentions", "hashtags", "geo", "competitor", "sov"]], ["Content", ["topposts"]]];

function manualRows(txt) {
  return String(txt || "").split(/\n/).map(l => l.split(/[,\t]/)).filter(a => a.length >= 2 && a[0].trim() && !isNaN(parseFloat(a[1]))).map(a => [a[0].trim(), parseFloat(a[1])]);
}
const fmtMetric = (metric, v) => v == null ? "–" : METRICS[metric] && METRICS[metric].pct ? pctf(v) : metric === "net_sentiment" ? (v > 0 ? "+" : "") + Math.round(v) : compact(v);
function chgHTML(c) {
  if (!c || c.chg == null) return "";
  const up = c.chg >= 0, t = c.abs ? (up ? "+" : "") + (c.metric === "net_sentiment" ? Math.round(c.chg) + " pts" : (c.chg * 100).toFixed(1) + " pts") : (up ? "+" : "") + (c.chg * 100).toFixed(1) + "%";
  return `<span class="rbw-chg ${up ? "up" : "down"}">${up ? "↑" : "↓"} ${t}</span>`;
}

function renderWidget(el, doc) {
  const c = el.props.cfg, W = WIDGETS[el.props.kind];
  if (!W) return "";
  const pad = el.style.pad || 0, tH = c.showTitle && el.props.kind !== "kpi" ? 26 : 0;
  const iw = Math.max(40, el.w - pad * 2), ih = Math.max(30, el.h - pad * 2 - tH);
  const title = tH ? `<div class="rbw-t">${esc(c.title || W.label)}</div>` : "";
  let body = "";
  try { body = widgetBody(el, doc, c, iw, ih); } catch (e) { console.warn(e); body = `<div class="rbc-empty">This widget could not be drawn</div>`; }
  return title + `<div class="rbw-b" style="height:${ih}px">${body}</div>`;
}
function widgetBody(el, doc, c, w, h) {
  const k = el.props.kind;
  const b = brandOf(doc, c);
  if (!b && !(c.manual || c.override)) return `<div class="rbc-empty">Choose a brand for this report</div>`;
  const P = rbPeriod(doc, c.period);
  const met = METRICS[c.metric] || METRICS.reach;
  if (k === "kpi") {
    const cmp = c.override !== "" && c.override != null ? { cur: null, chg: c.overrideChg !== "" ? parseFloat(c.overrideChg) / 100 : null } : metricCompare(doc, c, c.metric);
    const val = c.override !== "" && c.override != null ? esc(c.override) : fmtMetric(c.metric, cmp.cur);
    return `<div class="rbw-kpi"><div class="rbw-kl">${esc(c.label || (c.platform && c.platform !== "all" ? (MRP[c.platform] || { n: "" }).n + " " : "") + met.l)}</div><div class="rbw-kv" style="color:${doc.theme.ink}">${val}</div>${chgHTML(cmp)}${cmp.prev != null ? `<div class="rbw-kp">vs ${fmtMetric(c.metric, cmp.prev)} previous ${doc.compare === "year" ? "year" : "period"}</div>` : ""}</div>`;
  }
  if (k === "line" || k === "area" || (k === "bar" && c.mode === "daily")) {
    const d = dailySeries(doc, c, c.metric, !!c.split);
    return (k === "bar" ? svgBars : svgLine)({ w, h, labels: d.days.map(x => fmtD(x)), series: d.series, area: k === "area" });
  }
  if (k === "bar" || k === "pie" || k === "donut" || k === "platcompare") {
    let rows = manualRows(c.manual).map(([n, v], i) => ({ name: n, value: v, color: PALETTE[i % PALETTE.length] }));
    let prev = null;
    if (!rows.length) {
      rows = byPlatform(doc, c, c.metric, P).filter(r => r.value != null).map(r => ({ name: r.name, value: r.value, color: PLAT_COLORS[r.key] || PALETTE[0], key: r.key }));
      if (k === "platcompare" && doc.compare !== "none") { const Q = prevP(doc, P); prev = rows.map(r => metricValue(doc, { ...c, platform: r.key }, c.metric, Q)); }
    }
    if (k === "pie" || k === "donut") return svgPie({ w, h, items: rows, donut: k === "donut", center: k === "donut" ? fmtMetric(c.metric, rows.reduce((a, r) => a + r.value, 0)) : "", sub: met.l });
    const series = [{ name: "This period", values: rows.map(r => r.value), colors: rows.map(r => r.color), color: doc.theme.accent }];
    if (prev && prev.some(v => v != null)) series.push({ name: doc.compare === "year" ? "Previous year" : "Previous period", values: prev, color: "#CFC9E6" });
    return svgBars({ w, h, labels: rows.map(r => r.name), series, horizontal: k === "platcompare", values: true, legend: series.length > 1 });
  }
  if (k === "table") {
    const ms = (c.metrics || []).filter(m => METRICS[m] && !METRICS[m].listen);
    const rows = byPlatform(doc, c, "reach", P).map(r => r.key);
    if (!rows.length) return `<div class="rbc-empty">No connected platforms for this brand</div>`;
    const tot = ms.map(m => metricValue(doc, { ...c, platform: "all" }, m, P));
    return `<table class="rbw-tbl"><thead><tr><th>Platform</th>${ms.map(m => `<th>${esc(METRICS[m].l)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr><td><span class="rbw-dot" style="background:${PLAT_COLORS[r] || "#999"}"></span>${esc((MRP[r] || { n: r }).n)}</td>${ms.map(m => `<td>${fmtMetric(m, metricValue(doc, { ...c, platform: r }, m, P))}</td>`).join("")}</tr>`).join("")}</tbody>
      ${rows.length > 1 ? `<tfoot><tr><td>All platforms</td>${tot.map((v, i) => `<td>${fmtMetric(ms[i], v)}</td>`).join("")}</tr></tfoot>` : ""}</table>`;
  }
  if (k === "sentiment") {
    const L = listening(b, P, c.alert);
    if (!L || !L.cur.length) return `<div class="rbc-empty">No listening mentions for this period</div>`;
    const it = [["Positive", L.sp.c.pos, SENT_C.pos], ["Neutral", L.sp.c.neu, SENT_C.neu], ["Negative", L.sp.c.neg, SENT_C.neg]].map(([n, v, col]) => ({ name: n, value: v, color: col }));
    return svgPie({ w, h, items: it, donut: true, center: Math.round(L.sp.p * 100) + "%", sub: "Positive" }) + `<div class="rbw-foot">${fmtInt(L.cur.length)} mentions · net sentiment ${L.sp.net > 0 ? "+" : ""}${L.sp.net}</div>`;
  }
  if (k === "competitor" || (k === "sov" && c.basis === "followers")) {
    const manual = k === "sov" ? manualRows(c.manual) : [];
    let rows;
    if (manual.length) rows = manual.map(([n, v]) => ({ name: n, v }));
    else {
      const C = competitors(b, P);
      rows = C.groups.filter(g => c.group === "all" || g.g === c.group).flatMap(g => g.rows).filter((r, i, a) => a.findIndex(x => x.name === r.name) === i)
        .map(r => ({ name: r.name, v: r[c.net], self: r.self })).filter(r => r.v != null).sort((x, y) => y.v - x.v);
    }
    if (!rows.length) return `<div class="rbc-empty">No competitor follower counts yet (Competitor Analysis)</div>`;
    if (k === "sov") {
      const top = rows.slice(0, c.limit || 6), rest = rows.slice(c.limit || 6).reduce((a, r) => a + r.v, 0);
      const it = top.map((r, i) => ({ name: r.name, value: r.v, color: r.self ? doc.theme.accent : PALETTE[(i + 1) % PALETTE.length] }));
      if (rest) it.push({ name: "Others", value: rest, color: "#CBD5E1" });
      return svgPie({ w, h, items: it, donut: true, center: "", legend: true });
    }
    const rs = rows.slice(0, c.limit || 10);
    return svgBars({ w, h, labels: rs.map(r => r.name), series: [{ name: CNET.find(x => x[0] === c.net)[1] + " followers", values: rs.map(r => r.v), colors: rs.map(r => r.self ? doc.theme.accent : "#B9B2D6") }], horizontal: true, legend: false });
  }
  if (k === "sov") {
    const manual = manualRows(c.manual);
    let it;
    if (manual.length) it = manual.map(([n, v], i) => ({ name: n, value: v, color: PALETTE[i % PALETTE.length] }));
    else {
      const L = listening(b, P, c.alert); if (!L || !L.cur.length) return `<div class="rbc-empty">No listening mentions for this period</div>`;
      const names = [b.name, ...competitors(b, P).groups.flatMap(g => g.rows).map(r => r.name)].filter((n, i, a) => n && a.indexOf(n) === i && !(/^self$/i.test(n)));
      const all = MENTIONS.filter(m => m.day >= P.from && m.day <= P.to);
      it = names.map((n, i) => { const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"), "i"); return { name: n, value: i === 0 ? L.cur.length : all.filter(m => re.test(m.text)).length, color: i === 0 ? doc.theme.accent : PALETTE[i % PALETTE.length] }; })
        .filter(x => x.value > 0).slice(0, c.limit || 6);
    }
    return svgPie({ w, h, items: it, donut: true, center: "", legend: true });
  }
  if (k === "topposts") {
    const ps = topPosts(doc, c);
    if (!ps.length) return `<div class="rbc-empty">No posts in this period</div>`;
    const n = ps.length, wide = w / n > 150 && n <= 4;
    return `<div class="rbw-posts ${wide ? "cols" : "rows"}" style="--n:${n}">${ps.map(p => `<div class="rbw-post">${p.img ? `<img src="${esc(p.img)}" alt="" crossorigin="anonymous" referrerpolicy="no-referrer">` : `<div class="rbw-noimg">${esc((MRP[p.plat] || { a: "" }).a)}</div>`}
      <div class="rbw-pb"><div class="rbw-pm"><span class="rbw-chip" style="background:${PLAT_COLORS[p.plat] || "#555"}">${esc((MRP[p.plat] || { a: p.plat }).a)}</span>${fmtD(localDay(new Date(p.published)), true)}</div>
      <div class="rbw-pt">${esc((p.title || p.text || "(No caption)").slice(0, 160))}</div>
      <div class="rbw-ps"><span><b>${p.reach == null ? "–" : compact(p.reach)}</b> ${p.plat === "youtube" || p.plat === "x" ? "views" : "reach"}</span><span><b>${compact(p.eng || 0)}</b> engagements</span></div></div></div>`).join("")}</div>`;
  }
  if (k === "topmentions") {
    const L = listening(b, P, c.alert);
    if (!L || !L.cur.length) return `<div class="rbc-empty">No listening mentions for this period</div>`;
    let ms = L.cur.filter(m => c.tone === "all" || labelOf(m) === c.tone);
    ms = ms.slice().sort((x, y) => c.sort === "date" ? (y.date > x.date ? 1 : -1) : y.reach - x.reach).slice(0, c.limit || 4);
    return `<div class="rbw-ments">${ms.map(m => { const l = labelOf(m); return `<div class="rbw-ment"><div class="rbw-mh"><b>${esc(m.author || "Unknown")}</b><span>${esc(m.platform)} · ${new Date(m.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span><span class="rbw-tone" style="background:${SENT_C[l]}">${esc(LABEL[l] || l)}</span></div><div class="rbw-mt">${esc(String(m.title || m.text || "").slice(0, 220))}</div><div class="rbw-mr">${compact(m.reach)} reach</div></div>`; }).join("")}</div>`;
  }
  if (k === "hashtags") {
    const tags = hashtags(doc, c);
    if (!tags.length) return `<div class="rbc-empty">No hashtags in this period</div>`;
    if (c.style === "bars") return svgBars({ w, h, labels: tags.map(t => t[0]), series: [{ name: "Uses", values: tags.map(t => t[1]), color: doc.theme.accent }], horizontal: true, legend: false });
    const max = tags[0][1];
    return `<div class="rbw-cloud">${tags.map(([t, n]) => `<span style="font-size:${(11 + 13 * n / max).toFixed(1)}px;opacity:${(.55 + .45 * n / max).toFixed(2)};color:${doc.theme.accent}">${esc(t)}</span>`).join("")}</div>`;
  }
  if (k === "growth") {
    const d = dailySeries(doc, c, "followers_gained", true);
    const ser = d.series.map(s => { let a = 0; return { ...s, values: s.values.map(v => v == null ? (a || null) : (a += v)) }; });
    const fol = byPlatform(doc, c, "followers", P).filter(r => r.value != null);
    const chartH = Math.max(60, h - (fol.length ? 30 : 0));
    return svgLine({ w, h: chartH, labels: d.days.map(x => fmtD(x)), series: ser }) +
      (fol.length ? `<div class="rbw-foot">${fol.map(r => `<span><i class="rbw-dot" style="background:${PLAT_COLORS[r.key] || "#999"}"></i>${esc(r.name)} <b>${compact(r.value)}</b></span>`).join("")}</div>` : "");
  }
  if (k === "geo") {
    const L = listening(b, P, c.alert);
    if (!L || !L.countries.length) return `<div class="rbc-empty">No location data for this period</div>`;
    const cs = L.countries.slice(0, c.limit || 8);
    return svgBars({ w, h, labels: cs.map(x => x[0]), series: [{ name: "Share of located mentions", values: cs.map(x => Math.round(x[2] * 1000) / 10), color: doc.theme.accent }], horizontal: true, legend: false });
  }
  return "";
}

/* data settings shown in the right panel for each widget */
function widgetFields(k) {
  const per = ["period"], brand = ["brand"];
  const F = {
    kpi: [...brand, "platform", "metric", "campaign", ...per, "label", "override", "overrideChg"],
    line: [...brand, "platform", "metric", "split", "campaign", ...per], area: [...brand, "platform", "metric", "split", "campaign", ...per],
    bar: [...brand, "mode", "platform", "metric", "split", ...per, "manual"], pie: [...brand, "metric", ...per, "manual"], donut: [...brand, "metric", ...per, "manual"],
    table: [...brand, "metrics", ...per], platcompare: [...brand, "metric", ...per, "manual"], sentiment: [...brand, "alert", ...per],
    competitor: [...brand, "net", "group", "limit"], sov: [...brand, "basis", "net", "group", "alert", "limit", ...per, "manual"],
    topposts: [...brand, "platform", "sort", "limit", "campaign", ...per], topmentions: [...brand, "alert", "tone", "msort", "limit", ...per],
    hashtags: [...brand, "source", "platform", "alert", "style", "limit", ...per], growth: [...brand, "platform", ...per], geo: [...brand, "alert", "limit", ...per]
  };
  return F[k] || brand;
}

(()=>{
"use strict";
/* ===== Custom Report Builder: core document model ===== */
const MM = 96 / 25.4;                                   // px per mm at 96 dpi
const PAGE_SIZES = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] };
const FONTS = ["Inter", "Jost", "Poppins", "Montserrat", "Roboto", "Lato", "Open Sans", "Playfair Display", "Merriweather", "Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"];
const GFONTS = ["Poppins", "Montserrat", "Roboto", "Lato", "Open Sans", "Playfair Display", "Merriweather"];
const PALETTE = ["#6739F5", "#3B82F6", "#14B8A6", "#F59E0B", "#EC4899", "#22C55E", "#EF4444", "#8B5CF6", "#0EA5E9", "#64748B"];
const PLAT_COLORS = { facebook: "#1877F2", instagram: "#D62976", youtube: "#E60000", linkedin: "#0A66C2", x: "#111111", tiktok: "#25F4EE" };
const FIELDS = [["client_name", "Client Name"], ["brand_name", "Brand Name"], ["report_title", "Report Title"], ["reporting_period", "Reporting Period"],
  ["generated_date", "Report Generated Date"], ["agency_name", "Agency Name"], ["page_number", "Page Number"], ["total_pages", "Total Pages"]];

const uid = (p = "e") => p + Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = v => Math.round(v * 10) / 10;

function loadGoogleFont(f) {
  if (!GFONTS.includes(f) || document.querySelector(`link[data-rbfont="${f}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.dataset.rbfont = f;
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f)}:wght@400;600;700&display=swap`;
  document.head.appendChild(l);
}
function fontsInDoc(doc) {
  const s = new Set([doc.theme.font]);
  doc.pages.forEach(p => p.elements.forEach(e => { if (e.props && e.props.font) s.add(e.props.font); }));
  s.forEach(loadGoogleFont);
}

function pageDims(doc, pg) {
  const sz = doc.page.size === "Custom" ? [+doc.page.w || 210, +doc.page.h || 297] : (PAGE_SIZES[doc.page.size] || PAGE_SIZES.A4);
  const o = (pg && pg.orientation) || doc.page.orientation;
  const w = Math.round(sz[0] * MM), h = Math.round(sz[1] * MM);
  return o === "landscape" ? [h, w] : [w, h];
}
function pageMM(doc, pg) { const [w, h] = pageDims(doc, pg); return [w / MM, h / MM]; }

/* ----- new documents ----- */
function newDoc(opts = {}) {
  const b = opts.brand ? SMA.brands.find(x => x.id === opts.brand) : null;
  return {
    v: 1, kind: opts.kind || "report", name: opts.name || "Untitled report", brand: opts.brand || "", client: opts.client || (b ? b.name : ""),
    agency: "Stark Agency", website: "starkpeople.in", copyright: `© ${new Date().getFullYear()} Stark Agency. All rights reserved.`,
    period: { preset: "last_month" }, compare: "prev",
    page: { size: "A4", orientation: "portrait", w: 210, h: 297 },
    theme: { font: "Inter", accent: "#6739F5", ink: "#17132B" },
    header: { enabled: true, height: 64, bg: "#6739F5", color: "#FFFFFF", clientLogo: true, agencyLogo: true, title: true, brand: true, text: "", firstPage: "hide" },
    footer: { enabled: true, height: 36, bg: "#F4F2FB", color: "#5B5675", pageNumber: true, total: true, copyright: false, agency: true, website: true, text: "", firstPage: "hide" },
    pages: [newPage("Page 1")], template_for: ""
  };
}
function newPage(name) {
  return { id: uid("p"), name: name || "Page", bg: "#FFFFFF", bgImage: "", orientation: "", header: "inherit", footer: "inherit", headerText: "", elements: [] };
}

/* ----- element factories ----- */
const TEXT_PRESETS = {
  heading: { html: "Heading", size: 32, weight: 700 },
  subheading: { html: "Subheading", size: 20, weight: 600 },
  text: { html: "Write your text here. Double-click to edit; use {{brand_name}} and other fields for values that fill in automatically.", size: 13, weight: 400 }
};
function baseEl(type, x, y, w, h, props, style) {
  return { id: uid(), type, x, y, w, h, locked: false, hidden: false, group: "", name: "", opacity: 1, link: "",
    style: Object.assign({ bg: "", borderW: 0, borderC: "#E4E1F0", borderS: "solid", radius: 0, shadow: false, pad: 0 }, style || {}), props: props || {} };
}
function makeEl(kind, doc, at) {
  const [pw] = pageDims(doc, curPage());
  const ac = doc.theme.accent;
  const P = (x, y) => at ? [at[0], at[1]] : [x, y];
  let e;
  if (TEXT_PRESETS[kind]) {
    const t = TEXT_PRESETS[kind];
    const [x, y] = P(56, 120);
    e = baseEl("text", x, y, kind === "text" ? 420 : 520, kind === "heading" ? 56 : kind === "subheading" ? 36 : 90,
      { html: t.html, font: "", size: t.size, weight: t.weight, color: kind === "text" ? "#3D3856" : doc.theme.ink, align: "left", lh: 1.35, ls: 0, valign: "top" });
    e.name = kind[0].toUpperCase() + kind.slice(1);
    return e;
  }
  const [x, y] = P(56, 140);
  switch (kind) {
    case "image": e = baseEl("image", x, y, 320, 200, { src: "", fit: "cover", px: 50, py: 50, zoom: 1, ratio: "free", align: "center" }, { radius: 8 }); break;
    case "video": e = baseEl("video", x, y, 420, 236, { url: "", src: "", thumb: "", title: "Video title", desc: "", play: true, showText: true }, { radius: 10 }); break;
    case "divider": e = baseEl("divider", x, y, pw - 112, 12, { color: "#E4E1F0", thick: 2, dash: "solid", dir: "h" }); break;
    case "spacer": e = baseEl("spacer", x, y, 200, 40, {}); break;
    case "container": e = baseEl("container", x, y, 340, 200, {}, { bg: "#F6F4FE", radius: 12, borderW: 1, borderC: "#E7E2FB" }); break;
    case "shape": e = baseEl("container", x, y, 120, 120, {}, { bg: ac, radius: 60 }); break;
    case "field": e = baseEl("text", x, y, 260, 28, { html: "{{reporting_period}}", font: "", size: 13, weight: 600, color: "#3D3856", align: "left", lh: 1.3, ls: 0, valign: "top" }); e.name = "Field"; break;
    default:
      if (WIDGETS[kind]) {
        const W = WIDGETS[kind];
        e = baseEl("widget", x, y, W.w || 340, W.h || 220, { kind, cfg: Object.assign({ title: W.label, showTitle: true, platform: "all", brand: "" }, clone(W.cfg || {})) },
          { bg: "#FFFFFF", radius: 12, borderW: 1, borderC: "#ECE9F5", pad: 14, shadow: true });
        e.name = W.label;
      }
  }
  return e;
}

/* ----- editor state ----- */
let ST = null;   // { doc, rid, page, sel, zoom, ... }
const curPage = () => ST && ST.doc.pages[ST.page];
const findEl = id => { for (const p of ST.doc.pages) { const e = p.elements.find(x => x.id === id); if (e) return e; } return null; };
const selEls = () => { const pg = curPage(); return pg ? pg.elements.filter(e => ST.sel.includes(e.id)) : []; };

/* ----- undo / redo (whole-document snapshots) ----- */
function snapshot() { return JSON.stringify({ d: ST.doc, p: ST.page }); }
function commit(label) {
  const s = snapshot();
  if (ST.hist.length && ST.hist[ST.hist.length - 1] === s) return;
  ST.hist.push(s); if (ST.hist.length > 120) ST.hist.shift();
  ST.fut = []; ST.dirty = true; scheduleAutosave();
}
function undo() {
  if (ST.hist.length < 2) return;
  ST.fut.push(ST.hist.pop());
  restore(ST.hist[ST.hist.length - 1]);
}
function redo() {
  if (!ST.fut.length) return;
  const s = ST.fut.pop(); ST.hist.push(s); restore(s);
}
function restore(s) {
  const o = JSON.parse(s); ST.doc = o.d; ST.page = clamp(o.p, 0, ST.doc.pages.length - 1);
  ST.sel = ST.sel.filter(id => curPage().elements.some(e => e.id === id)); ST.editing = null; ST.dirty = true;
  scheduleAutosave(); renderAll();
}

/* ----- HTML sanitising for rich text (only simple formatting and safe links survive) ----- */
const OK_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI", "A", "FONT", "SUB", "SUP", "S", "STRIKE"]);
const OK_CSS = /^(color|background-color|font-weight|font-style|text-decoration(-line)?|font-size|font-family|text-align)$/;
function cleanHTML(html) {
  const d = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const walk = n => {
    [...n.childNodes].forEach(c => {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1 || !OK_TAGS.has(c.tagName)) {
        if (c.nodeType === 1 && !["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(c.tagName)) { walk(c); c.replaceWith(...c.childNodes); } else c.remove();
        return;
      }
      [...c.attributes].forEach(a => {
        const n2 = a.name.toLowerCase();
        if (n2 === "style") {
          const keep = String(a.value).split(";").map(x => x.trim()).filter(x => { const [k, v] = x.split(":"); return k && v && OK_CSS.test(k.trim().toLowerCase()) && !/url\(|expression|javascript/i.test(v); });
          keep.length ? c.setAttribute("style", keep.join(";")) : c.removeAttribute("style");
        } else if (c.tagName === "A" && n2 === "href") {
          if (!/^(https?:|mailto:)/i.test(a.value.trim())) c.removeAttribute("href");
        } else if (c.tagName === "FONT" && (n2 === "color" || n2 === "face" || n2 === "size")) {
          if (!/^[#\w\s,-]{1,40}$/.test(a.value)) c.removeAttribute(a.name);
        } else c.removeAttribute(a.name);
      });
      if (c.tagName === "A") { c.setAttribute("target", "_blank"); c.setAttribute("rel", "noopener noreferrer"); }
      walk(c);
    });
  };
  walk(d.body.firstChild);
  return d.body.firstChild.innerHTML;
}

/* ----- dynamic fields ----- */
function fieldValues(doc, pageIndex, total) {
  const b = SMA.brands && SMA.brands.find(x => x.id === doc.brand);
  const P = rbPeriod(doc);
  return {
    client_name: doc.client || (b ? b.name : ""), brand_name: b ? b.name : "", report_title: doc.name, reporting_period: P.label,
    generated_date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), agency_name: doc.agency || "",
    page_number: String(pageIndex + 1), total_pages: String(total)
  };
}
function fillFields(html, vals) {
  return String(html || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => k in vals ? esc(vals[k]) : m);
}

/* ===== Data binding: periods, metrics and lists from Sentimeter's analytics ===== */
const PRESETS = [["last_7", "Last 7 days"], ["last_30", "Last 30 days"], ["this_month", "This month"], ["last_month", "Last month"],
  ["this_quarter", "This quarter"], ["last_quarter", "Last quarter"], ["this_year", "This year"], ["custom", "Custom range"]];
const iso = d => localDay(d);
const addDays = (k, n) => { const d = new Date(k + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => { const out = []; for (let k = a; k <= b; k = addDays(k, 1)) { out.push(k); if (out.length > 800) break; } return out; };
const fmtD = (k, y) => new Date(k + "T00:00:00").toLocaleDateString("en-IN", y ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });

function presetRange(preset, from, to) {
  const t = new Date(); t.setHours(0, 0, 0, 0); const today = iso(t);
  const q = Math.floor(t.getMonth() / 3);
  switch (preset) {
    case "last_7": return [addDays(today, -6), today];
    case "last_30": return [addDays(today, -29), today];
    case "this_month": return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), today];
    case "this_quarter": return [iso(new Date(t.getFullYear(), q * 3, 1)), today];
    case "last_quarter": { const s = new Date(t.getFullYear(), q * 3 - 3, 1); return [iso(s), iso(new Date(s.getFullYear(), s.getMonth() + 3, 0))]; }
    case "this_year": return [iso(new Date(t.getFullYear(), 0, 1)), today];
    case "custom": if (from && to && from <= to) return [from, to];
    // fall through
    default: { const s = new Date(t.getFullYear(), t.getMonth() - 1, 1); return [iso(s), iso(new Date(t.getFullYear(), t.getMonth(), 0))]; }
  }
}
function rangeLabel(a, b) {
  const s = new Date(a + "T00:00:00"), e = new Date(b + "T00:00:00");
  const whole = s.getDate() === 1 && addDays(b, 1).slice(8) === "01";
  if (whole && s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return s.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return s.getFullYear() === e.getFullYear() ? `${fmtD(a)} – ${fmtD(b, true)}` : `${fmtD(a, true)} – ${fmtD(b, true)}`;
}
function makeP(from, to, compare) {
  const all = daysBetween(from, to);
  let prev;
  if (compare === "year") prev = all.map(k => { const d = new Date(k + "T00:00:00"); d.setFullYear(d.getFullYear() - 1); return iso(d); });
  else prev = all.map(k => addDays(k, -all.length));
  const label = rangeLabel(from, to);
  return { kind: "custom", from, to, allDays: all, prevDays: prev, label, cover: ["SOCIAL MEDIA REPORT", label.toUpperCase()], month: to.slice(0, 7), word: "period" };
}
function rbPeriod(doc, over) {
  const pr = over && over.preset && over.preset !== "report" ? over : doc.period || {};
  const [a, b] = presetRange(pr.preset, pr.from, pr.to);
  return makeP(a, b, doc.compare);
}
function prevP(doc, P) {
  if (doc.compare === "none") return null;
  return makeP(P.prevDays[0], P.prevDays[P.prevDays.length - 1], "prev");
}

/* ----- loading every brand a document uses ----- */
function docBrands(doc) {
  const ids = new Set(doc.brand ? [doc.brand] : []);
  doc.pages.forEach(p => p.elements.forEach(e => { if (e.type === "widget" && e.props.cfg.brand) ids.add(e.props.cfg.brand); }));
  return [...ids].map(id => (SMA.brands || []).find(b => b.id === id)).filter(Boolean);
}
async function ensureData(doc) {
  const bs = docBrands(doc);
  await Promise.all(bs.map(b => grpLoad(b, false)));
}

/* ----- one model per brand and period, reused by every widget ----- */
const MODELS = new Map();
function brandOf(doc, cfg) { const id = (cfg && cfg.brand) || doc.brand; return (SMA.brands || []).find(b => b.id === id) || null; }
function verKey(b) { return [b.id, SMA.dataFor[b.id], SMA.metaFor[b.id], SMA.ytAllFor[b.id], SMA.extraFor[b.id], MENTIONS.length].join("|"); }
function model(b, P) {
  const k = verKey(b) + "|" + P.from + "|" + P.to + "|" + P.prevDays[0];
  if (!MODELS.has(k)) {
    if (MODELS.size > 60) MODELS.clear();
    let M = null;
    try { M = mrModel(b, P); } catch (e) { console.warn("report model", e); }
    MODELS.set(k, M);
  }
  return MODELS.get(k);
}
function listening(b, P, alertId) {
  const k = "L|" + verKey(b) + "|" + P.from + "|" + P.to + "|" + (alertId || "");
  if (!MODELS.has(k)) {
    const cfg = (b.extra || {}).config || {};
    const id = alertId || cfg.alert_id || "__brand__";
    let L = null;
    try { L = mrListening({ ...b, extra: { ...(b.extra || {}), config: { ...cfg, alert_id: id } } }, P, P.allDays); } catch (e) { console.warn("listening", e); }
    MODELS.set(k, L);
  }
  return MODELS.get(k);
}
function competitors(b, P) { try { return mrCompetitors(b, P); } catch (e) { return { groups: [] }; } }

/* ----- metric catalogue ----- */
const METRICS = {
  followers: { l: "Followers", f: p => p.followers, level: true },
  followers_gained: { l: "New followers", f: p => p.gained, series: ["New followers", "New subscribers"] },
  reach: { l: "Reach", f: p => p.reach, series: ["Reach"] },
  impressions: { l: "Impressions / views", f: p => p.impr, series: ["Views", "Impressions"] },
  engagements: { l: "Engagements", f: p => p.eng, series: ["Engagements"] },
  engagement_rate: { l: "Engagement rate", pct: true },
  video_views: { l: "Video views", f: p => p.videoViews },
  posts: { l: "Posts published", series: ["Posts"] },
  mentions: { l: "Mentions", listen: true },
  mention_reach: { l: "Mention reach", listen: true },
  positive: { l: "Positive sentiment", listen: true, pct: true },
  negative: { l: "Negative sentiment", listen: true, pct: true },
  net_sentiment: { l: "Net sentiment score", listen: true }
};
const PLATFORM_OPTS = [["all", "All platforms"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["linkedin", "LinkedIn"], ["x", "X"], ["tiktok", "TikTok"]];
const platsOf = (M, platform) => !M ? [] : M.plats.filter(p => platform === "all" || !platform || p.key === platform);
const sumN = arr => { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, x) => a + (+x || 0), 0) : null; };

function postsOf(M, platform, campaign) {
  if (!M) return [];
  const c = String(campaign || "").trim().toLowerCase();
  return M.R.posts.filter(p => (platform === "all" || !platform || p.plat === platform) && (!c || (p.text + " " + p.title).toLowerCase().includes(c)));
}
function metricValue(doc, cfg, metric, P) {
  const b = brandOf(doc, cfg); if (!b) return null;
  const def = METRICS[metric] || METRICS.reach;
  if (def.listen) {
    const L = listening(b, P, cfg.alert); if (!L) return null;
    if (metric === "mentions") return L.cur.length;
    if (metric === "mention_reach") return L.reach;
    if (metric === "positive") return L.cur.length ? L.sp.p : null;
    if (metric === "negative") return L.cur.length ? L.sp.n : null;
    return L.cur.length ? L.sp.net : null;
  }
  const M = model(b, P);
  if (!M) return null;
  if (cfg.campaign && ["reach", "engagements", "posts", "engagement_rate"].includes(metric)) {   // campaign filter: from matching posts
    const ps = postsOf(M, cfg.platform, cfg.campaign);
    if (metric === "posts") return ps.length;
    const r = sumN(ps.map(p => p.reach)), e = sumN(ps.map(p => p.eng));
    return metric === "reach" ? r : metric === "engagements" ? e : r ? (e || 0) / r : null;
  }
  const ps = platsOf(M, cfg.platform);
  if (metric === "posts") return postsOf(M, cfg.platform).length;
  if (metric === "engagement_rate") { const e = sumN(ps.map(p => p.eng)), r = sumN(ps.map(p => p.reach)) || sumN(ps.map(p => p.impr)); return r ? (e || 0) / r : null; }
  return sumN(ps.map(def.f));
}
function metricCompare(doc, cfg, metric) {
  const P = rbPeriod(doc, cfg.period), Q = prevP(doc, P);
  const cur = metricValue(doc, cfg, metric, P);
  if (!Q || METRICS[metric] && METRICS[metric].level) return { cur, prev: null, chg: null, metric };
  const prev = metricValue(doc, cfg, metric, Q);
  const chg = cur == null || prev == null ? null : METRICS[metric] && (METRICS[metric].pct || metric === "net_sentiment") ? cur - prev : prev ? (cur - prev) / Math.abs(prev) : null;
  return { cur, prev, chg, metric, abs: METRICS[metric] && (METRICS[metric].pct || metric === "net_sentiment") };
}
/* daily series: one per platform (or summed) */
function dailySeries(doc, cfg, metric, split) {
  const b = brandOf(doc, cfg); const P = rbPeriod(doc, cfg.period);
  const days = P.allDays.filter(k => k <= iso(new Date()));
  if (!b) return { days, series: [] };
  const def = METRICS[metric] || METRICS.reach;
  if (def.listen) {
    const L = listening(b, P, cfg.alert); if (!L) return { days, series: [] };
    const vals = days.map(k => { const ms = L.cur.filter(m => m.day === k); return metric === "mention_reach" ? ms.reduce((a, m) => a + m.reach, 0) : ms.length; });
    return { days, series: [{ name: def.l, values: vals, color: doc.theme.accent }] };
  }
  const M = model(b, P); if (!M) return { days, series: [] };
  if (metric === "posts") {
    const by = {}; postsOf(M, cfg.platform, cfg.campaign).forEach(p => { const k = localDay(new Date(p.published)); (by[p.plat] = by[p.plat] || {})[k] = (by[p.plat][k] || 0) + 1; });
    const ser = Object.entries(by).map(([k, m]) => ({ name: (MRP[k] || { n: k }).n, key: k, values: days.map(d => m[d] || 0), color: PLAT_COLORS[k] }));
    return { days, series: split ? ser : [{ name: def.l, values: days.map((d, i) => ser.reduce((a, s) => a + s.values[i], 0)), color: doc.theme.accent }] };
  }
  const names = def.series || [];
  const ser = [];
  platsOf(M, cfg.platform).forEach(p => {
    const s = (p.charts || []).flatMap(c => c.series).find(x => names.includes(x.name));
    if (!s) return;
    const m = {}; (p.days || []).forEach((k, i) => m[k] = s.values[i]);
    ser.push({ name: p.name.replace(" (public data)", ""), key: p.key, values: days.map(k => m[k] ?? null), color: PLAT_COLORS[p.key] });
  });
  if (split) return { days, series: ser };
  return { days, series: ser.length ? [{ name: def.l, values: days.map((k, i) => { const v = ser.map(s => s.values[i]).filter(x => x != null); return v.length ? v.reduce((a, x) => a + x, 0) : null; }), color: doc.theme.accent }] : [] };
}
function byPlatform(doc, cfg, metric, P) {
  const b = brandOf(doc, cfg); P = P || rbPeriod(doc, cfg.period); const M = b && model(b, P); if (!M) return [];
  return M.plats.filter(p => !p.apify || !M.plats.some(q => q.key === p.key && !q.apify)).map(p => {
    const c = { ...cfg, platform: p.key };
    return { key: p.key, name: (MRP[p.key] || { n: p.name }).n, value: metricValue(doc, c, metric, P) };
  }).filter((x, i, a) => a.findIndex(y => y.key === x.key) === i);
}
function topPosts(doc, cfg) {
  const b = brandOf(doc, cfg); const P = rbPeriod(doc, cfg.period); const M = b && model(b, P);
  const ps = postsOf(M, cfg.platform, cfg.campaign).slice();
  const k = cfg.sort || "eng";
  ps.sort((a, c) => k === "date" ? (c.published < a.published ? -1 : 1) : ((c[k] || 0) - (a[k] || 0)));
  return ps.slice(0, cfg.limit || 5).map(p => ({ ...p, img: p.thumb ? thumbUrl(b.id, p.thumb) : p.pic }));
}
function hashtags(doc, cfg) {
  const b = brandOf(doc, cfg); const P = rbPeriod(doc, cfg.period); if (!b) return [];
  if (cfg.source === "posts") {
    const M = model(b, P); const c = {};
    postsOf(M, cfg.platform, cfg.campaign).forEach(p => (p.text.match(/#[\p{L}\p{N}_]{2,40}/gu) || []).forEach(h => { const k = h.toLowerCase(); c[k] = (c[k] || 0) + 1; }));
    return Object.entries(c).sort((x, y) => y[1] - x[1]).slice(0, cfg.limit || 20);
  }
  const L = listening(b, P, cfg.alert); return L ? L.tags.slice(0, cfg.limit || 20) : [];
}

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

/* ===== Predefined templates (built from the same elements, so they fill with each brand's data) ===== */
function T(doc) {
  const A = doc.theme.accent;
  const w = (kind, x, y, ww, hh, cfg, extra) => { const e = makeEl(kind, doc, [x, y]); e.w = ww; e.h = hh; Object.assign(e.props.cfg, cfg || {}); if (extra) Object.assign(e, extra); return e; };
  const t = (kind, x, y, ww, hh, html, p) => { const e = makeEl(kind, doc, [x, y]); e.w = ww; e.h = hh; e.props.html = html; Object.assign(e.props, p || {}); return e; };
  const box = (x, y, ww, hh, st) => { const e = makeEl("container", doc, [x, y]); e.w = ww; e.h = hh; Object.assign(e.style, st || {}); return e; };
  const img = (x, y, ww, hh, src, p) => { const e = makeEl("image", doc, [x, y]); e.w = ww; e.h = hh; e.props.src = src; Object.assign(e.props, p || {}); e.style.radius = 0; return e; };
  const page = (name, els, opt) => Object.assign(newPage(name), { elements: els }, opt || {});
  const b = SMA.brands.find(x => x.id === doc.brand);
  const logo = b && b.logo ? logoUrl(b) : "";
  const cover = (title, sub) => page("Cover", [
    box(0, 0, 794, 1123, { bg: "#17123A", radius: 0, borderW: 0 }),
    box(0, 0, 794, 560, { bg: A, radius: 0, borderW: 0 }),
    box(540, 380, 340, 340, { bg: "#FFFFFF", radius: 999, borderW: 0 }),
    ...(logo ? [img(578, 470, 200, 160, logo, { fit: "contain" })] : [t("heading", 566, 500, 212, 100, "{{brand_name}}", { color: "#17123A", align: "center", size: 24, valign: "middle", lh: 1.15 })]),
    t("text", 64, 150, 480, 30, "{{agency_name}} · {{client_name}}", { color: "#E9E3FF", size: 15, weight: 600 }),
    t("heading", 64, 196, 460, 170, title, { color: "#FFFFFF", size: 38, lh: 1.12 }),
    t("subheading", 64, 380, 460, 36, sub || "{{reporting_period}}", { color: "#FFFFFF", size: 22, weight: 500 }),
    t("text", 64, 1020, 500, 28, "Prepared on {{generated_date}}", { color: "#A9A3C9", size: 13 })
  ], { header: "hide", footer: "hide", bg: "#17123A" });
  const H = (txt, y) => t("heading", 48, y || 92, 698, 44, txt, { size: 26 });
  const kpis = (y, list, cfg) => list.map((m, i) => w("kpi", 48 + i * 178, y, 164, 118, { metric: m, ...(cfg || {}) }));
  return {
    monthly: () => ({
      period: { preset: "last_month" }, pages: [
        cover("{{report_title}}"),
        page("Executive summary", [H("Executive summary"),
          t("text", 48, 142, 698, 70, "{{brand_name}}'s social media performance for {{reporting_period}}. Summarise the highlights here: reach, engagement, audience growth and how people talked about the brand."),
          ...kpis(226, ["reach", "engagements", "engagement_rate", "followers_gained"]),
          w("line", 48, 364, 430, 290, { title: "Reach trend", metric: "reach", split: true }), w("sentiment", 492, 364, 254, 290, { title: "Sentiment" }),
          w("table", 48, 670, 698, 230, { title: "Platform-wise performance" }),
          t("text", 48, 918, 698, 80, "Key takeaways: add your commentary for the client here.", { color: "#5B5675" })]),
        page("Platforms", [H("Platform performance"), w("platcompare", 48, 146, 698, 270, { title: "Engagements by platform", metric: "engagements" }),
          w("area", 48, 430, 698, 270, { title: "Impressions / views per day", metric: "impressions", split: true }),
          w("donut", 48, 716, 340, 280, { title: "Reach share", metric: "reach" }), w("growth", 402, 716, 344, 280, { title: "Audience growth" })]),
        page("Top content", [H("Top performing posts"), w("topposts", 48, 146, 698, 380, { title: "Top posts by engagement", limit: 3 }),
          w("bar", 48, 542, 698, 270, { title: "Posts published per day", metric: "posts", mode: "daily", split: true })]),
        page("Listening", [H("Social listening"), ...kpis(146, ["mentions", "mention_reach", "positive", "net_sentiment"]),
          w("topmentions", 48, 282, 698, 360, { title: "Top mentions", limit: 4 }), w("hashtags", 48, 658, 340, 290, { title: "Top hashtags" }), w("geo", 402, 658, 344, 290, { title: "Where mentions came from" })])
      ]
    }),
    weekly: () => ({
      period: { preset: "last_7" }, pages: [
        page("Week at a glance", [H("Weekly performance · {{reporting_period}}"), ...kpis(146, ["reach", "impressions", "engagements", "followers_gained"]),
          w("line", 48, 282, 698, 300, { title: "Engagements per day", metric: "engagements", split: true }), w("table", 48, 598, 698, 220, { title: "By platform" }),
          t("text", 48, 836, 698, 120, "This week: note wins, issues and next week's plan.", { color: "#5B5675" })]),
        page("Content", [H("Top posts this week"), w("topposts", 48, 146, 698, 380, { title: "Top posts", limit: 3 }), w("sentiment", 48, 542, 340, 280), w("topmentions", 402, 542, 344, 400, { limit: 3 })])
      ]
    }),
    campaign: () => ({
      period: { preset: "last_30" }, pages: [
        cover("Campaign performance report", "Campaign #YourHashtag · {{reporting_period}}"),
        page("Campaign results", [H("Campaign results"), t("text", 48, 142, 698, 48, "Results for posts containing the campaign hashtag. Change the hashtag in each widget's Campaign setting.", { color: "#5B5675" }),
          ...kpis(204, ["posts", "reach", "engagements", "engagement_rate"], { campaign: "#YourHashtag" }),
          w("topposts", 48, 340, 698, 380, { title: "Campaign posts", campaign: "#YourHashtag", limit: 3 }),
          w("platcompare", 48, 736, 698, 250, { title: "Engagements by platform", metric: "engagements" })])
      ]
    }),
    competitor: () => ({
      period: { preset: "last_month" }, pages: [
        cover("Competitor analysis"),
        page("Followers", [H("Competitor comparison"), w("competitor", 48, 146, 698, 400, { title: "Instagram followers", net: "ig" }), w("competitor", 48, 562, 698, 400, { title: "Facebook followers", net: "fb" })]),
        page("Share of voice", [H("Share of voice"), w("sov", 48, 146, 340, 330, { title: "Instagram audience share", net: "ig" }), w("sov", 402, 146, 344, 330, { title: "Share of mentions", basis: "mentions" }),
          w("competitor", 48, 492, 698, 400, { title: "YouTube subscribers", net: "yt" })])
      ]
    }),
    sentiment: () => ({
      period: { preset: "last_month" }, pages: [
        cover("Brand sentiment report"),
        page("Sentiment", [H("Brand sentiment"), ...kpis(146, ["mentions", "positive", "negative", "net_sentiment"]),
          w("sentiment", 48, 282, 340, 300, { title: "Sentiment split" }), w("line", 402, 282, 344, 300, { title: "Mentions per day", metric: "mentions", split: false }),
          w("topmentions", 48, 598, 340, 400, { title: "Most positive", tone: "pos", limit: 3 }), w("topmentions", 402, 598, 344, 400, { title: "Most negative", tone: "neg", limit: 3 })])
      ]
    }),
    listening: () => ({
      period: { preset: "last_30" }, pages: [
        cover("Social listening report"),
        page("Overview", [H("Listening overview"), ...kpis(146, ["mentions", "mention_reach", "positive", "net_sentiment"]),
          w("area", 48, 282, 698, 280, { title: "Mentions per day", metric: "mentions" }), w("hashtags", 48, 578, 340, 300, { title: "Top hashtags" }), w("geo", 402, 578, 344, 300, { title: "Countries" })]),
        page("Conversations", [H("Top conversations"), w("topmentions", 48, 146, 698, 520, { title: "Top mentions by reach", limit: 5 }), w("sov", 48, 682, 340, 300, { title: "Share of voice", basis: "mentions" }), w("sentiment", 402, 682, 344, 300)])
      ]
    }),
    quarterly: () => ({
      period: { preset: "last_quarter" }, pages: [
        cover("Quarterly marketing report"),
        page("Quarter summary", [H("Quarter at a glance"), ...kpis(146, ["reach", "engagements", "followers_gained", "posts"]),
          w("area", 48, 282, 698, 290, { title: "Reach over the quarter", metric: "reach", split: true }), w("table", 48, 588, 698, 230, { title: "Platform-wise performance" }),
          t("text", 48, 836, 698, 120, "Quarter highlights and plans for the next quarter.", { color: "#5B5675" })]),
        page("Content & audience", [H("Content and audience"), w("topposts", 48, 146, 698, 380, { title: "Best posts of the quarter", limit: 3 }), w("growth", 48, 542, 698, 280, { title: "Audience growth" })]),
        page("Market", [H("Sentiment and competitors"), w("sentiment", 48, 146, 340, 300), w("sov", 402, 146, 344, 300, { title: "Share of voice", net: "ig" }), w("competitor", 48, 462, 698, 420, { title: "Instagram followers vs competitors", net: "ig" })])
      ]
    })
  };
}
const TEMPLATE_LIST = [["monthly", "Monthly Social Media Report", "Cover, executive summary, platforms, top content and listening."],
  ["weekly", "Weekly Performance Report", "Week at a glance and the week's top content."],
  ["campaign", "Campaign Performance Report", "Results for one campaign hashtag across platforms."],
  ["competitor", "Competitor Analysis Report", "Followers vs competitors and share of voice."],
  ["sentiment", "Brand Sentiment Report", "Sentiment split, trend, and the most positive and negative mentions."],
  ["listening", "Social Listening Report", "Mentions, reach, hashtags, countries and top conversations."],
  ["quarterly", "Quarterly Marketing Report", "Quarter summary, content, audience, sentiment and competitors."]];
function applyBuiltin(doc, key) {
  ST = ST || { doc, page: 0, sel: [] };
  const prev = ST.doc; ST.doc = doc; ST.page = 0;
  const tpl = T(doc)[key]();
  ST.doc = prev;
  doc.pages = tpl.pages; doc.period = tpl.period; doc.name = doc.name && doc.name !== "Untitled report" ? doc.name : TEMPLATE_LIST.find(x => x[0] === key)[1];
  return doc;
}

/* ===== Editor: rendering of pages, selection, drag/resize/snap, text editing, page navigator ===== */
const $q = (s, r) => (r || document).querySelector(s), $qa = (s, r) => [...(r || document).querySelectorAll(s)];

/* ----- header / footer ----- */
function showHF(doc, pi, kind) {
  const cfg = doc[kind], pg = doc.pages[pi];
  if (!cfg.enabled) return pg[kind] === "show";
  if (pg[kind] === "hide") return false;
  if (pg[kind] === "show") return true;
  return !(pi === 0 && cfg.firstPage === "hide");
}
function headerHTML(doc, pi, vals, pw) {
  const H = doc.header, first = pi === 0 && H.firstPage === "custom" && H.first ? { ...H, ...H.first } : H, pg = doc.pages[pi];
  const b = SMA.brands.find(x => x.id === doc.brand);
  const text = fillFields(esc(pg.headerText || first.text || ""), vals);
  return `<div class="rb-hdr" style="height:${first.height}px;background:${first.bg};color:${first.color}">
    ${first.clientLogo && b && b.logo ? `<img class="rb-hlogo" src="${logoUrl(b)}" alt="">` : ""}
    <div class="rb-htxt">${first.title ? `<b>${esc(doc.name)}</b>` : ""}${first.brand && b ? `<span>${esc(b.name)}${doc.client && doc.client !== b.name ? " · " + esc(doc.client) : ""}</span>` : ""}</div>
    ${text ? `<div class="rb-hcustom">${text}</div>` : ""}
    ${first.agencyLogo ? `<img class="rb-hlogo agency" src="stark-logo.png" alt="">` : ""}</div>`;
}
function footerHTML(doc, pi, vals) {
  const F = doc.footer;
  const left = [F.agency && doc.agency ? esc(doc.agency) : "", F.website && doc.website ? esc(doc.website) : "", F.copyright && doc.copyright ? esc(doc.copyright) : ""].filter(Boolean).join(" · ");
  const num = F.pageNumber ? `Page ${vals.page_number}${F.total ? " of " + vals.total_pages : ""}` : "";
  return `<div class="rb-ftr" style="height:${F.height}px;background:${F.bg};color:${F.color}"><span>${left}</span><span class="c">${fillFields(esc(F.text || ""), vals)}</span><span class="r">${num}</span></div>`;
}

/* ----- elements ----- */
function ytId(u) { return (String(u || "").match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/) || [])[1] || ""; }
function elStyle(e, z, mode) {
  const s = e.style;
  const bw = +s.borderW || 0;
  return `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;z-index:${z};opacity:${e.hidden && mode === "edit" ? .35 : e.opacity ?? 1};` +
    (s.bg ? `background:${s.bg};` : "") + (bw ? `border:${bw}px ${s.borderS || "solid"} ${s.borderC};` : "") + (s.radius ? `border-radius:${s.radius}px;` : "") +
    (s.shadow ? `box-shadow:0 6px 18px rgba(23,19,43,.10),0 1px 3px rgba(23,19,43,.08);` : "") + (s.pad && e.type !== "image" ? `padding:${s.pad}px;` : "");
}
function elInner(e, doc, vals, mode) {
  const p = e.props;
  switch (e.type) {
    case "text": {
      const editing = mode === "edit" && ST && ST.editing === e.id;
      const html = editing ? cleanHTML(p.html) : fillFields(cleanHTML(p.html), vals);
      return `<div class="rb-txt${editing ? " editing" : ""}" ${editing ? 'contenteditable="true" spellcheck="true"' : ""} style="font-family:'${esc(p.font || doc.theme.font)}',sans-serif;font-size:${p.size}px;font-weight:${p.weight};color:${p.color};text-align:${p.align};line-height:${p.lh};letter-spacing:${p.ls || 0}px;justify-content:${p.valign === "middle" ? "center" : p.valign === "bottom" ? "flex-end" : "flex-start"}${p.bg ? ";background:" + p.bg : ""}">${html}</div>`;
    }
    case "image": {
      if (!p.src) return mode === "edit" ? `<div class="rb-ph">${icon("image", 26)}<span>Double-click to add an image</span></div>` : "";
      return `<img class="rb-img" src="${esc(p.src)}" alt="" draggable="false" style="object-fit:${p.fit};object-position:${p.px}% ${p.py}%;transform:scale(${p.zoom || 1});transform-origin:${p.px}% ${p.py}%;border-radius:${e.style.radius || 0}px">`;
    }
    case "video": {
      const yid = ytId(p.url), thumb = p.thumb || (yid ? `https://i.ytimg.com/vi/${yid}/hqdefault.jpg` : "");
      const txtH = p.showText && (p.title || p.desc) ? 54 : 0;
      const media = mode === "view" && p.src ? `<video src="${esc(p.src)}" ${thumb ? `poster="${esc(thumb)}"` : ""} controls style="width:100%;height:100%;object-fit:cover;background:#000"></video>`
        : `${thumb ? `<img src="${esc(thumb)}" alt="" draggable="false" crossorigin="anonymous" referrerpolicy="no-referrer">` : `<div class="rb-vph"></div>`}${p.play ? `<span class="rb-play"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="#fff"/></svg></span>` : ""}`;
      return `<div class="rb-vid"><div class="rb-vm" style="height:calc(100% - ${txtH}px);border-radius:${e.style.radius || 0}px ${e.style.radius || 0}px ${txtH ? 0 : e.style.radius || 0}px ${txtH ? 0 : e.style.radius || 0}px">${media}</div>
        ${txtH ? `<div class="rb-vt"><b>${esc(p.title || "")}</b><span>${esc(p.desc || "")}</span></div>` : ""}</div>`;
    }
    case "divider": return `<div class="rb-div ${p.dir}" style="${p.dir === "v" ? "border-left" : "border-top"}:${p.thick}px ${p.dash} ${p.color}"></div>`;
    case "spacer": return mode === "edit" ? `<div class="rb-spacer">Spacer</div>` : "";
    case "widget": return `<div class="rb-w" style="font-family:'${esc(doc.theme.font)}',sans-serif">${renderWidget(e, doc)}</div>`;
    default: return "";
  }
}
function elHTML(e, doc, vals, mode, z) {
  if (e.hidden && mode !== "edit") return "";
  if (e.type === "spacer" && mode !== "edit") return "";
  return `<div class="rb-el t-${e.type}${e.locked && mode === "edit" ? " locked" : ""}" data-id="${e.id}" ${e.link && mode === "view" ? `data-link="${esc(e.link)}"` : ""} style="${elStyle(e, z, mode)}">${elInner(e, doc, vals, mode)}</div>`;
}
function pageHTML(doc, pi, mode) {
  const pg = doc.pages[pi], [pw, ph] = pageDims(doc, pg), vals = fieldValues(doc, pi, doc.pages.length);
  const bgi = pg.bgImage ? `background-image:url('${esc(pg.bgImage)}');background-size:cover;background-position:center;` : "";
  return `<div class="rb-page m-${mode}" data-pi="${pi}" style="width:${pw}px;height:${ph}px;background-color:${pg.bg || "#fff"};${bgi}font-family:'${esc(doc.theme.font)}',sans-serif;color:${doc.theme.ink}">
    ${showHF(doc, pi, "header") ? headerHTML(doc, pi, vals, pw) : ""}
    ${pg.elements.map((e, i) => elHTML(e, doc, vals, mode, i + 2)).join("")}
    ${showHF(doc, pi, "footer") ? footerHTML(doc, pi, vals) : ""}
    ${mode === "edit" ? `<div class="rb-ov" id="rb-ov"></div>` : ""}</div>`;
}

/* ----- stage ----- */
function overflowEls(doc, pi) { const [, ph] = pageDims(doc, doc.pages[pi]); return doc.pages[pi].elements.filter(e => !e.hidden && e.y + e.h > ph + 1 && e.y > ph * .5); }   // content running past the bottom (bleeds off an edge are allowed)
function renderStage() {
  const host = $q("#rb-stage-host"); if (!host) return;
  const doc = ST.doc, pg = curPage(), [pw, ph] = pageDims(doc, pg), z = ST.zoom;
  const scrollT = host.parentElement.scrollTop, scrollL = host.parentElement.scrollLeft;
  host.style.width = pw * z + "px"; host.style.height = ph * z + "px";
  host.innerHTML = `<div class="rb-scale" style="transform:scale(${z});width:${pw}px;height:${ph}px">${pageHTML(doc, ST.page, "edit")}</div>${ST.grid && ST.showGrid ? "" : ""}`;
  if (ST.showGrid) $q(".rb-page", host).classList.add("gridded"), $q(".rb-page", host).style.setProperty("--g", ST.grid + "px");
  host.parentElement.scrollTop = scrollT; host.parentElement.scrollLeft = scrollL;
  const ov = overflowEls(doc, ST.page);
  const bar = $q("#rb-pagebar");
  if (bar) bar.innerHTML = `<span class="rb-pname">${esc(pg.name)}</span><span class="hint">Page ${ST.page + 1} of ${doc.pages.length} · ${doc.page.size} ${(pg.orientation || doc.page.orientation)}</span>
    ${ov.length ? `<span class="rb-warn">${ov.length} element${ov.length > 1 ? "s" : ""} run past the bottom of the page <button type="button" class="rb-mini" data-act="overflow">Move to a new page</button></span>` : ""}`;
  if (ST.editing) {
    const t = $q(`.rb-el[data-id="${ST.editing}"] .rb-txt`, host);
    if (t && document.activeElement !== t) { t.focus(); const r = document.createRange(); r.selectNodeContents(t); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  }
  drawOverlay();
}
function selBox(els) {
  const x = Math.min(...els.map(e => e.x)), y = Math.min(...els.map(e => e.y));
  return { x, y, w: Math.max(...els.map(e => e.x + e.w)) - x, h: Math.max(...els.map(e => e.y + e.h)) - y };
}
function drawOverlay(guides) {
  const ov = $q("#rb-ov"); if (!ov) return;
  const els = selEls(), z = ST.zoom, hs = 9 / z;
  let h = "";
  if (els.length) {
    const one = els.length === 1 ? els[0] : null;
    if (!one) els.forEach(e => h += `<div class="rb-sel ghost" style="left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;border-width:${1 / z}px"></div>`);
    const b = selBox(els);
    h += `<div class="rb-sel${one && one.locked ? " locked" : ""}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border-width:${1.5 / z}px">`;
    if (one && !one.locked && ST.editing !== one.id) h += ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(k => `<i class="rb-h h-${k}" data-h="${k}" style="width:${hs}px;height:${hs}px;margin:${-hs / 2}px;border-width:${1.5 / z}px"></i>`).join("");
    if (one && one.locked) h += `<span class="rb-lockbadge" style="transform:scale(${1 / z})">🔒</span>`;
    h += `<span class="rb-dims" style="transform:scale(${1 / z})">${Math.round(b.w)} × ${Math.round(b.h)}</span></div>`;
  }
  (guides || []).forEach(g => h += g.v ? `<div class="rb-guide v" style="left:${g.p}px;width:${1 / z}px"></div>` : `<div class="rb-guide h" style="top:${g.p}px;height:${1 / z}px"></div>`);
  if (ST.marq) { const m = ST.marq; h += `<div class="rb-marq" style="left:${Math.min(m.x0, m.x1)}px;top:${Math.min(m.y0, m.y1)}px;width:${Math.abs(m.x1 - m.x0)}px;height:${Math.abs(m.y1 - m.y0)}px;border-width:${1 / z}px"></div>`; }
  ov.innerHTML = h;
  placeCtx();
}

/* ----- contextual toolbar (outside the scaled page so it keeps its size) ----- */
function placeCtx() {
  const bar = $q("#rb-ctx"); if (!bar) return;
  const els = selEls();
  if (!els.length || ST.drag) { bar.hidden = true; return; }
  const b = selBox(els), z = ST.zoom, host = $q("#rb-stage-host");
  const editing = ST.editing && els.length === 1 && els[0].type === "text";
  bar.innerHTML = editing ? textToolsHTML() : selToolsHTML(els);
  bar.hidden = false;
  const top = host.offsetTop + b.y * z - bar.offsetHeight - 10, left = host.offsetLeft + (b.x + b.w / 2) * z - bar.offsetWidth / 2;
  bar.style.top = Math.max(host.offsetTop - bar.offsetHeight + 2, top < host.offsetTop + 4 && b.y * z > 60 ? top : top < 0 ? host.offsetTop + (b.y + b.h) * z + 10 : top) + "px";
  bar.style.left = clamp(left, 4, host.parentElement.scrollWidth - bar.offsetWidth - 4) + "px";
}
const TB = (act, title, inner, extra) => `<button type="button" class="rb-tb" data-act="${act}" title="${title}" aria-label="${title}" ${extra || ""}>${inner}</button>`;
function selToolsHTML(els) {
  const one = els.length === 1 ? els[0] : null, grouped = els.some(e => e.group), locked = els.every(e => e.locked);
  return [one && one.type === "text" ? TB("edit", "Edit text (double-click)", "✎ Edit") : "",
    one && (one.type === "image" || one.type === "video") ? TB("replace", "Replace", "⤒ Replace") : "",
    one && one.type === "widget" ? TB("data", "Data settings", "⚙ Data") : "",
    TB("dup", "Duplicate (Ctrl+D)", "⧉"), TB("front", "Bring forward", "⬆"), TB("back", "Send backward", "⬇"),
    els.length > 1 && !grouped ? TB("group", "Group (Ctrl+G)", "▣ Group") : "", grouped ? TB("ungroup", "Ungroup (Ctrl+Shift+G)", "▢ Ungroup") : "",
    els.length > 1 ? TB("alignmenu", "Align", "⫶ Align") : "",
    TB("lock", locked ? "Unlock" : "Lock", locked ? "🔓" : "🔒"), TB("del", "Delete (Del)", "🗑", 'class="rb-tb danger"')].join("");
}
function textToolsHTML() {
  return [TB("fmt:bold", "Bold", "<b>B</b>"), TB("fmt:italic", "Italic", "<i>I</i>"), TB("fmt:underline", "Underline", "<u>U</u>"), TB("fmt:strikeThrough", "Strikethrough", "<s>S</s>"),
    `<span class="rb-sep"></span>`, TB("fmt:insertUnorderedList", "Bulleted list", "• List"), TB("fmt:insertOrderedList", "Numbered list", "1. List"),
    TB("fmt:justifyLeft", "Align left", "⟸"), TB("fmt:justifyCenter", "Centre", "≡"), TB("fmt:justifyRight", "Align right", "⟹"),
    `<span class="rb-sep"></span>`, TB("link", "Link", "🔗"), `<label class="rb-tb" title="Text colour">A<input type="color" data-act="fcolor" value="#17132b"></label>`,
    `<select class="rb-tbsel" data-act="field" title="Insert a field"><option value="">{ } Field</option>${FIELDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>`,
    TB("done", "Done editing", "Done", 'class="rb-tb primary"')].join("");
}

/* ----- coordinates ----- */
function pagePoint(ev) {
  const pgEl = $q("#rb-stage-host .rb-page"); const r = pgEl.getBoundingClientRect();
  return [(ev.clientX - r.left) / ST.zoom, (ev.clientY - r.top) / ST.zoom];
}
function expandGroups(ids) {
  const pg = curPage(), gs = new Set(pg.elements.filter(e => ids.includes(e.id) && e.group).map(e => e.group));
  return pg.elements.filter(e => ids.includes(e.id) || (e.group && gs.has(e.group))).map(e => e.id);
}
function select(ids, add) {
  ids = expandGroups(ids);
  if (add) { const all = ST.sel.slice(); ids.forEach(id => { const i = all.indexOf(id); i < 0 ? all.push(id) : all.splice(i, 1); }); ST.sel = expandGroups(all); }
  else ST.sel = ids;
  if (ST.editing && !ST.sel.includes(ST.editing)) finishEdit();
  drawOverlay(); renderRight();
}

/* ----- snapping ----- */
function snapTargets(exclude) {
  const doc = ST.doc, [pw, ph] = pageDims(doc, curPage());
  const xs = [0, pw / 2, pw], ys = [0, ph / 2, ph];
  curPage().elements.forEach(e => { if (exclude.includes(e.id) || e.hidden) return; xs.push(e.x, e.x + e.w / 2, e.x + e.w); ys.push(e.y, e.y + e.h / 2, e.y + e.h); });
  return { xs, ys };
}
function snapAxis(cands, edges, th) {   // edges: positions of the moving box's edges; returns [delta, guidePos]
  let best = null;
  edges.forEach(ed => cands.forEach(c => { const d = c - ed; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best[0]))) best = [d, c]; }));
  return best;
}

/* ----- pointer interactions on the page ----- */
function onPointerDown(ev) {
  if (ev.button !== 0) return;
  const pgEl = ev.target.closest(".rb-page"); if (!pgEl) return;
  const handle = ev.target.closest(".rb-h");
  const elNode = ev.target.closest(".rb-el");
  if (ST.editing && elNode && elNode.dataset.id === ST.editing) return;   // let the caret work
  const [px, py] = pagePoint(ev);
  if (handle) return startResize(ev, handle.dataset.h, px, py);
  if (elNode) {
    const id = elNode.dataset.id;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { select([id], true); return; }
    if (!ST.sel.includes(id)) select(ev.altKey ? [id].filter(() => true) : [id]);
    if (ev.altKey) { ST.sel = [id]; drawOverlay(); renderRight(); }
    return startMove(ev, px, py);
  }
  // empty page: marquee
  if (ST.editing) finishEdit();
  if (!ev.shiftKey) { ST.sel = []; renderRight(); }
  ST.marq = { x0: px, y0: py, x1: px, y1: py, base: ev.shiftKey ? ST.sel.slice() : [] };
  const mv = e2 => { const [x, y] = pagePoint(e2); ST.marq.x1 = x; ST.marq.y1 = y; const m = ST.marq, l = Math.min(m.x0, m.x1), t = Math.min(m.y0, m.y1), r = Math.max(m.x0, m.x1), b = Math.max(m.y0, m.y1);
    ST.sel = [...new Set([...m.base, ...expandGroups(curPage().elements.filter(e => e.x < r && e.x + e.w > l && e.y < b && e.y + e.h > t).map(e => e.id))])]; drawOverlay(); };
  const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); ST.marq = null; drawOverlay(); renderRight(); };
  addEventListener("pointermove", mv); addEventListener("pointerup", up);
}
function startMove(ev, px, py) {
  const pg = curPage();
  let moving = selEls().filter(e => !e.locked);
  if (!moving.length) return;
  // containers carry the elements sitting inside them
  const inside = pg.elements.filter(e => !e.locked && !moving.includes(e) && moving.some(c => c.type === "container" && pg.elements.indexOf(e) > pg.elements.indexOf(c) && e.x >= c.x - 1 && e.y >= c.y - 1 && e.x + e.w <= c.x + c.w + 1 && e.y + e.h <= c.y + c.h + 1));
  moving = moving.concat(inside);
  const orig = moving.map(e => [e, e.x, e.y]);
  const box0 = selBox(moving), ids = moving.map(e => e.id);
  const T0 = snapTargets(ids), th = 6 / ST.zoom;
  let moved = false;
  const nodes = new Map(moving.map(e => [e.id, $q(`#rb-stage-host .rb-el[data-id="${e.id}"]`)]));
  const mv = e2 => {
    const [x, y] = pagePoint(e2); let dx = x - px, dy = y - py;
    if (!moved && Math.hypot(dx, dy) * ST.zoom < 3) return;
    moved = true; ST.drag = true;
    const guides = [];
    if (ST.snap && !e2.altKey) {
      const bx = box0.x + dx, by = box0.y + dy;
      const sx = snapAxis(T0.xs, [bx, bx + box0.w / 2, bx + box0.w], th), sy = snapAxis(T0.ys, [by, by + box0.h / 2, by + box0.h], th);
      if (sx) { dx += sx[0]; guides.push({ v: 1, p: sx[1] }); } else if (ST.grid) dx = Math.round((box0.x + dx) / ST.grid) * ST.grid - box0.x;
      if (sy) { dy += sy[0]; guides.push({ v: 0, p: sy[1] }); } else if (ST.grid) dy = Math.round((box0.y + dy) / ST.grid) * ST.grid - box0.y;
    }
    if (e2.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    orig.forEach(([e, ox, oy]) => { e.x = Math.round(ox + dx); e.y = Math.round(oy + dy); const n = nodes.get(e.id); if (n) { n.style.left = e.x + "px"; n.style.top = e.y + "px"; } });
    drawOverlay(guides);
  };
  const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); ST.drag = false;
    if (moved) { commit("move"); renderStage(); renderNavSoon(); renderRight(); } else drawOverlay(); };
  addEventListener("pointermove", mv); addEventListener("pointerup", up);
}
function startResize(ev, h, px, py) {
  ev.stopPropagation();
  const e = selEls()[0]; if (!e || e.locked) return;
  const o = { x: e.x, y: e.y, w: e.w, h: e.h };
  const ratio = e.type === "image" && e.props.ratio && e.props.ratio !== "free" ? (() => { const [a, b] = e.props.ratio.split(":").map(Number); return a / b; })() : null;
  const T0 = snapTargets([e.id]), th = 6 / ST.zoom;
  const node = $q(`#rb-stage-host .rb-el[data-id="${e.id}"]`);
  const mv = e2 => {
    ST.drag = true;
    const [x, y] = pagePoint(e2); let dx = x - px, dy = y - py; const guides = [];
    let { x: nx, y: ny, w: nw, h: nh } = o;
    const sn = (val, cands, vertical) => { if (!ST.snap || e2.altKey) return val; const s = snapAxis(cands, [val], th); if (s) { guides.push({ v: vertical ? 1 : 0, p: s[1] }); return val + s[0]; } return ST.grid ? Math.round(val / ST.grid) * ST.grid : val; };
    if (h.includes("e")) nw = sn(o.x + o.w + dx, T0.xs, 1) - o.x;
    if (h.includes("w")) { const l = sn(o.x + dx, T0.xs, 1); nw = o.x + o.w - l; nx = l; }
    if (h.includes("s")) nh = sn(o.y + o.h + dy, T0.ys, 0) - o.y;
    if (h.includes("n")) { const t = sn(o.y + dy, T0.ys, 0); nh = o.y + o.h - t; ny = t; }
    const keep = ratio || (e2.shiftKey ? o.w / o.h : null);
    if (keep && h.length === 2) { nh = nw / keep; if (h.includes("n")) ny = o.y + o.h - nh; }
    else if (keep && (h === "e" || h === "w")) nh = nw / keep; else if (keep) { nw = nh * keep; if (h === "n" || h === "s") { /* width follows */ } }
    if (nw < 8) { if (h.includes("w")) nx -= 8 - nw; nw = 8; }
    if (nh < 6) { if (h.includes("n")) ny -= 6 - nh; nh = 6; }
    Object.assign(e, { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) });
    if (node) { Object.assign(node.style, { left: e.x + "px", top: e.y + "px", width: e.w + "px", height: e.h + "px" }); }
    drawOverlay(guides);
  };
  const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); ST.drag = false; commit("resize"); renderStage(); renderNavSoon(); renderRight(); };
  addEventListener("pointermove", mv); addEventListener("pointerup", up);
}

/* ----- text editing ----- */
function startEdit(id) {
  const e = findEl(id); if (!e || e.type !== "text" || e.locked) return;
  ST.sel = [id]; ST.editing = id; renderStage(); renderRight();
}
function finishEdit() {
  const id = ST.editing; if (!id) return;
  const node = $q(`#rb-stage-host .rb-el[data-id="${id}"] .rb-txt`), e = findEl(id);
  ST.editing = null;
  if (node && e) { const html = cleanHTML(node.innerHTML); if (html !== e.props.html) { e.props.html = html; commit("text"); } }
  renderStage(); renderNavSoon(); renderRight();
}
function fitTextHeight(id) {
  const e = findEl(id), node = $q(`#rb-stage-host .rb-el[data-id="${id}"]`); if (!e || !node) return;
  const t = $q(".rb-txt", node), need = t.scrollHeight + 2 * (e.style.pad || 0) + 2 * (e.style.borderW || 0);
  if (need > e.h) { e.h = Math.ceil(need); node.style.height = e.h + "px"; drawOverlay(); }
}
function execFmt(cmd, val) { document.execCommand("styleWithCSS", false, true); document.execCommand(cmd, false, val); const id = ST.editing; if (id) fitTextHeight(id); }

/* ----- element operations ----- */
function addElement(e, opts = {}) {
  const pg = curPage(), [pw, ph] = pageDims(ST.doc, pg);
  if (!opts.keepPos && !opts.at) { e.x = Math.round((pw - e.w) / 2); e.y = Math.round(Math.min(ph - e.h - 40, Math.max(90, ph / 2 - e.h / 2))); }
  if (opts.at) { e.x = Math.round(clamp(opts.at[0] - e.w / 2, 0, pw - Math.min(e.w, pw))); e.y = Math.round(clamp(opts.at[1] - e.h / 2, 0, ph - Math.min(e.h, ph))); }
  pg.elements.push(e); ST.sel = [e.id]; commit("add"); renderStage(); renderNavSoon(); renderRight();
}
function addKind(kind, at) {
  const doc = ST.doc;
  if (kind === "pagebreak") { insertPage(ST.page + 1); return; }
  if (kind === "header" || kind === "footer") { doc[kind].enabled = true; curPage()[kind] = "inherit"; commit(kind); ST.sel = []; ST.rtab = "hf"; renderAll(); return; }
  if (kind === "columns") {
    const n = 2, [pw] = pageDims(doc, curPage()), gap = 16, W = Math.min(698, pw - 96), cw = (W - gap * (n - 1)) / n, g = uid("g"), y = at ? at[1] - 100 : 160;
    const els = Array.from({ length: n }, (_, i) => { const c = makeEl("container", doc); Object.assign(c, { x: Math.round((pw - W) / 2 + i * (cw + gap)), y: Math.round(y), w: Math.round(cw), h: 200, group: g, name: "Column " + (i + 1) }); return c; });
    curPage().elements.push(...els); ST.sel = els.map(e => e.id); commit("columns"); renderStage(); renderNavSoon(); renderRight(); return;
  }
  const e = makeEl(kind, doc); if (!e) return;
  addElement(e, { at });
  if (kind === "image" && !at) pickFile("image", f => uploadInto(e.id, f));
}
function dupSel(dx = 16, dy = 16) {
  const pg = curPage(), els = selEls(); if (!els.length) return;
  const gmap = {}, out = els.map(e => { const c = clone(e); c.id = uid(); c.x += dx; c.y += dy; c.locked = false; if (c.group) c.group = gmap[c.group] = gmap[c.group] || uid("g"); return c; });
  pg.elements.push(...out); ST.sel = out.map(e => e.id); commit("duplicate"); renderStage(); renderNavSoon(); renderRight();
}
function delSel() {
  const pg = curPage(), els = selEls().filter(e => !e.locked); if (!els.length) return;
  pg.elements = pg.elements.filter(e => !els.includes(e)); ST.sel = []; ST.editing = null; commit("delete"); renderStage(); renderNavSoon(); renderRight();
}
function copySel(cut) {
  const els = selEls(); if (!els.length) return;
  ST.clip = { page: curPage().id, els: clone(els) };
  try { localStorage.setItem("sentimeter-rb-clip", JSON.stringify(ST.clip)); } catch (e) {}
  if (cut) delSel();
  toast(`${cut ? "Cut" : "Copied"} ${els.length} element${els.length > 1 ? "s" : ""}`);
}
function paste() {
  let clip = ST.clip; try { clip = JSON.parse(localStorage.getItem("sentimeter-rb-clip")) || clip; } catch (e) {}
  if (!clip || !clip.els || !clip.els.length) return;
  const same = clip.page === curPage().id, gmap = {};
  const out = clip.els.map(e => { const c = clone(e); c.id = uid(); if (same) { c.x += 16; c.y += 16; } if (c.group) c.group = gmap[c.group] = gmap[c.group] || uid("g"); return c; });
  if (same) { ST.clip = { ...clip, els: out.map(clone) }; try { localStorage.setItem("sentimeter-rb-clip", JSON.stringify(ST.clip)); } catch (e) {} }
  curPage().elements.push(...out); ST.sel = out.map(e => e.id); commit("paste"); renderStage(); renderNavSoon(); renderRight();
}
function layer(dir) {
  const pg = curPage(), ids = ST.sel; if (!ids.length) return;
  let a = pg.elements;
  if (dir === "top") a = a.filter(e => !ids.includes(e.id)).concat(a.filter(e => ids.includes(e.id)));
  else if (dir === "bottom") a = a.filter(e => ids.includes(e.id)).concat(a.filter(e => !ids.includes(e.id)));
  else if (dir === "up") { for (let i = a.length - 2; i >= 0; i--) if (ids.includes(a[i].id) && !ids.includes(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]]; }
  else { for (let i = 1; i < a.length; i++) if (ids.includes(a[i].id) && !ids.includes(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]]; }
  pg.elements = a; commit("layer"); renderStage(); renderNavSoon(); renderRight();
}
function groupSel(on) {
  const els = selEls(); if (on && els.length < 2) return;
  const g = on ? uid("g") : "";
  els.forEach(e => e.group = g); commit(on ? "group" : "ungroup"); drawOverlay(); renderRight();
}
function lockSel() { const els = selEls(); const to = !els.every(e => e.locked); els.forEach(e => e.locked = to); commit("lock"); renderStage(); renderRight(); }
function alignSel(how) {
  const els = selEls().filter(e => !e.locked); if (!els.length) return;
  const [pw, ph] = pageDims(ST.doc, curPage());
  const B = els.length > 1 ? selBox(els) : { x: 0, y: 0, w: pw, h: ph };
  if (how === "dh" || how === "dv") {
    if (els.length < 3) return toast("Select three or more elements to distribute");
    const k = how === "dh" ? ["x", "w"] : ["y", "h"], s = els.slice().sort((a, b) => a[k[0]] - b[k[0]]);
    const tot = s.reduce((a, e) => a + e[k[1]], 0), span = B[k[1]], gap = (span - tot) / (s.length - 1);
    let p = B[k[0]]; s.forEach(e => { e[k[0]] = Math.round(p); p += e[k[1]] + gap; });
  } else els.forEach(e => {
    if (how === "l") e.x = B.x; if (how === "c") e.x = Math.round(B.x + (B.w - e.w) / 2); if (how === "r") e.x = B.x + B.w - e.w;
    if (how === "t") e.y = B.y; if (how === "m") e.y = Math.round(B.y + (B.h - e.h) / 2); if (how === "b") e.y = B.y + B.h - e.h;
  });
  commit("align"); renderStage(); renderNavSoon(); renderRight();
}
function nudge(dx, dy) { const els = selEls().filter(e => !e.locked); if (!els.length) return; els.forEach(e => { e.x += dx; e.y += dy; }); commit("nudge"); renderStage(); renderNavSoon(); renderRight(); }
function moveToPage(pi, copy) {
  const els = selEls(); if (!els.length || pi === ST.page) return;
  const tgt = ST.doc.pages[pi]; const out = clone(els).map(e => (copy ? Object.assign(e, { id: uid() }) : e));
  tgt.elements.push(...out);
  if (!copy) curPage().elements = curPage().elements.filter(e => !ST.sel.includes(e.id));
  ST.page = pi; ST.sel = out.map(e => e.id); commit(copy ? "copy to page" : "move to page"); renderAll();
  toast(`${copy ? "Copied" : "Moved"} to ${tgt.name}`);
}
function moveOverflow() {
  const doc = ST.doc, pg = curPage(), [pw, ph] = pageDims(doc, pg);
  const over = overflowEls(doc, ST.page); if (!over.length) return;
  const top = Math.min(...over.map(e => e.y)), np = newPage(pg.name + " (cont.)");
  np.orientation = pg.orientation; np.bg = pg.bg;
  const off = top - (showHF(doc, ST.page, "header") ? doc.header.height + 24 : 40);
  over.forEach(e => { e.y = Math.max(0, e.y - off); np.elements.push(e); });
  pg.elements = pg.elements.filter(e => !over.includes(e));
  doc.pages.splice(ST.page + 1, 0, np); ST.page += 1; ST.sel = []; commit("overflow"); renderAll();
}

/* ----- pages ----- */
function insertPage(at, src) {
  const p = src ? Object.assign(clone(src), { id: uid("p"), name: src.name + " copy" }) : newPage("Page " + (ST.doc.pages.length + 1));
  if (src) p.elements.forEach(e => { e.id = uid(); });
  ST.doc.pages.splice(at, 0, p); ST.page = at; ST.sel = []; commit("page"); renderAll();
}
function deletePage(pi) {
  if (ST.doc.pages.length < 2) return toast("A report needs at least one page");
  ST.doc.pages.splice(pi, 1); ST.page = clamp(ST.page >= pi ? ST.page - 1 : ST.page, 0, ST.doc.pages.length - 1); ST.sel = []; commit("delete page"); renderAll();
}
function movePage(from, to) {
  if (from === to) return; const [p] = ST.doc.pages.splice(from, 1); ST.doc.pages.splice(to, 0, p); ST.page = to; commit("reorder"); renderAll();
}
let navTimer = null;
function renderNavSoon() { clearTimeout(navTimer); navTimer = setTimeout(renderNav, 350); }
function renderNav() {
  const nav = $q("#rb-nav"); if (!nav) return;
  const doc = ST.doc, TW = 104;
  nav.innerHTML = doc.pages.map((p, i) => { const [pw, ph] = pageDims(doc, p), s = TW / pw;
    return `<div class="rb-th${i === ST.page ? " on" : ""}" draggable="true" data-pi="${i}" title="${esc(p.name)}"><div class="rb-thv" style="width:${TW}px;height:${Math.round(ph * s)}px"><div style="transform:scale(${s});transform-origin:0 0;width:${pw}px;height:${ph}px">${pageHTML(doc, i, "thumb")}</div></div>
      <div class="rb-thl"><span class="n">${i + 1}</span><span class="t">${esc(p.name)}</span><button type="button" class="rb-thm" data-pmenu="${i}" aria-label="Page options">⋯</button></div></div>`; }).join("") +
    `<button type="button" class="rb-addpage" data-act="addpage">+ Add page</button>`;
}

/* ----- uploads ----- */
function pickFile(kind, cb) {
  const i = document.createElement("input"); i.type = "file";
  i.accept = kind === "video" ? "video/mp4,video/webm,video/quicktime" : "image/png,image/jpeg,image/webp,image/gif";
  i.onchange = () => i.files[0] && cb(i.files[0]); i.click();
}
async function shrinkImage(f) {
  if (f.type === "image/gif" || f.size < 1.5e6) return f;
  const url = URL.createObjectURL(f);
  try {
    const img = new Image(); await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    const s = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight)); if (s === 1 && f.size < 6e6) return f;
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const type = f.type === "image/png" ? "image/png" : "image/jpeg";
    return await new Promise(r => c.toBlob(b => r(b || f), type, .9));
  } catch (e) { return f; } finally { URL.revokeObjectURL(url); }
}
function uploadAsset(blob, type, onp) {
  return new Promise((ok, bad) => {
    const x = new XMLHttpRequest(); x.open("POST", "api/upload/rb/assets"); x.setRequestHeader("Content-Type", type); x.withCredentials = true;
    x.upload.onprogress = e => e.lengthComputable && onp && onp(e.loaded / e.total);
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {}
      if (x.status === 413) return bad(new Error("The server doesn't accept large uploads yet. It updates itself within about 10 minutes; try again then."));
      x.status === 200 && j.url ? ok(j.url) : bad(new Error(j.error || "Upload failed (" + x.status + ")")); };
    x.onerror = () => bad(new Error("The upload was interrupted.")); x.send(blob);
  });
}
async function videoThumb(f) {
  const url = URL.createObjectURL(f);
  try {
    const v = document.createElement("video"); v.muted = true; v.src = url; v.preload = "auto";
    await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = bad; setTimeout(bad, 15000); });
    v.currentTime = Math.min(1, (v.duration || 2) / 3); await new Promise(ok => { v.onseeked = ok; setTimeout(ok, 4000); });
    const c = document.createElement("canvas"); const s = Math.min(1, 1280 / v.videoWidth); c.width = v.videoWidth * s; c.height = v.videoHeight * s;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, "image/jpeg", .86));
  } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
}
async function uploadFile(f, onp) {
  if (f.type.startsWith("video/")) {
    const th = await videoThumb(f);
    const src = await uploadAsset(f, f.type, onp);
    const thumb = th ? await uploadAsset(th, "image/jpeg") : "";
    ST.doc.assets = (ST.doc.assets || []).concat([{ type: "video", url: src, thumb, name: f.name }]).slice(-60);
    return { type: "video", src, thumb, name: f.name };
  }
  const blob = await shrinkImage(f);
  const url = await uploadAsset(blob, blob.type || f.type, onp);
  ST.doc.assets = (ST.doc.assets || []).concat([{ type: "image", url, name: f.name }]).slice(-60);
  return { type: "image", src: url, name: f.name };
}
async function uploadInto(id, f) {
  toast("Uploading " + f.name + "…", 60000);
  try {
    const r = await uploadFile(f, p => toast(`Uploading ${f.name}… ${Math.round(p * 100)}%`, 60000));
    const e = findEl(id);
    if (e && e.type === "image" && r.type === "image") e.props.src = r.src;
    else if (e && e.type === "video") { if (r.type === "video") { e.props.src = r.src; e.props.thumb = r.thumb || e.props.thumb; if (!e.props.title || e.props.title === "Video title") e.props.title = r.name.replace(/\.\w+$/, ""); } else e.props.thumb = r.src; }
    commit("upload"); renderStage(); renderNavSoon(); renderRight(); renderLeft(); toast("Uploaded");
  } catch (err) { toast(err.message, 6000, true); }
}
async function dropFiles(files, at) {
  for (const f of files) {
    if (!/^(image|video)\//.test(f.type)) { toast("Drop images or videos", 4000, true); continue; }
    const e = makeEl(f.type.startsWith("video/") ? "video" : "image", ST.doc);
    addElement(e, { at }); await uploadInto(e.id, f);
  }
}

/* ----- toast ----- */
let toastT = null;
function toast(msg, ms = 2600, bad) {
  let t = $q("#rb-toast"); if (!t) return;
  t.textContent = msg; t.className = "rb-toast show" + (bad ? " bad" : "");
  clearTimeout(toastT); toastT = setTimeout(() => t.className = "rb-toast", ms);
}

/* ===== Left (library), right (properties) and top panels ===== */
const getPath = (o, p) => p.split(".").reduce((a, k) => a == null ? a : a[k], o);
const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); const t = ks.reduce((a, k) => a[k] = a[k] == null ? {} : a[k], o); t[last] = v; };
const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(l)}</option>`;

/* field builders: data-k = path on selected elements, data-pg = path on current page, data-d = path on the document */
function F(label, ctl, hint) { return `<label class="rb-f"><span>${label}</span>${ctl}${hint ? `<em>${hint}</em>` : ""}</label>`; }
function inNum(attr, v, o = {}) { return `<input type="number" ${attr} value="${v ?? ""}" ${o.min != null ? `min="${o.min}"` : ""} ${o.max != null ? `max="${o.max}"` : ""} step="${o.step || 1}">`; }
function inTxt(attr, v, ph) { return `<input type="text" ${attr} value="${esc(v || "")}" placeholder="${esc(ph || "")}">`; }
function inCol(attr, v) { return `<span class="rb-col"><input type="color" ${attr} value="${/^#[0-9a-f]{6}$/i.test(v || "") ? v : "#ffffff"}"><input type="text" ${attr} value="${esc(v || "")}" placeholder="none" class="hex"></span>`; }
function inSel(attr, opts, v) { return `<select ${attr}>${opts.map(([a, b]) => opt(a, b, v)).join("")}</select>`; }
function inChk(attr, v, label) { return `<label class="rb-chk"><input type="checkbox" ${attr} ${v ? "checked" : ""}> ${label}</label>`; }
function inRange(attr, v, min, max, step) { return `<span class="rb-rng"><input type="range" ${attr} value="${v}" min="${min}" max="${max}" step="${step}"><output>${v}</output></span>`; }
const K = p => `data-k="${p}"`, PG = p => `data-pg="${p}"`, D = p => `data-d="${p}"`;

/* ----- left: library ----- */
const CONTENT_ITEMS = [["heading", "Heading"], ["subheading", "Subheading"], ["text", "Text"], ["image", "Image"], ["video", "Video"], ["divider", "Divider"],
  ["spacer", "Spacer"], ["container", "Container"], ["columns", "Columns"], ["shape", "Shape"]];
const PAGE_ITEMS = [["header", "Header"], ["footer", "Footer"], ["pagebreak", "Page break"]];
function tile(kind, label, ic) { return `<button type="button" class="rb-tile" draggable="true" data-kind="${kind}" title="Drag onto the page, or click to add">${icon(ic || kind, 20)}<span>${esc(label)}</span></button>`; }
function renderLeft() {
  const L = $q("#rb-left"); if (!L) return;
  const tab = ST.ltab || "el", q = (ST.lq || "").toLowerCase();
  const m = l => !q || l.toLowerCase().includes(q);
  let body = "";
  if (tab === "el") {
    const sec = (id, title, items) => items.length ? `<details class="rb-sec" ${ST.closed && ST.closed[id] ? "" : "open"} data-sec="${id}"><summary>${title}</summary><div class="rb-tiles">${items.join("")}</div></details>` : "";
    body = `<input type="search" class="rb-search" id="rb-lq" placeholder="Search elements…" value="${esc(ST.lq || "")}">` +
      WIDGET_GROUPS.map(([g, ks]) => sec("w-" + g, "Analytics · " + g, ks.filter(k => m(WIDGETS[k].label)).map(k => tile(k, WIDGETS[k].label, WIDGETS[k].ic)))).join("") +
      sec("content", "Custom content", CONTENT_ITEMS.filter(([, l]) => m(l)).map(([k, l]) => tile(k, l))) +
      sec("page", "Page elements", PAGE_ITEMS.filter(([, l]) => m(l)).map(([k, l]) => tile(k, l))) +
      sec("fields", "Custom fields", FIELDS.filter(([, l]) => m(l)).map(([k, l]) => `<button type="button" class="rb-tile wide" draggable="true" data-kind="field:${k}" title="Insert {{${k}}}">${icon("field", 18)}<span>${esc(l)}</span></button>`));
  } else if (tab === "tpl") {
    body = `<p class="rb-note">Applying a template replaces this report's pages (undo with Ctrl+Z), or adds its pages at the end.</p>` +
      TEMPLATE_LIST.map(([k, n, d]) => `<div class="rb-tplrow"><b>${esc(n)}</b><span>${esc(d)}</span><div><button type="button" class="rb-mini" data-tpl="b:${k}" data-how="replace">Replace pages</button><button type="button" class="rb-mini" data-tpl="b:${k}" data-how="add">Add pages</button></div></div>`).join("") +
      `<div class="rb-subh">Saved templates</div>` + ((LIST.items || []).filter(i => i.kind === "template").map(i => `<div class="rb-tplrow"><b>${esc(i.name)}</b><span>${i.pages} page${i.pages === 1 ? "" : "s"}${i.template_for ? " · " + esc(brandName(i.template_for)) : ""}</span><div><button type="button" class="rb-mini" data-tpl="s:${i.id}" data-how="replace">Replace pages</button><button type="button" class="rb-mini" data-tpl="s:${i.id}" data-how="add">Add pages</button></div></div>`).join("") || `<p class="rb-note">None yet. Use <b>Save as Template</b> in the toolbar.</p>`);
  } else {
    const b = SMA.brands.find(x => x.id === ST.doc.brand);
    const assets = (ST.doc.assets || []).slice().reverse();
    body = `<div class="rb-up"><button type="button" class="btn primary" data-act="upload">Upload image or video</button><p class="rb-note">Or drop files straight onto the page. Images up to 15 MB, videos up to 500 MB.</p></div>
      <div class="rb-subh">Logos</div><div class="rb-assets">${b && b.logo ? `<button type="button" class="rb-asset" data-asset="${esc(logoUrl(b))}" data-atype="image" title="${esc(b.name)} logo"><img src="${esc(logoUrl(b))}" alt=""></button>` : ""}<button type="button" class="rb-asset dark" data-asset="stark-logo.png" data-atype="image" title="Agency logo"><img src="stark-logo.png" alt=""></button></div>
      <div class="rb-subh">Uploaded to this report</div>${assets.length ? `<div class="rb-assets">${assets.map(a => `<button type="button" class="rb-asset" data-asset="${esc(a.url)}" data-atype="${a.type}" data-thumb="${esc(a.thumb || "")}" title="${esc(a.name || "")}">${a.type === "video" ? (a.thumb ? `<img src="${esc(a.thumb)}" alt="">` : "") + `<i>▶</i>` : `<img src="${esc(a.url)}" alt="">`}</button>`).join("")}</div>` : `<p class="rb-note">Nothing uploaded yet.</p>`}`;
  }
  L.innerHTML = `<div class="rb-ltabs">${[["el", "Elements"], ["tpl", "Templates"], ["up", "Uploads"]].map(([k, l]) => `<button type="button" data-ltab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div><div class="rb-lbody">${body}</div>`;
  if (tab === "el" && ST.lqFocus) { const i = $q("#rb-lq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); ST.lqFocus = false; }
}
const brandName = id => ((SMA.brands || []).find(b => b.id === id) || { name: "" }).name;

/* ----- right: properties ----- */
function renderRight() {
  const R = $q("#rb-right"); if (!R) return;
  const els = selEls();
  if (!els.length) return renderDocPanel(R);
  const tabs = [["content", "Content"], ["style", "Style"], ["layout", "Layout"], ["adv", "Advanced"]];
  const tab = tabs.some(t => t[0] === ST.etab) ? ST.etab : "content";
  const one = els.length === 1 ? els[0] : null;
  const head = one ? `<div class="rb-rh">${icon(one.type === "widget" ? WIDGETS[one.props.kind].ic : one.type === "text" ? "text" : one.type, 18)}<b>${esc(one.name || (one.type === "widget" ? WIDGETS[one.props.kind].label : one.type[0].toUpperCase() + one.type.slice(1)))}</b>${one.type === "widget" ? `<span class="rb-badge">Analytics</span>` : `<span class="rb-badge c">Content</span>`}</div>`
    : `<div class="rb-rh"><b>${els.length} elements selected</b></div>`;
  let body = "";
  if (tab === "content") body = one ? contentPanel(one) : `<p class="rb-note">Select a single element to edit its content. Style, Layout and Advanced apply to all selected elements.</p>`;
  if (tab === "style") body = stylePanel(els);
  if (tab === "layout") body = layoutPanel(els);
  if (tab === "adv") body = advPanel(els);
  R.innerHTML = `<div class="rb-rtabs">${tabs.map(([k, l]) => `<button type="button" data-etab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div>${head}<div class="rb-rbody">${body}</div>`;
}
function contentPanel(e) {
  const p = e.props;
  if (e.type === "text") {
    const lv = p.size >= 30 ? "h1" : p.size >= 22 ? "h2" : p.size >= 17 ? "h3" : p.size <= 11 ? "small" : "body";
    return `<div class="rb-grp"><button type="button" class="btn" data-act="edit">✎ Edit text on the page</button><p class="rb-note">Double-click text on the page to type. Fields like {{brand_name}} fill in automatically.</p></div>
      ${F("Insert field", `<select data-act="fieldsel"><option value="">Choose a field…</option>${FIELDS.map(([k, l]) => opt(k, l)).join("")}</select>`)}
      ${F("Heading level", inSel('data-act="hlevel"', [["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["body", "Body text"], ["small", "Small text"]], lv))}
      <div class="rb-2">${F("Font", inSel(K("props.font"), [["", "Report font"], ...FONTS.map(f => [f, f])], p.font))}${F("Size", inNum(K("props.size"), p.size, { min: 6, max: 160 }))}</div>
      <div class="rb-2">${F("Weight", inSel(K("props.weight"), [[300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"]], p.weight))}${F("Colour", inCol(K("props.color"), p.color))}</div>
      ${F("Alignment", `<div class="rb-seg">${[["left", "⟸"], ["center", "≡"], ["right", "⟹"], ["justify", "☰"]].map(([v, l]) => `<button type="button" data-setk="props.align" data-v="${v}" class="${p.align === v ? "on" : ""}" title="${v}">${l}</button>`).join("")}</div>`)}
      <div class="rb-2">${F("Line height", inNum(K("props.lh"), p.lh, { min: .8, max: 3, step: .05 }))}${F("Letter spacing", inNum(K("props.ls"), p.ls || 0, { min: -5, max: 20, step: .1 }))}</div>
      ${F("Vertical position", inSel(K("props.valign"), [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], p.valign || "top"))}
      ${F("Lists & links", `<div class="rb-seg">${TB("fmtall:insertUnorderedList", "Bulleted list", "• List")}${TB("fmtall:insertOrderedList", "Numbered list", "1. List")}${TB("link", "Link", "🔗 Link")}</div>`, "Lists and links apply to the selected text while editing.")}`;
  }
  if (e.type === "image") {
    return `<div class="rb-grp"><div class="rb-imgprev">${p.src ? `<img src="${esc(p.src)}" alt="">` : `<span>No image yet</span>`}</div>
      <div class="rb-btnrow"><button type="button" class="btn primary" data-act="replace">${p.src ? "Replace image" : "Upload image"}</button>${SMA.brands.find(b => b.id === ST.doc.brand && b.logo) ? `<button type="button" class="btn" data-act="brandlogo">Brand logo</button>` : ""}</div></div>
      ${F("Image address", inTxt(K("props.src"), p.src, "https://… or upload"), "Uploads are stored with the report.")}
      ${F("Fit", `<div class="rb-seg">${[["cover", "Fill"], ["contain", "Fit"], ["fill", "Stretch"]].map(([v, l]) => `<button type="button" data-setk="props.fit" data-v="${v}" class="${p.fit === v ? "on" : ""}">${l}</button>`).join("")}</div>`)}
      ${F("Aspect ratio", inSel('data-act="ratio"', [["free", "Free"], ["1:1", "Square 1:1"], ["4:3", "4:3"], ["3:2", "3:2"], ["16:9", "16:9"], ["9:16", "9:16 (vertical)"], ["3:4", "3:4"]], p.ratio || "free"), "Locks resizing to this shape.")}
      <div class="rb-subh">Crop</div>${F("Zoom", inRange(K("props.zoom"), p.zoom || 1, 1, 3, .05))}${F("Horizontal focus", inRange(K("props.px"), p.px, 0, 100, 1))}${F("Vertical focus", inRange(K("props.py"), p.py, 0, 100, 1))}
      ${F("Alignment", `<div class="rb-seg">${[["0", "Left"], ["50", "Centre"], ["100", "Right"]].map(([v, l]) => `<button type="button" data-setk="props.px" data-v="${v}" class="${String(p.px) === v ? "on" : ""}">${l}</button>`).join("")}</div>`)}`;
  }
  if (e.type === "video") {
    const b = SMA.brands.find(x => x.id === ST.doc.brand);
    const vids = b ? Object.values(SMA.ytAll[b.id] || {}).flatMap(y => (y.uploads || []).map(u => [u.id, u.title])).slice(0, 40) : [];
    return `<div class="rb-btnrow"><button type="button" class="btn primary" data-act="upvideo">Upload video</button><button type="button" class="btn" data-act="upthumb">Upload thumbnail</button></div>
      ${vids.length ? F("Choose a YouTube video", `<select data-act="ytpick"><option value="">From ${esc(b.name)}'s channel…</option>${vids.map(([id, t]) => opt(id, t)).join("")}</select>`) : ""}
      ${F("Video link", inTxt(K("props.url"), p.url, "YouTube or any video page link"), "YouTube links get their thumbnail automatically. In the PDF the video becomes a clickable thumbnail.")}
      ${p.src ? `<p class="rb-note">Uploaded video plays in the preview. <button type="button" class="rb-mini" data-act="clearvideo">Remove upload</button></p>` : ""}
      ${F("Title", inTxt(K("props.title"), p.title))}${F("Description", `<textarea ${K("props.desc")} rows="3">${esc(p.desc || "")}</textarea>`)}
      ${inChk(K("props.showText"), p.showText, "Show title and description")}${inChk(K("props.play"), p.play, "Play button overlay")}`;
  }
  if (e.type === "divider") return `${F("Direction", inSel(K("props.dir"), [["h", "Horizontal"], ["v", "Vertical"]], p.dir))}<div class="rb-2">${F("Colour", inCol(K("props.color"), p.color))}${F("Thickness", inNum(K("props.thick"), p.thick, { min: 1, max: 30 }))}</div>${F("Line style", inSel(K("props.dash"), [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["double", "Double"]], p.dash))}`;
  if (e.type === "widget") return widgetPanel(e);
  return `<p class="rb-note">${e.type === "spacer" ? "Spacers keep room between elements and don't appear in the report." : "Use the Style tab for colour, border, corners and shadow. Elements placed inside a container move with it."}</p>`;
}
function widgetPanel(e) {
  const k = e.props.kind, c = e.props.cfg, W = WIDGETS[k], ck = p => K("props.cfg." + p);
  const listenOK = ["kpi", "line", "area", "bar"].includes(k);
  const metricOpts = Object.entries(METRICS).filter(([m, d]) => listenOK || !d.listen).filter(([m]) => k !== "bar" || c.mode === "daily" || !METRICS[m].listen).map(([m, d]) => [m, d.l]);
  const brandOpts = [["", "Report brand" + (ST.doc.brand ? ` (${brandName(ST.doc.brand)})` : "")], ...SMA.brands.map(b => [b.id, b.name])];
  const alerts = [["", "Brand's listening alert"], ...(S.alerts || []).filter(a => !a.virtual).map(a => [a.id, a.name + (a.brand ? " · " + a.brand : "")])];
  const per = c.period || { preset: "report" };
  const fld = {
    brand: F("Brand", inSel(ck("brand"), brandOpts, c.brand)),
    platform: F("Platform", inSel(ck("platform"), PLATFORM_OPTS, c.platform)),
    metric: F("Metric", inSel(ck("metric"), metricOpts, c.metric)),
    split: inChk(ck("split"), c.split, "One series per platform"),
    campaign: F("Campaign", inTxt(ck("campaign"), c.campaign, "#hashtag or keyword"), "Only posts containing this text count."),
    period: F("Period", inSel('data-act="wperiod"', [["report", "Report period"], ...PRESETS], per.preset)) + (per.preset === "custom" ? `<div class="rb-2">${F("From", `<input type="date" data-act="wfrom" value="${per.from || ""}">`)}${F("To", `<input type="date" data-act="wto" value="${per.to || ""}">`)}</div>` : ""),
    label: F("Label", inTxt(ck("label"), c.label, METRICS[c.metric] ? METRICS[c.metric].l : "")),
    override: F("Manual value", inTxt(ck("override"), c.override, "Leave empty for live data"), "Shown instead of the live number in this report only; analytics data isn't changed."),
    overrideChg: F("Manual change %", inNum(ck("overrideChg"), c.overrideChg, { step: .1 })),
    mode: F("Bars show", inSel(ck("mode"), [["platform", "Totals by platform"], ["daily", "Each day"]], c.mode)),
    manual: F("Manual data", `<textarea ${ck("manual")} rows="4" placeholder="Label, value&#10;Facebook, 1200">${esc(c.manual || "")}</textarea>`, "One 'Label, value' per line replaces the live data in this widget only."),
    metrics: `<div class="rb-f"><span>Columns</span><div class="rb-chks">${Object.entries(METRICS).filter(([, d]) => !d.listen).map(([m, d]) => `<label class="rb-chk"><input type="checkbox" data-act="tmetric" value="${m}" ${(c.metrics || []).includes(m) ? "checked" : ""}> ${esc(d.l)}</label>`).join("")}</div></div>`,
    alert: F("Listening alert", inSel(ck("alert"), alerts, c.alert)),
    net: F("Network", inSel(ck("net"), CNET, c.net)),
    group: F("Competitor group", inSel(ck("group"), [["all", "All competitors"], ["national", "Domestic"], ["international", "International"]], c.group)),
    basis: F("Based on", inSel(ck("basis"), [["followers", "Followers (competitor data)"], ["mentions", "Mentions (listening)"]], c.basis)),
    sort: F("Rank by", inSel(ck("sort"), [["eng", "Engagements"], ["reach", "Reach / views"], ["date", "Newest"]], c.sort)),
    msort: F("Rank by", inSel(ck("sort"), [["reach", "Reach"], ["date", "Newest"]], c.sort)),
    limit: F("How many", inNum(ck("limit"), c.limit, { min: 1, max: 30 })),
    tone: F("Sentiment", inSel(ck("tone"), [["all", "All"], ["pos", "Positive"], ["neu", "Neutral"], ["neg", "Negative"]], c.tone)),
    source: F("Hashtags from", inSel(ck("source"), [["listening", "Listening mentions"], ["posts", "Brand's own posts"]], c.source)),
    style: F("Show as", inSel(ck("style"), [["cloud", "Tag cloud"], ["bars", "Bar chart"]], c.style))
  };
  return `<div class="rb-grp">${F("Title", inTxt(ck("title"), c.title, W.label))}${k !== "kpi" ? inChk(ck("showTitle"), c.showTitle, "Show title") : ""}</div>
    <div class="rb-subh">Data</div>${widgetFields(k).filter(f => !(f === "platform" && k === "hashtags" && c.source !== "posts")).map(f => fld[f] || "").join("")}
    <p class="rb-note">Comparison: ${ST.doc.compare === "none" ? "off" : ST.doc.compare === "year" ? "same period last year" : "previous period"} (change it under Report settings). Data updates automatically when the period or filters change.</p>`;
}
function stylePanel(els) {
  const e = els[0], s = e.style;
  return `${F("Background", inCol(K("style.bg"), s.bg))}
    <div class="rb-2">${F("Border width", inNum(K("style.borderW"), s.borderW, { min: 0, max: 20 }))}${F("Border style", inSel(K("style.borderS"), [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]], s.borderS))}</div>
    ${F("Border colour", inCol(K("style.borderC"), s.borderC))}
    <div class="rb-2">${F("Corner radius", inNum(K("style.radius"), s.radius, { min: 0, max: 999 }))}${F("Padding", inNum(K("style.pad"), s.pad, { min: 0, max: 80 }))}</div>
    ${inChk(K("style.shadow"), s.shadow, "Shadow")}
    ${F("Opacity", inRange(K("opacity"), e.opacity ?? 1, 0, 1, .05))}`;
}
function layoutPanel(els) {
  const e = els[0], one = els.length === 1;
  const al = [["l", "Left"], ["c", "Centre"], ["r", "Right"], ["t", "Top"], ["m", "Middle"], ["b", "Bottom"]];
  return `${one ? `<div class="rb-2">${F("X", inNum(K("x"), e.x))}${F("Y", inNum(K("y"), e.y))}</div><div class="rb-2">${F("Width", inNum(K("w"), e.w, { min: 8 }))}${F("Height", inNum(K("h"), e.h, { min: 6 }))}</div>` : ""}
    <div class="rb-subh">${one ? "Align on page" : "Align selection"}</div><div class="rb-seg wrap">${al.map(([k, l]) => `<button type="button" data-align="${k}">${l}</button>`).join("")}</div>
    ${!one ? `<div class="rb-seg wrap" style="margin-top:6px"><button type="button" data-align="dh">Distribute horizontally</button><button type="button" data-align="dv">Distribute vertically</button></div>` : ""}
    <div class="rb-subh">Layer</div><div class="rb-seg wrap"><button type="button" data-layer="top">To front</button><button type="button" data-layer="up">Forward</button><button type="button" data-layer="down">Backward</button><button type="button" data-layer="bottom">To back</button></div>
    ${ST.doc.pages.length > 1 ? `<div class="rb-subh">Other pages</div>${F("Page", `<select id="rb-mvpage">${ST.doc.pages.map((p, i) => i === ST.page ? "" : opt(i, (i + 1) + ". " + p.name)).join("")}</select>`)}<div class="rb-btnrow"><button type="button" class="btn" data-act="mvpage">Move there</button><button type="button" class="btn" data-act="cppage">Copy there</button></div>` : ""}`;
}
function advPanel(els) {
  const e = els[0], one = els.length === 1;
  return `${one ? F("Name", inTxt(K("name"), e.name, "Shown in the properties panel")) : ""}
    ${inChk('data-act="lockchk"', els.every(x => x.locked), "Locked (can't be moved, resized or deleted)")}
    ${inChk('data-act="hidechk"', els.every(x => x.hidden), "Hidden (kept in the editor, left out of the report)")}
    ${one ? F("Link", inTxt(K("link"), e.link, "https://…"), "Clickable in the preview and the PDF.") : ""}
    <div class="rb-subh">Group</div><div class="rb-btnrow">${els.length > 1 ? `<button type="button" class="btn" data-act="group">Group</button>` : ""}${els.some(x => x.group) ? `<button type="button" class="btn" data-act="ungroup">Ungroup</button>` : ""}</div>
    <div class="rb-btnrow" style="margin-top:14px"><button type="button" class="btn" data-act="dup">Duplicate</button><button type="button" class="btn" data-act="copy">Copy</button><button type="button" class="btn danger" data-act="del">Delete</button></div>
    ${one ? `<p class="rb-note">Element ID ${e.id}</p>` : ""}`;
}
function renderDocPanel(R) {
  const tabs = [["page", "Page"], ["hf", "Header & footer"], ["report", "Report"]];
  const tab = tabs.some(t => t[0] === ST.rtab) ? ST.rtab : "page";
  const doc = ST.doc, pg = curPage();
  let body = "";
  if (tab === "page") body = `${F("Page name", inTxt(PG("name"), pg.name))}
    ${F("Background colour", inCol(PG("bg"), pg.bg))}
    ${F("Background image", `<div class="rb-btnrow"><button type="button" class="btn" data-act="pgbg">${pg.bgImage ? "Replace" : "Upload"}</button>${pg.bgImage ? `<button type="button" class="btn" data-act="pgbgclear">Remove</button>` : ""}</div>`)}
    ${F("Orientation", inSel(PG("orientation"), [["", "Report default (" + doc.page.orientation + ")"], ["portrait", "Portrait"], ["landscape", "Landscape"]], pg.orientation))}
    <div class="rb-2">${F("Header", inSel(PG("header"), [["inherit", "Report setting"], ["show", "Show"], ["hide", "Hide"]], pg.header))}${F("Footer", inSel(PG("footer"), [["inherit", "Report setting"], ["show", "Show"], ["hide", "Hide"]], pg.footer))}</div>
    ${F("Header text on this page", inTxt(PG("headerText"), pg.headerText, "Uses the report header text"))}
    <div class="rb-btnrow"><button type="button" class="btn" data-act="duppage">Duplicate page</button><button type="button" class="btn danger" data-act="delpage">Delete page</button></div>
    <p class="rb-note">Tip: click an empty spot and drag to select several elements; Shift-click adds to the selection.</p>`;
  if (tab === "hf") {
    const H = doc.header, Fo = doc.footer;
    body = `<div class="rb-subh">Header</div>${inChk(D("header.enabled"), H.enabled, "Show a header")}
      <div class="rb-2">${F("Height", inNum(D("header.height"), H.height, { min: 24, max: 240 }))}${F("Text colour", inCol(D("header.color"), H.color))}</div>
      ${F("Background", inCol(D("header.bg"), H.bg))}
      <div class="rb-chks">${inChk(D("header.clientLogo"), H.clientLogo, "Client logo")}${inChk(D("header.agencyLogo"), H.agencyLogo, "Agency logo")}${inChk(D("header.title"), H.title, "Report title")}${inChk(D("header.brand"), H.brand, "Brand name")}</div>
      ${F("Custom text", inTxt(D("header.text"), H.text, "e.g. Confidential · {{reporting_period}}"))}
      ${F("First page", inSel(D("header.firstPage"), [["same", "Same as other pages"], ["hide", "No header"], ["custom", "Different first-page header"]], H.firstPage))}
      ${H.firstPage === "custom" ? `<div class="rb-box">${F("First-page text", inTxt(D("header.first.text"), (H.first || {}).text, ""))}<div class="rb-2">${F("Height", inNum(D("header.first.height"), (H.first || {}).height || H.height, { min: 24, max: 400 }))}${F("Background", inCol(D("header.first.bg"), (H.first || {}).bg || H.bg))}</div></div>` : ""}
      <div class="rb-subh">Footer</div>${inChk(D("footer.enabled"), Fo.enabled, "Show a footer")}
      <div class="rb-2">${F("Height", inNum(D("footer.height"), Fo.height, { min: 20, max: 160 }))}${F("Text colour", inCol(D("footer.color"), Fo.color))}</div>
      ${F("Background", inCol(D("footer.bg"), Fo.bg))}
      <div class="rb-chks">${inChk(D("footer.pageNumber"), Fo.pageNumber, "Page number")}${inChk(D("footer.total"), Fo.total, "Total pages")}${inChk(D("footer.agency"), Fo.agency, "Agency name")}${inChk(D("footer.website"), Fo.website, "Website")}${inChk(D("footer.copyright"), Fo.copyright, "Copyright")}</div>
      ${F("Custom text", inTxt(D("footer.text"), Fo.text, ""))}
      ${F("First page", inSel(D("footer.firstPage"), [["same", "Same as other pages"], ["hide", "No footer"]], Fo.firstPage))}
      <div class="rb-subh">Apply to pages</div><div class="rb-pagechk">${doc.pages.map((p, i) => `<label class="rb-chk"><input type="checkbox" data-hfpage="${i}" ${showHF(doc, i, "header") ? "checked" : ""}> ${i + 1}. ${esc(p.name)}</label>`).join("")}</div>
      <div class="rb-btnrow"><button type="button" class="btn" data-act="hfall">All pages follow the report setting</button></div><p class="rb-note">Ticks choose which pages show the header and footer. Each page can also override them in its Page settings.</p>`;
  }
  if (tab === "report") body = `${F("Report name", inTxt(D("name"), doc.name))}${F("Client name", inTxt(D("client"), doc.client))}
    ${F("Agency name", inTxt(D("agency"), doc.agency))}${F("Website", inTxt(D("website"), doc.website))}${F("Copyright", inTxt(D("copyright"), doc.copyright))}
    <div class="rb-2">${F("Font", inSel(D("theme.font"), FONTS.map(f => [f, f]), doc.theme.font))}${F("Accent colour", inCol(D("theme.accent"), doc.theme.accent))}</div>
    ${F("Comparison", inSel(D("compare"), [["prev", "Previous period"], ["year", "Same period last year"], ["none", "No comparison"]], doc.compare))}
    <div class="rb-2">${F("Page size", inSel(D("page.size"), [["A4", "A4"], ["A3", "A3"], ["Letter", "Letter"], ["Custom", "Custom"]], doc.page.size))}${F("Orientation", inSel(D("page.orientation"), [["portrait", "Portrait"], ["landscape", "Landscape"]], doc.page.orientation))}</div>
    ${doc.page.size === "Custom" ? `<div class="rb-2">${F("Width (mm)", inNum(D("page.w"), doc.page.w, { min: 50, max: 1200 }))}${F("Height (mm)", inNum(D("page.h"), doc.page.h, { min: 50, max: 1200 }))}</div>` : ""}
    <div class="rb-subh">Editor</div><div class="rb-chks">${inChk('data-act="snapchk"', ST.snap, "Snap to guides and grid")}${inChk('data-act="gridchk"', ST.showGrid, "Show grid")}</div>
    ${F("Grid size", inNum('data-act="gridsize"', ST.grid, { min: 0, max: 64 }))}`;
  R.innerHTML = `<div class="rb-rtabs">${tabs.map(([k, l]) => `<button type="button" data-rtab="${k}" class="${tab === k ? "on" : ""}">${l}</button>`).join("")}</div><div class="rb-rbody">${body}</div>`;
}

/* ----- top bar ----- */
function renderTop() {
  const T0 = $q("#rb-top"); if (!T0) return;
  const doc = ST.doc, P = rbPeriod(doc), pr = doc.period || {};
  T0.innerHTML = `<a class="rb-back" href="#builder" title="All reports">←</a>
    <input class="rb-name" id="rb-name" value="${esc(doc.name)}" aria-label="Report name">${doc.kind === "template" ? `<span class="rb-badge">Template</span>` : ""}
    <select id="rb-brand" aria-label="Brand / client"><option value="">Choose brand…</option>${SMA.brands.map(b => opt(b.id, b.name, doc.brand)).join("")}</select>
    <span class="rb-range"><select id="rb-preset" aria-label="Reporting period">${PRESETS.map(([k, l]) => opt(k, l, pr.preset || "last_month")).join("")}</select>
      ${pr.preset === "custom" ? `<input type="date" id="rb-from" value="${pr.from || P.from}"><input type="date" id="rb-to" value="${pr.to || P.to}">` : `<span class="rb-rl">${esc(P.label)}</span>`}</span>
    <span class="spacer"></span>
    <span class="rb-iconbtns">${TB("undo", "Undo (Ctrl+Z)", "↶", ST.hist.length < 2 ? "disabled" : "")}${TB("redo", "Redo (Ctrl+Y)", "↷", ST.fut.length ? "" : "disabled")}</span>
    <span class="rb-zoom">${TB("zout", "Zoom out", "−")}<select id="rb-zoomsel" aria-label="Zoom">${[[.5, "50%"], [.75, "75%"], [1, "100%"], [1.25, "125%"], [1.5, "150%"], [2, "200%"], ["fit", "Fit"]].map(([v, l]) => `<option value="${v}" ${v === ST.zoom || (v === "fit" && ST.fit) ? "selected" : ""}>${l}</option>`).join("")}${![.5, .75, 1, 1.25, 1.5, 2].includes(ST.zoom) && !ST.fit ? `<option selected>${Math.round(ST.zoom * 100)}%</option>` : ""}</select>${TB("zin", "Zoom in", "+")}</span>
    <span class="rb-iconbtns">${TB("prev:desktop", "Desktop preview", "🖥")}${TB("prev:mobile", "Mobile preview", "📱")}</span>
    <button type="button" class="btn" data-act="save">Save Draft</button><button type="button" class="btn" data-act="savetpl">Save as Template</button>
    <span class="rb-gen"><button type="button" class="btn primary" data-act="generate">Generate Report</button><button type="button" class="btn primary rb-caret" data-act="genmenu" aria-label="More export options">▾</button>
      <div class="rb-menu" id="rb-genmenu" hidden><button type="button" data-act="exp:pdf">Download PDF</button><button type="button" data-act="exp:pptx">Download PPTX</button><button type="button" data-act="exp:png">Download PNG (all pages)</button><button type="button" data-act="exp:jpg">Download JPG (all pages)</button></div></span>`;
  const st = $q("#rb-status"); if (st) st.innerHTML = saveStatus();
}
function saveStatus() { return ST.saving ? "Saving…" : ST.saveErr ? `<span class="neg-c">Not saved: ${esc(ST.saveErr)}</span>` : ST.dirty ? "Unsaved changes" : ST.savedAt ? "Saved " + new Date(ST.savedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""; }
function renderAll() { renderTop(); renderLeft(); renderNav(); renderStage(); renderRight(); }

/* ===== Saving, preview and exports (PDF / PPTX / PNG / JPG) ===== */
let saveTimer = null;
function scheduleAutosave() { const s = $q("#rb-status"); if (s) s.innerHTML = saveStatus(); clearTimeout(saveTimer); if (ST && ST.rid) saveTimer = setTimeout(() => saveDoc(), 4000); }
async function putDoc(rid, doc) {
  const r = await fetch(`api/upload/rb/reports/${rid}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { AUTH = null; go("login"); throw new Error("Please log in again."); }
  if (r.status === 413) throw new Error("The server doesn't accept large saves yet; it updates itself within about 10 minutes.");
  if (!r.ok) throw new Error(j.error || "Server error " + r.status);
  return j;
}
async function saveDoc(force) {
  if (!ST || (!ST.dirty && !force && ST.rid)) return true;
  clearTimeout(saveTimer);
  if (ST.saving) { ST.saveAgain = true; return true; }
  ST.saving = true; ST.saveErr = ""; const st = $q("#rb-status"); if (st) st.innerHTML = saveStatus();
  const snap = snapshot();
  try {
    const j = await putDoc(ST.rid || "new", ST.doc);
    if (!ST.rid) { ST.rid = j.id; ST.doc.id = j.id; history.replaceState(null, "", "#builder-" + j.id); }
    ST.savedAt = Date.now(); if (snapshot() === snap) ST.dirty = false;
    LIST.items = null;
    return true;
  } catch (e) { ST.saveErr = e.message; return false; }
  finally { ST.saving = false; const s2 = $q("#rb-status"); if (s2) s2.innerHTML = saveStatus(); if (ST.saveAgain) { ST.saveAgain = false; scheduleAutosave(); } }
}
async function saveAsTemplate() {
  const name = prompt("Template name", ST.doc.name.replace(/ - .*$/, "") + " template"); if (!name) return;
  const forBrand = ST.doc.brand && confirm(`Make this a template for ${brandName(ST.doc.brand)} only?\n\nOK: only for this brand · Cancel: for every brand`);
  const t = clone(ST.doc); delete t.id; t.kind = "template"; t.name = name.slice(0, 120); t.template_for = forBrand ? ST.doc.brand : "";
  try { await putDoc("new", t); LIST.items = null; toast("Template saved: " + name); await loadList(); renderLeft(); } catch (e) { toast(e.message, 6000, true); }
}

/* ----- off-screen rendering of pages for preview and export ----- */
async function imagesReady(root) {
  await Promise.all([...root.querySelectorAll("img")].map(im => im.complete ? 0 : new Promise(r => { im.addEventListener("load", r, { once: true }); im.addEventListener("error", r, { once: true }); setTimeout(r, 10000); })));
  try { await document.fonts.ready; } catch (e) {}
}
function exportHost(doc) {
  let h = $q("#rb-exphost"); if (h) h.remove();
  h = document.createElement("div"); h.id = "rb-exphost";
  h.innerHTML = doc.pages.map((p, i) => pageHTML(doc, i, "export")).join("");
  document.body.appendChild(h); return h;
}
async function pageCanvas(node, scale) {
  return html2canvas(node, { scale, useCORS: true, backgroundColor: "#ffffff", logging: false, imageTimeout: 15000 });
}
function fileBase(doc) { const L = rbPeriod(doc).label; return (doc.name.includes(L) ? doc.name : `${doc.name} - ${L}`).replace(/[–—]/g, "-").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim(); }
function saveBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
async function exportReport(fmt, opts = {}, progress) {
  const doc = ST.doc; progress = progress || (t => toast(t, 60000));
  if (ST.editing) finishEdit();
  progress("Loading data…"); await ensureData(doc); fontsInDoc(doc);
  const libs = [mrLoad("vendor/html2canvas-pro.min.js")];
  if (fmt === "pdf") libs.push(mrLoad("vendor/jspdf.umd.min.js")); if (fmt === "pptx") libs.push(mrLoad("vendor/pptxgen.bundle.js"));
  await Promise.all(libs);
  const host = exportHost(doc); await imagesReady(host);
  const nodes = [...host.querySelectorAll(".rb-page")];
  const only = opts.page != null ? [opts.page] : nodes.map((_, i) => i);
  const scale = opts.hi ? 3 : 2, base = fileBase(doc);
  try {
    if (fmt === "pdf") {
      const { jsPDF } = window.jspdf; let pdf = null;
      for (const i of only) {
        progress(`Creating PDF page ${i + 1} of ${nodes.length}…`);
        const [wmm, hmm] = pageMM(doc, doc.pages[i]), cv = await pageCanvas(nodes[i], scale);
        const o = wmm > hmm ? "landscape" : "portrait";
        if (!pdf) pdf = new jsPDF({ orientation: o, unit: "mm", format: [wmm, hmm], compress: true }); else pdf.addPage([wmm, hmm], o);
        pdf.addImage(cv.toDataURL("image/jpeg", opts.hi ? .95 : .9), "JPEG", 0, 0, wmm, hmm, undefined, "FAST");
        doc.pages[i].elements.forEach(e => {   // clickable links: element links and videos
          const url = e.link || (e.type === "video" ? e.props.url : "");
          if (url && /^https?:\/\//.test(url) && !e.hidden) pdf.link(e.x / MM, e.y / MM, e.w / MM, e.h / MM, { url });
        });
      }
      pdf.setProperties({ title: doc.name, author: doc.agency || "Sentimeter", creator: "Sentimeter" });
      pdf.save(base + ".pdf");
    } else if (fmt === "pptx") {
      const pptx = new PptxGenJS(); const [w0, h0] = pageMM(doc, doc.pages[0]);
      pptx.defineLayout({ name: "RB", width: w0 / 25.4, height: h0 / 25.4 }); pptx.layout = "RB"; pptx.title = doc.name; pptx.author = doc.agency || "Sentimeter";
      for (const i of only) {
        progress(`Creating slide ${i + 1} of ${nodes.length}…`);
        const cv = await pageCanvas(nodes[i], scale), s = pptx.addSlide();
        const [wmm, hmm] = pageMM(doc, doc.pages[i]); const r = Math.min(w0 / wmm, h0 / hmm), W = wmm * r / 25.4, H = hmm * r / 25.4;
        s.addImage({ data: cv.toDataURL("image/jpeg", .92), x: (w0 / 25.4 - W) / 2, y: (h0 / 25.4 - H) / 2, w: W, h: H });
        s.addNotes(doc.pages[i].name);
      }
      progress("Saving…"); await pptx.writeFile({ fileName: base + ".pptx" });
    } else {
      const type = fmt === "jpg" ? "image/jpeg" : "image/png";
      for (const i of only) {
        progress(`Creating page ${i + 1} of ${nodes.length}…`);
        const cv = await pageCanvas(nodes[i], scale);
        const blob = await new Promise(r => cv.toBlob(r, type, .92));
        saveBlob(blob, `${base} - page ${i + 1}.${fmt}`);
        await new Promise(r => setTimeout(r, 350));
      }
    }
    progress("Downloaded."); toast("Downloaded", 2500);
  } finally { host.remove(); }
}

/* ----- step 3: preview & download ----- */
function renderPreview(root) {
  const doc = ST.doc, mob = ST.pmode === "mobile";
  root.innerHTML = `<div class="rb-prevbar"><a class="btn" href="#builder-${ST.rid}">← Back to editor</a>
      <div class="rb-seg"><button type="button" data-pmode="desktop" class="${mob ? "" : "on"}">🖥 Desktop</button><button type="button" data-pmode="mobile" class="${mob ? "on" : ""}">📱 Mobile</button></div>
      <span class="spacer"></span><span class="hint" id="rb-exmsg"></span>
      <label class="rb-chk"><input type="checkbox" id="rb-hi" ${ST.hi ? "checked" : ""}> High resolution</label>
      <button type="button" class="btn" data-exp="png">PNG</button><button type="button" class="btn" data-exp="jpg">JPG</button><button type="button" class="btn" data-exp="pptx">PPTX</button><button type="button" class="btn primary" data-exp="pdf">Download PDF</button></div>
    <div class="rb-prevwrap ${mob ? "mobile" : ""}" id="rb-prevwrap"><p class="hint">Preparing ${doc.pages.length} page${doc.pages.length > 1 ? "s" : ""}…</p></div>`;
  const wrap = $q("#rb-prevwrap");
  ensureData(doc).then(() => {
    fontsInDoc(doc);
    const W = mob ? 340 : Math.min(980, wrap.clientWidth - 40);
    wrap.innerHTML = (mob ? `<div class="rb-phone"><div class="rb-phone-in">` : "") + doc.pages.map((p, i) => { const [pw, ph] = pageDims(doc, p), s = W / pw;
      return `<div class="rb-pv" style="width:${W}px;height:${Math.round(ph * s)}px"><div style="transform:scale(${s});transform-origin:0 0;width:${pw}px;height:${ph}px">${pageHTML(doc, i, "view")}</div></div>`; }).join("") + (mob ? `</div></div>` : "");
  });
  root.onclick = async ev => {
    const pm = ev.target.closest("[data-pmode]"); if (pm) { ST.pmode = pm.dataset.pmode; renderPreview(root); return; }
    const lk = ev.target.closest("[data-link]"); if (lk) { window.open(lk.dataset.link, "_blank", "noopener"); return; }
    const ex = ev.target.closest("[data-exp]"); if (!ex || ex.disabled) return;
    const btns = $qa("[data-exp]", root); btns.forEach(b => b.disabled = true);
    const msg = $q("#rb-exmsg");
    try { await exportReport(ex.dataset.exp, { hi: $q("#rb-hi").checked }, t => msg.textContent = t); }
    catch (e) { msg.textContent = ""; toast(e.message || String(e), 7000, true); }
    finally { btns.forEach(b => b.disabled = false); }
  };
  $q("#rb-hi").onchange = e => ST.hi = e.target.checked;
}

/* ===== Routing, reports library, step 1 (select data) and editor wiring ===== */
const LIST = { items: null, tab: "reports", brand: "", err: "" };
async function loadList() {
  try { LIST.items = (await smaApi("/rb/reports")).items || []; LIST.err = ""; } catch (e) { LIST.err = e.message; LIST.items = LIST.items || []; }
}
async function fetchDoc(rid) { return (await smaApi("/rb/reports/" + rid)).report; }
const stepsHTML = n => `<div class="rb-steps">${[["Select Data", 1], ["Build Report", 2], ["Preview & Download", 3]].map(([l, i]) => `<span class="rb-step ${i < n ? "done" : i === n ? "on" : ""}"><i>${i < n ? "✓" : i}</i>${l}</span>`).join('<span class="rb-stepline"></span>')}<span class="spacer"></span><span id="rb-status" class="hint"></span></div>`;

let RSEQ = 0;
async function rbRender(root) {
  const seq = ++RSEQ;
  const h = location.hash.slice(1), m = h.match(/^builder-(new|r[0-9a-f]{10})(?:-(preview))?$/);
  if (!SMA.brands) { root.innerHTML = `<p class="hint" style="padding:24px">Loading brands…</p>`; try { SMA.brands = (await smaApi("/brands")).brands; } catch (e) { root.innerHTML = `<p class="neg-c" style="padding:24px">${esc(e.message)}</p>`; return; } }
  if (ST && ST.rid && ST.dirty && (!m || m[1] !== ST.rid)) saveDoc();
  if (!m) return renderLibrary(root);
  if (m[1] === "new") return renderStep1(root);
  if (!ST || ST.rid !== m[1]) {
    root.innerHTML = `<div class="rb-loading"><span class="rb-spin"></span>Opening report…</div>`;
    try { const d = await fetchDoc(m[1]); if (seq !== RSEQ) return; openDoc(d, m[1]); } catch (e) { root.innerHTML = `<div class="card" style="margin:24px"><p class="empty">${esc(e.message)}. <a href="#builder">Back to reports</a></p></div>`; return; }
  }
  if (m[2]) { ST.step = 3; root.className = "rb-pv-root"; root.innerHTML = `<div class="rb-shell">${stepsHTML(3)}<div id="rb-prev"></div></div><div id="rb-toast" class="rb-toast"></div>`; renderPreview($q("#rb-prev")); $q("#rb-status").innerHTML = saveStatus(); return; }
  ST.step = 2; renderEditor(root, seq);
}
function openDoc(d, rid) {
  ST = { doc: d, rid, page: 0, sel: [], zoom: 1, fit: true, grid: 8, snap: true, showGrid: false, hist: [], fut: [], dirty: false, editing: null, etab: "content", rtab: "page", ltab: "el", savedAt: d.updated ? Date.parse(d.updated) : null };
  d.assets = d.assets || []; d.theme = d.theme || { font: "Inter", accent: "#6739F5", ink: "#17132B" };
  ST.hist = [snapshot()]; fontsInDoc(d);
  if (d.brand && typeof setCurBrand === "function" && SMA.brands.some(b => b.id === d.brand)) { try { setCurBrand(d.brand); renderBrandNav("builder"); } catch (e) {} }
}

/* ----- library: reports and templates ----- */
async function renderLibrary(root) {
  root.className = "";
  if (!LIST.items) { root.innerHTML = libHead() + `<div class="rb-loading"><span class="rb-spin"></span>Loading reports…</div>`; bindLibHead(root); await loadList(); if (current() !== "builder" || location.hash !== "#builder") return; }
  const bf = LIST.brand, items = (LIST.items || []).filter(i => !bf || i.brand === bf || i.template_for === bf);
  const reports = items.filter(i => i.kind === "report"), tpls = items.filter(i => i.kind === "template");
  const row = i => `<tr><td><a href="#builder-${i.id}" class="rb-ln">${esc(i.name)}</a></td><td>${esc(brandName(i.brand) || "–")}</td><td>${esc(i.period || "–")}</td><td>${i.pages}</td><td>${relAgo(i.updated)}<div class="hint">${esc(i.updated_by || "")}</div></td>
    <td class="r" style="white-space:nowrap"><a class="btn" href="#builder-${i.id}">Open</a> <a class="btn" href="#builder-${i.id}-preview">Preview</a> <button type="button" class="btn" data-dupr="${i.id}">Duplicate</button> <button type="button" class="btn danger" data-delr="${i.id}">Delete</button></td></tr>`;
  root.innerHTML = libHead() + (LIST.err ? `<p class="neg-c">${esc(LIST.err)}</p>` : "") + `
    <div class="rb-libtabs"><button type="button" data-ltabl="reports" class="${LIST.tab === "reports" ? "on" : ""}">Reports (${reports.length})</button><button type="button" data-ltabl="templates" class="${LIST.tab === "templates" ? "on" : ""}">Templates (${TEMPLATE_LIST.length + tpls.length})</button>
      <span class="spacer"></span><select id="rb-lbrand" aria-label="Filter by brand"><option value="">All brands</option>${SMA.brands.map(b => opt(b.id, b.name, bf)).join("")}</select></div>
    ${LIST.tab === "reports" ? (reports.length ? `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Report</th><th>Brand</th><th>Period</th><th>Pages</th><th>Updated</th><th></th></tr></thead><tbody>${reports.map(row).join("")}</tbody></table></div></div>`
      : `<div class="card"><div class="rb-empty-state">${icon("table", 40)}<h3>No custom reports${bf ? " for this brand" : ""} yet</h3><p>Pick a brand and period, start from a template or a blank page, and drag in analytics and your own content.</p><a class="btn primary" href="#builder-new">Create your first report</a></div></div>`)
    : `<div class="rb-subh2">Sentimeter templates</div><div class="rb-tplgrid">${TEMPLATE_LIST.map(([k, n, d]) => `<div class="rb-tplcard"><div class="rb-tplic">${icon(k === "competitor" ? "competitor" : k === "sentiment" ? "sentiment" : k === "listening" ? "mentions" : k === "campaign" ? "tags" : "line", 26)}</div><b>${esc(n)}</b><span>${esc(d)}</span><a class="btn primary" href="#builder-new" data-usetpl="b:${k}">Use template</a></div>`).join("")}</div>
      <div class="rb-subh2">Your templates</div>${tpls.length ? `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Template</th><th>For</th><th>Pages</th><th>Updated</th><th></th></tr></thead><tbody>${tpls.map(i => `<tr><td><b>${esc(i.name)}</b></td><td>${esc(brandName(i.template_for) || "All brands")}</td><td>${i.pages}</td><td>${relAgo(i.updated)}</td>
        <td class="r" style="white-space:nowrap"><a class="btn primary" href="#builder-new" data-usetpl="s:${i.id}">Use</a> <a class="btn" href="#builder-${i.id}">Edit</a> <button type="button" class="btn" data-dupr="${i.id}">Duplicate</button> <button type="button" class="btn danger" data-delr="${i.id}">Delete</button></td></tr>`).join("")}</tbody></table></div></div>`
      : `<p class="hint">Open any report and click <b>Save as Template</b> to reuse its layout, for every brand or for one client.</p>`}`}`;
  bindLibHead(root);
  root.onclick = async ev => {
    const t = ev.target.closest("[data-ltabl]"); if (t) { LIST.tab = t.dataset.ltabl; renderLibrary(root); return; }
    const u = ev.target.closest("[data-usetpl]"); if (u) { NEWR.tpl = u.dataset.usetpl; return; }
    const dp = ev.target.closest("[data-dupr]"); if (dp) { try { const d = await fetchDoc(dp.dataset.dupr); delete d.id; d.name = d.name + " (copy)"; await putDoc("new", d); await loadList(); renderLibrary(root); } catch (e) { alert(e.message); } return; }
    const dl = ev.target.closest("[data-delr]"); if (dl) { if (dl.dataset.arm !== "1") { dl.dataset.arm = "1"; dl.textContent = "Click again to delete"; return; }
      try { await smaApi("/rb/reports/" + dl.dataset.delr, { method: "DELETE" }); await loadList(); renderLibrary(root); } catch (e) { alert(e.message); } }
  };
  const lb = $q("#rb-lbrand"); if (lb) lb.onchange = e => { LIST.brand = e.target.value; renderLibrary(root); };
}
const libHead = () => `<div class="page-head"><div><h1>Custom Report Builder</h1><p class="sub">Build fully branded, multi-page reports with live analytics, your own text, images and videos, and export them as PDF, PPTX or images.</p></div><a class="btn primary" href="#builder-new" data-usetpl="">+ New report</a></div>`;
function bindLibHead(root) { $qa("[data-usetpl]", root).forEach(a => a.addEventListener("click", () => NEWR.tpl = a.dataset.usetpl)); }

/* ----- step 1: select data ----- */
const NEWR = { tpl: "", brand: "", name: "", client: "", preset: "last_month", from: "", to: "", compare: "prev" };
async function renderStep1(root) {
  root.className = "";
  if (!LIST.items) await loadList();
  if (!NEWR.brand) NEWR.brand = (typeof curBrand === "function" && curBrand() ? curBrand().id : "") || (SMA.brands[0] || {}).id || "";
  const b = SMA.brands.find(x => x.id === NEWR.brand);
  const saved = (LIST.items || []).filter(i => i.kind === "template" && (!i.template_for || i.template_for === NEWR.brand));
  const [a, z] = presetRange(NEWR.preset, NEWR.from, NEWR.to);
  root.innerHTML = `<div class="rb-shell">${stepsHTML(1)}<div class="rb-s1">
    <div class="card"><div class="card-head"><h2>Client, brand and period</h2></div><div class="card-body rb-s1f">
      ${F("Brand", `<select id="n-brand">${SMA.brands.map(x => opt(x.id, x.name, NEWR.brand)).join("")}</select>`)}
      ${F("Client name", inTxt('id="n-client"', NEWR.client || (b ? b.name : ""), "Shown as {{client_name}}"))}
      ${F("Report name", inTxt('id="n-name"', NEWR.name, (b ? b.name + " – " : "") + "Monthly Social Media Report"))}
      ${F("Reporting period", `<select id="n-preset">${PRESETS.map(([k, l]) => opt(k, l, NEWR.preset)).join("")}</select>`, rangeLabel(a, z))}
      ${NEWR.preset === "custom" ? `<div class="rb-2">${F("From", `<input type="date" id="n-from" value="${NEWR.from || a}">`)}${F("To", `<input type="date" id="n-to" value="${NEWR.to || z}">`)}</div>` : ""}
      ${F("Compare with", `<select id="n-cmp">${[["prev", "Previous period"], ["year", "Same period last year"], ["none", "No comparison"]].map(([k, l]) => opt(k, l, NEWR.compare)).join("")}</select>`)}
    </div></div>
    <div class="card"><div class="card-head"><h2>Start from</h2></div><div class="card-body"><div class="rb-starts">
      <label class="rb-start ${!NEWR.tpl ? "on" : ""}"><input type="radio" name="n-tpl" value="" ${!NEWR.tpl ? "checked" : ""}><b>Blank report</b><span>An empty A4 page with your header and footer.</span></label>
      ${TEMPLATE_LIST.map(([k, n, d]) => `<label class="rb-start ${NEWR.tpl === "b:" + k ? "on" : ""}"><input type="radio" name="n-tpl" value="b:${k}" ${NEWR.tpl === "b:" + k ? "checked" : ""}><b>${esc(n)}</b><span>${esc(d)}</span></label>`).join("")}
      ${saved.map(i => `<label class="rb-start ${NEWR.tpl === "s:" + i.id ? "on" : ""}"><input type="radio" name="n-tpl" value="s:${i.id}" ${NEWR.tpl === "s:" + i.id ? "checked" : ""}><b>${esc(i.name)}</b><span>Your template · ${i.pages} page${i.pages === 1 ? "" : "s"}${i.template_for ? " · " + esc(brandName(i.template_for)) : ""}</span></label>`).join("")}
    </div></div></div>
    <div class="rb-s1a"><a class="btn" href="#builder">Cancel</a><span id="n-msg" class="hint"></span><button type="button" class="btn primary" id="n-go">Continue to Build Report →</button></div></div></div><div id="rb-toast" class="rb-toast"></div>`;
  const keep = () => { NEWR.brand = $q("#n-brand").value; NEWR.client = $q("#n-client").value; NEWR.name = $q("#n-name").value; NEWR.compare = $q("#n-cmp").value; if ($q("#n-from")) { NEWR.from = $q("#n-from").value; NEWR.to = $q("#n-to").value; } const t = $q('input[name="n-tpl"]:checked'); NEWR.tpl = t ? t.value : ""; };
  $q("#n-brand").onchange = () => { keep(); NEWR.client = ""; renderStep1(root); };
  $q("#n-preset").onchange = e => { keep(); NEWR.preset = e.target.value; renderStep1(root); };
  $qa('input[name="n-tpl"]').forEach(r => r.onchange = () => { keep(); $qa(".rb-start").forEach(l => l.classList.toggle("on", l.contains(r) && r.checked)); });
  $q("#n-go").onclick = async () => {
    keep(); const btn = $q("#n-go"), msg = $q("#n-msg"); btn.disabled = true; msg.textContent = "Creating…";
    try {
      const b2 = SMA.brands.find(x => x.id === NEWR.brand);
      let doc;
      if (NEWR.tpl.startsWith("s:")) { doc = await fetchDoc(NEWR.tpl.slice(2)); delete doc.id; doc.kind = "report"; doc.template_for = ""; doc.brand = NEWR.brand; doc.pages.forEach(p => p.elements.forEach(e => e.id = uid())); }
      else { doc = newDoc({ brand: NEWR.brand }); if (NEWR.tpl.startsWith("b:")) applyBuiltin(doc, NEWR.tpl.slice(2)); }
      doc.client = NEWR.client || (b2 ? b2.name : ""); doc.compare = NEWR.compare;
      doc.period = NEWR.preset === "custom" ? { preset: "custom", from: NEWR.from, to: NEWR.to } : { preset: NEWR.preset };
      doc.name = NEWR.name.trim() || `${b2 ? b2.name + " – " : ""}${NEWR.tpl.startsWith("b:") ? TEMPLATE_LIST.find(x => "b:" + x[0] === NEWR.tpl)[1] : NEWR.tpl.startsWith("s:") ? doc.name : "Social Media Report"}`;
      const j = await putDoc("new", doc); doc.id = j.id; LIST.items = null;
      openDoc(doc, j.id); ST.savedAt = Date.now();
      Object.assign(NEWR, { tpl: "", name: "", client: "" });
      location.hash = "builder-" + j.id;
    } catch (e) { msg.textContent = e.message; msg.className = "neg-c"; btn.disabled = false; }
  };
}

/* ----- editor shell ----- */
function fitZoom() {
  const sc = $q("#rb-scroll"); if (!sc) return 1;
  const [pw] = pageDims(ST.doc, curPage());
  return clamp(Math.floor((sc.clientWidth - 48) / pw * 20) / 20, .3, 2);
}
async function renderEditor(root, seq) {
  root.className = "rb-ed-root";
  root.innerHTML = `<div class="rb-shell ed">${stepsHTML(2)}<div class="rb-top" id="rb-top"></div>
    <div class="rb-main"><aside class="rb-left" id="rb-left"></aside><div class="rb-nav" id="rb-nav"></div>
      <div class="rb-stage"><div class="rb-pagebar" id="rb-pagebar"></div><div class="rb-scroll" id="rb-scroll"><div class="rb-host" id="rb-stage-host"></div><div class="rb-ctx" id="rb-ctx" hidden></div></div>
        <div class="rb-drawerbtns"><button type="button" class="btn" data-drawer="left">＋ Elements</button><button type="button" class="btn" data-drawer="right">☰ Properties</button></div></div>
      <aside class="rb-right" id="rb-right"></aside></div></div><div id="rb-toast" class="rb-toast"></div><div class="rb-menu" id="rb-pmenu" hidden></div>`;
  renderTop(); renderLeft(); $q("#rb-nav").innerHTML = `<p class="hint" style="padding:8px">…</p>`; renderRight();
  $q("#rb-stage-host").innerHTML = `<div class="rb-loading"><span class="rb-spin"></span>Loading analytics data…</div>`;
  if (!LIST.items) loadList().then(() => ST.ltab === "tpl" && renderLeft());
  try { await ensureData(ST.doc); } catch (e) { toast("Some analytics could not be loaded: " + e.message, 6000, true); }
  if (current() !== "builder" || !$q("#rb-stage-host") || seq !== RSEQ) return;   // a newer render took over
  if (ST.fit) ST.zoom = fitZoom();
  renderTop(); renderNav(); renderStage(); renderRight();
  bindEditor(root);
}
function setPeriod(p) { ST.doc.period = p; MODELS.clear(); commit("period"); ensureData(ST.doc).then(() => { renderTop(); renderStage(); renderNavSoon(); }); }

function bindEditor(root) {
  const host = $q("#rb-stage-host"), scroll = $q("#rb-scroll");
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("dblclick", ev => {
    const n = ev.target.closest(".rb-el"); if (!n) return; const e = findEl(n.dataset.id); if (!e) return;
    if (e.type === "text") startEdit(e.id);
    else if (e.type === "image" && !e.locked) pickFile("image", f => uploadInto(e.id, f));
    else if (e.type === "widget") { ST.etab = "content"; renderRight(); openDrawer("right"); }
  });
  host.addEventListener("input", ev => { if (ev.target.closest(".rb-txt.editing")) fitTextHeight(ST.editing); });
  host.addEventListener("focusout", ev => { if (ev.target.classList && ev.target.classList.contains("editing")) setTimeout(() => { if (ST.editing && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("#rb-ctx"))) finishEdit(); }, 120); });
  // drop from library / files
  scroll.addEventListener("dragover", ev => { if ([...ev.dataTransfer.types].some(t => t === "text/rb" || t === "Files")) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; } });
  scroll.addEventListener("drop", ev => {
    ev.preventDefault(); const pg = $q("#rb-stage-host .rb-page"); if (!pg) return;
    const at = pagePoint(ev), k = ev.dataTransfer.getData("text/rb");
    if (ev.dataTransfer.files && ev.dataTransfer.files.length) { const tgt = ev.target.closest(".rb-el"), e = tgt && findEl(tgt.dataset.id); if (e && (e.type === "image" || e.type === "video") && ev.dataTransfer.files.length === 1) uploadInto(e.id, ev.dataTransfer.files[0]); else dropFiles([...ev.dataTransfer.files], at); return; }
    if (k) addLib(k, at);
  });
  // left panel
  const L = $q("#rb-left");
  L.addEventListener("dragstart", ev => { const t = ev.target.closest("[data-kind]"); if (t) { ev.dataTransfer.setData("text/rb", t.dataset.kind); ev.dataTransfer.effectAllowed = "copy"; } });
  L.addEventListener("click", async ev => {
    const lt = ev.target.closest("[data-ltab]"); if (lt) { ST.ltab = lt.dataset.ltab; renderLeft(); return; }
    const t = ev.target.closest("[data-kind]"); if (t) { addLib(t.dataset.kind); closeDrawers(); return; }
    const a = ev.target.closest("[data-asset]"); if (a) { const e = makeEl(a.dataset.atype === "video" ? "video" : "image", ST.doc); if (e.type === "image") e.props.src = a.dataset.asset; else { e.props.src = a.dataset.asset; e.props.thumb = a.dataset.thumb; e.props.title = a.title.replace(/\.\w+$/, ""); } if (a.classList.contains("dark")) e.style.bg = "#17123A"; if (/logo/.test(a.title)) { e.props.fit = "contain"; e.w = 200; e.h = 100; } addElement(e); return; }
    const tp = ev.target.closest("[data-tpl]"); if (tp) return applyTpl(tp.dataset.tpl, tp.dataset.how);
    const ac = ev.target.closest('[data-act="upload"]'); if (ac) pickAny(f => dropFiles([f]));
  });
  L.addEventListener("input", ev => { if (ev.target.id === "rb-lq") { ST.lq = ev.target.value; ST.lqFocus = true; renderLeft(); } });
  L.addEventListener("toggle", ev => { const d = ev.target.closest("[data-sec]"); if (d) { ST.closed = ST.closed || {}; ST.closed[d.dataset.sec] = !d.open; } }, true);
  // page navigator
  const nav = $q("#rb-nav");
  nav.addEventListener("click", ev => {
    const m = ev.target.closest("[data-pmenu]"); if (m) { ev.stopPropagation(); return pageMenu(+m.dataset.pmenu, m); }
    if (ev.target.closest('[data-act="addpage"]')) return insertPage(ST.page + 1);
    const th = ev.target.closest(".rb-th"); if (th) { if (ST.editing) finishEdit(); ST.page = +th.dataset.pi; ST.sel = []; if (ST.fit) ST.zoom = fitZoom(); renderAll(); }
  });
  nav.addEventListener("dblclick", ev => { const th = ev.target.closest(".rb-th"); if (th) renamePage(+th.dataset.pi); });
  nav.addEventListener("dragstart", ev => { const th = ev.target.closest(".rb-th"); if (th) { ev.dataTransfer.setData("text/rbpage", th.dataset.pi); ev.dataTransfer.effectAllowed = "move"; } });
  nav.addEventListener("dragover", ev => { if ([...ev.dataTransfer.types].includes("text/rbpage")) { ev.preventDefault(); const th = ev.target.closest(".rb-th"); $qa(".rb-th", nav).forEach(x => x.classList.toggle("dropto", x === th)); } });
  nav.addEventListener("drop", ev => { const from = ev.dataTransfer.getData("text/rbpage"); const th = ev.target.closest(".rb-th"); if (from !== "" && th) { ev.preventDefault(); movePage(+from, +th.dataset.pi); } });
  // right panel
  const R = $q("#rb-right");
  R.addEventListener("click", ev => {
    const et = ev.target.closest("[data-etab]"); if (et) { ST.etab = et.dataset.etab; renderRight(); return; }
    const rt = ev.target.closest("[data-rtab]"); if (rt) { ST.rtab = rt.dataset.rtab; renderRight(); return; }
    const sk = ev.target.closest("[data-setk]"); if (sk) { selEls().forEach(e => setPath(e, sk.dataset.setk, isNaN(+sk.dataset.v) || sk.dataset.setk.endsWith("align") || sk.dataset.setk.endsWith("fit") ? sk.dataset.v : +sk.dataset.v)); commit("style"); renderStage(); renderNavSoon(); renderRight(); return; }
    const al = ev.target.closest("[data-align]"); if (al) return alignSel(al.dataset.align);
    const ly = ev.target.closest("[data-layer]"); if (ly) return layer(ly.dataset.layer);
    const ac = ev.target.closest("[data-act]"); if (ac && ac.tagName === "BUTTON") doAct(ac.dataset.act, ac);
  });
  R.addEventListener("mousedown", ev => { const b = ev.target.closest('[data-act^="fmtall:"],[data-act="link"]'); if (b) ev.preventDefault(); });
  R.addEventListener("input", ev => onField(ev, false));
  R.addEventListener("change", ev => onField(ev, true));
  // contextual toolbar
  const ctx = $q("#rb-ctx");
  ctx.addEventListener("mousedown", ev => { if (ev.target.tagName !== "SELECT" && ev.target.tagName !== "INPUT") ev.preventDefault(); });
  ctx.addEventListener("click", ev => { const b = ev.target.closest("button[data-act]"); if (b) doAct(b.dataset.act, b); });
  ctx.addEventListener("input", ev => { if (ev.target.dataset.act === "fcolor") execFmt("foreColor", ev.target.value); });
  ctx.addEventListener("change", ev => { if (ev.target.dataset.act === "field" && ev.target.value) { insertFieldAtCaret(ev.target.value); ev.target.value = ""; } });
  // top bar
  const top = $q("#rb-top");
  top.addEventListener("click", ev => { const b = ev.target.closest("[data-act]"); if (b && !b.disabled) doAct(b.dataset.act, b); });
  top.addEventListener("change", ev => {
    const id = ev.target.id;
    if (id === "rb-name") { ST.doc.name = ev.target.value.trim() || "Untitled report"; commit("name"); renderStage(); }
    if (id === "rb-brand") { ST.doc.brand = ev.target.value; if (ST.doc.brand) try { setCurBrand(ST.doc.brand); renderBrandNav("builder"); } catch (e) {} const b = SMA.brands.find(x => x.id === ST.doc.brand); if (b && !ST.doc.client) ST.doc.client = b.name; MODELS.clear(); commit("brand"); ensureData(ST.doc).then(() => { renderAll(); }); }
    if (id === "rb-preset") setPeriod(ev.target.value === "custom" ? { preset: "custom", from: rbPeriod(ST.doc).from, to: rbPeriod(ST.doc).to } : { preset: ev.target.value });
    if (id === "rb-from" || id === "rb-to") { const f = $q("#rb-from").value, t = $q("#rb-to").value; if (f && t && f <= t) setPeriod({ preset: "custom", from: f, to: t }); else toast("The start date must be before the end date", 3000, true); }
    if (id === "rb-zoomsel") { if (ev.target.value === "fit") { ST.fit = true; ST.zoom = fitZoom(); } else { ST.fit = false; ST.zoom = +ev.target.value || 1; } renderStage(); renderTop(); }
  });
  // stage background: deselect when clicking outside the page
  scroll.addEventListener("pointerdown", ev => { if (!ev.target.closest(".rb-page") && !ev.target.closest("#rb-ctx")) { if (ST.editing) finishEdit(); if (ST.sel.length) { ST.sel = []; drawOverlay(); renderRight(); } } });
  root.addEventListener("click", ev => { const d = ev.target.closest("[data-drawer]"); if (d) openDrawer(d.dataset.drawer); });
  window.removeEventListener("resize", onResize); window.addEventListener("resize", onResize);
  document.removeEventListener("keydown", onKey); document.addEventListener("keydown", onKey);
}
function onResize() { if (ST && ST.step === 2 && ST.fit && $q("#rb-scroll")) { ST.zoom = fitZoom(); renderStage(); } }
function openDrawer(side) { const sh = $q(".rb-shell.ed"); if (!sh) return; sh.classList.toggle("drawer-" + side); sh.classList.remove(side === "left" ? "drawer-right" : "drawer-left"); }
function closeDrawers() { const sh = $q(".rb-shell.ed"); if (sh) sh.classList.remove("drawer-left", "drawer-right"); }
function pickAny(cb) { const i = document.createElement("input"); i.type = "file"; i.accept = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"; i.onchange = () => i.files[0] && cb(i.files[0]); i.click(); }
function addLib(kind, at) {
  if (kind.startsWith("field:")) {
    const k = kind.slice(6);
    if (ST.editing) return insertFieldAtCaret(k);
    const e = makeEl("field", ST.doc); e.props.html = `{{${k}}}`; e.name = FIELDS.find(f => f[0] === k)[1]; addElement(e, { at }); return;
  }
  addKind(kind, at);
}
function insertFieldAtCaret(k) {
  if (!ST.editing) { const e = selEls()[0]; if (e && e.type === "text") { e.props.html += ` {{${k}}}`; commit("field"); renderStage(); renderNavSoon(); } return; }
  document.execCommand("insertText", false, `{{${k}}}`); fitTextHeight(ST.editing);
}
async function applyTpl(key, how) {
  let pages, period = null;
  try {
    if (key.startsWith("b:")) { const tmp = clone(ST.doc); applyBuiltin(tmp, key.slice(2)); pages = tmp.pages; period = tmp.period; }
    else { const d = await fetchDoc(key.slice(2)); pages = d.pages; pages.forEach(p => { p.id = uid("p"); p.elements.forEach(e => e.id = uid()); }); }
  } catch (e) { return toast(e.message, 5000, true); }
  if (how === "replace") { ST.doc.pages = pages; ST.page = 0; if (period && !ST.doc.period) ST.doc.period = period; }
  else { ST.doc.pages.push(...pages); ST.page = ST.doc.pages.length - pages.length; }
  ST.sel = []; commit("template"); await ensureData(ST.doc); renderAll(); toast(how === "replace" ? "Template applied (Ctrl+Z to undo)" : `${pages.length} page${pages.length > 1 ? "s" : ""} added`);
}
function renamePage(i) { const n = prompt("Page name", ST.doc.pages[i].name); if (n && n.trim()) { ST.doc.pages[i].name = n.trim().slice(0, 60); commit("rename"); renderNav(); renderStage(); renderRight(); } }
function pageMenu(i, anchor) {
  const m = $q("#rb-pmenu"), r = anchor.getBoundingClientRect();
  m.innerHTML = [["rename", "Rename"], ["dup", "Duplicate"], ["up", "Move up"], ["down", "Move down"], ["portrait", "Portrait"], ["landscape", "Landscape"], ["del", "Delete page"]].map(([k, l]) => `<button type="button" data-pm="${k}">${l}</button>`).join("");
  m.hidden = false; m.style.left = r.right + 6 + "px"; m.style.top = Math.min(innerHeight - 260, r.top) + "px";
  const close = () => { m.hidden = true; document.removeEventListener("pointerdown", out, true); };
  const out = ev => { if (!m.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener("pointerdown", out, true));
  m.onclick = ev => { const b = ev.target.closest("[data-pm]"); if (!b) return; close(); const k = b.dataset.pm;
    if (k === "rename") renamePage(i); if (k === "dup") insertPage(i + 1, ST.doc.pages[i]); if (k === "del") deletePage(i);
    if (k === "up" && i > 0) movePage(i, i - 1); if (k === "down" && i < ST.doc.pages.length - 1) movePage(i, i + 1);
    if (k === "portrait" || k === "landscape") { ST.doc.pages[i].orientation = k; ST.page = i; commit("orientation"); if (ST.fit) ST.zoom = fitZoom(); renderAll(); } };
}

/* ----- field edits in the right panel ----- */
function onField(ev, final) {
  const t = ev.target, doc = ST.doc;
  let v = t.type === "checkbox" ? t.checked : t.value;
  if (t.type === "number" || t.type === "range") v = t.value === "" ? (t.dataset.k && /override/.test(t.dataset.k) ? "" : 0) : +t.value;
  if (t.type === "range" && t.nextElementSibling) t.nextElementSibling.textContent = t.value;
  if (t.classList.contains("hex") && v && !/^#[0-9a-f]{3,8}$/i.test(v) && v !== "transparent") { if (final) toast("Use a colour like #6739F5", 2500, true); return; }
  if (t.type === "color") { const hx = t.parentElement.querySelector(".hex"); if (hx) hx.value = v; }
  if (t.dataset.k) {
    const els = selEls(); if (!els.length) return;
    els.forEach(e => { if (e.locked && /^(x|y|w|h)$/.test(t.dataset.k)) return; setPath(e, t.dataset.k, v); });
    if (t.dataset.k.startsWith("props.font") && v) loadGoogleFont(v);
    if (t.dataset.k.startsWith("props.cfg")) { const e = els[0]; if (t.dataset.k === "props.cfg.brand") ensureData(doc).then(() => { renderStage(); renderNavSoon(); }); }
    renderStage(); renderNavSoon();
    if (final) { commit("edit"); if (/cfg\.(mode|source|basis|period|brand)|ratio/.test(t.dataset.k)) renderRight(); }
    return;
  }
  if (t.dataset.pg) { setPath(curPage(), t.dataset.pg, v); renderStage(); renderNavSoon(); if (final) { commit("page"); if (t.dataset.pg === "orientation" && ST.fit) { ST.zoom = fitZoom(); renderStage(); } if (t.dataset.pg === "name") renderNav(); } return; }
  if (t.dataset.d) {
    setPath(doc, t.dataset.d, v);
    if (t.dataset.d === "header.firstPage" && v === "custom" && !doc.header.first) doc.header.first = { text: doc.header.text, height: doc.header.height + 40, bg: doc.header.bg };
    if (t.dataset.d === "theme.font") loadGoogleFont(v);
    if (t.dataset.d === "compare") MODELS.clear();
    renderStage(); renderNavSoon();
    if (final) { commit("report"); if (/firstPage|page\.|compare|name/.test(t.dataset.d)) { if (ST.fit) ST.zoom = fitZoom(); renderTop(); renderStage(); renderRight(); } }
    return;
  }
  const act = t.dataset.act;
  if (act === "hlevel" && final) { const L = { h1: [32, 700], h2: [24, 700], h3: [18, 600], body: [13, 400], small: [11, 400] }[v]; selEls().forEach(e => { e.props.size = L[0]; e.props.weight = L[1]; }); commit("level"); renderStage(); renderRight(); }
  if (act === "fieldsel" && final && v) { insertFieldAtCaret(v); t.value = ""; }
  if (act === "ratio" && final) { const e = selEls()[0]; e.props.ratio = v; if (v !== "free") { const [a, b] = v.split(":").map(Number); e.h = Math.round(e.w * b / a); } commit("ratio"); renderStage(); renderRight(); }
  if (act === "ytpick" && final && v) { const e = selEls()[0]; e.props.url = "https://www.youtube.com/watch?v=" + v; e.props.thumb = ""; e.props.title = t.options[t.selectedIndex].text; commit("video"); renderStage(); renderRight(); }
  if (act === "tmetric" && final) { const e = selEls()[0]; e.props.cfg.metrics = $qa('[data-act="tmetric"]:checked', $q("#rb-right")).map(x => x.value); commit("columns"); renderStage(); }
  if (act === "wperiod" && final) { const e = selEls()[0]; e.props.cfg.period = v === "report" ? null : v === "custom" ? { preset: "custom", from: rbPeriod(doc).from, to: rbPeriod(doc).to } : { preset: v }; commit("period"); renderStage(); renderRight(); }
  if ((act === "wfrom" || act === "wto") && final) { const e = selEls()[0], p = e.props.cfg.period; p[act === "wfrom" ? "from" : "to"] = v; commit("period"); renderStage(); }
  if (act === "lockchk" && final) { selEls().forEach(e => e.locked = v); commit("lock"); renderStage(); }
  if (act === "hidechk" && final) { selEls().forEach(e => e.hidden = v); commit("hide"); renderStage(); renderNavSoon(); }
  if (act === "snapchk") ST.snap = v;
  if (act === "gridchk") { ST.showGrid = v; renderStage(); }
  if (act === "gridsize" && final) { ST.grid = clamp(+v || 0, 0, 64); renderStage(); }
  if (t.dataset.hfpage != null && final) { const i = +t.dataset.hfpage; doc.pages[i].header = v ? "show" : "hide"; doc.pages[i].footer = v ? "show" : "hide"; commit("hf pages"); renderStage(); renderNavSoon(); }
}

/* ----- actions ----- */
async function doAct(a, btn) {
  const doc = ST.doc;
  if (a.startsWith("fmt:")) return execFmt(a.slice(4));
  if (a.startsWith("fmtall:")) { if (!ST.editing) { const e = selEls()[0]; if (e && e.type === "text") { startEdit(e.id); setTimeout(() => { document.execCommand("selectAll"); execFmt(a.slice(7)); }, 30); } return; } return execFmt(a.slice(7)); }
  if (a.startsWith("prev:")) { ST.pmode = a.slice(5); await saveDoc(true); location.hash = `builder-${ST.rid}-preview`; return; }
  if (a.startsWith("exp:")) { $q("#rb-genmenu").hidden = true; try { await exportReport(a.slice(4)); } catch (e) { toast(e.message || String(e), 7000, true); } return; }
  switch (a) {
    case "undo": return undo();
    case "redo": return redo();
    case "zin": ST.fit = false; ST.zoom = clamp(Math.round((ST.zoom + .1) * 10) / 10, .25, 3); renderStage(); return renderTop();
    case "zout": ST.fit = false; ST.zoom = clamp(Math.round((ST.zoom - .1) * 10) / 10, .25, 3); renderStage(); return renderTop();
    case "save": { const ok = await saveDoc(true); toast(ok ? "Draft saved" : "Could not save: " + ST.saveErr, ok ? 2500 : 6000, !ok); return; }
    case "savetpl": return saveAsTemplate();
    case "generate": { const ok = await saveDoc(true); if (ok) { ST.pmode = "desktop"; location.hash = `builder-${ST.rid}-preview`; } else toast("Could not save: " + ST.saveErr, 6000, true); return; }
    case "genmenu": { const m = $q("#rb-genmenu"); m.hidden = !m.hidden; return; }
    case "edit": { const e = selEls()[0]; if (e) startEdit(e.id); return; }
    case "done": return finishEdit();
    case "link": { const u = prompt("Link address (https://…)", "https://"); if (!u || !/^(https?:|mailto:)/i.test(u)) return; if (ST.editing) execFmt("createLink", u); else { selEls().forEach(e => e.link = u); commit("link"); renderRight(); } return; }
    case "replace": { const e = selEls()[0]; if (e) pickFile(e.type === "video" ? "video" : "image", f => uploadInto(e.id, f)); return; }
    case "upvideo": { const e = selEls()[0]; if (e) pickFile("video", f => uploadInto(e.id, f)); return; }
    case "upthumb": { const e = selEls()[0]; if (e) pickFile("image", async f => { toast("Uploading thumbnail…", 30000); try { const r = await uploadFile(f); e.props.thumb = r.src; commit("thumb"); renderStage(); renderRight(); toast("Thumbnail updated"); } catch (err) { toast(err.message, 6000, true); } }); return; }
    case "clearvideo": { const e = selEls()[0]; if (e) { e.props.src = ""; commit("video"); renderRight(); } return; }
    case "brandlogo": { const e = selEls()[0], b = SMA.brands.find(x => x.id === doc.brand); if (e && b) { e.props.src = logoUrl(b); e.props.fit = "contain"; commit("logo"); renderStage(); renderRight(); } return; }
    case "data": ST.etab = "content"; renderRight(); return openDrawer("right");
    case "dup": return dupSel();
    case "copy": return copySel();
    case "del": return delSel();
    case "front": return layer("up");
    case "back": return layer("down");
    case "group": return groupSel(true);
    case "ungroup": return groupSel(false);
    case "lock": return lockSel();
    case "alignmenu": ST.etab = "layout"; renderRight(); return openDrawer("right");
    case "overflow": return moveOverflow();
    case "addpage": return insertPage(ST.page + 1);
    case "duppage": return insertPage(ST.page + 1, curPage());
    case "delpage": if (btn.dataset.arm !== "1") { btn.dataset.arm = "1"; btn.textContent = "Click again to delete"; return; } return deletePage(ST.page);
    case "pgbg": return pickFile("image", async f => { toast("Uploading…", 30000); try { const r = await uploadFile(f); curPage().bgImage = r.src; commit("bg"); renderStage(); renderNavSoon(); renderRight(); toast("Background set"); } catch (e) { toast(e.message, 6000, true); } });
    case "pgbgclear": curPage().bgImage = ""; commit("bg"); renderStage(); renderNavSoon(); return renderRight();
    case "hfall": doc.pages.forEach(p => { p.header = "inherit"; p.footer = "inherit"; }); commit("hf"); renderStage(); renderNavSoon(); return renderRight();
    case "mvpage": case "cppage": { const s = $q("#rb-mvpage"); if (s) moveToPage(+s.value, a === "cppage"); return; }
  }
}

/* ----- keyboard ----- */
function onKey(ev) {
  if (!ST || ST.step !== 2 || current() !== "builder" || !$q("#rb-stage-host")) return;
  const t = ev.target, typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
  if (ev.key === "Escape") { if (ST.editing) finishEdit(); else if (ST.sel.length) { ST.sel = []; drawOverlay(); renderRight(); } closeDrawers(); return; }
  if (mod && k === "s") { ev.preventDefault(); doAct("save"); return; }
  if (typing) return;
  if (mod && k === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
  if (mod && (k === "y" || (k === "z" && ev.shiftKey))) { ev.preventDefault(); redo(); return; }
  if (mod && k === "c") { copySel(); return; }
  if (mod && k === "x") { copySel(true); return; }
  if (mod && k === "v") { ev.preventDefault(); paste(); return; }
  if (mod && k === "d") { ev.preventDefault(); dupSel(); return; }
  if (mod && k === "a") { ev.preventDefault(); ST.sel = curPage().elements.map(e => e.id); drawOverlay(); renderRight(); return; }
  if (mod && k === "g") { ev.preventDefault(); groupSel(!ev.shiftKey); return; }
  if (k === "delete" || k === "backspace") { if (ST.sel.length) { ev.preventDefault(); delSel(); } return; }
  if (k === "enter" && ST.sel.length === 1) { const e = selEls()[0]; if (e.type === "text") { ev.preventDefault(); startEdit(e.id); } return; }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k] && ST.sel.length) { ev.preventDefault(); const s = ev.shiftKey ? 10 : 1; nudge(arrows[k][0] * s, arrows[k][1] * s); }
}

window.addEventListener("beforeunload", ev => { if (ST && ST.dirty) { saveDoc(); ev.preventDefault(); ev.returnValue = ""; } });
window.RBX = { render: rbRender };

})();

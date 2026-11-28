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

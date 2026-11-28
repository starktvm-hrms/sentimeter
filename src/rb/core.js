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

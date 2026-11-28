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

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

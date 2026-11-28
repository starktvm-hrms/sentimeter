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

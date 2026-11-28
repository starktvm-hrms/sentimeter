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
/* ----- selectable text: an invisible text layer placed exactly over the page picture (like a searchable scan) ----- */
/* Fonts for the invisible text layer, one per script: Latin/Greek/Cyrillic, Kannada, Malayalam (loaded only when needed). */
/* One font per script; each loads only when a report uses that script.
   ranges: the script's own characters. Danda (U+0964/5) and the joiners stay with the word's script. */
const PDF_FONTS = {
  lat: { file: "NotoSans-ReportText.ttf", ranges: [] },
  kn: { file: "NotoSansKannada-ReportText.ttf", ranges: [[0x0C80, 0x0CFF]] },
  ml: { file: "NotoSansMalayalam-ReportText.ttf", ranges: [[0x0D00, 0x0D7F]] },
  deva: { file: "NotoSansDevanagari-ReportText.ttf", ranges: [[0x0900, 0x0963], [0x0966, 0x097F], [0xA8E0, 0xA8FF], [0x1CD0, 0x1CFF]] },
  beng: { file: "NotoSansBengali-ReportText.ttf", ranges: [[0x0980, 0x09FF]] },
  guru: { file: "NotoSansGurmukhi-ReportText.ttf", ranges: [[0x0A00, 0x0A7F]] },
  gujr: { file: "NotoSansGujarati-ReportText.ttf", ranges: [[0x0A80, 0x0AFF]] },
  orya: { file: "NotoSansOriya-ReportText.ttf", ranges: [[0x0B00, 0x0B7F]] },
  taml: { file: "NotoSansTamil-ReportText.ttf", ranges: [[0x0B80, 0x0BFF], [0x11FC0, 0x11FFF]] },
  telu: { file: "NotoSansTelugu-ReportText.ttf", ranges: [[0x0C00, 0x0C7F]] },
  arab: { file: "NotoSansArabic-ReportText.ttf", ranges: [[0x0600, 0x06FF], [0x0750, 0x077F], [0x08A0, 0x08FF], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF]], rtl: true },
  olck: { file: "NotoSansOlChiki-ReportText.ttf", ranges: [[0x1C50, 0x1C7F]] },
  mtei: { file: "NotoSansMeeteiMayek-ReportText.ttf", ranges: [[0xABC0, 0xABFF], [0xAAE0, 0xAAFF]] }
};
Object.entries(PDF_FONTS).forEach(([k, F]) => { F.name = "RT_" + k; });
const LAT_KEEP = /[ -~ -ɏ̀-ͯͰ-ϿЀ-ӿḀ-ỿ -⁯₠-⃏℀-⅏←-⇿−∕∞≈≠≤≥■-◿✓✗]/;
const NEUTRAL = new Set([0x200C, 0x200D, 0x0964, 0x0965]);
function scriptOf(ch) {
  const c = ch.codePointAt(0);
  if (NEUTRAL.has(c)) return "";
  if (c < 0x0600) return "lat";
  for (const k in PDF_FONTS) if (PDF_FONTS[k].ranges.some(([a, b]) => c >= a && c <= b)) return k;
  return "lat";
}
const keepChar = (k, ch) => k === "lat" ? LAT_KEEP.test(ch) : (NEUTRAL.has(ch.codePointAt(0)) && k !== "arab" && k !== "olck" && k !== "mtei") || scriptOf(ch) === k;
const FONT_DATA = {};
function fontData(k) {
  if (!FONT_DATA[k]) FONT_DATA[k] = fetch("vendor/" + PDF_FONTS[k].file, { cache: "force-cache" }).then(r => { if (!r.ok) throw new Error("font " + r.status); return r.arrayBuffer(); })
    .then(buf => { const u = new Uint8Array(buf); let bin = ""; for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(bin); })
    .catch(e => { delete FONT_DATA[k]; throw e; });
  return FONT_DATA[k];
}
async function pdfFonts(text) {   // the fonts this document needs, loaded in parallel
  const need = new Set(["lat"]);
  for (const ch of text) { const k = scriptOf(ch); if (k && k !== "lat") need.add(k); }
  const out = {};
  await Promise.all([...need].map(k => fontData(k).then(d => out[k] = d).catch(e => console.warn("PDF text layer font", k, e))));
  return out;
}
function segments(word) {   // split a word into runs of one script; joiners stay with the run they are in
  const out = []; let cur = null, i = 0;
  for (const ch of word) {
    const sc = scriptOf(ch);
    if (!cur || (sc && cur.sc && sc !== cur.sc)) { cur = { sc, s: i, e: i }; out.push(cur); }
    else if (sc && !cur.sc) cur.sc = sc;
    cur.e = i + ch.length; i += ch.length;
  }
  out.forEach(sg => { if (!sg.sc) sg.sc = "deva"; });   // a lone danda or joiner
  return out;
}
function textRuns(pageNode) {
  const pr = pageNode.getBoundingClientRect(), runs = [];
  const tw = document.createTreeWalker(pageNode, NodeFilter.SHOW_TEXT, { acceptNode: n => /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const range = document.createRange();
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const host = n.parentElement; if (!host || host.closest(".rb-spacer,.rb-ov")) continue;
    const cs = getComputedStyle(host); if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
    const clip = (host.closest(".rb-el") || pageNode).getBoundingClientRect();
    const re = /\S+/g; let m, line = null;
    const flush = () => { if (line) runs.push(line); line = null; };
    while ((m = re.exec(n.nodeValue))) {
      segments(m[0]).forEach((sg, si) => {
        range.setStart(n, m.index + sg.s); range.setEnd(n, m.index + sg.e);
        const rects = [...range.getClientRects()].filter(x => x.width > 0 && x.height > 0); if (!rects.length) return;
        const r = { left: Math.min(...rects.map(x => x.left)), right: Math.max(...rects.map(x => x.right)), top: Math.min(...rects.map(x => x.top)), bottom: Math.max(...rects.map(x => x.bottom)) };
        r.height = r.bottom - r.top;
        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, txt = m[0].slice(sg.s, sg.e);
        if (cx < clip.left || cx > clip.right || cy < clip.top || cy > clip.bottom || cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) { flush(); return; }   // clipped away on the page
        if (line && line.sc === sg.sc && (sg.sc === "lat" || si > 0) && Math.abs(r.top - line.t0) < r.height * .5 && r.left >= line.r - 2) {   // Indian-script fonts have no space glyph: one run per word
          line.text += (si === 0 ? " " : "") + txt; line.r = Math.max(line.r, r.right); line.b = Math.max(line.b, r.bottom);
        } else { flush(); line = { sc: sg.sc, text: txt, l: r.left - pr.left, t: r.top - pr.top, t0: r.top, r: r.right, b: r.bottom }; }
        line.R = line.r - pr.left; line.B = line.b - pr.top;
      });
    }
    flush();
  }
  return { runs, w: pr.width };
}
function addTextLayer(pdf, pageNode, wmm, have) {
  const { runs, w } = textRuns(pageNode), k = wmm / w;   // px -> mm
  let n = 0;
  runs.forEach(rn => {
    const F = PDF_FONTS[rn.sc]; if (!F || !have[rn.sc]) return;
    const text = [...rn.text].filter(ch => keepChar(rn.sc, ch)).join("").trim(); if (!text) return;
    const hmm = (rn.B - rn.t) * k, widthMM = (rn.R - rn.l) * k;
    pdf.setFont(F.name, "normal");
    pdf.setFontSize(Math.max(2, hmm / 25.4 * 72 * (rn.sc === "lat" ? .78 : .62)));
    let natural;
    if (F.rtl) { const api = window.jspdf.jsPDF.API, pa = api.processArabic; api.processArabic = null; try { natural = pdf.getTextWidth(text); } finally { api.processArabic = pa; } }   // measure unshaped, as written
    else natural = pdf.getTextWidth(text);
    const hs = natural > 0 ? Math.max(.2, Math.min(5, widthMM / natural)) : 1;
    pdf.text(text, rn.l * k, rn.t * k + hmm * (rn.sc === "lat" ? .78 : .7), { renderingMode: "invisible", horizontalScale: hs, baseline: "alphabetic" });
    n++;
  });
  return n;
}

/* jsPDF reshapes Arabic into presentation forms, which copy and search as odd characters. The text layer is invisible,
   so shaping isn't needed: create the document without that hook (right-to-left ordering stays). */
function newPdfNoShaping(jsPDF, opts) {
  const ev = (jsPDF.API && jsPDF.API.events) || [];
  const i = ev.findIndex(e => e[0] === "preProcessText" && e[1] === jsPDF.API.processArabic);
  const removed = i >= 0 ? ev.splice(i, 1)[0] : null;
  try { return new jsPDF(opts); } finally { if (removed) ev.splice(i, 0, removed); }
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
      const fonts = await pdfFonts(host.textContent);
      for (const i of only) {
        progress(`Creating PDF page ${i + 1} of ${nodes.length}…`);
        const [wmm, hmm] = pageMM(doc, doc.pages[i]), cv = await pageCanvas(nodes[i], scale);
        const o = wmm > hmm ? "landscape" : "portrait";
        if (!pdf) { pdf = newPdfNoShaping(jsPDF, { orientation: o, unit: "mm", format: [wmm, hmm], compress: true }); Object.entries(fonts).forEach(([fk, data]) => { const F = PDF_FONTS[fk]; pdf.addFileToVFS(F.file, data); pdf.addFont(F.file, F.name, "normal"); }); }
        else pdf.addPage([wmm, hmm], o);
        pdf.addImage(cv.toDataURL("image/jpeg", opts.hi ? .95 : .9), "JPEG", 0, 0, wmm, hmm, undefined, "FAST");
        if (fonts.lat) addTextLayer(pdf, nodes[i], wmm, fonts);
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

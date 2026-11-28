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

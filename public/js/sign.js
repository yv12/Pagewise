// Pagewise - Sign original PDF with visual signature, date, and text
const [,, key,, docId] = window.location.pathname.split('/');
if (!key || !docId) window.location.href = '/';
document.getElementById('backLink').href = `/w/${key}`;
let originalBytes = null, currentDoc = null, activePage = 1, items = [], hasUnsaved = false;
window.addEventListener('beforeunload', e => { if (hasUnsaved) { e.preventDefault(); e.returnValue = ''; } });
const pdfViewer = document.getElementById('pdfViewer');
const [signStatus, savedBadge, dlSavedBtn, downloadBtn] = ['signStatus', 'savedBadge', 'dlSavedBtn', 'downloadBtn'].map(id => document.getElementById(id));

async function init() {
  try {
    const res = await fetch(`/api/w/${key}/docs/${docId}`);
    if (!res.ok) throw new Error('Document not found');
    currentDoc = await res.json();
    document.getElementById('docTitle').textContent = currentDoc.title || 'Untitled';
    if (currentDoc.has_signed_copy && currentDoc.signed_file_id) {
      savedBadge.style.display = 'inline-block';
      dlSavedBtn.style.display = 'inline-flex';
      dlSavedBtn.href = `/api/w/${key}/files/${currentDoc.signed_file_id}`;
    }
    const fileRes = await fetch(`/api/w/${key}/files/${currentDoc.original_file_id}`);
    if (!fileRes.ok) throw new Error('Could not download original PDF');
    originalBytes = await fileRes.arrayBuffer();
    await renderPdf(originalBytes);
  } catch (err) {
    document.getElementById('loadingText').textContent = err.message || 'Could not load PDF.';
  }
}

async function renderPdf(data) {
  if (!window.pdfjsLib) throw new Error('Could not load the PDF tools. Refresh the page.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  pdfViewer.innerHTML = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1.5 });
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page-wrapper'; wrap.dataset.page = p;
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas'; canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const ov = document.createElement('div');
    ov.className = 'page-overlay'; ov.dataset.page = p;
    wrap.append(canvas, ov);
    pdfViewer.appendChild(wrap);
    wrap.addEventListener('pointerenter', () => { activePage = p; });
  }
}

function addItem(type, content, w = 0.25, h = 0.08) {
  const p = activePage || 1;
  const overlay = document.querySelector(`.page-overlay[data-page="${p}"]`);
  if (!overlay) return;
  const item = { id: 'it_' + Date.now() + Math.random().toString(36).slice(2, 5), pageNum: p, type, content, x: 0.35, y: 0.45, width: w, height: h };
  items.push(item);
  hasUnsaved = true;

  const el = document.createElement('div');
  el.className = 'placed-item';
  const sync = () => Object.assign(el.style, { left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` });
  sync();

  const del = document.createElement('button');
  del.className = 'item-delete-btn'; del.innerHTML = '&times;';
  del.onclick = e => { e.stopPropagation(); items = items.filter(i => i.id !== item.id); el.remove(); };

  const resizer = document.createElement('div');
  resizer.className = 'resize-handle';
  resizer.onpointerdown = e => {
    e.stopPropagation(); e.preventDefault(); resizer.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, sw = item.width, sh = item.height, rect = overlay.getBoundingClientRect();
    resizer.onpointermove = ev => {
      item.width = Math.max(0.06, Math.min(1 - item.x, sw + (ev.clientX - sx) / rect.width));
      item.height = Math.max(0.02, Math.min(1 - item.y, sh + (ev.clientY - sy) / rect.height));
      sync(); hasUnsaved = true;
    };
    resizer.onpointerup = ev => { resizer.onpointermove = null; resizer.onpointerup = null; resizer.releasePointerCapture(ev.pointerId); };
  };
  el.append(del, resizer);
  if (type === 'signature') {
    const img = document.createElement('img');
    img.src = content; img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;';
    el.appendChild(img);
  } else {
    const ta = document.createElement('textarea');
    ta.className = 'item-content-text'; ta.value = content;
    ta.oninput = () => { item.content = ta.value; hasUnsaved = true; };
    el.appendChild(ta);
  }

  el.onpointerdown = e => {
    if (e.target.closest('.item-delete-btn,.resize-handle,textarea')) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ox = item.x, oy = item.y, rect = overlay.getBoundingClientRect();
    el.onpointermove = ev => {
      item.x = Math.max(0, Math.min(1 - item.width, ox + (ev.clientX - sx) / rect.width));
      item.y = Math.max(0, Math.min(1 - item.height, oy + (ev.clientY - sy) / rect.height));
      sync(); hasUnsaved = true;
    };
    el.onpointerup = ev => { el.onpointermove = null; el.onpointerup = null; el.releasePointerCapture(ev.pointerId); };
  };
  overlay.appendChild(el);
}

const [sigModal, useSigBtn, useSavedBtn, dCan, tInp, tPrev, fInp, rmBg, pImg, uHint] =
  ['sigModal', 'useSigBtn', 'useSavedBtn', 'drawCanvas', 'typeInput', 'typePreview', 'sigFileInput', 'removeBgCheck', 'uploadPreviewImg', 'uploadHint']
  .map(id => document.getElementById(id));
const dCtx = dCan.getContext('2d');
let curTab = 'draw', hasDrawn = false, upData = null, drawing = false;

function checkSavedSig() { useSavedBtn.style.display = localStorage.getItem('pagewise_last_sig') ? 'inline-block' : 'none'; }
function updateUseBtn() {
  useSigBtn.disabled = curTab === 'draw' ? !hasDrawn : (curTab === 'type' ? !tInp.value.trim() : !upData);
}

document.querySelectorAll('.modal-tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.toggle('active', t === b));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${b.dataset.tab}`));
  curTab = b.dataset.tab; updateUseBtn();
});

dCan.onpointerdown = e => {
  e.preventDefault(); drawing = true; hasDrawn = true; dCan.setPointerCapture(e.pointerId);
  const r = dCan.getBoundingClientRect();
  dCtx.beginPath(); dCtx.lineWidth = 2.5; dCtx.lineCap = 'round'; dCtx.strokeStyle = '#0f172a';
  dCtx.moveTo(e.clientX - r.left, e.clientY - r.top); updateUseBtn();
};
dCan.onpointermove = e => {
  if (!drawing) return; e.preventDefault();
  const r = dCan.getBoundingClientRect(); dCtx.lineTo(e.clientX - r.left, e.clientY - r.top); dCtx.stroke();
};
dCan.onpointerup = () => { drawing = false; };
dCan.onpointercancel = () => { drawing = false; };
document.getElementById('clearDrawBtn').onclick = () => { dCtx.clearRect(0, 0, dCan.width, dCan.height); hasDrawn = false; updateUseBtn(); };
tInp.oninput = () => { tPrev.textContent = tInp.value.trim() || 'Preview'; updateUseBtn(); };

fInp.onchange = () => {
  const f = fInp.files[0];
  if (!f || !f.type.match(/^image\/(png|jpe?g)$/i) && !f.name.match(/\.(png|jpe?g)$/i)) return alert('Please upload a PNG or JPG file.');
  const fr = new FileReader();
  fr.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'), sc = img.width > 600 ? 600 / img.width : 1;
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, c.width, c.height);
      if (rmBg.checked) {
        const idat = cx.getImageData(0, 0, c.width, c.height), d = idat.data;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215) d[i + 3] = 0;
        cx.putImageData(idat, 0, 0);
      }
      upData = c.toDataURL('image/png');
      pImg.src = upData; pImg.style.display = 'block'; uHint.style.display = 'none'; updateUseBtn();
    };
    img.src = ev.target.result;
  };
  fr.readAsDataURL(f);
};

const openModal = () => { sigModal.style.display = 'flex'; checkSavedSig(); updateUseBtn(); };
const closeModal = () => { sigModal.style.display = 'none'; };
document.getElementById('closeModalBtn').onclick = closeModal;
document.getElementById('cancelSigBtn').onclick = closeModal;

useSavedBtn.onclick = () => {
  const s = localStorage.getItem('pagewise_last_sig');
  if (s) { addItem('signature', s); closeModal(); }
};

useSigBtn.onclick = async () => {
  let url = curTab === 'draw' ? dCan.toDataURL('image/png') : (curTab === 'upload' ? upData : null);
  if (curTab === 'type') {
    await document.fonts.ready;
    const c = document.createElement('canvas'); c.width = 500; c.height = 160;
    const cx = c.getContext('2d'); cx.font = '54px "Caveat", cursive'; cx.fillStyle = '#0f172a';
    cx.fillText(tInp.value.trim(), 20, 100); url = c.toDataURL('image/png');
  }
  if (url) { localStorage.setItem('pagewise_last_sig', url); addItem('signature', url); closeModal(); }
};

document.getElementById('addSigBtn').onclick = openModal;
document.getElementById('addDateBtn').onclick = () => addItem('date', new Date().toISOString().slice(0, 10), 0.18, 0.04);
document.getElementById('addTextBtn').onclick = () => addItem('text', 'Enter text', 0.22, 0.05);

downloadBtn.onclick = async () => {
  if (items.length === 0) return alert('Please add a signature, date, or text before downloading.');
  downloadBtn.disabled = true; signStatus.textContent = 'Generating PDF...';
  try {
    const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
    let pdfDoc;
    try { pdfDoc = await PDFDocument.load(originalBytes); }
    catch { downloadBtn.disabled = false; signStatus.textContent = ''; return alert('This PDF does not allow changes.'); }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    for (const it of items) {
      const page = pdfDoc.getPages()[it.pageNum - 1];
      if (!page) continue;
      const { width: W, height: H } = page.getSize();
      const rot = (page.getRotation().angle % 360 + 360) % 360;
      const isSideways = rot === 90 || rot === 270;
      const Vw = isSideways ? H : W, Vh = isSideways ? W : H;
      const vx = it.x * Vw, vy = it.y * Vh, vw = it.width * Vw, vh = it.height * Vh;

      let px, py, pAngle;
      if (rot === 0) { px = vx; py = H - vy - vh; pAngle = 0; }
      else if (rot === 90) { px = vy; py = vx + vw; pAngle = -90; }
      else if (rot === 180) { px = W - vx; py = vy; pAngle = 180; }
      else if (rot === 270) { px = W - vy; py = H - vx - vw; pAngle = 90; }

      if (it.type === 'signature') {
        const pngBuf = await fetch(it.content).then(r => r.arrayBuffer());
        const pngImg = await pdfDoc.embedPng(pngBuf);
        page.drawImage(pngImg, { x: px, y: py, width: vw, height: vh, rotate: degrees(pAngle) });
      } else {
        const sz = Math.max(9, Math.round(vh * 0.7));
        const ty = rot === 0 ? py + Math.round(vh * 0.2) : py;
        page.drawText(it.content || '', { x: px, y: ty, size: sz, font, color: rgb(0, 0, 0), rotate: degrees(pAngle) });
      }
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob), fname = `signed-${currentDoc?.title || 'document'}.pdf`;
    const a = document.createElement('a'); a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    try {
      const upRes = await fetch(`/api/w/${key}/docs/${docId}/signed`, {
        method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-filename': fname }, body: blob
      });
      if (upRes.ok) {
        const d = await upRes.json();
        hasUnsaved = false;
        signStatus.textContent = 'Signed copy saved';
        savedBadge.style.display = 'inline-block';
        dlSavedBtn.style.display = 'inline-flex';
        dlSavedBtn.href = `/api/w/${key}/files/${d.file_id}`;
      } else { signStatus.textContent = 'Saved on your device only.'; }
    } catch { signStatus.textContent = 'Saved on your device only.'; }
  } catch (err) {
    alert(err.message || 'Failed to sign document.'); signStatus.textContent = '';
  } finally { downloadBtn.disabled = false; }
};

init();

// Browser Editor Logic
import { copyToClipboard } from '/js/common.js';

const parts = window.location.pathname.split('/');
// Path is /w/:key/d/:id
const key = parts[2] ? parts[2].trim() : '';
const docId = parts[4] ? parts[4].trim() : '';

const titleInput = document.getElementById('docTitle');
const saveStatus = document.getElementById('saveStatus');
const editor = document.getElementById('editor');
const backLink = document.getElementById('backLink');
const conflictBanner = document.getElementById('conflictBanner');
const pdfNoticeBanner = document.getElementById('pdfNoticeBanner');
const reloadLatestBtn = document.getElementById('reloadLatestBtn');
const overwriteBtn = document.getElementById('overwriteBtn');
const copyShareBtn = document.getElementById('copyShareBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const printHint = document.getElementById('printHint');

let currentVersion = 0;
let saveTimer = null;
let retryTimer = null;
let isDirty = false;
let isSaving = false;

if (backLink) {
  backLink.href = `/w/${key}`;
}

// 1. Initial Load
async function loadDoc() {
  saveStatus.textContent = 'Loading...';
  try {
    const res = await fetch(`/api/w/${key}/docs/${docId}`);
    if (res.status === 404) {
      document.body.innerHTML = `
        <div class="container" style="text-align: center; margin-top: 5rem;">
          <h2>Document not found</h2>
          <p style="margin: 1rem 0 2rem; color: var(--muted);">This document does not exist or was deleted.</p>
          <a href="/w/${key}" class="button">Back to documents</a>
        </div>`;
      return;
    }
    if (!res.ok) throw new Error('Failed to load document');

    const data = await res.json();
    titleInput.value = data.title || 'Untitled';
    document.title = (data.title || 'Untitled') + ' - Pagewise';
    editor.innerHTML = data.html || '<p></p>';
    currentVersion = data.version;
    isDirty = false;
    conflictBanner.style.display = 'none';

    if (data.kind === 'pdf') {
      editor.classList.add('pdf-imported');
      editor.style.width = '595.3pt';
      editor.style.maxWidth = '595.3pt';
      editor.style.padding = '54pt';
      editor.style.fontSize = '10.5pt';
      editor.style.lineHeight = '1.2';
      editor.style.fontFamily = "'Carlito', 'Lato', Calibri, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

      // After rendering, compare the width of the longest body line with the original. If wider by > 3%, scale font size down.
      requestAnimationFrame(() => {
        const expectedMaxWidth = 595.3 - 54.1 * 2; // ~487.1 pt
        let maxLineWidth = 0;
        const paragraphs = editor.querySelectorAll('p:not(.contact-info), li');
        paragraphs.forEach(p => {
          if (p.scrollWidth > maxLineWidth) maxLineWidth = p.scrollWidth;
        });
        if (maxLineWidth > expectedMaxWidth * 1.03) {
          const scale = expectedMaxWidth / maxLineWidth;
          const newSize = Math.max(9, 10.5 * scale);
          editor.style.fontSize = newSize.toFixed(1) + 'pt';
        }
      });
    } else {
      editor.classList.remove('pdf-imported');
      editor.style.width = '';
      editor.style.maxWidth = '';
      editor.style.padding = '';
      editor.style.fontSize = '';
      editor.style.lineHeight = '';
      editor.style.fontFamily = '';
    }

    if (pdfNoticeBanner) {
      if (data.kind === 'pdf') {
        const isScanned = !data.html || data.html.trim() === '' || data.html === '<p></p>';
        if (isScanned) {
          pdfNoticeBanner.innerHTML = `
            <span><strong>Notice:</strong> This looks like a scanned PDF. Text editing is not possible. You can still sign it.</span>
            <a href="/w/${key}/s/${docId}" class="button secondary" style="font-size: 0.8rem; padding: 0.25rem 0.5rem;">Sign PDF</a>
          `;
        } else {
          pdfNoticeBanner.innerHTML = `
            <span><strong>PDF imported:</strong> Layout and images are not kept. Please check the text.</span>
            <a href="/w/${key}/s/${docId}" class="button secondary" style="font-size: 0.8rem; padding: 0.25rem 0.5rem;">Sign original</a>
          `;
        }
        pdfNoticeBanner.style.display = 'flex';
      } else {
        pdfNoticeBanner.style.display = 'none';
      }
    }

    saveStatus.textContent = 'Saved';
  } catch (err) {
    saveStatus.textContent = 'Error loading';
    console.error(err);
  }
}

// 2. Toolbar Commands (document.execCommand)
document.querySelectorAll('.editor-toolbar button').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep focus in editor
    const cmd = btn.getAttribute('data-cmd');
    const format = btn.getAttribute('data-format');

    if (cmd === 'createLink') {
      const url = prompt('Enter link URL (e.g. https://example.com):');
      if (url) document.execCommand('createLink', false, url);
    } else if (cmd) {
      document.execCommand(cmd, false, null);
    } else if (format) {
      document.execCommand('formatBlock', false, `<${format}>`);
    }
    triggerChange();
  });
});

// 3. Change Detection & Autosave (1.5s delay)
function triggerChange() {
  isDirty = true;
  saveStatus.textContent = 'Unsaved changes...';
  clearTimeout(saveTimer);
  clearTimeout(retryTimer);
  saveTimer = setTimeout(saveDoc, 1500);
}

titleInput.addEventListener('input', () => {
  document.title = (titleInput.value.trim() || 'Untitled') + ' - Pagewise';
  triggerChange();
});
editor.addEventListener('input', triggerChange);

// 4. Save Function
async function saveDoc(forceLatestVersion = false) {
  if (!isDirty && !forceLatestVersion) return;
  if (isSaving) return;

  isSaving = true;
  saveStatus.textContent = 'Saving...';

  const title = titleInput.value.trim() || 'Untitled';
  const html = editor.innerHTML;

  try {
    const res = await fetch(`/api/w/${key}/docs/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        html,
        version: currentVersion
      })
    });

    if (res.status === 409) {
      // Conflict! Document was updated elsewhere
      isSaving = false;
      const data = await res.json();
      saveStatus.textContent = 'Changed elsewhere';
      conflictBanner.style.display = 'flex';
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Save failed');
    }

    const data = await res.json();
    currentVersion = data.version;
    isDirty = false;
    isSaving = false;
    conflictBanner.style.display = 'none';
    saveStatus.textContent = 'Saved';
  } catch (err) {
    isSaving = false;
    saveStatus.textContent = 'Not saved. Retrying...';
    console.error('Autosave error:', err);
    // Retry every 5 seconds if connection dropped
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => saveDoc(forceLatestVersion), 5000);
  }
}

// 5. Conflict Resolution Buttons
reloadLatestBtn.addEventListener('click', () => {
  loadDoc();
});

overwriteBtn.addEventListener('click', async () => {
  // Fetch latest version number first to overwrite safely
  try {
    const res = await fetch(`/api/w/${key}/docs/${docId}`);
    if (res.ok) {
      const data = await res.json();
      currentVersion = data.version; // adopt latest version number to overwrite
      saveDoc(true);
    }
  } catch (err) {
    alert('Failed to connect to server');
  }
});

// 6. Share and Print Actions
if (copyShareBtn) {
  copyShareBtn.addEventListener('click', async () => {
    const shareUrl = `${window.location.origin}/p/${docId}`;
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      const origText = copyShareBtn.textContent;
      copyShareBtn.textContent = 'Copied!';
      setTimeout(() => { copyShareBtn.textContent = origText; }, 2000);
    }
  });
}

if (downloadPdfBtn) {
  downloadPdfBtn.addEventListener('click', () => {
    const isPhone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 640;
    const hint = isPhone
      ? 'Use Share, then Print, then Save as PDF.'
      : 'Choose Save as PDF. In print options, turn off Headers and footers.';
    if (printHint) {
      printHint.textContent = hint;
      printHint.style.display = 'block';
    }
    setTimeout(() => {
      window.print();
    }, 100);
  });
}

// 7. Warn before closing if unsaved changes exist
window.addEventListener('beforeunload', (e) => {
  if (isDirty || saveStatus.textContent !== 'Saved') {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Load on start
loadDoc();


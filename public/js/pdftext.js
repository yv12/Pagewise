// PDF text extraction and conversion to clean HTML

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
}

export async function extractTextFromPdf(arrayBuffer, onProgress) {
  if (!window.pdfjsLib) throw new Error('Could not load the PDF tools. Refresh the page.');

  if (typeof window !== 'undefined' && window.Worker && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const uint8 = (arrayBuffer instanceof Uint8Array)
    ? new Uint8Array(arrayBuffer.buffer, arrayBuffer.byteOffset, arrayBuffer.byteLength)
    : new Uint8Array(arrayBuffer);

  let pdf;
  try {
    const task = window.pdfjsLib.getDocument({
      data: uint8,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
    });
    pdf = await task.promise;
  } catch (err) {
    if (err && (err.name === 'PasswordException' || err.message?.includes('password'))) {
      throw new Error('This PDF is locked. Remove the password and try again.');
    }
    throw new Error('We could not read this file.');
  }

  const totalPages = pdf.numPages;
  const pagesToExtract = Math.min(totalPages, 50);
  const rawPages = [];

  for (let p = 1; p <= pagesToExtract; p++) {
    if (typeof onProgress === 'function') onProgress(p, pagesToExtract, totalPages);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    const items = [];
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = viewport.height - item.transform[5];
      const fontSize = Math.round(item.height || Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 12);
      items.push({ str: item.str, x, y, width: item.width || 0, fontSize });
    }

    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const item of items) {
      const line = lines.find(l => Math.abs(l.y - item.y) <= Math.max(3, item.fontSize * 0.35));
      if (line) line.items.push(item);
      else lines.push({ y: item.y, items: [item], page: p, height: viewport.height });
    }

    lines.sort((a, b) => a.y - b.y);
    const pageLines = [];
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      let lineText = '';
      let lastXEnd = null;
      let maxFontSize = 0;
      for (const it of line.items) {
        maxFontSize = Math.max(maxFontSize, it.fontSize);
        if (lastXEnd !== null && it.x > lastXEnd + 2 && !lineText.endsWith(' ') && !it.str.startsWith(' ')) {
          lineText += ' ';
        }
        lineText += it.str;
        lastXEnd = it.x + it.width;
      }
      const trimmed = lineText.trim();
      if (trimmed) pageLines.push({ text: trimmed, fontSize: maxFontSize, y: line.y, page: p, height: line.height });
    }
    rawPages.push(pageLines);
  }

  // Remove repeating headers and footers across pages if >= 3 pages
  if (pagesToExtract >= 3) {
    const candidateCounts = new Map();
    for (const pageLines of rawPages) {
      const topBottom = pageLines.filter(l => l.y < l.height * 0.1 || l.y > l.height * 0.9);
      const seen = new Set();
      for (const l of topBottom) {
        const norm = l.text.toLowerCase().replace(/\d+/g, '#').trim();
        if (!seen.has(norm)) {
          seen.add(norm);
          candidateCounts.set(norm, (candidateCounts.get(norm) || 0) + 1);
        }
      }
    }
    const threshold = Math.ceil(pagesToExtract * 0.5);
    for (const pageLines of rawPages) {
      for (let i = pageLines.length - 1; i >= 0; i--) {
        const l = pageLines[i];
        if (l.y < l.height * 0.1 || l.y > l.height * 0.9) {
          const norm = l.text.toLowerCase().replace(/\d+/g, '#').trim();
          if ((candidateCounts.get(norm) || 0) >= threshold) pageLines.splice(i, 1);
        }
      }
    }
  }

  const allLines = rawPages.flat();
  const fullText = allLines.map(l => l.text).join(' ');
  const isScanned = fullText.replace(/\s+/g, '').length < 50;

  if (isScanned) return { html: '', title: '', isScanned: true, pageCount: totalPages };

  const fontFreq = new Map();
  for (const l of allLines) {
    if (l.text.length > 3) fontFreq.set(l.fontSize, (fontFreq.get(l.fontSize) || 0) + 1);
  }
  let bodyFontSize = 12;
  let maxCount = 0;
  for (const [size, count] of fontFreq) {
    if (count > maxCount) {
      maxCount = count;
      bodyFontSize = size;
    }
  }

  const largerSizes = [...new Set(allLines.map(l => l.fontSize))]
    .filter(s => s >= bodyFontSize * 1.15)
    .sort((a, b) => b - a);

  const h1Threshold = largerSizes[0] || 999;
  const h2Threshold = largerSizes[1] || largerSizes[0] || 999;

  for (let i = 0; i < allLines.length - 1; i++) {
    if (allLines[i].text.endsWith('-') && allLines[i + 1].text.match(/^[a-z]/)) {
      allLines[i].text = allLines[i].text.slice(0, -1);
      allLines[i].hyphenJoined = true;
    }
  }

  const parts = [];
  let currentList = null;
  let currentPara = [];
  let extractedTitle = '';

  const flushPara = () => {
    if (currentPara.length > 0) {
      parts.push(`<p>${currentPara.join(' ')}</p>`);
      currentPara = [];
    }
  };
  const flushList = () => {
    if (currentList) {
      parts.push(`</${currentList}>`);
      currentList = null;
    }
  };

  for (let i = 0; i < allLines.length; i++) {
    const l = allLines[i];
    const bulletMatch = l.text.match(/^([•\u2022\u25cf\u25e6\u2219\*\-\–\—▪▫]|\([a-zA-Z0-9]\))\s+(.+)$/);
    const numMatch = l.text.match(/^(\d+[\.\)])\s+(.+)$/);

    if (bulletMatch || numMatch) {
      flushPara();
      const listType = bulletMatch ? 'ul' : 'ol';
      const itemText = (bulletMatch ? bulletMatch[2] : numMatch[2]).trim();
      if (currentList !== listType) {
        flushList();
        parts.push(`<${listType}>`);
        currentList = listType;
      }
      parts.push(`<li>${escapeHtml(itemText)}</li>`);
      continue;
    }

    if (l.fontSize >= h1Threshold && l.text.length < 150 && !l.text.endsWith('.')) {
      flushPara();
      flushList();
      parts.push(`<h1>${escapeHtml(l.text)}</h1>`);
      if (!extractedTitle) extractedTitle = l.text;
      continue;
    }

    if (l.fontSize >= h2Threshold && l.text.length < 150 && !l.text.endsWith('.')) {
      flushPara();
      flushList();
      parts.push(`<h2>${escapeHtml(l.text)}</h2>`);
      continue;
    }

    flushList();
    if (!extractedTitle && l.text.length < 100) extractedTitle = l.text;

    const prev = allLines[i - 1];
    const shouldBreak = prev && !prev.hyphenJoined &&
      (prev.text.endsWith('.') || prev.text.endsWith('!') || prev.text.endsWith('?')) &&
      (l.page !== prev.page || l.y - prev.y > l.fontSize * 1.8);

    if (shouldBreak) flushPara();

    if (prev && prev.hyphenJoined && currentPara.length > 0) {
      currentPara[currentPara.length - 1] += escapeHtml(l.text);
    } else {
      currentPara.push(escapeHtml(l.text));
    }
  }

  flushPara();
  flushList();

  return {
    html: parts.join('\n'),
    title: extractedTitle.slice(0, 100),
    isScanned: false,
    pageCount: totalPages
  };
}

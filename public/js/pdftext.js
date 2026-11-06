// PDF text extraction and conversion to clean HTML preserving document structure

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
}

function autoLink(html) {
  return html.replace(/(https?:\/\/[^\s<]+|(?:linkedin\.com\/in\/|github\.com\/)[^\s<]*|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9.-]+\.railway\.app[^\s<]*)/g, m => {
    const url = m.includes('@') && !m.startsWith('mailto:') ? 'mailto:' + m : (!m.startsWith('http') ? 'https://' + m : m);
    return `<a href="${url}">${m}</a>`;
  });
}

function formatLineItems(items) {
  let html = '', lastEnd = null, prevEndedHyphen = false, lastLineIdx = -1;
  for (const it of items) {
    if (!it.str && !it.width) continue;
    const isNew = it.lineIdx !== undefined && it.lineIdx !== lastLineIdx && lastLineIdx !== -1;
    if (isNew && !prevEndedHyphen && !html.endsWith(' ') && !it.str.startsWith(' ')) html += ' ';
    else if (lastEnd !== null && it.x > lastEnd + 1.5 && !html.endsWith(' ') && !it.str.startsWith(' ') && !prevEndedHyphen) html += ' ';
    let piece = escapeHtml(it.str);
    if (it.str.trim()) {
      if (it.isBold && it.isItalic) piece = `<strong><em>${piece}</em></strong>`;
      else if (it.isBold) piece = `<strong>${piece}</strong>`;
      else if (it.isItalic) piece = `<em>${piece}</em>`;
    }
    html += piece;
    prevEndedHyphen = it.str.endsWith('-');
    lastEnd = it.x + it.width;
    if (it.lineIdx !== undefined) lastLineIdx = it.lineIdx;
  }
  return autoLink(html);
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

  const totalPages = pdf.numPages, pagesToExtract = Math.min(totalPages, 50);
  const blocks = [];
  let extractedTitle = '';

  for (let p = 1; p <= pagesToExtract; p++) {
    if (typeof onProgress === 'function') onProgress(p, pagesToExtract, totalPages);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    try { await page.getOperatorList(); } catch (_) {}
    const textContent = await page.getTextContent();

    function getRealFont(fontName) {
      if (page.commonObjs && page.commonObjs.has(fontName)) {
        const obj = page.commonObjs.get(fontName);
        return obj.name || obj.loadedName || (obj.data && obj.data.name) || '';
      }
      return textContent.styles?.[fontName]?.fontFamily || '';
    }

    const rawItems = [];
    for (const it of textContent.items) {
      if (!it.str && !it.width) continue;
      const x = it.transform[4], y = viewport.height - it.transform[5], font = getRealFont(it.fontName);
      rawItems.push({
        str: it.str, x, y, width: it.width, height: it.height || 11,
        fontSize: Math.round(Math.abs(it.transform[0]) || it.height || 11),
        isBold: /bold|black|heavy|semibold/i.test(font),
        isItalic: /italic|oblique/i.test(font)
      });
    }

    rawItems.sort((a, b) => a.y - b.y || a.x - b.x);
    if (!rawItems.length) continue;

    const lines = [];
    for (const it of rawItems) {
      const line = lines.find(l => Math.abs(l.y - it.y) <= 3);
      if (line) line.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    lines.sort((a, b) => a.y - b.y);
    lines.forEach((l, idx) => l.items.forEach(it => { it.lineIdx = idx; }));

    const fontFreq = new Map();
    for (const it of rawItems) if (it.str.trim()) fontFreq.set(it.fontSize, (fontFreq.get(it.fontSize) || 0) + 1);
    let dominantFontSize = 11, maxCount = 0;
    for (const [s, c] of fontFreq) if (c > maxCount) { maxCount = c; dominantFontSize = s; }

    const gapFreq = new Map();
    for (let i = 0; i < lines.length - 1; i++) {
      const gap = Math.round((lines[i + 1].y - lines[i].y) * 10) / 10;
      if (gap > 8 && gap < 25) gapFreq.set(gap, (gapFreq.get(gap) || 0) + 1);
    }
    let dominantLineGap = 13.4, maxGapCount = 0;
    for (const [g, c] of gapFreq) if (c > maxGapCount) { maxGapCount = c; dominantLineGap = g; }

    const parsedLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      line.items.sort((a, b) => a.x - b.x);

      let splitIndex = -1, lastEnd = null;
      for (let idx = 0; idx < line.items.length; idx++) {
        const it = line.items[idx];
        if (lastEnd !== null && it.x - lastEnd > 12 && it.x > viewport.width * 0.6 && splitIndex === -1) splitIndex = idx;
        if (it.str.trim() === '' && it.width > 12 && it.x > viewport.width * 0.5 && splitIndex === -1 && idx + 1 < line.items.length) splitIndex = idx + 1;
        lastEnd = it.x + it.width;
      }

      const nonSpace = line.items.filter(it => it.str.trim() !== '');
      const minX = nonSpace[0]?.x ?? line.items[0].x;
      const lastItem = nonSpace[nonSpace.length - 1] ?? line.items[line.items.length - 1];
      const maxX = lastItem.x + lastItem.width;
      const isCentered = Math.abs((minX + maxX) / 2 - viewport.width / 2) < (viewport.width * 0.05);

      const rawText = line.items.map(it => it.str).join('').trim();
      const bulletMatch = rawText.match(/^([•\u2022\u25cf\u25e6\u2219\*\-\–\—▪▫]|\([a-zA-Z0-9]\))\s*(.*)$/);
      const isBullet = Boolean(bulletMatch);
      const isUppercase = /^[A-Z0-9\s&/,:|\-]{3,35}$/.test(rawText) && /[A-Z]/.test(rawText) && !/[a-z]/.test(rawText);
      const maxLineFontSize = Math.max(...line.items.map(it => it.fontSize));
      const isHeading = !isBullet && (maxLineFontSize >= dominantFontSize * 1.05 || isUppercase) && rawText.length < 40 && !rawText.endsWith('.');

      parsedLines.push({
        y: line.y, minX, maxX, isCentered, isSplit: splitIndex > 0,
        leftItems: splitIndex > 0 ? line.items.slice(0, splitIndex).filter(it => it.str.trim() !== '') : [],
        rightItems: splitIndex > 0 ? line.items.slice(splitIndex).filter(it => it.str.trim() !== '') : [],
        items: line.items, rawText, isBullet, isHeading
      });
    }

    let i = 0;
    if (p === 1 && parsedLines[0]?.isCentered) {
      const headerLines = [];
      while (i < parsedLines.length && parsedLines[i].y < 120 && parsedLines[i].isCentered) {
        if (parsedLines[i].rawText === 'SUMMARY' || parsedLines[i].rawText === 'EXPERIENCE') break;
        headerLines.push(parsedLines[i]);
        i++;
      }
      blocks.push({ type: 'h1', html: formatLineItems(headerLines[0].items), isCentered: true });
      if (!extractedTitle) extractedTitle = headerLines[0].rawText;

      if (headerLines.length > 1) {
        const contactItems = [];
        for (let k = 1; k < headerLines.length; k++) contactItems.push(...headerLines[k].items);
        blocks.push({ type: 'contact', html: formatLineItems(contactItems), isCentered: true });
      }
    }

    while (i < parsedLines.length) {
      const cur = parsedLines[i];
      if (cur.isHeading) {
        blocks.push({ type: 'heading', html: formatLineItems(cur.items) });
        if (!extractedTitle) extractedTitle = cur.rawText;
        i++;
        continue;
      }
      if (cur.isSplit) {
        blocks.push({ type: 'split-row', leftHtml: formatLineItems(cur.leftItems), rightHtml: formatLineItems(cur.rightItems) });
        i++;
        continue;
      }
      if (cur.isBullet) {
        const bulletItems = [...cur.items];
        let j = i + 1;
        while (j < parsedLines.length) {
          const next = parsedLines[j], gap = next.y - parsedLines[j - 1].y;
          if (!next.isBullet && !next.isHeading && !next.isSplit && next.minX > 68 && gap <= dominantLineGap * 1.25) {
            bulletItems.push(...next.items);
            j++;
          } else break;
        }
        let bulletHtml = formatLineItems(bulletItems).replace(/^([•\u2022\u25cf\u25e6\u2219\*\-\–\—▪▫]|\([a-zA-Z0-9]\))\s*/, '').trim();
        blocks.push({ type: 'bullet', html: bulletHtml });
        i = j;
        continue;
      }
      const paraItems = [...cur.items];
      let j = i + 1;
      while (j < parsedLines.length) {
        const next = parsedLines[j], prev = parsedLines[j - 1], gap = next.y - prev.y;
        const sameLeft = Math.abs(next.minX - cur.minX) < 8;
        const prevWrapped = prev.maxX > viewport.width * 0.7 || prev.rawText.endsWith('-');
        const isCat = /^[A-Z][a-zA-Z0-9\s&/]+:/.test(next.rawText.trim());
        if (!next.isBullet && !next.isHeading && !next.isSplit && sameLeft && gap <= dominantLineGap * 1.35 && prevWrapped && !isCat) {
          paraItems.push(...next.items);
          j++;
        } else break;
      }
      blocks.push({ type: 'p', html: formatLineItems(paraItems) });
      i = j;
    }
  }

  const parts = [];
  let inList = false;
  for (const b of blocks) {
    if (b.type === 'bullet') {
      if (!inList) { parts.push('<ul>'); inList = true; }
      parts.push(`  <li>${b.html}</li>`);
      continue;
    }
    if (inList) { parts.push('</ul>'); inList = false; }
    if (b.type === 'h1') parts.push(`<h1${b.isCentered ? ' style="text-align: center;"' : ''}>${b.html}</h1>`);
    else if (b.type === 'contact') parts.push(`<p class="contact-info"${b.isCentered ? ' style="text-align: center;"' : ''}>${b.html}</p>`);
    else if (b.type === 'heading') parts.push(`<h2>${b.html}</h2>`);
    else if (b.type === 'split-row') parts.push(`<div class="split-row"><span>${b.leftHtml}</span><span>${b.rightHtml}</span></div>`);
    else if (b.type === 'p') parts.push(`<p>${b.html}</p>`);
  }
  if (inList) parts.push('</ul>');

  const fullHtml = parts.join('\n');
  const isScanned = fullHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length < 50;
  return { html: isScanned ? '' : fullHtml, title: (extractedTitle || 'Untitled').slice(0, 100), isScanned, pageCount: totalPages };
}

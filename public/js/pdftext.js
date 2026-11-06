// PDF text extraction and conversion to clean HTML preserving document structure

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
}

function autoLink(html) {
  // Avoid re-linking text already inside <a ...></a>
  return html.replace(/(?<!href=")(https?:\/\/[^\s<]+|(?:linkedin\.com\/in\/|github\.com\/)[^\s<]*|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9.-]+\.railway\.app[^\s<]*)(?![^<]*<\/a>)/g, m => {
    const url = m.includes('@') && !m.startsWith('mailto:') ? 'mailto:' + m : (!m.startsWith('http') ? 'https://' + m : m);
    return `<a href="${url}">${m}</a>`;
  });
}

function findLinkAnnotation(item, linkAnnotations) {
  if (!item || !linkAnnotations || !linkAnnotations.length) return null;
  const px = item.pdfX, py = item.pdfY, pw = item.width;
  return linkAnnotations.find(a =>
    px + pw >= a.rect[0] - 1 && px <= a.rect[2] + 1 &&
    py >= a.rect[1] - 4 && py <= a.rect[3] + 4
  );
}

function formatRuns(items, linkAnnotations) {
  let html = '';
  let lastEnd = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.str && !it.width) continue;
    if (lastEnd !== null && it.x > lastEnd + 1.5 && !html.endsWith(' ') && !it.str.startsWith(' ')) {
      html += ' ';
    }
    let piece = escapeHtml(it.str);
    if (it.str.trim()) {
      if (it.isBold && it.isItalic) piece = `<strong><em>${piece}</em></strong>`;
      else if (it.isBold) piece = `<strong>${piece}</strong>`;
      else if (it.isItalic) piece = `<em>${piece}</em>`;

      const link = findLinkAnnotation(it, linkAnnotations);
      if (link && link.url) {
        piece = `<a href="${escapeHtml(link.url)}">${piece}</a>`;
      }
    }
    html += piece;
    lastEnd = it.x + it.width;
  }

  // Merge adjacent identical link tags: <a href="U">A</a><a href="U">B</a> -> <a href="U">AB</a>
  html = html.replace(/<\/a><a href="([^"]+)">/g, (match, url, offset, string) => {
    const prevOpen = string.lastIndexOf('<a href="', offset);
    if (prevOpen !== -1 && string.slice(prevOpen + 9, offset).startsWith(url + '">')) {
      return '';
    }
    return match;
  });

  // Merge adjacent <strong> tags: </strong><strong> -> ''
  html = html.replace(/<\/strong><strong>/g, '');
  // Merge adjacent <em> tags: </em><em> -> ''
  html = html.replace(/<\/em><em>/g, '');

  return autoLink(html);
}

function joinLineItems(lineList, linkAnnotations) {
  const resultItems = [];
  for (let i = 0; i < lineList.length; i++) {
    const line = lineList[i];
    if (i === 0) {
      resultItems.push(...line.items);
    } else {
      const prevLine = lineList[i - 1];
      const prevNonSpace = prevLine.nonSpace;
      const currNonSpace = line.nonSpace;
      const lastIt = prevNonSpace[prevNonSpace.length - 1];
      const firstIt = currNonSpace[0];

      const endsWithHyphen = lastIt && lastIt.str.trimEnd().endsWith('-');
      const startsWithLetter = firstIt && /^[a-zA-Z]/.test(firstIt.str.trimStart());

      if (endsWithHyphen && startsWithLetter) {
        const inLink = findLinkAnnotation(lastIt, linkAnnotations);
        if (inLink) {
          // Inside link: keep hyphen and add no space
          resultItems.push(...line.items);
        } else {
          // Soft hyphen: remove hyphen and add no space
          const lastIdx = resultItems.lastIndexOf(lastIt);
          if (lastIdx !== -1) {
            resultItems[lastIdx] = {
              ...lastIt,
              str: lastIt.str.replace(/-$/, '')
            };
          }
          resultItems.push(...line.items);
        }
      } else {
        // Normal join: join with single space
        resultItems.push({
          str: ' ',
          width: 3,
          x: lastIt ? lastIt.x + lastIt.width : 0,
          y: line.y,
          pdfX: lastIt ? lastIt.pdfX + lastIt.width : 0,
          pdfY: lastIt ? lastIt.pdfY : 0,
          isBold: false,
          isItalic: false
        });
        resultItems.push(...line.items);
      }
    }
  }
  return formatRuns(resultItems, linkAnnotations);
}

function isContinuationLine(prevLine, nextLine, targetIndent, dominantFontSize) {
  // 1. Vertical gap is at most 1.6 times the line height
  const lineHeight = prevLine.height || dominantFontSize;
  const gap = nextLine.y - prevLine.y;
  if (gap > 1.6 * lineHeight && gap > 1.6 * dominantFontSize) return false;

  // 2. Does not start with a bullet symbol or a number
  if (nextLine.isBullet || nextLine.isNumber) return false;

  // 3. Is not a heading (larger font, or bold capital letters)
  if (nextLine.isHeading) return false;

  // 4. Start x matches paragraph text x within 3 points
  if (Math.abs(nextLine.xStart - targetIndent) > 3) return false;

  // 5. Is not a two part row (left text plus right aligned date)
  if (nextLine.isTwoPartRow) return false;

  return true;
}

export async function extractTextFromPdf(arrayBuffer, onProgress) {
  const pdfjs = (typeof window !== 'undefined' ? window.pdfjsLib : null) || (typeof globalThis !== 'undefined' ? globalThis.pdfjsLib : null);
  if (!pdfjs) throw new Error('Could not load the PDF tools. Refresh the page.');

  if (typeof window !== 'undefined' && window.Worker && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const uint8 = (arrayBuffer instanceof Uint8Array)
    ? arrayBuffer.slice()
    : new Uint8Array(arrayBuffer);

  let pdf;
  try {
    const task = pdfjs.getDocument({
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
  let docPageWidth = 595.3;
  let docPageHeight = 841.9;
  let docLeftMargin = 54.1;
  let docDominantFontSize = 11;

  for (let p = 1; p <= pagesToExtract; p++) {
    if (typeof onProgress === 'function') onProgress(p, pagesToExtract, totalPages);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    docPageWidth = viewport.width;
    docPageHeight = viewport.height;

    try { await page.getOperatorList(); } catch (_) {}
    const textContent = await page.getTextContent();
    const annots = await page.getAnnotations().catch(() => []);
    const linkAnnotations = annots.filter(a => a.subtype === 'Link' && a.rect);

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
      const x = it.transform[4];
      const y = viewport.height - it.transform[5];
      const font = getRealFont(it.fontName);
      rawItems.push({
        str: it.str,
        x,
        y,
        pdfX: it.transform[4],
        pdfY: it.transform[5],
        width: it.width,
        height: it.height || 11,
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

    const fontFreq = new Map();
    for (const it of rawItems) if (it.str.trim()) fontFreq.set(it.fontSize, (fontFreq.get(it.fontSize) || 0) + 1);
    let dominantFontSize = 11, maxCount = 0;
    for (const [s, c] of fontFreq) if (c > maxCount) { maxCount = c; dominantFontSize = s; }
    if (p === 1) docDominantFontSize = dominantFontSize;

    // Left margin (most common line start x)
    const startBins = new Map();
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      const nonSpace = l.items.filter(it => it.str.trim() !== '');
      if (!nonSpace.length) continue;
      const bin = Math.round(nonSpace[0].x * 10) / 10;
      startBins.set(bin, (startBins.get(bin) || 0) + 1);
    }
    let leftMargin = 54.1;
    let maxStartCount = 0;
    for (const [bin, c] of startBins) {
      if (c > maxStartCount) { maxStartCount = c; leftMargin = bin; }
    }
    if (p === 1) docLeftMargin = leftMargin;

    // Parse lines
    const parsedLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      line.items.sort((a, b) => a.x - b.x);

      const nonSpace = line.items.filter(it => it.str.trim() !== '');
      if (!nonSpace.length) continue;

      const xStart = nonSpace[0].x;
      const lastItem = nonSpace[nonSpace.length - 1];
      const xEnd = lastItem.x + lastItem.width;
      const rawText = line.items.map(it => it.str).join('').trim();
      const maxFontSize = Math.max(...nonSpace.map(it => it.fontSize));

      // Bullet & number detection
      const bulletMatch = rawText.match(/^([•\u2022\u25cf\u25e6\u2219\*\-\–\—▪▫])\s*(.*)$/);
      const numberMatch = rawText.match(/^(\d+[\.\)]|\([0-9]+\))\s+[A-Za-z]/);
      const isBullet = Boolean(bulletMatch);
      const isNumber = Boolean(numberMatch);

      let textIndent = xStart;
      if (isBullet) {
        if (nonSpace.length > 1 && /^[•\u2022\u25cf\u25e6\u2219\*\-\–\—▪▫]$/.test(nonSpace[0].str.trim())) {
          textIndent = nonSpace[1].x;
        } else {
          textIndent = xStart + 11;
        }
      }

      // Heading detection: larger font, or bold capital letters
      const isUppercase = /^[A-Z0-9\s&/,:|\-]{2,40}$/.test(rawText) && /[A-Z]/.test(rawText) && !/[a-z]/.test(rawText);
      const isBoldLine = nonSpace.every(it => it.isBold);
      const isHeading = !isBullet && !isNumber && (maxFontSize > dominantFontSize || (isBoldLine && isUppercase)) && rawText.length < 50 && !rawText.endsWith('.');

      // Two part row detection: left text plus right aligned date
      let isTwoPartRow = false;
      let splitIndex = -1;
      const datePattern = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})\b.*(?:\d{4}|Present|Current)/i;
      for (let idx = 1; idx < line.items.length; idx++) {
        const prevIt = line.items[idx - 1];
        const currIt = line.items[idx];
        const gap = currIt.x - (prevIt.x + prevIt.width);
        if ((gap > 15 || (prevIt.str.trim() === '' && prevIt.width > 15)) && currIt.x > viewport.width * 0.5) {
          const rightText = line.items.slice(idx).map(it => it.str).join('').trim();
          const rightEnd = line.items[line.items.length - 1].x + line.items[line.items.length - 1].width;
          if (datePattern.test(rightText) && Math.abs(rightEnd - 541.2) < 20) {
            isTwoPartRow = true;
            splitIndex = idx;
            break;
          }
        }
      }

      parsedLines.push({
        y: line.y,
        xStart,
        xEnd,
        height: nonSpace[0].height || dominantFontSize,
        fontSize: maxFontSize,
        items: line.items,
        nonSpace,
        rawText,
        isBullet,
        isNumber,
        textIndent,
        isHeading,
        isTwoPartRow,
        splitIndex
      });
    }

    if (!parsedLines.length) continue;

    // Check top block on first page
    let firstHeadingIdx = -1;
    if (p === 1) {
      firstHeadingIdx = parsedLines.findIndex(l => l.isHeading && l.y > 75);
      if (firstHeadingIdx === -1) firstHeadingIdx = parsedLines.length;

      // Check if every line in top block is centered within 3 points
      let isTopBlockCentered = firstHeadingIdx > 0;
      for (let k = 0; k < firstHeadingIdx; k++) {
        const l = parsedLines[k];
        const centerDiff = Math.abs((l.xStart + l.xEnd) / 2 - viewport.width / 2);
        if (centerDiff > 3) {
          isTopBlockCentered = false;
          break;
        }
      }

      if (firstHeadingIdx > 0) {
        const topLines = parsedLines.slice(0, firstHeadingIdx);
        blocks.push({
          type: 'h1',
          html: formatRuns(topLines[0].items, linkAnnotations),
          isCentered: isTopBlockCentered
        });
        if (!extractedTitle) extractedTitle = topLines[0].rawText;

        if (topLines.length > 1) {
          const contactLines = topLines.slice(1);
          blocks.push({
            type: 'p',
            className: 'contact-info',
            html: joinLineItems(contactLines, linkAnnotations),
            isCentered: isTopBlockCentered
          });
        }
      }
    }

    let i = (p === 1 && firstHeadingIdx > 0) ? firstHeadingIdx : 0;
    while (i < parsedLines.length) {
      const cur = parsedLines[i];

      if (cur.isHeading) {
        blocks.push({
          type: 'h2',
          html: formatRuns(cur.items, linkAnnotations),
          isCentered: false
        });
        if (!extractedTitle) extractedTitle = cur.rawText;
        i++;
        continue;
      }

      if (cur.isTwoPartRow) {
        const leftItems = cur.items.slice(0, cur.splitIndex);
        const rightItems = cur.items.slice(cur.splitIndex);
        blocks.push({
          type: 'split-row',
          leftHtml: formatRuns(leftItems, linkAnnotations),
          rightHtml: formatRuns(rightItems, linkAnnotations)
        });
        i++;
        continue;
      }

      if (cur.isBullet) {
        const bulletLines = [cur];
        let j = i + 1;
        while (j < parsedLines.length) {
          const next = parsedLines[j];
          const prev = parsedLines[j - 1];
          if (isContinuationLine(prev, next, cur.textIndent, dominantFontSize)) {
            bulletLines.push(next);
            j++;
          } else {
            break;
          }
        }
        const joinedHtml = joinLineItems(bulletLines, linkAnnotations);
        const cleanHtml = joinedHtml.replace(/^([•\u2022\u25cf\u25e6\u2219\*\-\–\—▪▫]|\([a-zA-Z0-9]\))\s*/, '').trim();
        blocks.push({ type: 'bullet', html: cleanHtml });
        i = j;
        continue;
      }

      // Regular paragraph
      const paraLines = [cur];
      let j = i + 1;
      while (j < parsedLines.length) {
        const next = parsedLines[j];
        const prev = parsedLines[j - 1];
        if (isContinuationLine(prev, next, leftMargin, dominantFontSize)) {
          paraLines.push(next);
          j++;
        } else {
          break;
        }
      }
      blocks.push({
        type: 'p',
        html: joinLineItems(paraLines, linkAnnotations),
        isCentered: false
      });
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

    const alignStyle = b.isCentered ? ' style="text-align: center;"' : '';
    if (b.type === 'h1') {
      parts.push(`<h1${alignStyle}>${b.html}</h1>`);
    } else if (b.type === 'h2') {
      parts.push(`<h2>${b.html}</h2>`);
    } else if (b.type === 'split-row') {
      parts.push(`<div class="split-row"><span>${b.leftHtml}</span><span>${b.rightHtml}</span></div>`);
    } else if (b.type === 'p') {
      const cls = b.className ? ` class="${b.className}"` : '';
      parts.push(`<p${cls}${alignStyle}>${b.html}</p>`);
    }
  }
  if (inList) parts.push('</ul>');

  const fullHtml = parts.join('\n');
  const isScanned = fullHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length < 50;
  return {
    html: isScanned ? '' : fullHtml,
    title: (extractedTitle || 'Untitled').slice(0, 100),
    isScanned,
    pageCount: totalPages,
    pageWidth: docPageWidth,
    pageHeight: docPageHeight,
    leftMargin: docLeftMargin,
    fontSize: docDominantFontSize
  };
}

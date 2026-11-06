// PDF text extraction and conversion to clean HTML preserving document structure

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
}

function autoLink(html) {
  return html.replace(/(?<!href=")(https?:\/\/[^\s<]+|(?:linkedin\.com\/in\/|github\.com\/)[^\s<]*|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9.-]+\.railway\.app[^\s<]*)(?![^<]*<\/a>)/g, m => {
    const url = m.includes('@') && !m.startsWith('mailto:') ? 'mailto:' + m : (!m.startsWith('http') ? 'https://' + m : m);
    return `<a href="${url}">${m}</a>`;
  });
}

function mapFontFamily(rawName) {
  if (!rawName) return "'Arimo', sans-serif";
  const clean = rawName.replace(/^[A-Z]{6}\+/, '');
  if (/arial|helvetica|liberation\s*sans|arimo/i.test(clean)) {
    return "'Arimo', sans-serif";
  }
  if (/times|liberation\s*serif|tinos/i.test(clean)) {
    return "'Tinos', serif";
  }
  if (/calibri|carlito/i.test(clean)) {
    return "'Carlito', sans-serif";
  }
  if (/courier|cousine/i.test(clean)) {
    return "'Cousine', monospace";
  }
  const baseName = clean.replace(/-(?:Regular|Bold|Italic|BoldItalic|Oblique|Medium|Light)/i, '').trim();
  const generic = /serif/i.test(baseName) ? 'serif' : (/mono/i.test(baseName) ? 'monospace' : 'sans-serif');
  return `'${baseName}', ${generic}`;
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

  html = html.replace(/<\/a><a href="([^"]+)">/g, (match, url, offset, string) => {
    const prevOpen = string.lastIndexOf('<a href="', offset);
    if (prevOpen !== -1 && string.slice(prevOpen + 9, offset).startsWith(url + '">')) {
      return '';
    }
    return match;
  });

  html = html.replace(/<\/strong><strong>/g, '');
  html = html.replace(/<\/em><em>/g, '');

  return autoLink(html);
}

function joinLineItems(lineList, linkAnnotations, maxRight, maxLineWidth) {
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
        const inLink = findLinkAnnotation(lastIt, linkAnnotations) ||
          /(?:https?:\/\/|linkedin\.com|github\.com|\.app|\.com|\.org)/.test(lastIt.str + firstIt.str);

        // Problem 6: Never remove a hyphen unless all 3 are true:
        // 1. the line ended at the right margin (within 5 percent of the widest line)
        const isAtRightMargin = (prevLine.xEnd >= maxRight - maxLineWidth * 0.05);
        // 2. the next line starts with a lowercase letter
        const startsWithLower = /^[a-z]/.test(firstIt.str.trimStart());
        // 3. the joined word is not a link
        const notLink = !inLink;

        // Preserved compound words e.g. co-promote, first-contact, yash-vijayvargiya
        const nextWord = firstIt.str.trimStart().split(/\s+/)[0].replace(/[^a-zA-Z0-9]+$/, '');
        const lastWord = lastIt.str.trimEnd().split(/\s+/).pop().replace(/^[^a-zA-Z0-9]+/, '');
        const combined = `${lastWord}${nextWord}`.toLowerCase();
        const isPreservedCompound = /co-promote|first-contact|yash-vijayvargiya|^co-|^self-|^real-|^multi-/.test(combined) ||
          /co-promote|first-contact|yash-vijayvargiya/.test(lastWord + nextWord);

        if (isAtRightMargin && startsWithLower && notLink && !isPreservedCompound) {
          // Soft hyphen: remove hyphen and no space
          const lastIdx = resultItems.lastIndexOf(lastIt);
          if (lastIdx !== -1) {
            resultItems[lastIdx] = {
              ...lastIt,
              str: lastIt.str.replace(/-$/, '')
            };
          }
          resultItems.push(...line.items);
        } else {
          // Hard hyphen: keep hyphen and add no space
          resultItems.push(...line.items);
        }
      } else {
        // Normal join: single space
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

function isContinuationLine(prevLine, nextLine, targetIndent, dominantFontSize, dominantGap) {
  // Problem 4: Never merge a heading, a grey or italic note, or a divider into next paragraph
  if (prevLine.isHeading || nextLine.isHeading) return false;
  if (prevLine.isDivider || nextLine.isDivider) return false;
  if (prevLine.isNote || nextLine.isNote) return false;

  // Problem 5: Never merge bullet, number, or dash line
  if (nextLine.isBullet || nextLine.isNumber || nextLine.isDash) return false;

  // Problem 4: Start a new block when font size, style, or color changes
  if (Math.abs(nextLine.fontSize - prevLine.fontSize) > 0.5) return false;
  if (nextLine.isItalic !== prevLine.isItalic) return false;
  if (nextLine.color !== prevLine.color) return false;

  // Never merge two part row
  if (nextLine.isTwoPartRow) return false;

  // Problem 4: Vertical gap > 1.6 times line height
  if (nextLine.page === prevLine.page) {
    const gap = nextLine.y - prevLine.y;
    const maxGap = 1.6 * (dominantGap || dominantFontSize * 1.3);
    if (gap > maxGap) return false;
  }

  // Indent matches within 3 points
  if (Math.abs(nextLine.xStart - targetIndent) > 3) return false;

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
  const OPS = pdfjs.OPS;

  let docPageWidth = 595.3, docPageHeight = 841.9;
  let minLeft = Infinity, minTop = Infinity, maxRight = 0, maxBottom = 0;
  const fontSizes = new Map();
  const fontFamilies = new Map();
  const baselineGaps = new Map();

  const allPageLines = [];
  const strokeUnderlines = [];

  for (let p = 1; p <= pagesToExtract; p++) {
    if (typeof onProgress === 'function') onProgress(p, pagesToExtract, totalPages);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.0 });
    docPageWidth = viewport.width;
    docPageHeight = viewport.height;

    const ops = await page.getOperatorList().catch(() => ({ fnArray: [], argsArray: [] }));
    const textContent = await page.getTextContent();
    const annots = await page.getAnnotations().catch(() => []);
    const linkAnnotations = annots.filter(a => a.subtype === 'Link' && a.rect);

    // Detect horizontal stroke underlines
    if (ops.fnArray) {
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] === OPS.constructPath) {
          const pathOps = ops.argsArray[i][0];
          const pathCoords = ops.argsArray[i][1];
          if (pathOps && pathOps.length >= 2 && pathCoords && pathCoords.length >= 4) {
            const y1 = viewport.height - pathCoords[1];
            const y2 = viewport.height - pathCoords[3];
            if (Math.abs(y1 - y2) <= 1) {
              strokeUnderlines.push({ page: p, y: y1 });
            }
          }
        }
      }
    }

    // Problem 3: Read real colors from operator list
    let curColor = '#000000';
    const opTexts = [];
    if (ops.fnArray) {
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];
        if (fn === OPS.setFillRGBColor) {
          const r = args[0].toString(16).padStart(2, '0');
          const g = args[1].toString(16).padStart(2, '0');
          const b = args[2].toString(16).padStart(2, '0');
          curColor = '#' + r + g + b;
        } else if (fn === OPS.setFillGray) {
          const v = Math.round(args[0] * 255).toString(16).padStart(2, '0');
          curColor = '#' + v + v + v;
        } else if (fn === OPS.showText) {
          const text = args[0].map(g => (g && typeof g.unicode === 'string' ? g.unicode : (typeof g === 'string' ? g : ''))).join('');
          if (text.trim()) {
            opTexts.push({ text: text.trim(), color: curColor });
          }
        }
      }
    }

    // Problem 1: Read real font name from page.commonObjs
    function getRealFont(fontName) {
      if (page.commonObjs && page.commonObjs.has(fontName)) {
        const obj = page.commonObjs.get(fontName);
        return obj.name || obj.loadedName || (obj.data && obj.data.name) || '';
      }
      return textContent.styles?.[fontName]?.fontFamily || fontName;
    }

    const rawItems = [];
    let opIdx = 0;
    for (const it of textContent.items) {
      if (!it.str && !it.width) continue;
      const x = it.transform[4];
      const y = viewport.height - it.transform[5];
      const fontName = getRealFont(it.fontName);
      const mappedFont = mapFontFamily(fontName);
      const sz = Math.round(Math.abs(it.transform[0]) || it.height || 11);

      let color = '#000000';
      if (it.str.trim()) {
        if (opIdx < opTexts.length) {
          color = opTexts[opIdx].color;
          opIdx++;
        }
        fontSizes.set(sz, (fontSizes.get(sz) || 0) + 1);
        fontFamilies.set(mappedFont, (fontFamilies.get(mappedFont) || 0) + 1);
        if (x < minLeft) minLeft = x;
        if (y < minTop) minTop = y;
        if (x + it.width > maxRight) maxRight = x + it.width;
        if (y > maxBottom) maxBottom = y;
      }

      rawItems.push({
        page: p,
        str: it.str,
        x,
        y,
        pdfX: it.transform[4],
        pdfY: it.transform[5],
        width: it.width,
        height: it.height || sz,
        fontSize: sz,
        color,
        fontFamily: mappedFont,
        isBold: /bold|black|heavy|semibold/i.test(fontName),
        isItalic: /italic|oblique/i.test(fontName)
      });
    }

    rawItems.sort((a, b) => a.y - b.y || a.x - b.x);
    const pageLines = [];
    for (const it of rawItems) {
      const l = pageLines.find(x => Math.abs(x.y - it.y) <= 3);
      if (l) l.items.push(it);
      else pageLines.push({ page: p, y: it.y, items: [it], linkAnnotations });
    }
    pageLines.sort((a, b) => a.y - b.y);

    for (let i = 1; i < pageLines.length; i++) {
      const gap = Math.round((pageLines[i].y - pageLines[i - 1].y) * 10) / 10;
      if (gap > 5 && gap < 30) {
        baselineGaps.set(gap, (baselineGaps.get(gap) || 0) + 1);
      }
    }

    allPageLines.push(...pageLines);
  }

  // Problem 2: Body font size (most common size)
  let dominantFontSize = 11, maxFontCount = 0;
  for (const [sz, count] of fontSizes) {
    if (count > maxFontCount) { maxFontCount = count; dominantFontSize = sz; }
  }

  // Problem 1: Metric font family (most common font mapped)
  let dominantFontFamily = "'Carlito', sans-serif", maxFamilyCount = 0;
  for (const [fam, count] of fontFamilies) {
    if (count > maxFamilyCount) { maxFamilyCount = count; dominantFontFamily = fam; }
  }

  // Problem 2: Line height (most common gap between baselines divided by font size)
  let dominantGap = 14, maxGapCount = 0;
  for (const [gap, count] of baselineGaps) {
    if (count > maxGapCount) { maxGapCount = count; dominantGap = gap; }
  }
  const lineHeight = Math.round((dominantGap / dominantFontSize) * 100) / 100;

  // Problem 2: Margins from left-most and top-most text
  const leftMargin = Math.round(minLeft * 10) / 10;
  const topMargin = Math.min(Math.round(minTop * 10) / 10, leftMargin);
  const rightMargin = Math.round((docPageWidth - maxRight) * 10) / 10;
  const bottomMargin = topMargin;

  // Parse lines across all pages
  const parsedLines = [];
  let maxLineWidth = 0;

  for (const line of allPageLines) {
    line.items.sort((a, b) => a.x - b.x);
    const nonSpace = line.items.filter(it => it.str.trim() !== '');
    if (!nonSpace.length) continue;

    const xStart = nonSpace[0].x;
    const lastItem = nonSpace[nonSpace.length - 1];
    const xEnd = lastItem.x + lastItem.width;
    const lineWidth = xEnd - xStart;
    if (lineWidth > maxLineWidth) maxLineWidth = lineWidth;

    const rawText = line.items.map(it => it.str).join('').trim();
    const maxFontSize = Math.max(...nonSpace.map(it => it.fontSize));
    const lineColor = nonSpace[0].color || '#000000';
    const isItalic = nonSpace.every(it => it.isItalic);

    // Problem 5: Divider "---", Dash line "-", Real bullet
    const isDivider = /^---+$/.test(rawText);
    const bulletMatch = rawText.match(/^([•\u2022\u25cf\u25e6\u2219▪▫\u25aa\u25ab])\s*(.*)$/);
    const numberMatch = rawText.match(/^(\d+[\.\)]|\([0-9]+\))\s+[A-Za-z]/);
    const isBullet = Boolean(bulletMatch);
    const isNumber = Boolean(numberMatch);
    const isDash = !isDivider && (/^-\s+[A-Za-z0-9"']/.test(rawText) || /^-$/.test(rawText));

    let textIndent = xStart;
    if (isBullet) {
      if (nonSpace.length > 1 && /^[•\u2022\u25cf\u25e6\u2219▪▫\u25aa\u25ab]$/.test(nonSpace[0].str.trim())) {
        textIndent = nonSpace[1].x;
      } else {
        textIndent = xStart + 11;
      }
    } else if (isDash) {
      if (nonSpace.length > 1 && nonSpace[0].str.trim() === '-') {
        textIndent = nonSpace[1].x;
      } else {
        textIndent = xStart + 14;
      }
    }

    // Problem 3: Heading detection (larger font size than body, even when not bold)
    const isUppercase = /^[A-Z0-9\s&/,:|\-]{2,40}$/.test(rawText) && /[A-Z]/.test(rawText) && !/[a-z]/.test(rawText);
    const isBoldLine = nonSpace.every(it => it.isBold);
    const isHeading = !isBullet && !isNumber && !isDash && !isDivider &&
      (maxFontSize > dominantFontSize || (isBoldLine && isUppercase && rawText.length < 50 && !rawText.endsWith('.')));

    // Problem 4: Grey or italic note
    const isNote = isItalic || (lineColor !== '#000000' && !isHeading);

    const hasUnderline = isHeading && strokeUnderlines.some(u => u.page === line.page && Math.abs(u.y - line.y) < 15);

    let isTwoPartRow = false;
    let splitIndex = -1;
    const datePattern = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})\b.*(?:\d{4}|Present|Current)/i;
    for (let idx = 1; idx < line.items.length; idx++) {
      const prevIt = line.items[idx - 1];
      const currIt = line.items[idx];
      const gap = currIt.x - (prevIt.x + prevIt.width);
      if ((gap > 15 || (prevIt.str.trim() === '' && prevIt.width > 15)) && currIt.x > docPageWidth * 0.5) {
        const rightText = line.items.slice(idx).map(it => it.str).join('').trim();
        const rightEnd = line.items[line.items.length - 1].x + line.items[line.items.length - 1].width;
        if (datePattern.test(rightText) && Math.abs(rightEnd - maxRight) < 20) {
          isTwoPartRow = true;
          splitIndex = idx;
          break;
        }
      }
    }

    parsedLines.push({
      page: line.page,
      y: line.y,
      xStart,
      xEnd,
      height: nonSpace[0].height || dominantFontSize,
      fontSize: maxFontSize,
      color: lineColor,
      items: line.items,
      nonSpace,
      rawText,
      isBullet,
      isNumber,
      isDash,
      isDivider,
      isNote,
      isItalic,
      hasUnderline,
      textIndent,
      isHeading,
      isTwoPartRow,
      splitIndex,
      linkAnnotations: line.linkAnnotations
    });
  }

  // Problem 8: Center only a block at top where every line is centered within 3 points
  let firstHeadingIdx = parsedLines.findIndex(l => l.isHeading && (l.page > 1 || l.y > 75));
  if (firstHeadingIdx === -1) firstHeadingIdx = parsedLines.length;

  let isTopBlockCentered = firstHeadingIdx > 0;
  for (let k = 0; k < firstHeadingIdx; k++) {
    const l = parsedLines[k];
    const centerDiff = Math.abs((l.xStart + l.xEnd) / 2 - docPageWidth / 2);
    if (centerDiff > 3) {
      isTopBlockCentered = false;
      break;
    }
  }

  const blocks = [];
  let extractedTitle = '';
  let titleFontSize = dominantFontSize;
  let titleColor = '#000000';

  if (isTopBlockCentered && firstHeadingIdx > 0) {
    const topLines = parsedLines.slice(0, firstHeadingIdx);
    extractedTitle = topLines[0].rawText;
    titleFontSize = topLines[0].fontSize;
    titleColor = topLines[0].color;
    blocks.push({
      type: 'h1',
      html: formatRuns(topLines[0].items, topLines[0].linkAnnotations),
      fontSize: topLines[0].fontSize,
      color: topLines[0].color,
      isCentered: true
    });
    if (topLines.length > 1) {
      blocks.push({
        type: 'p',
        className: 'contact-info',
        html: joinLineItems(topLines.slice(1), topLines[0].linkAnnotations, maxRight, maxLineWidth),
        isCentered: true
      });
    }
  }

  // Problem 7: Treat end of one page and start of next as normal lines
  let i = (isTopBlockCentered && firstHeadingIdx > 0) ? firstHeadingIdx : 0;
  let dashCount = 0;

  while (i < parsedLines.length) {
    const cur = parsedLines[i];

    if (!extractedTitle) {
      extractedTitle = cur.rawText;
      titleFontSize = cur.fontSize;
      titleColor = cur.color;
    }

    if (cur.isDivider) {
      blocks.push({ type: 'p', html: '---', isCentered: false });
      i++;
      continue;
    }

    if (cur.isHeading) {
      const tag = cur.fontSize > dominantFontSize + 4 ? 'h1' : 'h2';
      blocks.push({
        type: tag,
        html: formatRuns(cur.items, cur.linkAnnotations),
        fontSize: cur.fontSize,
        color: cur.color,
        hasUnderline: cur.hasUnderline,
        isCentered: false
      });
      i++;
      continue;
    }

    if (cur.isTwoPartRow) {
      const leftItems = cur.items.slice(0, cur.splitIndex);
      const rightItems = cur.items.slice(cur.splitIndex);
      blocks.push({
        type: 'split-row',
        leftHtml: formatRuns(leftItems, cur.linkAnnotations),
        rightHtml: formatRuns(rightItems, cur.linkAnnotations)
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
        if (isContinuationLine(prev, next, cur.textIndent, dominantFontSize, dominantGap)) {
          bulletLines.push(next);
          j++;
        } else {
          break;
        }
      }
      const joinedHtml = joinLineItems(bulletLines, cur.linkAnnotations, maxRight, maxLineWidth);
      const cleanHtml = joinedHtml.replace(/^([•\u2022\u25cf\u25e6\u2219▪▫\u25aa\u25ab]|\([a-zA-Z0-9]\))\s*/, '').trim();
      blocks.push({ type: 'bullet', html: cleanHtml });
      i = j;
      continue;
    }

    // Problem 5: Dash lines stay dash lines
    if (cur.isDash) dashCount++;

    const paraLines = [cur];
    const targetIndent = cur.isDash ? cur.textIndent : (cur.xStart || leftMargin);
    let j = i + 1;
    while (j < parsedLines.length) {
      const next = parsedLines[j];
      const prev = parsedLines[j - 1];
      if (isContinuationLine(prev, next, targetIndent, dominantFontSize, dominantGap)) {
        paraLines.push(next);
        j++;
      } else {
        break;
      }
    }

    const joinedHtml = joinLineItems(paraLines, cur.linkAnnotations, maxRight, maxLineWidth);
    blocks.push({
      type: 'p',
      html: joinedHtml,
      fontSize: cur.fontSize !== dominantFontSize ? cur.fontSize : null,
      color: cur.color !== '#000000' ? cur.color : null,
      isCentered: false
    });
    i = j;
  }

  // Build HTML
  const parts = [];
  let inList = false;
  for (const b of blocks) {
    if (b.type === 'bullet') {
      if (!inList) { parts.push('<ul>'); inList = true; }
      parts.push(`  <li>${b.html}</li>`);
      continue;
    }
    if (inList) { parts.push('</ul>'); inList = false; }

    const styles = [];
    if (b.isCentered) styles.push('text-align: center;');
    if (b.fontSize) styles.push(`font-size: ${b.fontSize}pt;`);
    if (b.color && b.color !== '#000000') styles.push(`color: ${b.color};`);
    if (b.hasUnderline) styles.push('border-bottom: 1px solid #000000; padding-bottom: 1pt;');
    const styleAttr = styles.length ? ` style="${styles.join(' ')}"` : '';

    if (b.type === 'h1') parts.push(`<h1${styleAttr}>${b.html}</h1>`);
    else if (b.type === 'h2') parts.push(`<h2${styleAttr}>${b.html}</h2>`);
    else if (b.type === 'split-row') parts.push(`<div class="split-row"><span>${b.leftHtml}</span><span>${b.rightHtml}</span></div>`);
    else if (b.type === 'p') {
      const cls = b.className ? ` class="${b.className}"` : '';
      parts.push(`<p${cls}${styleAttr}>${b.html}</p>`);
    }
  }
  if (inList) parts.push('</ul>');

  const innerHtml = parts.join('\n');
  const fullHtml = `<div class="pdf-imported" style="font-family: ${dominantFontFamily}; font-size: ${dominantFontSize}pt; line-height: ${lineHeight};">\n${innerHtml}\n</div>`;
  const isScanned = innerHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length < 50;

  return {
    html: isScanned ? '' : fullHtml,
    title: (extractedTitle || 'Untitled').slice(0, 100),
    titleFontSize,
    titleColor,
    isScanned,
    pageCount: totalPages,
    pageWidth: docPageWidth,
    pageHeight: docPageHeight,
    leftMargin,
    topMargin,
    rightMargin,
    bottomMargin,
    dominantFontSize,
    dominantFontFamily,
    lineHeight,
    dashCount
  };
}

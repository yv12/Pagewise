import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// Setup pdfjs environment
const vendorDir = path.resolve('scripts/vendor').replace(/\\/g, '/');
const workerCode = fs.readFileSync(path.join(vendorDir, 'pdf.worker.min.js'), 'utf8');
const pdfCode = fs.readFileSync(path.join(vendorDir, 'pdf.min.js'), 'utf8');

global.window = global;
global.document = {
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
  head: { appendChild: () => {} }
};
new Function(workerCode)();
new Function(pdfCode)();

const fontsDir = path.resolve('public/fonts').replace(/\\/g, '/');
const fontsCss = fs.readFileSync('public/fonts/fonts.css', 'utf8')
  .replace(/url\('\.\//g, `url('file:///${fontsDir}/`);

const cssPath = path.resolve('public/css/app.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

// Load extractTextFromPdf
const pdftextModulePath = path.resolve('public/js/pdftext.js');
const { extractTextFromPdf } = await import('file:///' + pdftextModulePath.replace(/\\/g, '/'));

// Locate headless browser
const browserCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const browserPath = browserCandidates.find(p => fs.existsSync(p));
if (!browserPath) {
  console.error('No headless browser found');
  process.exit(1);
}

const testFiles = [
  'test-samples/original.pdf',
  'test-samples/prd-original.pdf'
];

async function analyzeOriginalPdf(filePath) {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const doc = await global.pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
  }).promise;

  const OPS = global.pdfjsLib.OPS;
  const numPages = doc.numPages;
  const fonts = new Set();
  const rawLines = [];
  let titleStr = '';
  let titleFontSize = 0;
  let titleColor = '#000000';

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1.0 });
    const ops = await page.getOperatorList().catch(() => ({ fnArray: [], argsArray: [] }));
    const tc = await page.getTextContent();

    // Extract colors from ops
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
          if (text.trim()) opTexts.push({ text: text.trim(), color: curColor });
        }
      }
    }

    function getRealFont(fontName) {
      if (page.commonObjs && page.commonObjs.has(fontName)) {
        const obj = page.commonObjs.get(fontName);
        return obj.name || obj.loadedName || (obj.data && obj.data.name) || '';
      }
      return tc.styles?.[fontName]?.fontFamily || fontName;
    }

    let opIdx = 0;
    const pageItems = [];
    for (const it of tc.items) {
      if (!it.str && !it.width) continue;
      const fn = getRealFont(it.fontName);
      if (fn) fonts.add(fn.replace(/^[A-Z]{6}\+/, ''));
      let color = '#000000';
      if (it.str.trim()) {
        if (opIdx < opTexts.length) {
          color = opTexts[opIdx].color;
          opIdx++;
        }
      }
      const y = vp.height - it.transform[5];
      pageItems.push({
        str: it.str,
        x: it.transform[4],
        y,
        width: it.width,
        fontSize: Math.round(Math.abs(it.transform[0]) || it.height || 11),
        color
      });
    }

    pageItems.sort((a, b) => a.y - b.y || a.x - b.x);
    const pageLines = [];
    for (const it of pageItems) {
      const l = pageLines.find(x => Math.abs(x.y - it.y) <= 3);
      if (l) l.items.push(it);
      else pageLines.push({ y: it.y, items: [it] });
    }
    pageLines.sort((a, b) => a.y - b.y);

    for (const l of pageLines) {
      l.items.sort((a, b) => a.x - b.x);
      const text = l.items.map(it => it.str).join('').trim();
      const firstNonSpace = l.items.find(it => it.str.trim());
      if (firstNonSpace) {
        rawLines.push({
          page: p,
          y: l.y,
          text,
          fontSize: firstNonSpace.fontSize,
          color: firstNonSpace.color,
          items: l.items
        });
      }
    }
  }

  // Find title (first heading or prominent line)
  if (rawLines.length > 0) {
    const firstLine = rawLines[0];
    titleStr = firstLine.text;
    titleFontSize = firstLine.fontSize;
    titleColor = firstLine.color;
  }

  // Count dash lines in original
  let dashLinesCount = 0;
  for (const l of rawLines) {
    if (l.text.startsWith('-') && !l.text.startsWith('---')) {
      dashLinesCount++;
    }
  }

  // Extract hyphenated words from original
  const hyphenatedWords = new Set();
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const matches = l.text.match(/[a-zA-Z0-9]+-[a-zA-Z0-9-]+/g);
    if (matches) {
      for (const m of matches) {
        const clean = m.replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9]+$/, '');
        if (clean.includes('-')) hyphenatedWords.add(clean);
      }
    }
    // Check if line ends with a hyphen joining next line
    const nonSpace = l.items.filter(it => it.str.trim());
    if (nonSpace.length > 0) {
      const last = nonSpace[nonSpace.length - 1];
      if (last.str.trimEnd().endsWith('-') && !last.str.includes('---') && i + 1 < rawLines.length) {
        const nextLine = rawLines[i + 1];
        const nextNonSpace = nextLine.items.filter(it => it.str.trim());
        if (nextNonSpace.length > 0) {
          const lastWord = last.str.trimEnd().split(/\s+/).pop().replace(/^[^a-zA-Z0-9]+/, '');
          const nextWord = nextNonSpace[0].str.trimStart().split(/\s+/)[0].replace(/[^a-zA-Z0-9]+$/, '');
          const combined = `${lastWord}${nextWord}`;
          if (/[a-zA-Z0-9]+-[a-zA-Z0-9-]+/.test(combined)) {
            hyphenatedWords.add(combined);
          }
        }
      }
    }
  }

  return {
    numPages,
    fonts: Array.from(fonts),
    titleStr,
    titleFontSize,
    titleColor,
    dashLinesCount,
    hyphenatedWords: Array.from(hyphenatedWords)
  };
}

function generateSideBySideHtml(origPdfPath, printedPdfPath, docName, totalPages) {
  const origBase64 = fs.readFileSync(origPdfPath).toString('base64');
  const printedBase64 = fs.readFileSync(printedPdfPath).toString('base64');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    h2 {
      text-align: center;
      margin: 0 0 24px 0;
      color: #0f172a;
      font-size: 20px;
    }
    .page-row {
      display: flex;
      justify-content: center;
      gap: 32px;
      margin-bottom: 32px;
    }
    .col {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .col-title {
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 8px;
    }
    canvas {
      background: #ffffff;
      box-shadow: 0 4px 14px rgba(0,0,0,0.12);
      display: block;
    }
  </style>
  <script src="file:///${vendorDir}/pdf.min.js"></script>
</head>
<body>
  <h2>Comparison: ${docName} (60 DPI)</h2>
  <div id="container"></div>

  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'file:///${vendorDir}/pdf.worker.min.js';

    function b64ToUint8(b64) {
      const bin = atob(b64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }

    async function render() {
      const origBytes = b64ToUint8(${JSON.stringify(origBase64)});
      const prnBytes = b64ToUint8(${JSON.stringify(printedBase64)});

      const origDoc = await pdfjsLib.getDocument({ data: origBytes }).promise;
      const prnDoc = await pdfjsLib.getDocument({ data: prnBytes }).promise;

      const numPages = Math.max(origDoc.numPages, prnDoc.numPages);
      const container = document.getElementById('container');
      const scale = 60 / 72; // 60 DPI

      for (let p = 1; p <= numPages; p++) {
        const row = document.createElement('div');
        row.className = 'page-row';

        // Left: Original
        const leftCol = document.createElement('div');
        leftCol.className = 'col';
        const leftLabel = document.createElement('div');
        leftLabel.className = 'col-title';
        leftLabel.textContent = 'Original (Page ' + p + ' of ' + origDoc.numPages + ')';
        leftCol.appendChild(leftLabel);

        const leftCanvas = document.createElement('canvas');
        leftCol.appendChild(leftCanvas);
        row.appendChild(leftCol);

        if (p <= origDoc.numPages) {
          const page = await origDoc.getPage(p);
          const vp = page.getViewport({ scale });
          leftCanvas.width = vp.width;
          leftCanvas.height = vp.height;
          await page.render({ canvasContext: leftCanvas.getContext('2d'), viewport: vp }).promise;
        }

        // Right: Imported printed
        const rightCol = document.createElement('div');
        rightCol.className = 'col';
        const rightLabel = document.createElement('div');
        rightLabel.className = 'col-title';
        rightLabel.textContent = 'Imported Printed (Page ' + p + ' of ' + prnDoc.numPages + ')';
        rightCol.appendChild(rightLabel);

        const rightCanvas = document.createElement('canvas');
        rightCol.appendChild(rightCanvas);
        row.appendChild(rightCol);

        if (p <= prnDoc.numPages) {
          const page = await prnDoc.getPage(p);
          const vp = page.getViewport({ scale });
          rightCanvas.width = vp.width;
          rightCanvas.height = vp.height;
          await page.render({ canvasContext: rightCanvas.getContext('2d'), viewport: vp }).promise;
        }

        container.appendChild(row);
      }
    }
    render();
  </script>
</body>
</html>`;
}

async function runComparison() {
  let allPass = true;

  for (const filePath of testFiles) {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      allPass = false;
      continue;
    }

    console.log('============================================================');
    console.log(`COMPARING: ${filePath}`);
    console.log('============================================================');

    // 1. Analyze original
    const orig = await analyzeOriginalPdf(filePath);

    // 2. Extract with pdftext.js
    const origBytes = new Uint8Array(fs.readFileSync(filePath));
    const imported = await extractTextFromPdf(origBytes);

    // Count dash lines in import
    const importedDashMatches = imported.html.match(/<p[^>]*>-\s/g) || [];
    const importedDashCount = importedDashMatches.length;

    // Check hyphenated words
    const importedTextClean = imported.html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    const lostHyphenatedWords = [];
    for (const word of orig.hyphenatedWords) {
      if (!importedTextClean.toLowerCase().includes(word.toLowerCase())) {
        lostHyphenatedWords.push(word);
      }
    }

    // 3. Print imported HTML to PDF via headless browser
    const printDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    ${fontsCss}
    ${cssContent}
    @page {
      size: ${imported.pageWidth}pt ${imported.pageHeight}pt;
      margin: ${imported.topMargin}pt ${imported.rightMargin}pt ${imported.bottomMargin}pt ${imported.leftMargin}pt;
    }
  </style>
</head>
<body>
  <div class="page-sheet">
    ${imported.html}
  </div>
</body>
</html>`;

    const baseName = path.basename(filePath, '.pdf');
    const tempHtmlPath = path.resolve(`test-samples/temp-compare-${baseName}.html`);
    const tempPdfPath = path.resolve(`test-samples/temp-compare-${baseName}.pdf`);
    fs.writeFileSync(tempHtmlPath, printDoc, 'utf8');

    try { fs.unlinkSync(tempPdfPath); } catch {}

    execFileSync(browserPath, [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--print-to-pdf=' + tempPdfPath,
      'file:///' + tempHtmlPath.replace(/\\/g, '/')
    ]);

    const printedPdfBytes = new Uint8Array(fs.readFileSync(tempPdfPath));
    const printedDoc = await global.pdfjsLib.getDocument({
      data: printedPdfBytes,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
    }).promise;

    const importedPrintedPageCount = printedDoc.numPages;

    // 4. Render side-by-side comparison image at 60 DPI
    const sideBySideHtml = generateSideBySideHtml(filePath, tempPdfPath, baseName, Math.max(orig.numPages, importedPrintedPageCount));
    const sideHtmlPath = path.resolve(`test-samples/temp-side-${baseName}.html`);
    const sideImgPath = path.resolve(`test-samples/compare-${baseName}.png`);
    fs.writeFileSync(sideHtmlPath, sideBySideHtml, 'utf8');

    const windowHeight = Math.max(900, Math.max(orig.numPages, importedPrintedPageCount) * 780 + 100);
    execFileSync(browserPath, [
      '--headless=new',
      '--disable-gpu',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=6000',
      '--screenshot=' + sideImgPath,
      `--window-size=1200,${windowHeight}`,
      'file:///' + sideHtmlPath.replace(/\\/g, '/')
    ]);

    // Also copy to test-samples/compare-prd.png if baseName is prd-original
    if (baseName === 'prd-original') {
      try {
        fs.copyFileSync(sideImgPath, path.resolve('test-samples/compare-prd.png'));
      } catch {}
    }

    // Clean up temp html
    try { fs.unlinkSync(tempHtmlPath); } catch {}
    try { fs.unlinkSync(sideHtmlPath); } catch {}

    // Output results as required
    console.log(`- Original page count: ${orig.numPages}`);
    console.log(`- Imported printed page count: ${importedPrintedPageCount}`);
    console.log(`- Original fonts: ${orig.fonts.join(', ')}`);
    console.log(`- Imported font families: ${imported.dominantFontFamily}`);
    console.log(`- Title in original: "${orig.titleStr}" (Size: ${orig.titleFontSize}pt, Color: ${orig.titleColor})`);
    console.log(`- Title in import:   "${imported.title}" (Size: ${imported.titleFontSize}pt, Color: ${imported.titleColor})`);
    console.log(`- Number of dash lines in original: ${orig.dashLinesCount}`);
    console.log(`- Number of dash lines in import:   ${importedDashCount}`);
    console.log(`- Lost hyphenated words count: ${lostHyphenatedWords.length}`);
    if (lostHyphenatedWords.length > 0) {
      console.log(`  Lost words: ${lostHyphenatedWords.join(', ')}`);
    }
    console.log(`- Side-by-side comparison image saved to: test-samples/compare-${baseName}.png`);

    // Verification check
    const pageCountMatch = orig.numPages === importedPrintedPageCount;
    const titleSizeMatch = orig.titleFontSize === imported.titleFontSize;
    const titleColorMatch = orig.titleColor.toLowerCase() === imported.titleColor.toLowerCase();
    const dashLinesMatch = orig.dashLinesCount === importedDashCount;
    const noLostHyphens = lostHyphenatedWords.length === 0;

    let fontMapMatch = false;
    if (baseName === 'original' && imported.dominantFontFamily.includes('Carlito')) fontMapMatch = true;
    if (baseName.includes('prd') && imported.dominantFontFamily.includes('Arimo')) fontMapMatch = true;

    console.log('------------------------------------------------------------');
    console.log(`Page count matches:      ${pageCountMatch ? 'PASS' : 'FAIL'}`);
    console.log(`Font mapping matches:     ${fontMapMatch ? 'PASS' : 'FAIL'}`);
    console.log(`Title size & color match: ${titleSizeMatch && titleColorMatch ? 'PASS' : 'FAIL'}`);
    console.log(`Dash lines match:         ${dashLinesMatch ? 'PASS' : 'FAIL'}`);
    console.log(`No hyphenated word lost:  ${noLostHyphens ? 'PASS' : 'FAIL'}`);

    const filePassed = pageCountMatch && fontMapMatch && titleSizeMatch && titleColorMatch && dashLinesMatch && noLostHyphens;
    if (!filePassed) allPass = false;
    console.log(`Overall file status:     ${filePassed ? 'PASS' : 'FAIL'}`);
  }

  console.log('============================================================');
  if (allPass) {
    console.log('ALL FILES PASSED ALL CHECKS!');
    process.exit(0);
  } else {
    console.error('ONE OR MORE CHECKS FAILED.');
    process.exit(1);
  }
}

await runComparison();

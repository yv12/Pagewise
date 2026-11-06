import fs from 'fs';
import path from 'path';

// Locate files
const pdfPath = fs.existsSync('test-samples/original.pdf')
  ? 'test-samples/original.pdf'
  : (fs.existsSync('pagewise-docs/test-samples/original.pdf') ? 'pagewise-docs/test-samples/original.pdf' : null);

if (!pdfPath) {
  console.error('test-samples/original.pdf not found');
  process.exit(1);
}

const vendorDir = fs.existsSync('scripts/vendor')
  ? 'scripts/vendor'
  : (fs.existsSync('pagewise-docs/scripts/vendor') ? 'pagewise-docs/scripts/vendor' : null);

let workerCode, pdfCode;
if (vendorDir && fs.existsSync(path.join(vendorDir, 'pdf.min.js'))) {
  workerCode = fs.readFileSync(path.join(vendorDir, 'pdf.worker.min.js'), 'utf8');
  pdfCode = fs.readFileSync(path.join(vendorDir, 'pdf.min.js'), 'utf8');
} else {
  workerCode = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js').then(r => r.text());
  pdfCode = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js').then(r => r.text());
}

global.window = global;
global.document = {
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
  head: { appendChild: () => {} }
};
new Function(workerCode)();
new Function(pdfCode)();

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await global.pdfjsLib.getDocument({
  data,
  cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
}).promise;

function getPercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

const allLines = [];
let pageWidth = 0;

for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.0 });
  pageWidth = viewport.width;

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
    const x = it.transform[4];
    const y = viewport.height - it.transform[5];
    const font = getRealFont(it.fontName);
    rawItems.push({
      str: it.str,
      x,
      y,
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

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    const nonSpace = line.items.filter(it => it.str.trim() !== '');
    if (!nonSpace.length) continue;

    let lineText = '';
    let lastEnd = null;
    for (const it of line.items) {
      if (!it.str && !it.width) continue;
      if (lastEnd !== null && it.x > lastEnd + 1.5 && !lineText.endsWith(' ') && !it.str.startsWith(' ')) {
        lineText += ' ';
      }
      lineText += it.str;
      lastEnd = it.x + it.width;
    }

    const xStart = nonSpace[0].x;
    const lastItem = nonSpace[nonSpace.length - 1];
    const xEnd = lastItem.x + lastItem.width;
    const fontSize = nonSpace[0].fontSize;
    const bold = nonSpace.some(it => it.isBold);

    allLines.push({
      page: pageNum,
      xStart,
      xEnd,
      y: line.y,
      fontSize,
      bold,
      text: lineText.trim()
    });
  }
}

// Compute left margin (most common line start x)
const startBins = new Map();
for (const l of allLines) {
  // Round to 1 decimal place to group floats
  const bin = Math.round(l.xStart * 10) / 10;
  startBins.set(bin, (startBins.get(bin) || 0) + 1);
}
let leftMargin = 0;
let maxStartCount = 0;
for (const [bin, count] of startBins) {
  if (count > maxStartCount) {
    maxStartCount = count;
    leftMargin = bin;
  }
}

// Compute right margin (95th percentile of line end x)
const rightMargin = getPercentile(allLines.map(l => l.xEnd), 0.95);

// Print the output
console.log(`Page Width: ${pageWidth.toFixed(2)} pt`);
console.log(`Left Margin (most common line start x): ${leftMargin.toFixed(2)} pt (occurred ${maxStartCount} times)`);
console.log(`Right Margin (95th percentile of line end x): ${rightMargin.toFixed(2)} pt`);
console.log('');
console.log('Visual Lines:');
console.log('------------------------------------------------------------------------------------------------------------------------');
console.log(
  'Page'.padEnd(5) + ' | ' +
  'x start'.padStart(7) + ' | ' +
  'x end'.padStart(7) + ' | ' +
  'y'.padStart(7) + ' | ' +
  'font size'.padStart(9) + ' | ' +
  'bold'.padEnd(5) + ' | ' +
  'text'
);
console.log('------------------------------------------------------------------------------------------------------------------------');

for (const l of allLines) {
  const pStr = String(l.page).padEnd(5);
  const xsStr = l.xStart.toFixed(2).padStart(7);
  const xeStr = l.xEnd.toFixed(2).padStart(7);
  const yStr = l.y.toFixed(2).padStart(7);
  const fsStr = String(l.fontSize).padStart(9);
  const bStr = String(l.bold).padEnd(5);
  console.log(`${pStr} | ${xsStr} | ${xeStr} | ${yStr} | ${fsStr} | ${bStr} | ${l.text}`);
}

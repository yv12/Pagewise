import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// Resolve paths
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

// Load extractTextFromPdf
const pdftextModulePath = fs.existsSync('public/js/pdftext.js')
  ? path.resolve('public/js/pdftext.js')
  : path.resolve('pagewise-docs/public/js/pdftext.js');

const { extractTextFromPdf } = await import('file:///' + pdftextModulePath.replace(/\\/g, '/'));

// Read original PDF bytes
const origDoc = await global.pdfjsLib.getDocument({
  data: new Uint8Array(fs.readFileSync(pdfPath)),
  cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
}).promise;

let originalBulletCount = 0;
for (let p = 1; p <= origDoc.numPages; p++) {
  const page = await origDoc.getPage(p);
  const viewport = page.getViewport({ scale: 1.0 });
  const textContent = await page.getTextContent();
  const rawItems = [];
  for (const it of textContent.items) {
    if (!it.str && !it.width) continue;
    rawItems.push({
      str: it.str,
      x: it.transform[4],
      y: viewport.height - it.transform[5]
    });
  }
  rawItems.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of rawItems) {
    const line = lines.find(l => Math.abs(l.y - it.y) <= 3);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    const text = line.items.map(it => it.str).join('').trim();
    if (/^[•\u2022\u25cf\u25e6\u2219\*\-\–\—▪▫]/.test(text)) {
      originalBulletCount++;
    }
  }
}

// 2. Run extraction
const res = await extractTextFromPdf(new Uint8Array(fs.readFileSync(pdfPath)));
const html = res.html;

console.log('============================================================');
console.log('PDF IMPORT VERIFICATION FOR test-samples/original.pdf');
console.log('============================================================');

let allPassed = true;

// Check 1: the number of <li> items equals the number of bullets in the original
const liMatches = html.match(/<li[\s>]/gi) || [];
const liCount = liMatches.length;
const check1Pass = liCount === originalBulletCount;
if (!check1Pass) allPassed = false;
console.log(`Check 1: <li> items count equals original bullets`);
console.log(`  - Original bullets: ${originalBulletCount}`);
console.log(`  - Imported <li> count: ${liCount}`);
console.log(`  - Result: ${check1Pass ? 'PASS' : 'FAIL'}`);
console.log('------------------------------------------------------------');

// Check 2: no <p> or <li> starts with a lowercase letter
const pAndLiMatches = [];
const itemRegex = /<(p|li)([^>]*)>([\s\S]*?)<\/\1>/gi;
let match;
while ((match = itemRegex.exec(html)) !== null) {
  const tag = match[1];
  const rawInner = match[3];
  // Strip inner html tags
  const textOnly = rawInner.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/&quot;/g, '"');
  // Trim leading whitespace and common punctuation
  const trimmed = textOnly.trim().replace(/^[\s"'“‘(\[\{\-–—]+/, '');
  pAndLiMatches.push({ tag, full: match[0], textOnly: trimmed });
}

let check2Pass = true;
const lowercaseStarts = [];
for (const item of pAndLiMatches) {
  if (!item.textOnly.length) continue;
  const firstLetter = item.textOnly[0];
  if (/[a-z]/.test(firstLetter)) {
    check2Pass = false;
    allPassed = false;
    lowercaseStarts.push({ tag: item.tag, firstLetter, textSnippet: item.textOnly.slice(0, 40) });
  }
}

console.log(`Check 2: No <p> or <li> starts with a lowercase letter`);
if (check2Pass) {
  console.log(`  - Checked ${pAndLiMatches.length} elements (<p> and <li>)`);
  console.log(`  - Result: PASS`);
} else {
  console.log(`  - Result: FAIL (${lowercaseStarts.length} elements start with lowercase)`);
  for (const s of lowercaseStarts) {
    console.log(`    - <${s.tag}> starts with '${s.firstLetter}': "${s.textSnippet}..."`);
  }
}
console.log('------------------------------------------------------------');

// Check 3: no paragraph is centered except the top block
// Top block is everything before the first section heading (<h2>)
const h2Idx = html.indexOf('<h2');
let check3Pass = true;
const invalidCentered = [];

if (h2Idx !== -1) {
  const afterH2 = html.slice(h2Idx);
  const pRegex = /<p([^>]*)>([\s\S]*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = pRegex.exec(afterH2)) !== null) {
    const attrs = pMatch[1] || '';
    if (/text-align\s*:\s*center/i.test(attrs) || /class="[^"]*center[^"]*"/i.test(attrs)) {
      check3Pass = false;
      allPassed = false;
      const snippet = pMatch[2].replace(/<[^>]+>/g, '').slice(0, 40);
      invalidCentered.push(snippet);
    }
  }
}

console.log(`Check 3: No paragraph is centered except the top block`);
if (check3Pass) {
  console.log(`  - Result: PASS`);
} else {
  console.log(`  - Result: FAIL (${invalidCentered.length} paragraphs after section heading are centered)`);
  for (const s of invalidCentered) {
    console.log(`    - Centered paragraph: "${s}..."`);
  }
}
console.log('------------------------------------------------------------');

// Check 4: the printed page count is 1
const cssPath = fs.existsSync('public/css/app.css')
  ? path.resolve('public/css/app.css')
  : path.resolve('pagewise-docs/public/css/app.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

const fullRenderDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    ${cssContent}
  </style>
</head>
<body>
  <div class="page-sheet">
    ${html}
  </div>
</body>
</html>`;

const tempDir = fs.existsSync('test-samples') ? 'test-samples' : 'pagewise-docs/test-samples';
const tempHtmlPath = path.resolve(path.join(tempDir, 'temp-check-render.html'));
const tempPdfPath = path.resolve(path.join(tempDir, 'temp-check-render.pdf'));

fs.writeFileSync(tempHtmlPath, fullRenderDoc, 'utf8');
try { fs.unlinkSync(tempPdfPath); } catch {}

// Locate Chrome / Edge
const browserCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

let browserPath = browserCandidates.find(p => fs.existsSync(p));

let check4Pass = false;
let printedPageCount = 0;

if (browserPath) {
  try {
    execFileSync(browserPath, [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--print-to-pdf=' + tempPdfPath,
      'file:///' + tempHtmlPath.replace(/\\/g, '/')
    ]);

    if (fs.existsSync(tempPdfPath)) {
      const renderedPdfBytes = new Uint8Array(fs.readFileSync(tempPdfPath));
      const renderedDoc = await global.pdfjsLib.getDocument({
        data: renderedPdfBytes,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
      }).promise;

      printedPageCount = renderedDoc.numPages;
      check4Pass = printedPageCount === 1;
    }
  } catch (err) {
    console.error('Browser print error:', err.message);
  } finally {
    try { fs.unlinkSync(tempHtmlPath); } catch {}
    try { fs.unlinkSync(tempPdfPath); } catch {}
  }
} else {
  console.warn('No headless browser found to print PDF.');
}

if (!check4Pass) allPassed = false;
console.log(`Check 4: Printed page count is 1`);
console.log(`  - Printed page count: ${printedPageCount}`);
console.log(`  - Result: ${check4Pass ? 'PASS' : 'FAIL'}`);
console.log('============================================================');

if (allPassed) {
  console.log('ALL 4 CHECKS PASSED!');
  process.exit(0);
} else {
  console.error('ONE OR MORE CHECKS FAILED.');
  process.exit(1);
}

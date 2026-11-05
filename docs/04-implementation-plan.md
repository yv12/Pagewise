# 04. Implementation Plan

Build in order. Finish and test one phase before starting the next. Read `03-architecture.md` before every phase. Do not add features that are not listed.

---

## Phase 1: Server, database, MCP tools
**Goal:** Claude can create and read a document in the app.

Tasks:
1. Create `package.json` with only the packages listed in the architecture file. Set `"type": "module"` and a `start` script.
2. `db.js`: open SQLite at `DATA_DIR`, create the 3 tables, add small helper functions.
3. `clean.js`: sanitize-html with the allowed tags and attributes.
4. `mcp.js`: the 5 tools with zod inputs and clear descriptions.
5. `server.js`: Express, JSON body limit 1 MB, `POST /mcp/:key`, 405 for GET and DELETE, `POST /api/workspaces`, `GET /healthz`.

Files touched: `package.json`, `db.js`, `clean.js`, `mcp.js`, `server.js`.

Done when:
- `npm start` runs with no errors.
- A curl call to create a workspace returns a key.
- A curl MCP call to `tools/list` shows 5 tools.
- A curl MCP call to `create_document` returns an id and URLs, and `get_document` returns the same content.

---

## Phase 2: Dashboard and browser editor
**Goal:** A person can open the app, see what Claude made, and change it.

Tasks:
1. `api.js`: list, get, put (with version check), delete, create.
2. `index.html`: one button, creates workspace, saves key in localStorage, goes to the dashboard.
3. `dashboard.html`: document cards (title, time, "edited by Claude" or "edited by you"), MCP link box with copy button, 3 setup steps for Claude, auto refresh every 10 seconds, delete button.
4. `editor.html` and `editor.js`: title field, toolbar (bold, italic, underline, H1, H2, H3, bullet list, numbered list, link, align, undo, redo), page-style editing area, autosave, status text ("Saved", "Saving...", "Changed elsewhere").
5. `css/app.css`: clean, simple look. Page width like A4.

Files touched: `api.js`, `server.js`, `public/*.html`, `public/js/common.js`, `public/js/editor.js`, `public/css/app.css`.

Done when:
- Create a document with curl MCP, see it on the dashboard within 10 seconds.
- Open it, change a sentence, refresh, the change is still there.
- Update the same document through MCP, the editor shows the version conflict message if the user had old content open.

---

## Phase 3: PDF download and share link
**Goal:** The user gets a clean PDF and a link to share.

Tasks:
1. Print stylesheet: hide toolbar and buttons, A4 page, margins, readable fonts.
2. "Download PDF" button calls `window.print()` with a short hint: "Choose Save as PDF."
3. `view.html` and `GET /api/p/:id`: read-only page with a Download PDF button.
4. "Copy share link" button in the editor.

Files touched: `css/app.css`, `editor.html`, `view.html`, `api.js`.

Done when:
- Print preview shows only the document, on A4, no toolbar.
- The public link opens in a private window with no workspace key.

---

## Phase 4: Upload a PDF and edit as text
**Goal:** A text PDF becomes an editable document.

Tasks:
1. Dashboard: "Upload PDF" button and drag and drop.
2. `pdftext.js`: use pdf.js to read all pages. Group text items into lines by their vertical position. Use the largest font sizes for h1 and h2. Join lines into paragraphs. Detect lines starting with a bullet or number as list items. Return clean HTML.
3. `POST /upload`: check size and `%PDF` header, save file to `DATA_DIR/files`, create a `pdf` doc.
4. If the extracted text is almost empty, show: "This looks like a scanned PDF. Text editing is not possible. You can still sign it."
5. Open the editor for the new doc after upload.

Files touched: `public/js/pdftext.js`, `dashboard.html`, `api.js`.

Done when:
- A text PDF (such as a resume) uploads and shows headings and paragraphs in the editor.
- A scanned PDF shows the warning and does not crash.
- `get_document` through MCP returns the extracted text, so Claude can rewrite it.

---

## Phase 5: Sign on the original PDF
**Goal:** The user signs an NDA and downloads it.

Tasks:
1. `sign.html` and `sign.js`: load the original through `GET files/:fileId`, draw pages on canvases with pdf.js.
2. Signature maker with 3 tabs: Draw (canvas, mouse and touch), Type (name in a cursive font, rendered to PNG), Upload image. Output a transparent PNG. Save the last signature in `localStorage` for reuse.
3. Placement: click "Add signature", then drag it on a page and resize with a corner handle. Also "Add date" and "Add text" boxes.
4. Store positions as fractions of page width and height, with the page number.
5. Download: load the original bytes with `pdf-lib`, embed the PNG and text, save, trigger download. Also `POST /signed` to store the signed copy and show "Signed copy saved" on the dashboard.
6. Show this line near the Download button: "This is a visual signature, not a certified digital signature."

Files touched: `public/sign.html`, `public/js/sign.js`, `api.js`, `dashboard.html`.

Done when:
- A multi-page PDF is signed on page 2, and the signature is in the right place in a normal PDF reader.
- Reloading the page lets the user download the saved signed copy again.
- Touch drawing works on a phone.

---

## Phase 6: Deploy and connect to Claude
**Goal:** It is live, and a reviewer can try it.

Tasks:
1. `README.md`: what it is, the 4 assignment rules and how each is met, local run steps, Folio credit, known limits.
2. Push to GitHub.
3. Railway: new project from the repo, add a volume mounted at `/data`, set `DATA_DIR=/data` and `BASE_URL=<railway url>`, generate a public domain.
4. Open the live site, create a workspace, copy the MCP link.
5. In Claude: Settings, Connectors, Add custom connector, paste the link.
6. Run the demo script in `06-test-checklist.md`.
7. Confirm no AI keys exist: search the repo for `openai`, `anthropic`, `api_key`.

Done when:
- The demo script passes on the live URL.
- The service keeps its documents after a Railway restart.

---

## Cut list (if time or limits run short)
Drop in this order: Phase 3 share link, "Add text" in signing, type and upload tabs of the signature maker. Never drop: MCP create and update, browser edit, PDF download, live deploy.

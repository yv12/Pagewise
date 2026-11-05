# 03. Architecture

This file is the single source of truth. Do not change these decisions without asking the user.

## Stack (fixed)
| Part | Choice |
|---|---|
| Runtime | Node.js 20 or newer, ES modules |
| Server | Express 4 |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP, stateless (new server per request) |
| Database | SQLite through `better-sqlite3` |
| HTML cleaning | `sanitize-html` |
| Input checks | `zod` |
| Frontend | Plain HTML, CSS, JavaScript. No framework. No build step. |
| PDF reading | `pdf.js` from cdnjs, in the browser |
| PDF signing | `pdf-lib` from cdnjs, in the browser |
| Editor | `contenteditable` with a small toolbar (`document.execCommand`) |
| PDF export of Claude documents | Browser print to PDF with a print stylesheet |
| Hosting | Railway, one service, one volume mounted at `/data` |

Forbidden: any AI SDK or key (openai, anthropic, google generative, etc.), any ORM, any frontend framework, any build tool.

## Folder structure
```
pagewise/
  server.js            // starts Express, mounts routes
  db.js                // opens SQLite, creates tables, small query helpers
  mcp.js               // builds the MCP server and its 5 tools
  api.js               // REST routes used by the web pages
  clean.js             // sanitize-html settings
  public/
    index.html         // landing page, creates a workspace
    dashboard.html     // list of documents, MCP link, upload button
    editor.html        // edit a Claude-made or extracted document
    sign.html          // view original PDF, place signature
    view.html          // read-only public page
    css/app.css        // shared styles and print styles
    js/common.js       // fetch helpers, copy-to-clipboard, time format
    js/editor.js
    js/sign.js
    js/pdftext.js      // PDF to HTML text extraction
  docs/                // these files
  CLAUDE.md
  README.md
  package.json
```
Keep each file under about 250 lines. If a file grows past that, split it.

## Identity (no login)
- A workspace is created with one click. The server makes a random 32-character hex key.
- The key is the only identity. Web URL: `/w/<key>`. MCP URL: `/mcp/<key>`.
- Anyone with the key can see that workspace. The dashboard must say: "Keep this link private."
- The key is saved in the browser `localStorage` so the user returns to the same dashboard.

## Database tables
```
workspaces(key TEXT PRIMARY KEY, created_at TEXT)

docs(
  id TEXT PRIMARY KEY,          // 12 hex chars
  ws TEXT NOT NULL,             // workspace key
  kind TEXT NOT NULL,           // 'doc' (made in Claude or in the editor) or 'pdf' (uploaded)
  title TEXT NOT NULL,
  html TEXT NOT NULL,           // cleaned HTML; for kind 'pdf' it is the extracted text
  version INTEGER NOT NULL,     // starts at 1, +1 on every change
  last_editor TEXT NOT NULL,    // 'claude' or 'user'
  created_at TEXT, updated_at TEXT
)

files(
  id TEXT PRIMARY KEY,
  ws TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  role TEXT NOT NULL,           // 'original' or 'signed'
  filename TEXT NOT NULL,
  created_at TEXT
)
```
Files are stored on disk at `DATA_DIR/files/<file id>.pdf`. `DATA_DIR` defaults to `./data`, and is `/data` on Railway.

## MCP tools (exactly these 5)
All tools work only inside the workspace of the key in the URL. Every tool returns plain JSON text.

| Tool | Input | What it does | Returns |
|---|---|---|---|
| `create_document` | `title` (string), `html` (string) | Saves a new document, kind `doc`. | `id`, `title`, `version`, `edit_url`, `view_url` |
| `update_document` | `id`, optional `title`, optional `html`, optional `base_version` (number) | Replaces title and/or content. If `base_version` is given and does not match, return an error: "Document changed. Call get_document first." | `id`, `version`, `edit_url` |
| `get_document` | `id` | Reads the latest title, HTML, text, version, last_editor. Works for uploaded PDFs too (extracted text). | `id`, `title`, `kind`, `html`, `version`, `last_editor`, `has_signed_copy` |
| `list_documents` | none | Lists documents, newest first. | array of `id`, `title`, `kind`, `updated_at`, `last_editor` |
| `delete_document` | `id` | Deletes a document and its files. | `deleted: true` |

Tool descriptions must tell Claude: "Write content as simple HTML: h1, h2, h3, p, ul, ol, li, strong, em, table, tr, th, td, a, br. No scripts, no styles, no images."

Implementation notes:
- Endpoint: `POST /mcp/:key`. `GET` and `DELETE` on that path return 405.
- Create a new `McpServer` and a `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` for each request.
- Return `edit_url` and `view_url` using `BASE_URL` env var, or the request host if not set.

## REST API used by the web pages
All under `/api`. `:key` is the workspace key.

| Method and path | Purpose |
|---|---|
| `POST /api/workspaces` | Create workspace, return `{key}` |
| `GET /api/w/:key/docs` | List documents |
| `GET /api/w/:key/docs/:id` | Get one document |
| `PUT /api/w/:key/docs/:id` | Save from editor. Body: `title`, `html`, `version`. Sets `last_editor` to `user`. 409 if version is old. |
| `DELETE /api/w/:key/docs/:id` | Delete |
| `POST /api/w/:key/docs` | Create from the browser (used after PDF text extraction) |
| `POST /api/w/:key/upload` | Upload a PDF (multipart or raw body, max 10 MB). Stores file with role `original`, creates a `pdf` doc. |
| `GET /api/w/:key/files/:fileId` | Download a stored PDF |
| `POST /api/w/:key/docs/:id/signed` | Upload the signed PDF made in the browser. Stores with role `signed`. |
| `GET /api/p/:id` | Public read-only document (title and html only) |

## Page routes
| Path | Page |
|---|---|
| `/` | Landing, "Create my workspace" |
| `/w/:key` | Dashboard |
| `/w/:key/d/:id` | Editor (kind `doc`, or extracted text of kind `pdf`) |
| `/w/:key/s/:id` | Sign page (kind `pdf`) |
| `/p/:id` | Public read-only view |

## Main flows
**Claude creates a document**
Claude calls `create_document` -> server cleans HTML -> row saved -> Claude shows `edit_url` to the user.

**User edits**
Editor loads doc -> user types -> autosave after 1.5 seconds with `PUT` and `version` -> server returns new version. If 409, show "Changed elsewhere. Reload." with a reload button.

**Dashboard stays fresh**
Dashboard re-fetches the list every 10 seconds so new documents from Claude appear without a reload.

**Upload and edit as text**
Browser reads PDF with pdf.js -> `pdftext.js` builds HTML (group text by line, treat larger font as headings) -> `POST /upload` stores the file and creates a `pdf` doc with this HTML -> user can open the editor.

**Upload and sign**
Sign page loads the original through `GET files/:fileId` -> pdf.js draws each page on a canvas -> user makes a signature (draw, type, or upload image) as a PNG -> user drags and resizes it on a page overlay -> on Download, `pdf-lib` embeds the PNG and any typed text at the matching spot (positions saved as fractions of page width and height) -> browser downloads the file and also posts it to `/signed`.

## Cleaning rules (`clean.js`)
Allowed tags: h1, h2, h3, p, ul, ol, li, strong, em, u, table, thead, tbody, tr, th, td, a, br, blockquote, hr. Allowed attributes: `href` on `a` (http, https, mailto only), `style` with only `text-align`. Everything else is removed. Apply on every write, from MCP or from the browser.

## Environment variables
| Name | Use |
|---|---|
| `PORT` | Provided by Railway |
| `DATA_DIR` | Set to `/data` on Railway |
| `BASE_URL` | Public site URL, for links returned by MCP |

No other variables. No API keys of any kind.

## Limits
- Document HTML: 500 KB.
- Upload: 10 MB, PDF only (check the file starts with `%PDF`).
- Workspace creation: max 10 per IP per hour (in-memory counter is enough).
- Title: 200 characters.

## Security basics
- All SQL uses prepared statements.
- Never trust HTML. Clean on write.
- Never log workspace keys.
- Public view `/p/:id` shows only title and html.

## Known limits to show on the site
- Text extraction works for text PDFs, not scans. Layout and images are not kept.
- Signature is visual, not a certified digital signature.

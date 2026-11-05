# Pagewise

Pagewise is a lightweight web application that runs on Claude through the Model Context Protocol (MCP). Claude does the thinking, drafting, and rewriting. Pagewise does everything else: document persistence, browser-based rich text editing, visual PDF signing, and document serving.

There is zero AI inside the application. No AI SDKs, no AI API keys, and no AI calls are made by the server or client.

---

## Target Audience & Problem

Freelancers, founders, and small business owners frequently use Claude to draft documents such as proposals, engagement letters, NDAs, and resumes.

**The pain point today:**
1. Claude drafts a document.
2. The user copies or downloads it as a PDF or text.
3. To edit one line or fix formatting, the user converts between formats or opens Word/Google Docs, breaking the layout.
4. For contracts or NDAs, the user prints, manually signs, and scans, or searches for another signing tool.

**What Pagewise changes:**
- Users prompt Claude in chat, and a real, structured document is instantly created in Pagewise via MCP.
- The user can open the document link and edit it directly in their browser with live autosave.
- The user can export a clean, printable A4 PDF.
- The user can upload existing text or contract PDFs, extract text for Claude to review/rewrite, and place visual signatures directly onto the original PDF.

---

## The 4 Assignment Rules & How Each Is Met

| Rule | Requirement | How Pagewise Meets It |
|---|---|---|
| **1. Works from Claude** | A request typed in Claude creates something real in the app. | Pagewise implements a Streamable HTTP MCP endpoint (`POST /mcp/:key`) exposing 5 tools (`create_document`, `update_document`, `get_document`, `list_documents`, `delete_document`). Claude calls these tools to create, read, update, and manage documents in real time. |
| **2. Let a person edit it** | The reviewer can open the app, see what Claude created, and change it. | A distraction-free browser editor (`/w/:key/d/:id`) with rich text formatting (headings, lists, bold, italics, links, alignment), 1.5-second debounce autosave, version conflict detection (HTTP 409), and print-to-PDF styles. |
| **3. Live on the internet** | The reviewer can try it on a live public URL. | Configured for deployment on Railway with persistent volume storage (`/data`) and public HTTPS access. |
| **4. No AI inside** | No AI SDKs or AI keys anywhere in the app. | Zero AI packages in `package.json`, zero AI API keys or environment variables, and zero outgoing AI requests. Claude operates strictly external to the app as an MCP client. |

---

## Getting Started: Local Run

### Prerequisites
- Node.js 20 or newer
- npm 9 or newer

### Installation & Run

1. Clone or extract the repository:
   ```bash
   cd pagewise-docs
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm start
   ```

4. Open your browser at:
   ```
   http://localhost:3000
   ```

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port for the Express HTTP server |
| `DATA_DIR` | `./data` | Directory where SQLite database (`pagewise.db`) and uploaded files are stored. Mounted at `/data` on Railway. |
| `BASE_URL` | *(Request host)* | Public base URL used to construct `edit_url` and `view_url` returned to Claude over MCP. |

---

## Deployment (Railway)

1. **Repository**: Push the code to a GitHub repository.
2. **New Project**: In Railway, create a new project from your GitHub repository.
3. **Volume**: Add a Persistent Volume mounted at `/data`.
4. **Environment Variables**:
   - `DATA_DIR=/data`
   - `BASE_URL=https://<your-railway-domain>`
5. **Networking**: Generate a public domain under service Settings -> Networking.
6. **Health Check**: Railway automatically checks `/healthz` which returns `{ "status": "ok" }`.

---

## Connecting Claude to Pagewise (MCP)

1. Open your live Pagewise site and click **"Create my workspace"**.
2. On your workspace dashboard, copy your private MCP connector link:
   ```
   https://<your-domain>/mcp/<workspace-key>
   ```
3. In Claude (Desktop or Web where custom connectors are supported):
   - Go to **Settings** &rarr; **Connectors** (or **Developer** settings).
   - Click **Add custom connector**.
   - Enter a Name (e.g., `Pagewise`) and paste the connector URL.
   - Save and enable the connector.

### Reviewer Demo Script

1. **Create document from Claude**:
   In Claude, prompt:
   > *"Write a one page NDA between Acme Ltd and a freelancer. Save it in Pagewise."*
   Claude calls `create_document` and provides an edit link.
2. **Edit in browser**:
   Click the edit link, change a sentence in the browser editor, and verify the status says **"Saved"**.
3. **Export PDF**:
   Click **"Download PDF"** (or print to PDF). Notice the clean layout without toolbars.
4. **Update from Claude**:
   Back in Claude, prompt:
   > *"Make the NDA friendlier and shorter. Update the same document."*
   Refresh the browser editor to see the updated version.
5. **Upload and sign a PDF**:
   On the Pagewise dashboard, upload an existing PDF. Click **"Sign"**, draw or type your signature, drag it to the desired position on the document, and click **"Download signed PDF"**.
6. **Claude reads uploaded documents**:
   In Claude, prompt:
   > *"Read my uploaded NDA and list the risky parts in simple words."*
   Claude calls `get_document` to read the extracted text and analyze it.

---

## Known Limits

- **Text extraction from PDFs**: Extraction works on text-based PDFs using `pdf.js`. Scanned image PDFs (photos of paper without text layers) cannot be converted to editable text (though they can still be signed).
- **Layout and styling**: PDF text extraction extracts plain semantic HTML text (headings, paragraphs, lists) and omits embedded images or complex multi-column print coordinates.
- **Visual signatures only**: Pagewise provides visual overlay signatures (PNG stamp placed using `pdf-lib`). It is not a cryptographically certified digital signature (e.g., DSC, eIDAS, or Aadhaar eSign).
- **Size and rate limits**: Request HTML bodies are limited to 500 KB; PDF uploads are capped at 10 MB; workspace creation is rate-limited to 10 workspaces per IP per hour.

---

## Reference & Credits

- **Folio**: Signature approach inspired by [Folio](https://github.com/Forward-Future/folio) (MIT license). The signature placement flow and PDF handling concept were adapted and rewritten in vanilla JavaScript with `pdf.js` and `pdf-lib` without React, Electron, or AI dependencies.

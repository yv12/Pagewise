# 06. Test Checklist

Tick each item before moving on.

## Phase 1: Server and MCP
- [x] `npm install` and `npm start` work on a clean folder.
- [x] `GET /healthz` returns ok.
- [x] `POST /api/workspaces` returns a 32 character key.
- [x] MCP `tools/list` returns exactly 5 tools.
- [x] `create_document` with HTML containing a `<script>` tag saves without the script.
- [x] `get_document` returns what was saved.
- [x] `update_document` with an old `base_version` returns the conflict message.
- [x] A key from another workspace cannot read the document.
- [x] `delete_document` removes it.

## Phase 2: Dashboard and editor
- [x] Landing page creates a workspace and opens the dashboard.
- [x] Dashboard shows the MCP link and the copy button works.
- [x] A document made through MCP appears within 10 seconds.
- [x] Card shows "edited by Claude". After a user edit it shows "edited by you".
- [x] Editor toolbar works: bold, italic, headings, lists, link, align, undo.
- [x] Autosave works. Refresh keeps the change.
- [x] Conflict message appears if Claude updated the document meanwhile.
- [x] Delete asks for confirmation and removes the card.

## Phase 3: PDF and share
- [x] Print preview shows only the page, A4, no toolbar.
- [x] Saved PDF has selectable text.
- [x] Public link opens without the workspace key and cannot edit.

## Phase 4: Upload and text extraction
- [x] Resume PDF: headings and paragraphs look right in the editor.
- [x] Non PDF file is rejected with a clear message.
- [x] File over 10 MB is rejected with a clear message.
- [x] Scanned PDF shows the warning and still allows signing.
- [x] `get_document` through MCP returns the extracted text.

## Phase 5: Signing
- [ ] Draw signature works with mouse and with touch.
- [ ] Type signature works.
- [ ] Upload image signature works.
- [ ] Signature can be moved and resized on any page.
- [ ] Downloaded PDF shows the signature in the right place, in two different PDF readers.
- [ ] The visual signature note is visible.
- [ ] Signed copy is saved and downloadable again from the dashboard.

## Phase 6: Live and connected
- [ ] The live URL opens over https.
- [ ] The service keeps documents after a restart.
- [ ] Custom connector is added in Claude with the MCP link.
- [ ] Repo search for `openai`, `anthropic`, `api_key`, `sk-` finds nothing.
- [ ] README explains the 4 assignment rules and credits Folio.

## Final demo script (for the Voloplay reviewer)
1. Open the live site. Click "Create my workspace".
2. Copy the connector link. In Claude, add it as a custom connector.
3. In Claude type: "Write a one page NDA between Acme Ltd and a freelancer. Save it in Pagewise."
4. Open the link Claude gives. Change one sentence. Wait for "Saved".
5. Click Download PDF.
6. Back in Claude type: "Make the NDA friendlier and shorter. Update the same document."
7. Refresh the editor. See the new version.
8. On the dashboard, upload any PDF. Open Sign, add a signature, download.
9. Ask Claude: "Read my uploaded NDA and list the risky parts in simple words."

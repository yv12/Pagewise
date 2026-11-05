# 07. Edge Cases

Read this before each phase. Each row says what can go wrong and what the app must do. Plain messages only. The user must never see a blank screen or a raw error.

## A. Workspace and key
| Case | What the app must do |
|---|---|
| Key in the URL does not exist | Show "This link is not valid. Create a new workspace." with a button. |
| User clears the browser data and loses the key | Cannot be recovered. The dashboard says "Save your private link" with a copy button. |
| Someone guesses a key | Keys are 32 random hex characters. Do not add any shorter or readable key. |
| Same key opened in two tabs | Both work. Version checks protect edits. |
| Many workspaces created by one IP | Limit 10 per hour. Show "Too many tries. Please wait." |

## B. MCP and Claude
| Case | What the app must do |
|---|---|
| Claude sends HTML with `<script>`, `<style>`, `onclick`, or images | Clean it silently. Save the safe part. |
| Claude sends Markdown instead of HTML | Tool description asks for HTML. If the content has no HTML tags, wrap each blank-line block in `<p>`. Do not fail. |
| Claude sends empty title or empty content | Return an error: "Title and content are required." |
| Claude sends a very long document (over 500 KB) | Return an error: "Document is too long. Split it into parts." |
| Claude calls `update_document` for an id that does not exist or belongs to another workspace | Return "Document not found. Call list_documents." Do not reveal if it exists elsewhere. |
| User edited in the browser, then Claude updates with an old `base_version` | Return the conflict message: "Document changed. Call get_document first." |
| Claude updates without `base_version` | Allow it. Save, bump the version. |
| Claude calls the same create twice (retry) | Two documents are created. Acceptable. Titles stay visible so the user can delete one. |
| Claude passes only `title` or only `html` in update | Update only what was given. Keep the rest. |
| Claude connector shows tools but calls fail | Check that `POST /mcp/:key` returns JSON and the `Accept` header with `text/event-stream` is handled by the SDK. Log the status code only, never the key. |
| Server restarts while Claude is calling | Stateless design means the next call works. No session to lose. |
| Claude asks for the edit link of a deleted document | Return "Document not found." |
| `GET` on the MCP URL (a browser or a probe) | Return 405 with a short plain message. |

## C. Browser editor
| Case | What the app must do |
|---|---|
| User pastes from Word or a website | Strip unsafe markup on save. Keep headings, lists, bold, links. |
| User pastes a very large block | Block save above 500 KB with "Too long to save." Keep the text on screen. |
| Autosave fails (offline) | Show "Not saved. Check your connection." Keep the content. Retry every 5 seconds. |
| Claude updated the document while the user was typing | On save, the server returns 409. Show "Changed elsewhere" with two buttons: "Load latest" and "Keep mine and save". Keep mine saves with the latest version number. |
| User closes the tab with unsaved changes | Use `beforeunload` warning only when status is not "Saved". |
| Empty title | Save as "Untitled". |
| Very long title | Cut at 200 characters. |
| Undo after autosave | Browser undo still works. Do not rebuild the editor on save. |
| Mobile screen | Toolbar scrolls sideways. Page width fits the screen. |
| Two browser tabs open on the same document | Last save wins, version check shows the conflict message in the older tab. |

## D. PDF download (print)
| Case | What the app must do |
|---|---|
| Table wider than the page | Use `table-layout: fixed` and word wrap in the print style. |
| Page breaks cut a heading from its text | Use `break-after: avoid` on headings. |
| Browser adds headers and footers | Show the hint: "In print options, turn off Headers and footers." |
| User on a phone | Say "Use Share, then Print, then Save as PDF" in the hint if the device is a phone. |
| Long document | Let the browser create many pages. Do not cut content. |

## E. Public share link
| Case | What the app must do |
|---|---|
| Document deleted after sharing | Show "This page is not available." |
| Someone opens a link of a `pdf` kind document | Show the extracted text only. Never expose the original file. |
| Search engines index it | Add `<meta name="robots" content="noindex">`. |
| Anyone with the link can read it | Say this clearly next to the Copy link button. |

## F. Upload
| Case | What the app must do |
|---|---|
| File is not a PDF (wrong extension or no `%PDF` header) | Reject: "Please upload a PDF file." |
| File over 10 MB | Reject: "File is too large. Maximum is 10 MB." |
| Empty file | Reject: "The file is empty." |
| Password protected PDF | pdf.js will fail to open. Show "This PDF is locked. Remove the password and try again." |
| Corrupt PDF | Show "We could not read this file." Do not save anything. |
| Scanned PDF (no text) | Save the file, create the doc with empty text, show "This looks like a scanned PDF. You can sign it, but not edit the text." |
| PDF with 100 or more pages | Allow upload. Extract the first 50 pages only and say so. Signing still works on all pages. |
| Two files with the same name | Allowed. Show upload time on the card. |
| Upload cut halfway (connection lost) | Delete any partial file. Show "Upload failed. Try again." |
| Disk volume full | Show "Storage is full." Log the error. |
| Same file uploaded twice | Two documents. Acceptable. |

## G. Text extraction (PDF to HTML)
| Case | What the app must do |
|---|---|
| Two column layout | Text may mix across columns. Show a note: "Layout is not kept. Please check the text." |
| Tables | Come out as plain lines. Do not try to rebuild tables in V1. |
| Headers, footers, page numbers repeat on every page | Remove lines that repeat on most pages at the same position. |
| Hyphenated words at line ends | Join them when the next line starts in lowercase. |
| Bullets and numbered lists | Detect by leading symbol or number and make `li` items. |
| Languages other than English (Hindi and others) | Extract as given. If characters look broken, show "Some characters may not be correct." |
| Images and logos | Dropped. Say so in the note. |
| Extraction very slow | Show a progress text "Reading page 3 of 20". |

## H. Signing
| Case | What the app must do |
|---|---|
| Signature drawn with no strokes | Disable "Use signature" until something is drawn. |
| Typed signature font not loaded yet | Wait for the font before rendering to PNG. Show the preview before saving. |
| Uploaded signature image is large or has a white background | Resize to max 600 px wide. Offer "Remove white background" using a simple threshold. |
| Image type not supported | Accept PNG and JPG only. |
| Page is rotated in the PDF | Read the page rotation from pdf.js and pdf-lib and convert positions correctly. Test with one rotated sample. |
| Pages have different sizes | Use fractions of each page's own width and height, never fixed pixels. |
| Different zoom or screen size | Positions stay correct because they are fractions. |
| PDF y-axis starts at the bottom, screen y-axis starts at the top | Flip y when drawing with pdf-lib. This is a common bug. Test it. |
| User places signature, then reloads | Positions are lost in V1. Warn with `beforeunload` while unsigned items exist. |
| Touch scroll conflicts with drawing | Disable page scroll on the signature canvas while the finger is down. |
| Multiple signatures or date boxes | Allow several items. Each can be removed. |
| Download blocked on iOS Safari | Open the PDF in a new tab if the download attribute is ignored. |
| Encrypted or protected PDF cannot be edited by pdf-lib | Show "This PDF does not allow changes." |
| Signed copy upload fails | Still let the user download it. Show "Saved on your device only." |

## I. Deploy and data
| Case | What the app must do |
|---|---|
| Railway restarts or redeploys | Data must survive. Volume mounted at `/data`, `DATA_DIR=/data`. Test this before submitting. |
| Volume not attached | App still starts but data is lost on redeploy. Log one warning at startup if `DATA_DIR` is not set in production. |
| `better-sqlite3` fails to build | Use Node 20 or 22 on Railway. Set the Node version in `package.json` engines. |
| Wrong `BASE_URL` | Links from Claude point to the wrong place. Fall back to the request host if `BASE_URL` is empty. |
| App sleeps or cold starts | First request may be slow. The reviewer should be told to wait. Add `/healthz` for Railway. |
| HTTP instead of HTTPS | Railway gives HTTPS. Set `trust proxy` so the app builds https links. |
| CDN for pdf.js or pdf-lib is down | Show "Could not load the PDF tools. Refresh the page." Pin exact versions in the script tags. |

## J. Security and privacy
| Case | What the app must do |
|---|---|
| HTML injection (XSS) through documents | Clean on every write. Render only cleaned HTML. |
| SQL injection | Prepared statements only. |
| Oversized request body | Express JSON limit 1 MB. Reject larger with a clear message. |
| Uploaded file path tricks | Name files by random id only. Never use the user filename on disk. |
| Reading another workspace's file | Check `ws` on every file and doc lookup. |
| Logs leaking keys or document text | Never log the URL path of `/mcp/:key`, `/w/:key`, or document content. |
| Confidential NDAs on a free demo | Show a line on the dashboard: "Demo app. Do not upload sensitive documents." |
| AI keys in the repo | Before the final push, search for `openai`, `anthropic`, `api_key`, `sk-`. |

## K. Claude connection (reviewer experience)
| Case | What the app must do |
|---|---|
| Reviewer does not know how to add a connector | Dashboard shows 3 steps with the exact menu names and a copy button for the link. |
| Reviewer's Claude plan does not allow custom connectors | Say in the README which plans allow it, and add a 2 minute screen recording as backup. |
| Reviewer tries the tools with a vague request | Tool descriptions are clear enough that Claude picks the right tool without extra instructions. |
| Link has trailing spaces when pasted | Trim the key from the URL before the lookup. |

## L. Testing the edge cases
Before submitting, test at least these 10:
1. Script tag sent through MCP is removed.
2. Update with an old `base_version` is rejected.
3. Editing in two tabs shows the conflict message.
4. Non PDF upload is rejected.
5. Scanned PDF upload shows the warning.
6. Locked PDF shows the message.
7. Signature on a rotated page lands in the right place.
8. Signature on page 2 of a multi page PDF lands in the right place.
9. Data is still there after a Railway redeploy.
10. Wrong key shows the "link not valid" page.

# 02. Context

## The assignment (Voloplay, Founder's Office, Product & Growth)
Build a small business that runs on Claude, with no AI inside the app. The customer connects their own Claude to the app through MCP. Claude does the thinking and writing. The app does everything else: saving, editing, and keeping the result live.

The first version must:
1. **Work from Claude.** A request typed in Claude creates something real in the app.
2. **Let a person edit it.** The reviewer can open the app, see what Claude created, and change it.
3. **Be live on the internet.** The reviewer can try it.
4. **Have no AI inside.** No OpenAI, Anthropic, or other AI keys anywhere in the app.

## How we meet each rule
| Rule | How |
|---|---|
| Works from Claude | MCP endpoint with 5 tools. Claude calls them. |
| Editable | Browser editor with autosave. |
| Live | Hosted on Railway with a public URL. |
| No AI inside | No AI SDK in package.json. No AI env vars. Claude lives outside the app. |

## What MCP means here
MCP is a standard way for Claude to call tools on another server. Pagewise runs one MCP server. The user adds its URL to Claude as a custom connector. After that, Claude can call Pagewise tools during a chat.

## Reference project: Folio
Repo: https://github.com/Forward-Future/folio (MIT license).
Folio is a desktop PDF reader made with React, TypeScript, Electron, and pdf.js. It has reading, highlights, notes, and visual signatures.

What we take from Folio:
- The idea and flow of the signature feature (draw, place, save onto the PDF).
- How it uses pdf.js to read PDF pages and text.

What we do NOT take:
- Electron, React, or its build setup. Pagewise is a web app with plain HTML, CSS, and JavaScript.
- Its "Ask AI" feature. Pagewise has no AI inside.

Rules for reuse: read the Folio code for logic only. Rewrite it in our own style. Add a credit line "Signature approach inspired by Folio (MIT)" in the README.

## Signature note (must be shown on the page)
Pagewise adds a visual signature: an image placed on the PDF. It is not a certified digital signature. The signing page must say this in one short line.

## Key decisions already made
- Idea: PDF editor connected to Claude.
- Hosting: Railway.
- Upload feature: yes, text PDFs only for editing.
- Signing: yes, on the original PDF, in V1.
- Highlights and notes: later.

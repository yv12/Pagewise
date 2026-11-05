# 01. Problem

## The product
Pagewise is a small web app that runs on Claude. The customer connects their own Claude to Pagewise through MCP. Claude does the thinking and writing. Pagewise does everything else: saving, editing, signing, and keeping the result live.

## Who is the user
Freelancers, founders, and small business owners who use Claude to draft documents (proposals, letters, NDAs, resumes) and then need to fix, sign, and send them.

## The pain today
1. Claude writes a document.
2. The user downloads it as a PDF.
3. To fix one line, the user converts the PDF to Word.
4. The user edits in Word.
5. The user exports to PDF again.
6. For an NDA, the user then prints, signs, and scans, or finds another signing tool.

This is slow, and the format breaks at every step.

## What Pagewise changes
1. The user types a request in Claude. A real document appears in Pagewise.
2. The user opens the link and edits it in the browser.
3. The user downloads a clean PDF.
4. The user can also upload an existing PDF (for example an NDA), sign it, and download it.
5. Claude can read uploaded documents and rewrite them on request.

## Success looks like (for the Voloplay assignment)
The reviewer can do all of this without help:
- Connect their Claude to the app with one link.
- Type "Write a one page proposal for X". See it appear in the app.
- Open the app, change a sentence, see the change saved.
- Download the PDF.
- Upload a PDF, place a signature, download the signed PDF.
- Open the live link on the internet.
- Find no AI keys or AI calls in the code.

## Not solving in V1
- Certified digital signatures (DSC, Aadhaar eSign). We only do visual signatures.
- Editing scanned PDFs (photos of paper).
- Keeping exact layout when a PDF is converted to editable text.
- Teams, logins with passwords, payments, comments, templates.
- Highlights and notes (listed as "next").

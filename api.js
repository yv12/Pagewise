import express from 'express';
import { Readable } from 'node:stream';
import { writeFileSync, unlinkSync, existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import * as db from './db.js';
import { clean } from './clean.js';

export const apiRouter = express.Router();
const MAX_HTML_BYTES = 500 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Middleware to check workspace existence
function requireWorkspace(req, res, next) {
  const key = req.params.key.trim();
  const ws = db.getWorkspace(key);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  req.workspaceKey = key;
  next();
}

// GET /api/w/:key/docs - List documents
apiRouter.get('/w/:key/docs', requireWorkspace, (req, res) => {
  const docs = db.listDocs(req.workspaceKey).map(d => {
    const signed = db.getDocFileByRole(d.id, req.workspaceKey, 'signed');
    return {
      ...d,
      has_signed_copy: !!signed,
      signed_file_id: signed ? signed.id : null
    };
  });
  res.json(docs);
});

// GET /api/w/:key/docs/:id - Get one document
apiRouter.get('/w/:key/docs/:id', requireWorkspace, (req, res) => {
  const doc = db.getDoc(req.params.id, req.workspaceKey);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  const files = db.getDocFiles(doc.id, req.workspaceKey);
  const orig = files.find(f => f.role === 'original');
  const signed = files.find(f => f.role === 'signed');
  res.json({
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    html: doc.html,
    version: doc.version,
    last_editor: doc.last_editor,
    has_signed_copy: !!signed,
    original_file_id: orig ? orig.id : null,
    signed_file_id: signed ? signed.id : null,
    updated_at: doc.updated_at
  });
});

// PUT /api/w/:key/docs/:id - Save from editor
apiRouter.put('/w/:key/docs/:id', requireWorkspace, (req, res) => {
  const { id } = req.params;
  const { title, html, version } = req.body || {};

  const current = db.getDoc(id, req.workspaceKey);
  if (!current) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Version check (409 conflict if version is old)
  if (version !== undefined && version !== current.version) {
    return res.status(409).json({
      error: 'Changed elsewhere',
      current_version: current.version
    });
  }

  if (html && Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    return res.status(400).json({ error: 'Too long to save.' });
  }

  let cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!cleanTitle) cleanTitle = 'Untitled';
  cleanTitle = cleanTitle.slice(0, 200);

  const cleanHtml = html !== undefined ? clean(html) : current.html;

  const updated = db.updateDoc(id, req.workspaceKey, {
    title: cleanTitle,
    html: cleanHtml,
    lastEditor: 'user'
  });

  res.json({
    id: updated.id,
    title: updated.title,
    version: updated.version,
    last_editor: updated.last_editor,
    updated_at: updated.updated_at
  });
});

// DELETE /api/w/:key/docs/:id - Delete
apiRouter.delete('/w/:key/docs/:id', requireWorkspace, (req, res) => {
  const deleted = db.deleteDoc(req.params.id, req.workspaceKey);
  if (!deleted) {
    return res.status(404).json({ error: 'Document not found' });
  }
  res.json({ deleted: true });
});

// POST /api/w/:key/docs - Create from the browser
apiRouter.post('/w/:key/docs', requireWorkspace, (req, res) => {
  const { title, html } = req.body || {};

  let cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!cleanTitle) cleanTitle = 'Untitled';
  cleanTitle = cleanTitle.slice(0, 200);

  const rawHtml = typeof html === 'string' ? html : '<p></p>';
  if (Buffer.byteLength(rawHtml, 'utf8') > MAX_HTML_BYTES) {
    return res.status(400).json({ error: 'Too long to save.' });
  }

  const cleanHtml = clean(rawHtml);
  const id = db.createDoc(req.workspaceKey, 'doc', cleanTitle, cleanHtml, 'user');
  const doc = db.getDoc(id, req.workspaceKey);

  res.json({
    id: doc.id,
    title: doc.title,
    version: doc.version,
    last_editor: doc.last_editor
  });
});

// GET /api/p/:id - Public read-only document (title and html only)
apiRouter.get('/p/:id', (req, res) => {
  const doc = db.getPublicDoc(req.params.id);
  if (!doc) {
    return res.status(404).json({ error: 'This page is not available.' });
  }
  res.json({
    id: doc.id,
    title: doc.title,
    html: doc.html
  });
});

async function parsePdfStream(req) {
  const cLen = parseInt(req.headers['content-length'] || '0', 10);
  if (cLen > MAX_UPLOAD_BYTES) throw new Error('File is too large. Maximum is 10 MB.');
  const cType = req.headers['content-type'] || '';
  if (cType.includes('multipart/form-data')) {
    const webRes = new Response(Readable.toWeb(req), { headers: req.headers });
    const fd = await webRes.formData();
    const file = fd.get('file');
    if (!file || typeof file === 'string') return null;
    if (file.size === 0) throw new Error('The file is empty.');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('File is too large. Maximum is 10 MB.');
    return {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name || 'document.pdf',
      title: typeof fd.get('title') === 'string' ? fd.get('title') : '',
      html: typeof fd.get('html') === 'string' ? fd.get('html') : ''
    };
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) throw new Error('File is too large. Maximum is 10 MB.');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length === 0) throw new Error('The file is empty.');
  return {
    buffer,
    filename: req.headers['x-filename'] || 'document.pdf',
    title: typeof req.query.title === 'string' ? req.query.title : '',
    html: typeof req.query.html === 'string' ? req.query.html : ''
  };
}

// POST /api/w/:key/upload - Upload a PDF
apiRouter.post('/w/:key/upload', requireWorkspace, async (req, res) => {
  try {
    const parsed = await parsePdfStream(req);
    if (!parsed || !parsed.filename.toLowerCase().endsWith('.pdf') || parsed.buffer.subarray(0, 4).toString() !== '%PDF') {
      return res.status(400).json({ error: 'Please upload a PDF file.' });
    }
    let cleanTitle = parsed.title.trim() || parsed.filename.replace(/\.pdf$/i, '').trim() || 'Untitled';
    cleanTitle = cleanTitle.slice(0, 200);

    const cleanHtml = parsed.html ? clean(parsed.html) : '<p></p>';
    const docId = db.createDoc(req.workspaceKey, 'pdf', cleanTitle, cleanHtml, 'user');
    const fileId = db.createFile(req.workspaceKey, docId, 'original', parsed.filename);
    const filePath = join(db.DATA_DIR, 'files', `${fileId}.pdf`);

    try {
      writeFileSync(filePath, parsed.buffer);
    } catch {
      db.deleteDoc(docId, req.workspaceKey);
      try { unlinkSync(filePath); } catch {}
      return res.status(500).json({ error: 'Storage is full.' });
    }

    res.json({ id: docId, file_id: fileId, title: cleanTitle, kind: 'pdf', version: 1 });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Upload failed. Try again.' });
  }
});

// POST /api/w/:key/docs/:id/signed - Upload signed PDF
apiRouter.post('/w/:key/docs/:id/signed', requireWorkspace, async (req, res) => {
  const doc = db.getDoc(req.params.id, req.workspaceKey);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  try {
    const parsed = await parsePdfStream(req);
    if (!parsed || parsed.buffer.subarray(0, 4).toString() !== '%PDF') {
      return res.status(400).json({ error: 'Please upload a PDF file.' });
    }
    db.deleteFileByDocAndRole(doc.id, req.workspaceKey, 'signed');
    const filename = parsed.filename || `signed-${doc.title}.pdf`;
    const fileId = db.createFile(req.workspaceKey, doc.id, 'signed', filename);
    const filePath = join(db.DATA_DIR, 'files', `${fileId}.pdf`);
    try {
      writeFileSync(filePath, parsed.buffer);
    } catch {
      db.deleteFile(fileId, req.workspaceKey);
      return res.status(500).json({ error: 'Storage is full.' });
    }
    res.json({ ok: true, file_id: fileId });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Upload failed. Try again.' });
  }
});

// GET /api/w/:key/files/:fileId - Download a stored PDF
apiRouter.get('/w/:key/files/:fileId', requireWorkspace, (req, res) => {
  const file = db.getFile(req.params.fileId, req.workspaceKey);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const filePath = join(db.DATA_DIR, 'files', `${file.id}.pdf`);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
  createReadStream(filePath).pipe(res);
});




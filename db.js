import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || './data';
try {
  mkdirSync(join(DATA_DIR, 'files'), { recursive: true });
} catch (e) {
  console.warn('Notice: Could not create files directory:', e.message);
}

const db = new Database(join(DATA_DIR, 'pagewise.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    key TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY,
    ws TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    html TEXT NOT NULL,
    version INTEGER NOT NULL,
    last_editor TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    ws TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    role TEXT NOT NULL,
    filename TEXT NOT NULL,
    created_at TEXT
  )
`);

export { DATA_DIR };

export function createWorkspace() {
  const key = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO workspaces (key, created_at) VALUES (?, ?)').run(key, now);
  return key;
}

export function getWorkspace(key) {
  return db.prepare('SELECT * FROM workspaces WHERE key = ?').get(key);
}

export function createDoc(ws, kind, title, html, lastEditor) {
  const id = randomBytes(6).toString('hex');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO docs (id, ws, kind, title, html, version, last_editor, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(id, ws, kind, title, html, lastEditor, now, now);
  return id;
}

export function getDoc(id, ws) {
  return db.prepare('SELECT * FROM docs WHERE id = ? AND ws = ?').get(id, ws);
}

export function getPublicDoc(id) {
  return db.prepare('SELECT id, title, html, kind FROM docs WHERE id = ?').get(id);
}

export function updateDoc(id, ws, updates) {
  const doc = getDoc(id, ws);
  if (!doc) return null;

  const title = updates.title !== undefined ? updates.title : doc.title;
  const html = updates.html !== undefined ? updates.html : doc.html;
  const lastEditor = updates.lastEditor || doc.last_editor;
  const version = doc.version + 1;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE docs SET title = ?, html = ?, version = ?, last_editor = ?, updated_at = ?
     WHERE id = ? AND ws = ?`
  ).run(title, html, version, lastEditor, now, id, ws);

  return { ...doc, title, html, version, last_editor: lastEditor, updated_at: now };
}

export function listDocs(ws) {
  return db.prepare(
    'SELECT id, title, kind, updated_at, last_editor FROM docs WHERE ws = ? ORDER BY updated_at DESC'
  ).all(ws);
}

export function deleteDoc(id, ws) {
  const doc = getDoc(id, ws);
  if (!doc) return false;

  const files = db.prepare('SELECT id FROM files WHERE doc_id = ? AND ws = ?').all(id, ws);
  for (const f of files) {
    try { unlinkSync(join(DATA_DIR, 'files', `${f.id}.pdf`)); } catch { /* ok */ }
  }
  db.prepare('DELETE FROM files WHERE doc_id = ? AND ws = ?').run(id, ws);
  db.prepare('DELETE FROM docs WHERE id = ? AND ws = ?').run(id, ws);
  return true;
}

export function hasSignedCopy(docId) {
  return !!db.prepare("SELECT 1 FROM files WHERE doc_id = ? AND role = 'signed' LIMIT 1").get(docId);
}

export function getDocFiles(docId, ws) {
  return db.prepare('SELECT * FROM files WHERE doc_id = ? AND ws = ?').all(docId, ws);
}

export function getDocFileByRole(docId, ws, role) {
  return db.prepare('SELECT * FROM files WHERE doc_id = ? AND ws = ? AND role = ? ORDER BY created_at DESC LIMIT 1').get(docId, ws, role);
}

export function deleteFileByDocAndRole(docId, ws, role) {
  const existing = db.prepare('SELECT id FROM files WHERE doc_id = ? AND ws = ? AND role = ?').all(docId, ws, role);
  for (const f of existing) {
    try { unlinkSync(join(DATA_DIR, 'files', `${f.id}.pdf`)); } catch { /* ok */ }
    db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  }
}

export function createFile(ws, docId, role, filename) {
  const id = randomBytes(6).toString('hex');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO files (id, ws, doc_id, role, filename, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, ws, docId, role, filename, now);
  return id;
}

export function getFile(fileId, ws) {
  return db.prepare('SELECT * FROM files WHERE id = ? AND ws = ?').get(fileId, ws);
}

export function deleteFile(fileId, ws) {
  const f = db.prepare('SELECT id FROM files WHERE id = ? AND ws = ?').get(fileId, ws);
  if (!f) return false;
  try { unlinkSync(join(DATA_DIR, 'files', `${f.id}.pdf`)); } catch { /* ok */ }
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId, ws);
  return true;
}

export function closeDb() {
  try {
    db.close();
  } catch {
    /* ok */
  }
}





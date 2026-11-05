import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as db from './db.js';
import { clean } from './clean.js';

const HTML_NOTE =
  'Write content as simple HTML: h1, h2, h3, p, ul, ol, li, strong, em, table, tr, th, td, a, br. No scripts, no styles, no images.';
const MAX_HTML_BYTES = 500 * 1024;

function err(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

function ok(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

export function createMcpServer(wsKey, baseUrl) {
  const server = new McpServer({ name: 'Pagewise', version: '1.0.0' });

  // --- create_document ---
  server.tool(
    'create_document',
    `Create a new document in the workspace. ${HTML_NOTE}`,
    {
      title: z.string().describe('Document title (max 200 characters)'),
      html: z.string().describe('Document content as simple HTML')
    },
    async ({ title, html }) => {
      if (!title.trim() || !html.trim()) return err('Title and content are required.');
      if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        return err('Document is too long. Split it into parts.');
      }

      const id = db.createDoc(wsKey, 'doc', title.slice(0, 200), clean(html), 'claude');
      const doc = db.getDoc(id, wsKey);
      return ok({
        id: doc.id,
        title: doc.title,
        version: doc.version,
        edit_url: `${baseUrl}/w/${wsKey}/d/${doc.id}`,
        view_url: `${baseUrl}/p/${doc.id}`
      });
    }
  );

  // --- update_document ---
  server.tool(
    'update_document',
    `Update an existing document. ${HTML_NOTE}`,
    {
      id: z.string().describe('Document ID'),
      title: z.string().optional().describe('New title (max 200 characters)'),
      html: z.string().optional().describe('New content as simple HTML'),
      base_version: z.number().optional().describe('Expected current version for conflict detection')
    },
    async ({ id, title, html, base_version }) => {
      const doc = db.getDoc(id, wsKey);
      if (!doc) return err('Document not found. Call list_documents.');
      if (base_version !== undefined && base_version !== doc.version) {
        return err('Document changed. Call get_document first.');
      }
      if (html && Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        return err('Document is too long. Split it into parts.');
      }

      const updates = { lastEditor: 'claude' };
      if (title !== undefined) updates.title = title.slice(0, 200);
      if (html !== undefined) updates.html = clean(html);

      const updated = db.updateDoc(id, wsKey, updates);
      return ok({
        id: updated.id,
        version: updated.version,
        edit_url: `${baseUrl}/w/${wsKey}/d/${updated.id}`
      });
    }
  );

  // --- get_document ---
  server.tool(
    'get_document',
    'Get the latest version of a document, including uploaded PDFs (returns extracted text).',
    {
      id: z.string().describe('Document ID')
    },
    async ({ id }) => {
      const doc = db.getDoc(id, wsKey);
      if (!doc) return err('Document not found. Call list_documents.');
      return ok({
        id: doc.id,
        title: doc.title,
        kind: doc.kind,
        html: doc.html,
        version: doc.version,
        last_editor: doc.last_editor,
        has_signed_copy: db.hasSignedCopy(doc.id)
      });
    }
  );

  // --- list_documents ---
  server.tool(
    'list_documents',
    'List all documents in the workspace, newest first.',
    async () => {
      const docs = db.listDocs(wsKey);
      return ok(docs);
    }
  );

  // --- delete_document ---
  server.tool(
    'delete_document',
    'Delete a document and its files.',
    {
      id: z.string().describe('Document ID')
    },
    async ({ id }) => {
      const doc = db.getDoc(id, wsKey);
      if (!doc) return err('Document not found. Call list_documents.');
      db.deleteDoc(id, wsKey);
      return ok({ deleted: true });
    }
  );

  return server;
}


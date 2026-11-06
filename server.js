import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as db from './db.js';
import { createMcpServer } from './mcp.js';
import { apiRouter } from './api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.set('trust proxy', true);

// Health check endpoint for deployment orchestrators (Railway / Render / Docker)
app.get(['/healthz', '/health'], (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(express.json({ limit: '1mb' }));

// Serve static frontend files
app.use(express.static(join(__dirname, 'public')));

// --- Rate limiting for workspace creation (in-memory) ---
const ipCounts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now - entry.start > 3_600_000) {
    ipCounts.set(ip, { start: now, count: 1 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

// --- REST API ---
app.use('/api', apiRouter);

app.post('/api/workspaces', (req, res) => {
  if (!checkRateLimit(req.ip)) {
    return res.status(429).json({ error: 'Too many tries. Please wait.' });
  }
  const key = db.createWorkspace();
  res.json({ key });
});

// --- MCP routes ---
app.post('/mcp/:key', async (req, res) => {
  try {
    const key = req.params.key.trim();
    const ws = db.getWorkspace(key);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const server = createMcpServer(key, baseUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      try { transport.close(); } catch { /* ok */ }
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('MCP error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/mcp/:key', (_req, res) => {
  res.status(405).set('Allow', 'POST').type('text').send('Method not allowed. Use POST.');
});

app.delete('/mcp/:key', (_req, res) => {
  res.status(405).set('Allow', 'POST').type('text').send('Method not allowed. Use POST.');
});

// --- Page routes ---
app.get('/w/:key', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

app.get('/w/:key/d/:id', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'editor.html'));
});

app.get('/w/:key/s/:id', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'sign.html'));
});

app.get('/p/:id', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'view.html'));
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  if (process.env.NODE_ENV === 'production' && !process.env.DATA_DIR) {
    console.warn('Warning: DATA_DIR is not set in production. Data may be lost on redeploy.');
  }
  console.log(`Pagewise running on port ${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed');
    db.closeDb();
    process.exit(0);
  });
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  setTimeout(() => {
    console.warn('Forcing shutdown after timeout');
    db.closeDb();
    process.exit(0);
  }, 1500).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

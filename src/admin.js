import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addKnowledgeItem,
  listAllowedGroups,
  listAllowedUsers,
  listDashboardStats,
  listKnowledgeItems,
  listMessages,
  listQaLogs,
  listRequirements,
  listSettings,
  listUnansweredItems,
  openDb,
  resolveUnansweredItem,
  setSetting,
  updateKnowledgeItem
} from './db.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

export function startAdminServer({ port = 8787, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
  });

  let currentPort = port;
  let retryCount = 0;

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && retryCount < 10) {
      retryCount += 1;
      currentPort += 1;
      server.listen(currentPort, host);
      return;
    }
    throw error;
  });

  server.on('listening', () => {
    const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    console.log(JSON.stringify({
      ok: true,
      url: `http://${displayHost}:${currentPort}`
    }, null, 2));
  });

  server.listen(currentPort, host);

  return server;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  serveStatic(res, url.pathname);
}

async function handleApi(req, res, url) {
  const db = openDb();
  try {
    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      sendJson(res, 200, { ok: true, stats: listDashboardStats(db) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/messages') {
      sendJson(res, 200, { ok: true, messages: listMessages(db, readLimit(url, 100)) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/requirements') {
      sendJson(res, 200, { ok: true, requirements: listRequirements(db, readLimit(url, 100)) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/qa-logs') {
      sendJson(res, 200, { ok: true, qa_logs: listQaLogs(db, readLimit(url, 100)) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/knowledge') {
      sendJson(res, 200, { ok: true, items: listKnowledgeItems(db, readLimit(url, 200)) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/knowledge') {
      const item = validateKnowledgeItem(await readJson(req));
      const id = addKnowledgeItem(db, item);
      sendJson(res, 201, { ok: true, id });
      return;
    }

    const knowledgeMatch = url.pathname.match(/^\/api\/knowledge\/(\d+)$/);
    if (req.method === 'PUT' && knowledgeMatch) {
      const item = validateKnowledgeItem(await readJson(req));
      updateKnowledgeItem(db, Number(knowledgeMatch[1]), item);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/unanswered') {
      sendJson(res, 200, { ok: true, items: listUnansweredItems(db, readLimit(url, 100)) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/unanswered/resolve') {
      const body = await readJson(req);
      const knowledgeItem = validateKnowledgeItem(body.knowledge || {});
      const sourceType = String(body.source_type || '');
      const sourceId = Number(body.source_id);
      if (!sourceType || !Number.isFinite(sourceId)) {
        sendJson(res, 400, { ok: false, error: 'source_type 和 source_id 必填' });
        return;
      }
      const id = resolveUnansweredItem(db, {
        sourceType,
        sourceId,
        knowledgeItem,
        note: body.note || null
      });
      sendJson(res, 201, { ok: true, id });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/settings') {
      sendJson(res, 200, {
        ok: true,
        settings: listSettings(db),
        groups: listAllowedGroups(db),
        users: listAllowedUsers(db)
      });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/settings') {
      const body = await readJson(req);
      for (const [key, value] of Object.entries(body.settings || {})) {
        setSetting(db, key, value);
      }
      sendJson(res, 200, { ok: true, settings: listSettings(db) });
      return;
    }

    sendJson(res, 404, { ok: false, error: '接口不存在' });
  } finally {
    db.close();
  }
}

function serveStatic(res, pathname) {
  const relativePath = pathname === '/' ? 'admin.html' : pathname.slice(1);
  const filePath = path.resolve(publicDir, relativePath);
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { ok: false, error: '页面不存在' });
    return;
  }

  res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value, null, 2));
}

function readLimit(url, fallback) {
  const limit = Number(url.searchParams.get('limit') || fallback);
  return Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : fallback;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error('请求内容过大'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function validateKnowledgeItem(item) {
  const title = String(item.title || '').trim();
  const content = String(item.content || '').trim();
  if (!title) {
    throw new Error('知识库标题必填');
  }
  if (!content) {
    throw new Error('知识库内容必填');
  }
  return {
    title,
    content,
    category: normalizeOptional(item.category),
    keywords: normalizeOptional(item.keywords),
    module: normalizeOptional(item.module),
    status: item.status === 'inactive' ? 'inactive' : 'active'
  };
}

function normalizeOptional(value) {
  const text = String(value || '').trim();
  return text || null;
}

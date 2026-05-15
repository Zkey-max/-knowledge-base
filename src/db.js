import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaults, ensureLocalDirs, paths } from './config.js';

const schemaPath = path.join(paths.rootDir, 'src', 'schema.sql');

export function openDb() {
  ensureLocalDirs();
  const db = new DatabaseSync(paths.dbPath);
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  migrateDb(db);
  seedSettings(db);
  return db;
}

export function initDb() {
  const db = openDb();
  db.close();
  return paths.dbPath;
}

function seedSettings(db) {
  const entries = [
    ['poll_interval_seconds', String(defaults.pollIntervalSeconds)],
    ['poll_lookback_minutes', String(defaults.pollLookbackMinutes)],
    ['admin_port', String(defaults.adminPort)],
    ['auto_reply_enabled', String(defaults.autoReplyEnabled)],
    ['auto_process_enabled', String(defaults.autoProcessEnabled)],
    ['auto_process_limit', String(defaults.autoProcessLimit)],
    ['min_answer_confidence', String(defaults.minAnswerConfidence)],
    ['model_provider', defaults.modelProvider]
  ];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES (?, ?)
  `);
  for (const [key, value] of entries) {
    stmt.run(key, value);
  }
}

function migrateDb(db) {
  ensureColumn(db, 'qa_logs', 'resolution_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, 'qa_logs', 'resolved_knowledge_id', 'INTEGER');
  ensureColumn(db, 'qa_logs', 'resolved_at', 'TEXT');
  ensureColumn(db, 'qa_logs', 'resolution_note', 'TEXT');
}

function ensureColumn(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now', 'localtime'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, String(value));
}

export function listSettings(db) {
  return db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all();
}

export function upsertAllowedGroup(db, { chatId, name = null, enabled = true }) {
  db.prepare(`
    INSERT INTO allowed_groups (chat_id, name, enabled)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      name = excluded.name,
      enabled = excluded.enabled
  `).run(chatId, name, enabled ? 1 : 0);
}

export function upsertAllowedUser(db, { userId, name = null, role = null, enabled = true }) {
  db.prepare(`
    INSERT INTO allowed_users (user_id, name, role, enabled)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      enabled = excluded.enabled
  `).run(userId, name, role, enabled ? 1 : 0);
}

export function listAllowedGroups(db) {
  return db.prepare('SELECT chat_id, name, enabled, created_at FROM allowed_groups ORDER BY id').all();
}

export function listAllowedUsers(db) {
  return db.prepare('SELECT user_id, name, role, enabled, created_at FROM allowed_users ORDER BY id').all();
}

export function activeGroupIds(db) {
  return new Set(
    db.prepare('SELECT chat_id FROM allowed_groups WHERE enabled = 1')
      .all()
      .map((row) => row.chat_id)
  );
}

export function activeUserIds(db) {
  return new Set(
    db.prepare('SELECT user_id FROM allowed_users WHERE enabled = 1')
      .all()
      .map((row) => row.user_id)
  );
}

export function getUserRole(db, userId) {
  const row = db.prepare('SELECT role FROM allowed_users WHERE user_id = ?').get(userId);
  return row ? row.role : null;
}

export function createMessageKey({ chatId, userId, sendTime, msgType, content }) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([chatId, userId, sendTime, msgType, content || '']))
    .digest('hex');
}

export function insertMessage(db, message, shouldQueue) {
  const messageKey = createMessageKey(message);
  const existing = db.prepare('SELECT id, process_status FROM messages WHERE message_key = ?').get(messageKey);
  if (existing) {
    return { inserted: false, id: existing.id, processStatus: existing.process_status };
  }

  const processStatus = shouldQueue ? 'pending' : 'ignored';
  const result = db.prepare(`
    INSERT INTO messages (
      message_key, chat_id, chat_type, user_id, send_time, msg_type, content, raw_json, process_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageKey,
    message.chatId,
    message.chatType,
    message.userId,
    message.sendTime,
    message.msgType,
    message.content,
    JSON.stringify(message.raw),
    processStatus
  );

  const id = Number(result.lastInsertRowid);
  if (shouldQueue) {
    db.prepare('INSERT OR IGNORE INTO processing_tasks (message_id) VALUES (?)').run(id);
  }
  return { inserted: true, id, processStatus };
}

export function listPendingTasks(db, limit = 20) {
  return db.prepare(`
    SELECT
      t.id AS task_id,
      t.status AS task_status,
      m.id AS message_id,
      m.chat_id,
      m.chat_type,
      m.user_id,
      u.name AS user_name,
      u.role AS user_role,
      m.send_time,
      m.msg_type,
      m.content
    FROM processing_tasks t
    JOIN messages m ON m.id = t.message_id
    LEFT JOIN allowed_users u ON u.user_id = m.user_id
    WHERE t.status = 'pending'
    ORDER BY m.send_time ASC, t.id ASC
    LIMIT ?
  `).all(limit);
}

export function listKnowledgeItems(db, limit = 100) {
  return db.prepare(`
    SELECT id, category, title, content, keywords, module, status, updated_at
    FROM knowledge_items
    ORDER BY status ASC, updated_at DESC, id DESC
    LIMIT ?
  `).all(limit);
}

export function activeKnowledgeItems(db, limit = 100) {
  return db.prepare(`
    SELECT id, category, title, content, keywords, module, status, updated_at
    FROM knowledge_items
    WHERE status = 'active'
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(limit);
}

export function listMessages(db, limit = 50) {
  return db.prepare(`
    SELECT id, chat_id, user_id, send_time, msg_type, content, process_status, created_at
    FROM messages
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

export function listRequirements(db, limit = 50) {
  return db.prepare(`
    SELECT id, title, module, source_user_id, priority, status, created_at
    FROM requirements
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

export function listQaLogs(db, limit = 50) {
  return db.prepare(`
    SELECT
      id, message_id, question, matched_knowledge_ids, answer, confidence,
      sent_status, sent_at, error_message, resolution_status,
      resolved_knowledge_id, resolved_at, resolution_note, created_at
    FROM qa_logs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

export function addKnowledgeItem(db, item) {
  const result = db.prepare(`
    INSERT INTO knowledge_items (category, title, content, keywords, module, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `).run(
    item.category || null,
    item.title,
    item.content,
    item.keywords || null,
    item.module || null,
    item.status || 'active'
  );
  return Number(result.lastInsertRowid);
}

export function updateKnowledgeItem(db, id, item) {
  db.prepare(`
    UPDATE knowledge_items
    SET category = ?,
      title = ?,
      content = ?,
      keywords = ?,
      module = ?,
      status = ?,
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(
    item.category || null,
    item.title,
    item.content,
    item.keywords || null,
    item.module || null,
    item.status || 'active',
    id
  );
}

export function listDashboardStats(db) {
  const one = (sql, params = []) => db.prepare(sql).get(...params).count;
  return {
    messages: one('SELECT COUNT(*) AS count FROM messages'),
    pending_tasks: one("SELECT COUNT(*) AS count FROM processing_tasks WHERE status = 'pending'"),
    manual_review: one("SELECT COUNT(*) AS count FROM messages WHERE process_status = 'manual_review'"),
    requirements: one('SELECT COUNT(*) AS count FROM requirements'),
    knowledge_active: one("SELECT COUNT(*) AS count FROM knowledge_items WHERE status = 'active'"),
    qa_failed: one("SELECT COUNT(*) AS count FROM qa_logs WHERE sent_status = 'failed'"),
    qa_unresolved: listUnansweredItems(db, 1000).length
  };
}

export function listUnansweredItems(db, limit = 100) {
  const qaRows = db.prepare(`
    SELECT
      'qa_log' AS source_type,
      q.id AS source_id,
      q.message_id,
      q.question AS title,
      q.question AS content,
      q.answer,
      q.confidence,
      q.sent_status,
      q.error_message,
      q.created_at,
      q.matched_knowledge_ids,
      m.chat_id,
      m.user_id,
      m.send_time,
      m.process_status
    FROM qa_logs q
    LEFT JOIN messages m ON m.id = q.message_id
    WHERE COALESCE(q.resolution_status, 'pending') != 'done'
      AND (
        q.sent_status = 'failed'
        OR q.confidence IS NULL
        OR q.confidence < CAST((SELECT value FROM settings WHERE key = 'min_answer_confidence') AS REAL)
        OR q.matched_knowledge_ids IS NULL
        OR q.matched_knowledge_ids = '[]'
        OR q.answer LIKE '%当前知识库未找到明确答案%'
      )
    ORDER BY q.id DESC
    LIMIT ?
  `).all(limit);

  if (qaRows.length >= limit) {
    return qaRows;
  }

  const manualRows = db.prepare(`
    SELECT
      'manual_message' AS source_type,
      m.id AS source_id,
      m.id AS message_id,
      COALESCE(NULLIF(substr(m.content, 1, 60), ''), '待人工完善消息') AS title,
      m.content,
      NULL AS answer,
      t.confidence,
      NULL AS sent_status,
      t.error_message,
      m.created_at,
      NULL AS matched_knowledge_ids,
      m.chat_id,
      m.user_id,
      m.send_time,
      m.process_status
    FROM messages m
    LEFT JOIN processing_tasks t ON t.message_id = m.id
    WHERE m.process_status = 'manual_review'
    ORDER BY m.id DESC
    LIMIT ?
  `).all(limit - qaRows.length);

  return [...qaRows, ...manualRows];
}

export function resolveUnansweredItem(db, { sourceType, sourceId, knowledgeItem, note = null }) {
  db.exec('BEGIN');
  try {
    const knowledgeId = addKnowledgeItem(db, knowledgeItem);
    if (sourceType === 'qa_log') {
      db.prepare(`
        UPDATE qa_logs
        SET resolution_status = 'done',
          resolved_knowledge_id = ?,
          resolved_at = datetime('now', 'localtime'),
          resolution_note = ?
        WHERE id = ?
      `).run(knowledgeId, note, sourceId);
    } else if (sourceType === 'manual_message') {
      db.prepare('UPDATE messages SET process_status = ? WHERE id = ?').run('processed', sourceId);
      db.prepare(`
        UPDATE processing_tasks
        SET status = 'done',
          result_type = 'manual_review',
          error_message = ?,
          processed_at = datetime('now', 'localtime')
        WHERE message_id = ?
      `).run(note || `已通过后台补充知识库 #${knowledgeId}`, sourceId);
    } else {
      throw new Error(`Unsupported unanswered source: ${sourceType}`);
    }
    db.exec('COMMIT');
    return knowledgeId;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function applyDecision(db, decision) {
  const task = db.prepare(`
    SELECT
      t.id AS task_id,
      m.id AS message_id,
      m.chat_id,
      m.chat_type,
      m.user_id,
      m.content
    FROM processing_tasks t
    JOIN messages m ON m.id = t.message_id
    WHERE t.id = ?
  `).get(decision.task_id);

  if (!task) {
    throw new Error(`Task not found: ${decision.task_id}`);
  }

  const type = decision.type;
  const confidence = Number(decision.confidence ?? 0);

  db.exec('BEGIN');
  try {
    if (type === 'requirement') {
      const req = decision.requirement || {};
      db.prepare(`
        INSERT INTO requirements (
          message_id, source_user_id, source_role, module, title, description,
          scenario, expected_result, priority
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.message_id,
        task.user_id,
        getUserRole(db, task.user_id),
        req.module || null,
        req.title || '未命名需求',
        req.description || task.content || '',
        req.scenario || null,
        req.expected_result || null,
        req.priority || null
      );
      db.prepare('UPDATE messages SET process_status = ? WHERE id = ?').run('processed', task.message_id);
    } else if (type === 'question') {
      const qa = decision.qa || {};
      const replyTarget = JSON.stringify({ chat_type: task.chat_type, chat_id: task.chat_id });
      db.prepare(`
        INSERT INTO qa_logs (
          message_id, question, matched_knowledge_ids, answer, confidence, reply_target, sent_status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        task.message_id,
        task.content || '',
        JSON.stringify(qa.matched_knowledge_ids || []),
        qa.answer || '当前知识库未找到明确答案，请人工确认。',
        confidence,
        replyTarget
      );
      db.prepare('UPDATE messages SET process_status = ? WHERE id = ?').run('processed', task.message_id);
    } else if (type === 'ignore') {
      db.prepare('UPDATE messages SET process_status = ? WHERE id = ?').run('ignored', task.message_id);
    } else if (type === 'manual_review') {
      db.prepare('UPDATE messages SET process_status = ? WHERE id = ?').run('manual_review', task.message_id);
    } else {
      throw new Error(`Unsupported decision type: ${type}`);
    }

    db.prepare(`
      UPDATE processing_tasks
      SET status = 'done',
        result_type = ?,
        confidence = ?,
        error_message = ?,
        processed_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(type, confidence, decision.reason || null, decision.task_id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { task, type, confidence };
}

export function pendingReplies(db) {
  return db.prepare(`
    SELECT id, answer, reply_target
    FROM qa_logs
    WHERE sent_status = 'pending'
    ORDER BY id ASC
  `).all();
}

export function markReplySent(db, id) {
  db.prepare(`
    UPDATE qa_logs
    SET sent_status = 'sent', sent_at = datetime('now', 'localtime'), error_message = NULL
    WHERE id = ?
  `).run(id);
}

export function markReplyFailed(db, id, errorMessage) {
  db.prepare(`
    UPDATE qa_logs
    SET sent_status = 'failed', error_message = ?
    WHERE id = ?
  `).run(errorMessage, id);
}

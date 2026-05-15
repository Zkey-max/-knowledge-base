import fs from 'node:fs';
import {
  applyDecision,
  getSetting,
  activeKnowledgeItems,
  listPendingTasks,
  markReplyFailed,
  markReplySent,
  openDb,
  pendingReplies
} from './db.js';
import { sendMessage } from './wecom.js';

export function listTasks({ limit = 20, includeKnowledge = true } = {}) {
  const db = openDb();
  try {
    const tasks = listPendingTasks(db, limit);
    const knowledge = includeKnowledge ? activeKnowledgeItems(db, 50) : [];
    return { tasks, knowledge };
  } finally {
    db.close();
  }
}

export function applyDecisionFile(filePath) {
  const decision = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return applyDecisionObject(decision);
}

export function applyDecisionObject(decision) {
  const db = openDb();
  try {
    const result = applyDecision(db, decision);
    const autoReply = getSetting(db, 'auto_reply_enabled', 'true') === 'true';
    if (autoReply && decision.type === 'question') {
      sendPendingReplies(db);
    }
    return result;
  } finally {
    db.close();
  }
}

export function sendPendingReplies(db) {
  const rows = pendingReplies(db);
  const results = [];
  for (const row of rows) {
    try {
      const target = JSON.parse(row.reply_target);
      sendMessage({
        chatType: target.chat_type,
        chatId: target.chat_id,
        content: row.answer
      });
      markReplySent(db, row.id);
      results.push({ id: row.id, sent: true });
    } catch (error) {
      markReplyFailed(db, row.id, error.message);
      results.push({ id: row.id, sent: false, error: error.message });
    }
  }
  return results;
}

export function flushReplies() {
  const db = openDb();
  try {
    return sendPendingReplies(db);
  } finally {
    db.close();
  }
}

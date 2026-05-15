PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS allowed_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL UNIQUE,
  name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS allowed_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_key TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  chat_type INTEGER NOT NULL,
  user_id TEXT,
  send_time TEXT,
  msg_type TEXT NOT NULL,
  content TEXT,
  raw_json TEXT NOT NULL,
  process_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS processing_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL UNIQUE,
  task_type TEXT NOT NULL DEFAULT 'classify_message',
  status TEXT NOT NULL DEFAULT 'pending',
  result_type TEXT,
  confidence REAL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  processed_at TEXT,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  source_user_id TEXT,
  source_role TEXT,
  module TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  scenario TEXT,
  expected_result TEXT,
  priority TEXT,
  status TEXT NOT NULL DEFAULT '待整理',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT,
  module TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS qa_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  matched_knowledge_ids TEXT,
  answer TEXT NOT NULL,
  confidence REAL,
  reply_target TEXT NOT NULL,
  sent_status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  error_message TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'pending',
  resolved_knowledge_id INTEGER,
  resolved_at TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_id, send_time);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(process_status);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON processing_tasks(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_items(status);

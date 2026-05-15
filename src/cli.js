#!/usr/bin/env node
import fs from 'node:fs';
import { startAdminServer } from './admin.js';
import { autoOnce, autoWatch } from './auto.js';
import {
  addKnowledgeItem,
  getSetting,
  initDb,
  listAllowedGroups,
  listAllowedUsers,
  listKnowledgeItems,
  listMessages,
  listQaLogs,
  listRequirements,
  listSettings,
  openDb,
  setSetting,
  upsertAllowedGroup,
  upsertAllowedUser
} from './db.js';
import { pollOnce, pollWatch } from './poll.js';
import { applyDecisionFile, flushReplies, listTasks } from './tasks.js';
import { getChatList, getMessages, getSchema, initWecomConfig, installWecomCli, testWecom, formatLocalTime } from './wecom.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value.startsWith('--')) {
      const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(value);
    }
  }
  return args;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [section, command, subcommand] = args._;

  if (section === 'db' && command === 'init') {
    printJson({ ok: true, db_path: initDb() });
    return;
  }

  if (section === 'admin') {
    const db = openDb();
    try {
      const port = Number(args.port || getSetting(db, 'admin_port', '8787'));
      startAdminServer({ port, host: args.host || '127.0.0.1' });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'wecom' && command === 'install') {
    printJson({ ok: true, cli_path: installWecomCli() });
    return;
  }

  if (section === 'wecom' && command === 'init') {
    printJson({ ok: true, ...(await initWecomConfig()) });
    return;
  }

  if (section === 'wecom' && command === 'test') {
    const output = testWecom();
    printJson({ ok: true, output: output.split(/\r?\n/).slice(0, 8).join('\n') });
    return;
  }

  if (section === 'wecom' && command === 'schema') {
    printJson(getSchema(args.category || 'msg', args.command || 'send_message'));
    return;
  }

  if (section === 'wecom' && command === 'chats') {
    const hours = Number(args.hours || 24);
    const end = new Date();
    const begin = new Date(end.getTime() - hours * 3600_000);
    const payload = getChatList({ beginTime: formatLocalTime(begin), endTime: formatLocalTime(end) });
    printJson(payload);
    return;
  }

  if (section === 'wecom' && command === 'messages') {
    const hours = Number(args.hours || 24);
    const end = new Date();
    const begin = new Date(end.getTime() - hours * 3600_000);
    const payload = getMessages({
      chatType: Number(args.chatType || 2),
      chatId: required(args.chatId, 'chat-id'),
      beginTime: formatLocalTime(begin),
      endTime: formatLocalTime(end)
    });
    printJson(payload);
    return;
  }

  if (section === 'config' && command === 'group' && subcommand === 'add') {
    const db = openDb();
    try {
      upsertAllowedGroup(db, { chatId: required(args.chatId, 'chat-id'), name: args.name || null });
      printJson({ ok: true, groups: listAllowedGroups(db) });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'config' && command === 'user' && subcommand === 'add') {
    const db = openDb();
    try {
      upsertAllowedUser(db, {
        userId: required(args.userId, 'user-id'),
        name: args.name || null,
        role: args.role || null
      });
      printJson({ ok: true, users: listAllowedUsers(db) });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'config' && command === 'list') {
    const db = openDb();
    try {
      printJson({
        settings: listSettings(db),
        groups: listAllowedGroups(db),
        users: listAllowedUsers(db)
      });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'config' && command === 'set') {
    const db = openDb();
    try {
      setSetting(db, required(args.key, 'key'), required(args.value, 'value'));
      printJson({ ok: true, settings: listSettings(db) });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'knowledge' && command === 'add') {
    const db = openDb();
    try {
      const content = args.file ? fs.readFileSync(args.file, 'utf8') : required(args.content, 'content');
      const id = addKnowledgeItem(db, {
        title: required(args.title, 'title'),
        content,
        category: args.category || null,
        keywords: args.keywords || null,
        module: args.module || null
      });
      printJson({ ok: true, id });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'knowledge' && command === 'list') {
    const db = openDb();
    try {
      printJson({ items: listKnowledgeItems(db, Number(args.limit || 50)) });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'messages' && command === 'list') {
    const db = openDb();
    try {
      printJson({ messages: listMessages(db, Number(args.limit || 50)) });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'requirements' && command === 'list') {
    const db = openDb();
    try {
      printJson({ requirements: listRequirements(db, Number(args.limit || 50)) });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'qa' && command === 'list') {
    const db = openDb();
    try {
      printJson({ qa_logs: listQaLogs(db, Number(args.limit || 50)) });
    } finally {
      db.close();
    }
    return;
  }

  if (section === 'poll') {
    if (args.watch) {
      await pollWatch();
      return;
    }
    printJson(pollOnce({ hours: args.hours ? Number(args.hours) : null }));
    return;
  }

  if (section === 'auto') {
    if (args.watch) {
      await autoWatch();
      return;
    }
    printJson(autoOnce({
      hours: args.hours ? Number(args.hours) : null,
      limit: args.limit ? Number(args.limit) : null
    }));
    return;
  }

  if (section === 'tasks' && command === 'list') {
    printJson(listTasks({ limit: Number(args.limit || 20), includeKnowledge: !args.noKnowledge }));
    return;
  }

  if (section === 'tasks' && command === 'apply') {
    printJson({ ok: true, result: applyDecisionFile(required(args.file, 'file')) });
    return;
  }

  if (section === 'replies' && command === 'flush') {
    printJson({ ok: true, results: flushReplies() });
    return;
  }

  printHelp();
  process.exitCode = 1;
}

function required(value, name) {
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage:
  node src/cli.js db init
  node src/cli.js admin --port 8787 --host 127.0.0.1
  node src/cli.js wecom install
  node src/cli.js wecom init
  node src/cli.js wecom test
  node src/cli.js wecom chats --hours 167
  node src/cli.js wecom messages --chat-id <id> --hours 24
  node src/cli.js config group add --chat-id <id> --name <name>
  node src/cli.js config user add --user-id <id> --name <name> --role <role>
  node src/cli.js config list
  node src/cli.js knowledge add --title <title> --content <content>
  node src/cli.js knowledge list
  node src/cli.js messages list
  node src/cli.js requirements list
  node src/cli.js qa list
  node src/cli.js poll --once
  node src/cli.js poll --watch
  node src/cli.js auto --once
  node src/cli.js auto --watch
  node src/cli.js tasks list
  node src/cli.js tasks apply --file <decision.json>
  node src/cli.js replies flush`);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});

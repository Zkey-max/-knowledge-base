import {
  activeGroupIds,
  activeUserIds,
  getSetting,
  insertMessage,
  openDb
} from './db.js';
import { formatLocalTime, getChatList, getMessages } from './wecom.js';

function normalizeText(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    return value.content || value.text || JSON.stringify(value);
  }
  return String(value);
}

function normalizeMessage(raw, chatId, chatType) {
  return {
    chatId,
    chatType,
    userId: raw.userid || raw.user_id || raw.sender || raw.from || null,
    sendTime: raw.send_time || raw.msg_time || raw.time || null,
    msgType: raw.msgtype || raw.msg_type || raw.type || 'unknown',
    content: normalizeText(raw.text || raw.content || raw.msg_content || raw.message),
    raw
  };
}

export function pollOnce({ hours = null } = {}) {
  const db = openDb();
  try {
    const groupIds = activeGroupIds(db);
    const userIds = activeUserIds(db);
    if (groupIds.size === 0) {
      return { ok: false, reason: 'No enabled allowed group. Add one with: node src/cli.js config group add --chat-id <id>' };
    }

    const lookbackMinutes = Number(getSetting(db, 'poll_lookback_minutes', '120'));
    const end = new Date();
    const begin = new Date(end.getTime() - (hours ? hours * 3600_000 : lookbackMinutes * 60_000));
    const beginTime = formatLocalTime(begin);
    const endTime = formatLocalTime(end);

    const chatList = getChatList({ beginTime, endTime });
    const chats = Array.isArray(chatList.chats) ? chatList.chats : [];
    const targetChats = chats.filter((chat) => groupIds.has(chat.chat_id || chat.chatid));

    let inserted = 0;
    let queued = 0;
    let ignored = 0;
    let seenMessages = 0;

    for (const chat of targetChats) {
      const chatId = chat.chat_id || chat.chatid;
      const messagePayload = getMessages({ chatType: 2, chatId, beginTime, endTime });
      const messages = Array.isArray(messagePayload.messages) ? messagePayload.messages : [];
      for (const raw of messages) {
        seenMessages += 1;
        const message = normalizeMessage(raw, chatId, 2);
        const shouldQueue =
          message.msgType === 'text' &&
          Boolean(message.content) &&
          (!message.userId || userIds.has(message.userId));
        const result = insertMessage(db, message, shouldQueue);
        if (result.inserted) {
          inserted += 1;
          if (shouldQueue) {
            queued += 1;
          } else {
            ignored += 1;
          }
        }
      }
    }

    return {
      ok: true,
      begin_time: beginTime,
      end_time: endTime,
      chats_found: chats.length,
      target_chats: targetChats.length,
      messages_seen: seenMessages,
      inserted,
      queued,
      ignored
    };
  } finally {
    db.close();
  }
}

export async function pollWatch() {
  for (;;) {
    const db = openDb();
    const interval = Number(getSetting(db, 'poll_interval_seconds', '30'));
    db.close();
    const result = pollOnce();
    console.log(JSON.stringify({ time: formatLocalTime(new Date()), ...result }));
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureLocalDirs, paths, requireEnv } from './config.js';

const userAgent = 'WeComCLI/0.1.8 distribution/unknown windows/x86_64';

export function cliExePath() {
  return path.join(paths.wecomCliDir, 'package', 'bin', process.platform === 'win32' ? 'wecom-cli.exe' : 'wecom-cli');
}

export function ensureCliInstalled() {
  const exe = cliExePath();
  if (!fs.existsSync(exe)) {
    throw new Error('wecom-cli is not installed. Run: npm run wecom:install');
  }
  return exe;
}

export function installWecomCli() {
  ensureLocalDirs();
  fs.rmSync(paths.wecomCliDir, { recursive: true, force: true });
  fs.mkdirSync(paths.wecomCliDir, { recursive: true });
  fs.rmSync(paths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(paths.tmpDir, { recursive: true });

  const packArgs = ['pack', '@wecom/cli-win32-x64@0.1.8', '--pack-destination', paths.tmpDir];
  const pack = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...packArgs], { encoding: 'utf8' })
    : spawnSync('npm', packArgs, { encoding: 'utf8' });
  if (pack.status !== 0) {
    throw new Error(pack.stderr || pack.stdout || 'Failed to download wecom-cli package');
  }

  const tgz = fs.readdirSync(paths.tmpDir).find((name) => name.endsWith('.tgz'));
  if (!tgz) {
    throw new Error('Downloaded wecom-cli package was not found');
  }

  const extract = spawnSync('tar', ['-xf', path.join(paths.tmpDir, tgz), '-C', paths.wecomCliDir], {
    encoding: 'utf8'
  });
  if (extract.status !== 0) {
    throw new Error(extract.stderr || extract.stdout || 'Failed to extract wecom-cli package');
  }
  fs.rmSync(path.join(paths.tmpDir, tgz), { force: true });

  ensureCliInstalled();
  return cliExePath();
}

export async function initWecomConfig() {
  ensureLocalDirs();
  ensureCliInstalled();

  const botId = requireEnv('WECOM_BOT_ID');
  const secret = requireEnv('WECOM_BOT_SECRET');
  fs.rmSync(paths.wecomConfigDir, { recursive: true, force: true });
  fs.mkdirSync(paths.wecomConfigDir, { recursive: true });

  const time = Math.floor(Date.now() / 1000);
  const nonce = `mcp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const signature = crypto.createHash('sha256').update(`${secret}${botId}${time}${nonce}`).digest('hex');
  const requestBody = {
    bot_id: botId,
    time,
    nonce,
    signature,
    bind_source: 1,
    cli_version: userAgent
  };

  const response = await fetch('https://qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_mcp_config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent
    },
    body: JSON.stringify(requestBody)
  });
  const payload = await response.json();
  if (payload.errcode !== 0) {
    throw new Error(`MCP config fetch failed: ${payload.errmsg || payload.errcode}`);
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(path.join(paths.wecomConfigDir, '.encryption_key'), key.toString('base64'), 'ascii');
  writeEncryptedJson(path.join(paths.wecomConfigDir, 'bot.enc'), { id: botId, secret, create_time: time }, key);
  writeEncryptedJson(path.join(paths.wecomConfigDir, 'mcp_config.enc'), payload.list, key);

  return {
    listCount: payload.list.length,
    bizTypes: payload.list.map((item) => item.biz_type),
    authed: [...new Set(payload.list.map((item) => item.is_authed))]
  };
}

function writeEncryptedJson(filePath, data, key) {
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(filePath, Buffer.concat([nonce, encrypted, tag]));
}

export function callCli(args, { parseTextJson = true } = {}) {
  const exe = ensureCliInstalled();
  const result = spawnSync(exe, args, {
    env: { ...process.env, WECOM_CLI_CONFIG_DIR: paths.wecomConfigDir },
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `wecom-cli failed with status ${result.status}`);
  }

  const stdout = result.stdout.trim();
  if (!parseTextJson) {
    return stdout ? JSON.parse(stdout) : {};
  }

  const rpc = JSON.parse(stdout);
  const text = rpc.result?.content?.[0]?.text || '{}';
  return JSON.parse(text);
}

export function testWecom() {
  const msgHelp = spawnSync(ensureCliInstalled(), ['msg', '--help'], {
    env: { ...process.env, WECOM_CLI_CONFIG_DIR: paths.wecomConfigDir },
    encoding: 'utf8'
  });
  if (msgHelp.status !== 0) {
    throw new Error(msgHelp.stderr || msgHelp.stdout || 'wecom-cli msg test failed');
  }
  return msgHelp.stdout || msgHelp.stderr;
}

export function getChatList({ beginTime, endTime, cursor = null }) {
  const json = { begin_time: beginTime, end_time: endTime };
  if (cursor) {
    json.cursor = cursor;
  }
  return callCli(['msg', 'get_msg_chat_list', '--json', JSON.stringify(json)]);
}

export function getMessages({ chatType, chatId, beginTime, endTime, cursor = null }) {
  const json = {
    chat_type: chatType,
    chatid: chatId,
    begin_time: beginTime,
    end_time: endTime
  };
  if (cursor) {
    json.cursor = cursor;
  }
  return callCli(['msg', 'get_message', '--json', JSON.stringify(json)]);
}

export function getSchema(category, command) {
  return callCli([category, command, '--schema'], { parseTextJson: false });
}

export function sendMessage({ chatType, chatId, content }) {
  const attempts = [
    { chat_type: chatType, chatid: chatId, msgtype: 'text', text: { content } },
    { chat_type: chatType, chatid: chatId, content },
    { chat_type: chatType, chatid: chatId, text: content },
    { chat_type: chatType, chat_id: chatId, content }
  ];

  let lastError = null;
  for (const payload of attempts) {
    try {
      return callCli(['msg', 'send_message', '--json', JSON.stringify(payload)]);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function formatLocalTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

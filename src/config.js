import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localDir = path.join(rootDir, '.local');

export const paths = {
  rootDir,
  localDir,
  dbPath: path.join(localDir, 'app.sqlite'),
  wecomCliDir: path.join(localDir, 'wecom-cli'),
  wecomConfigDir: path.join(localDir, 'wecom-config'),
  tmpDir: path.join(localDir, 'tmp')
};

export function ensureLocalDirs() {
  for (const dir of [paths.localDir, paths.wecomCliDir, paths.wecomConfigDir, paths.tmpDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const defaults = {
  pollIntervalSeconds: 30,
  pollLookbackMinutes: 120,
  adminPort: 8787,
  autoReplyEnabled: true,
  autoProcessEnabled: true,
  autoProcessLimit: 20,
  minAnswerConfidence: 0.7,
  modelProvider: 'codex_session'
};

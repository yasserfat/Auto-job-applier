import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config, secrets } from './config.js';

mkdirSync(config.logsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
export const logFile = path.join(config.logsDir, `run-${stamp}.log`);

function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

function write(level: string, parts: unknown[]) {
  const msg = parts.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  const line = redact(`${new Date().toISOString()} [${level}] ${msg}`);
  (level === 'ERROR' ? console.error : console.log)(line);
  appendFileSync(logFile, line + '\n');
}

export const log = {
  info: (...p: unknown[]) => write('INFO', p),
  warn: (...p: unknown[]) => write('WARN', p),
  error: (...p: unknown[]) => write('ERROR', p),
};

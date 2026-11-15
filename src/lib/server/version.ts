/**
 * Version of the running app: the last git commit of the checkout. The
 * launcher (scripts/start.mjs) pulls updates while the server runs, so the
 * value is re-read every few seconds instead of once at start-up.
 */
import { execFile } from 'node:child_process';
import type { AppVersion } from '../shared/types';

const TTL_MS = 15_000;
let cached: { at: number; value: AppVersion | null } | null = null;

function gitLog(): Promise<AppVersion | null> {
  return new Promise((resolve) => {
    execFile('git', ['log', '-1', '--format=%h|%cI'], { cwd: process.cwd(), timeout: 5000, windowsHide: true }, (err, stdout) => {
      const [commit, date] = String(stdout ?? '')
        .trim()
        .split('|');
      resolve(!err && commit && date ? { commit, date } : null);
    });
  });
}

export async function appVersion(): Promise<AppVersion | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await gitLog();
  cached = { at: Date.now(), value };
  return value;
}

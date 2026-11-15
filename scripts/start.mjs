#!/usr/bin/env node
/**
 * Verticut launcher: starts the app and keeps it up to date on its own.
 *
 *   node scripts/start.mjs        (or double-click Verticut.bat / verticut.sh)
 *
 * On start and then every minute it asks GitHub for new commits. When there
 * are some it fast-forwards the checkout; the dev server reloads changed
 * source files by itself, and the launcher reinstalls dependencies and
 * restarts the server only when the update needs it. Nothing is updated
 * while the app is exporting or transcribing, and local edits are never
 * overwritten.
 *
 * Options:      --sin-actualizar   do not look for updates
 *               --sin-navegador    do not open the browser
 *               --descartar        put local edits aside (git stash) so the update can be applied
 * Environment:  PORT (3000), VERTICUT_UPDATE_SECONDS (60, 0 = off)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStatus, planUpdate, splitLocalChanges } from './update-plan.mjs';

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), '..');
process.chdir(root);

const isWin = process.platform === 'win32';
const flags = new Set(process.argv.slice(2));
const PORT = Number(process.env.PORT) || 3000;
const seconds = Number(process.env.VERTICUT_UPDATE_SECONDS ?? 60);
const INTERVAL_MS = Number.isFinite(seconds) && seconds > 0 ? Math.max(5, seconds) * 1000 : 0;
const AUTO_UPDATE = !flags.has('--sin-actualizar') && INTERVAL_MS > 0;
const OPEN_BROWSER = !flags.has('--sin-navegador') && process.env.VERTICUT_OPEN !== '0';
const STAMP = path.join(root, 'node_modules', '.verticut-lock');

const color = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const say = (text) => console.log(`${color('33;1', '[Verticut]')} ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a command and collects its output; never throws. */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(command, args, { cwd: root, windowsHide: true, ...options });
    } catch (e) {
      resolve({ code: -1, out, err: String(e) });
      return;
    }
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });
}

// Never stop to ask for a password in the background: a failed check is retried on the next round.
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const git = (...args) => run('git', args, { env: gitEnv, timeout: 120_000 });

// ---------------------------------------------------------------- updates

/** Messages that repeat on every round are printed once, until the situation changes. */
let lastNotice = '';
function notice(text) {
  if (text && text !== lastNotice) say(text);
  lastNotice = text;
}

/** What this checkout is compared with, and the arguments for `git fetch`. */
let upstream = '@{u}';
let fetchArgs = [];

async function canUpdate() {
  if (!fs.existsSync(path.join(root, '.git'))) {
    notice('Esta carpeta no se descargó con "git clone": la app funciona, pero no se actualizará sola.');
    return false;
  }
  if ((await git('--version')).code !== 0) {
    notice('No se encuentra Git: la app funciona, pero no se actualizará sola. Instálalo desde https://git-scm.com');
    return false;
  }
  if ((await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')).code === 0) return true;
  // A branch without a configured upstream: follow the branch of the same name on GitHub.
  const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).out.trim();
  if (branch && branch !== 'HEAD' && (await git('remote', 'get-url', 'origin')).code === 0) {
    upstream = 'FETCH_HEAD'; // what the fetch below downloads
    fetchArgs = ['origin', branch];
    return true;
  }
  notice('Esta copia no está enlazada con GitHub: la app funciona, pero no se actualizará sola.');
  return false;
}

/** Number of commits available on GitHub that this computer does not have yet. */
async function commitsBehind() {
  const fetched = await git('fetch', '--quiet', ...fetchArgs);
  if (fetched.code !== 0) {
    notice('No se ha podido comprobar si hay actualizaciones (¿sin conexión?). Se volverá a intentar.');
    return 0;
  }
  const count = await git('rev-list', '--count', `HEAD..${upstream}`);
  if (count.code !== 0) {
    notice(`No se ha podido comprobar si hay actualizaciones: ${count.err.trim().split('\n')[0]}`);
    return 0;
  }
  return Number(count.out.trim()) || 0;
}

async function serverBusy() {
  if (!server.url) return false;
  try {
    const res = await fetch(`${server.url}/api/status`, { signal: AbortSignal.timeout(4000) });
    return res.ok && (await res.json()).busy === true;
  } catch {
    return false;
  }
}

/**
 * Brings the checkout up to date. Returns the files that changed, or null
 * when there was nothing new or the update could not be applied.
 */
async function pullUpdate({ discard = false } = {}) {
  const behind = await commitsBehind();
  if (behind === 0) return null;
  if (await serverBusy()) {
    notice('Hay una actualización. Se aplicará cuando termine el trabajo en curso (exportación, transcripción…).');
    return null;
  }

  const before = (await git('rev-parse', 'HEAD')).out.trim();
  let merged = await git('merge', '--ff-only', '--quiet', upstream);
  if (merged.code !== 0) {
    // Files rewritten by npm or next can be restored; anything else is the user's work.
    const local = splitLocalChanges(parseStatus((await git('status', '--porcelain', '--untracked-files=no')).out));
    if (local.generated.length > 0) await git('checkout', '--', ...local.generated);
    if (local.user.length > 0 && discard) {
      await git('stash', 'push', '-m', `Verticut ${new Date().toISOString()}`);
      say('Tus cambios locales se han guardado aparte (se recuperan con "git stash pop").');
    }
    merged = await git('merge', '--ff-only', '--quiet', upstream);
    if (merged.code !== 0) {
      notice(
        local.user.length > 0 && !discard
          ? `Hay una actualización, pero no se puede aplicar porque has modificado: ${local.user.join(', ')}.\n` +
              '           Para guardar tus cambios aparte y actualizar, cierra esta ventana y abre la app con la opción --descartar.'
          : `No se ha podido aplicar la actualización: ${(merged.err || merged.out).trim().split('\n')[0]}`,
      );
      return null;
    }
  }

  const after = (await git('rev-parse', 'HEAD')).out.trim();
  const files = (await git('diff', '--name-only', before, after)).out.split('\n').filter(Boolean);
  const subjects = (await git('log', '--format=%s', `${before}..${after}`)).out.split('\n').filter(Boolean);
  lastNotice = '';
  say(color('32', `Actualizado (${behind} ${behind === 1 ? 'cambio' : 'cambios'}): ${subjects[0] ?? ''}`));
  for (const s of subjects.slice(1, 6)) console.log(`           · ${s}`);
  return files;
}

// ----------------------------------------------------------- dependencies

function lockHash() {
  try {
    return createHash('sha1')
      .update(fs.readFileSync(path.join(root, 'package-lock.json')))
      .digest('hex');
  } catch {
    return 'none';
  }
}

const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

/** Runs `npm install` when package-lock.json differs from the one that was installed. */
async function installDependencies() {
  const wanted = lockHash();
  const installed = fs.existsSync(nextBin) && fs.existsSync(STAMP) ? fs.readFileSync(STAMP, 'utf8').trim() : null;
  if (installed === wanted) return true;
  say(
    fs.existsSync(nextBin)
      ? 'Actualizando los componentes de la app…'
      : 'Instalando los componentes de la app (solo la primera vez, tarda unos minutos)…',
  );
  // npm is a .cmd file on Windows: it has to run through the shell, as one command line.
  const done = isWin
    ? await run('npm install --no-audit --no-fund', [], { stdio: 'inherit', shell: true })
    : await run('npm', ['install', '--no-audit', '--no-fund'], { stdio: 'inherit' });
  if (done.code !== 0) {
    say(color('31', 'No se han podido instalar los componentes (npm install ha fallado). Revisa la conexión a internet.'));
    return fs.existsSync(nextBin);
  }
  fs.writeFileSync(STAMP, wanted);
  return true;
}

// ----------------------------------------------------------------- server

const server = {
  /** @type {import('node:child_process').ChildProcess | null} */
  child: null,
  port: PORT,
  url: '',
  startedAt: 0,
  quickFailures: 0,
  stopping: false,
  starting: false,
};
let browserOpened = !OPEN_BROWSER;
let quitting = false;

function openBrowser(url) {
  const [command, args] = isWin ? ['cmd.exe', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // No browser to open: the address is printed anyway.
  }
}

/** True when the app already answers on a port (another copy of it is open). */
async function isVerticut(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/status`, { signal: AbortSignal.timeout(3000) });
    return res.ok && typeof (await res.json())?.transcriber === 'string';
  } catch {
    return false;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
  });
}

async function waitUntilReady(child) {
  const base = `http://localhost:${server.port}`;
  for (let i = 0; i < 180 && server.child === child; i++) {
    if ((await isVerticut(server.port)) && server.child === child) {
      server.url = base;
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function startServer() {
  if (!fs.existsSync(nextBin)) {
    say(color('31', 'Faltan los componentes de la app. Comprueba la conexión a internet y vuelve a abrirla.'));
    return;
  }
  server.url = '';
  server.stopping = false;
  server.starting = true;
  // After a restart the system may need a moment to release the port.
  for (let i = 0; i < 20 && !(await portFree(server.port)); i++) await sleep(500);
  server.starting = false;
  if (quitting) return;
  server.startedAt = Date.now();
  const child = spawn(process.execPath, [nextBin, 'dev', '-p', String(server.port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so the whole server (it starts helper processes) can be stopped at once.
    detached: !isWin,
    windowsHide: true,
    env: { ...process.env, ...(process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}) },
  });
  server.child = child;
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  child.on('error', (e) => say(color('31', `No se ha podido arrancar la app: ${e.message}`)));
  child.on('exit', (code) => {
    if (server.child !== child) return;
    server.child = null;
    if (server.stopping || quitting) return;
    const quick = Date.now() - server.startedAt < 20_000;
    server.quickFailures = quick ? server.quickFailures + 1 : 0;
    if (server.quickFailures >= 3) {
      say(color('31', `La app se ha cerrado (código ${code}). Se volverá a intentar cuando llegue una actualización.`));
      return;
    }
    say(`La app se ha cerrado (código ${code}). Reiniciando…`);
    setTimeout(() => !quitting && !server.child && !server.starting && void startServer(), 3000);
  });

  void waitUntilReady(child).then((ready) => {
    if (!ready || server.child !== child) return;
    say(`Lista en ${color('36;1', server.url)}  ·  deja esta ventana abierta mientras uses la app.`);
    if (!browserOpened) {
      browserOpened = true;
      openBrowser(server.url);
    }
  });
}

function stopServer() {
  const child = server.child;
  if (!child || child.exitCode !== null) {
    server.child = null;
    return Promise.resolve();
  }
  server.stopping = true;
  return new Promise((resolve) => {
    const finish = () => {
      if (server.child === child) server.child = null;
      resolve();
    };
    child.once('exit', finish);
    if (isWin) {
      void run('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      const kill = (signal) => {
        try {
          process.kill(-child.pid, signal);
        } catch {
          // Already gone.
        }
      };
      kill('SIGTERM');
      setTimeout(() => child.exitCode === null && kill('SIGKILL'), 5000).unref();
    }
    setTimeout(finish, 8000).unref();
  });
}

// ------------------------------------------------------------------- main

/** The launcher that replaced this one after an update, if any. */
let successor = null;

/** A newer launcher was downloaded: hand over to it and stay as a thin parent. */
async function relaunch() {
  say('El lanzador se ha actualizado: reiniciando…');
  quitting = true;
  await stopServer();
  const args = process.argv.slice(2).filter((a) => a !== '--descartar');
  const child = spawn(process.execPath, [self, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(server.port), VERTICUT_OPEN: '0' },
  });
  successor = child;
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', () => process.exit(1));
}

async function applyUpdate(files) {
  const plan = planUpdate(files);
  if (plan.relaunch) return relaunch();
  if (plan.restart) {
    say('Esta actualización necesita reiniciar la app…');
    await stopServer();
    await installDependencies();
    server.quickFailures = 0;
    await startServer();
  } else if (!server.child && !server.starting) {
    server.quickFailures = 0;
    await startServer(); // it had crashed: the update may have fixed it
  }
}

let checking = false;
async function checkForUpdates() {
  if (checking || quitting) return;
  checking = true;
  try {
    const files = await pullUpdate();
    if (files && !quitting) await applyUpdate(files);
  } catch (e) {
    notice(`No se ha podido comprobar si hay actualizaciones: ${e instanceof Error ? e.message : e}`);
  } finally {
    checking = false;
  }
}

async function quit(signal) {
  if (successor) {
    successor.kill(signal); // it owns the server now and will stop it
    return;
  }
  if (quitting) return;
  quitting = true;
  await stopServer();
  process.exit(0);
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    say(color('31', `Hace falta Node.js 20 o más reciente (tienes la ${process.versions.node}). Descárgalo de https://nodejs.org`));
    process.exit(1);
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void quit(signal));

  if (await isVerticut(PORT)) {
    say(`Verticut ya está abierto en este ordenador: http://localhost:${PORT}`);
    if (OPEN_BROWSER) openBrowser(`http://localhost:${PORT}`);
    await sleep(1500);
    process.exit(0);
  }

  const updates = AUTO_UPDATE && (await canUpdate());
  if (updates) {
    say('Buscando actualizaciones…');
    // The copy of this script that is running was read before the update.
    const files = await pullUpdate({ discard: flags.has('--descartar') }).catch(() => null);
    if (files && planUpdate(files).relaunch) return relaunch();
    if (!files) say('Tienes la última versión.');
  }

  if (!(await installDependencies())) process.exit(1);
  const tools = await Promise.all([run('ffmpeg', ['-version']), run('ffprobe', ['-version'])]);
  if (tools.some((t) => t.code !== 0)) {
    say(color('31', 'No se encuentra FFmpeg. En Windows: "winget install Gyan.FFmpeg" y vuelve a abrir la app. En Mac: "brew install ffmpeg".'));
  }

  // Another program may be using the usual port.
  for (let i = 0; i < 20 && !(await portFree(server.port)); i++) server.port++;
  if (server.port !== PORT) say(`El puerto ${PORT} está ocupado por otro programa: se usa el ${server.port}.`);

  await startServer();
  if (updates) {
    setInterval(() => void checkForUpdates(), INTERVAL_MS);
    say(`Actualización automática activada: se comprueba cada ${Math.round(INTERVAL_MS / 1000)} s.`);
  }
}

void main();

/**
 * Decides what the launcher has to do after pulling an update, from the list
 * of files that changed. Changes to the interface need nothing: the dev
 * server reloads them in the browser on its own.
 */

/** Files that npm reads: a change means dependencies may differ. */
const INSTALL = new Set(['package.json', 'package-lock.json']);
/**
 * Files the dev server only reads when it starts, and code that runs in the
 * server: it keeps state in memory (job queue, media index), so a clean
 * restart is safer than reloading it in place.
 */
const RESTART = [
  /^next\.config\./,
  /^postcss\.config\./,
  /^tsconfig\.json$/,
  /^\.env/,
  /^src\/lib\/(server|shared)\//,
  /^src\/app\/api\//,
  /^worker\//,
];
/** The launcher itself: the running copy is stale. */
const RELAUNCH = [/^scripts\/start\.mjs$/, /^scripts\/update-plan\.mjs$/];
/** Files written by tools (npm, next dev): local differences in them never hold user work. */
const GENERATED = new Set(['package-lock.json', 'AGENTS.md', 'next-env.d.ts']);

/**
 * @param {string[]} files paths relative to the repository root, with forward slashes
 * @returns {{ install: boolean, restart: boolean, relaunch: boolean }}
 */
export function planUpdate(files) {
  const install = files.some((f) => INSTALL.has(f));
  const relaunch = files.some((f) => RELAUNCH.some((re) => re.test(f)));
  const restart = install || relaunch || files.some((f) => RESTART.some((re) => re.test(f)));
  return { install, restart, relaunch };
}

/**
 * Splits locally modified files into the ones that can be restored without
 * asking (generated) and the ones the user edited.
 * @param {string[]} files
 */
export function splitLocalChanges(files) {
  return { generated: files.filter((f) => GENERATED.has(f)), user: files.filter((f) => !GENERATED.has(f)) };
}

/** Paths from `git status --porcelain` output. */
export function parseStatus(output) {
  return output
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => {
      const file = line.slice(3);
      const renamed = file.split(' -> ').pop() ?? file;
      return renamed.replace(/^"|"$/g, '');
    });
}

import { describe, expect, it } from 'vitest';
import { parseStatus, planUpdate, splitLocalChanges } from '../scripts/update-plan.mjs';

describe('planUpdate', () => {
  it('needs nothing for interface changes: the dev server reloads them', () => {
    expect(planUpdate(['src/components/editor/Timeline.tsx', 'src/lib/client/actions.ts', 'README.md', 'public/fonts/inter.ttf'])).toEqual({
      install: false,
      restart: false,
      relaunch: false,
    });
  });

  it('reinstalls and restarts when dependencies change', () => {
    expect(planUpdate(['package-lock.json', 'src/app/page.tsx'])).toEqual({ install: true, restart: true, relaunch: false });
    expect(planUpdate(['package.json']).install).toBe(true);
  });

  it('restarts when the server configuration changes', () => {
    expect(planUpdate(['next.config.ts'])).toEqual({ install: false, restart: true, relaunch: false });
    expect(planUpdate(['.env.example']).restart).toBe(true);
  });

  it('restarts when code that runs in the server changes', () => {
    for (const file of ['src/lib/server/jobs.ts', 'src/lib/shared/types.ts', 'src/app/api/status/route.ts', 'worker/separate.mjs']) {
      expect(planUpdate([file])).toEqual({ install: false, restart: true, relaunch: false });
    }
  });

  it('relaunches when the launcher itself changes', () => {
    expect(planUpdate(['scripts/start.mjs'])).toEqual({ install: false, restart: true, relaunch: true });
    expect(planUpdate(['scripts/update-plan.mjs']).relaunch).toBe(true);
    expect(planUpdate(['scripts/font-info.mjs']).relaunch).toBe(false);
  });
});

describe('local changes', () => {
  it('reads the paths of git status --porcelain', () => {
    const out = ' M package-lock.json\nM  src/app/page.tsx\nR  old.ts -> src/new.ts\n M "con espacio.txt"\n';
    expect(parseStatus(out)).toEqual(['package-lock.json', 'src/app/page.tsx', 'src/new.ts', 'con espacio.txt']);
    expect(parseStatus('')).toEqual([]);
  });

  it('separates generated files from the edits of the user', () => {
    expect(splitLocalChanges(['package-lock.json', 'AGENTS.md', 'src/app/page.tsx'])).toEqual({
      generated: ['package-lock.json', 'AGENTS.md'],
      user: ['src/app/page.tsx'],
    });
  });
});

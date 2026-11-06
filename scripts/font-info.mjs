// Prints the metrics of every subtitle font in public/fonts.
// Used to fill src/lib/shared/fonts.ts (a test checks they stay in sync).
// Run: node scripts/font-info.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFontInfo } from '../src/lib/server/ttf.ts';

const dir = join(import.meta.dirname, '..', 'public', 'fonts');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.ttf'))) {
  console.log(file, JSON.stringify(readFontInfo(readFileSync(join(dir, file)))));
}

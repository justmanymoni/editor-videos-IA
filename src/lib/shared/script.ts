/**
 * Aligns a written script with the recognised words so the subtitles use the
 * script's exact wording and spelling while keeping the timing of the voice.
 */
import { levenshtein, normalizeWord } from './text';

export interface ScriptAlignment {
  /** New text per recognised word (index into the input list); words not listed keep their text. */
  texts: Map<number, string>;
  matched: number;
  changed: number;
  /** Recognised words that are not in the script (ad-libs, fillers). */
  extraSpoken: number;
  /** Script words that could not be placed on a spoken word and were attached to a neighbour. */
  attached: number;
  /** Spoken words (indices) that start a new subtitle block: the script had a "/" before them. */
  breaks: number[];
  /** True when the script contains at least one "/". */
  hasBreaks: boolean;
}

/**
 * Words of the script, and where the user typed a slash: "el lobo / enfurecido"
 * means a new subtitle block starts at "enfurecido".
 */
export function parseScript(script: string): { tokens: string[]; breakBefore: boolean[] } {
  const tokens: string[] = [];
  const breakBefore: boolean[] = [];
  let pending = false;
  for (const raw of script.replace(/\//g, ' / ').split(/\s+/)) {
    if (raw === '/') pending = tokens.length > 0;
    else if (raw && normalizeWord(raw)) {
      tokens.push(raw);
      breakBefore.push(pending);
      pending = false;
    }
  }
  return { tokens, breakBefore };
}

export const scriptTokens = (script: string) => parseScript(script).tokens;

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  return 1 - levenshtein([...a], [...b]) / Math.max(a.length, b.length);
}

const MATCH = 3;
const NEAR = 1;
const MISMATCH = -2;
const GAP = -1;
const MAX_CELLS = 30_000_000;

/**
 * Global alignment (Needleman–Wunsch). Equal words score best, similar ones
 * ("ahi"/"ahí", "dia"/"días") a bit less, so recognition mistakes are fixed
 * while the order of the speech is respected.
 */
export function alignScript(spoken: string[], script: string): ScriptAlignment {
  const { tokens, breakBefore } = parseScript(script);
  const a = spoken.map(normalizeWord);
  const b = tokens.map(normalizeWord);
  const n = a.length;
  const m = b.length;
  const result: ScriptAlignment = {
    texts: new Map(),
    matched: 0,
    changed: 0,
    extraSpoken: 0,
    attached: 0,
    breaks: [],
    hasBreaks: breakBefore.some(Boolean),
  };
  if (!n || !m) return result;
  if ((n + 1) * (m + 1) > MAX_CELLS)
    throw new Error('El guión o la transcripción son demasiado largos para alinearlos de una vez. Pégalo por partes.');

  const W = m + 1;
  const score = new Int32Array((n + 1) * W);
  const move = new Uint8Array((n + 1) * W); // 1 = diagonal, 2 = up (spoken only), 3 = left (script only)
  for (let i = 1; i <= n; i++) {
    score[i * W] = i * GAP;
    move[i * W] = 2;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP;
    move[j] = 3;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = similarity(a[i - 1], b[j - 1]);
      const pair = sim === 1 ? MATCH : sim >= 0.6 ? NEAR : MISMATCH;
      const diag = score[(i - 1) * W + j - 1] + pair;
      const up = score[(i - 1) * W + j] + GAP;
      const left = score[i * W + j - 1] + GAP;
      const best = Math.max(diag, up, left);
      score[i * W + j] = best;
      move[i * W + j] = best === diag ? 1 : best === up ? 2 : 3;
    }
  }

  // Walk back: pairs (spoken i ↔ script j) and unpaired script tokens.
  const assigned: string[][] = Array.from({ length: n }, () => []);
  const spokenOf = new Array<number>(m).fill(-1);
  const orphans: { after: number; token: string }[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = move[i * W + j];
    if (i > 0 && j > 0 && mv === 1) {
      assigned[i - 1].unshift(tokens[j - 1]);
      spokenOf[j - 1] = i - 1;
      if (a[i - 1] === b[j - 1]) result.matched++;
      i--;
      j--;
    } else if (i > 0 && (mv === 2 || j === 0)) {
      i--;
      result.extraSpoken++;
    } else {
      orphans.push({ after: i - 1, token: tokens[j - 1] });
      j--;
    }
  }

  // Script words without a spoken partner join the previous paired word (or the next one).
  const paired = assigned.map((t) => t.length > 0);
  for (const o of orphans.reverse()) {
    let k = o.after;
    while (k >= 0 && !paired[k]) k--;
    if (k >= 0) assigned[k].push(o.token);
    else {
      k = paired.findIndex(Boolean);
      if (k < 0) continue;
      assigned[k].unshift(o.token);
    }
    result.attached++;
  }

  // A slash starts a block at the next script word that has a spoken partner.
  const breaks = new Set<number>();
  breakBefore.forEach((brk, j) => {
    if (!brk) return;
    const k = spokenOf.findIndex((sp, idx) => idx >= j && sp >= 0);
    if (k >= 0 && spokenOf[k] > 0) breaks.add(spokenOf[k]);
  });
  result.breaks = [...breaks].sort((x, y) => x - y);

  assigned.forEach((t, idx) => {
    if (!t.length) return;
    const text = t.join(' ');
    if (text !== spoken[idx]) {
      result.texts.set(idx, text);
      result.changed++;
    }
  });
  return result;
}

/** Text helpers for transcript analysis (Spanish first, language agnostic). */

/** Lowercase, strip accents and punctuation. */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** normalizeWord + collapses repeated letters ("mmmm" → "m", "ehhh" → "eh"). */
export function fillerForm(text: string): string {
  return normalizeWord(text).replace(/(\p{L})\1+/gu, '$1');
}

export const endsSentence = (text: string) => /[.!?…]["»”)]*$/.test(text.trim());

export function levenshtein<T>(a: T[], b: T[]): number {
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export const SPANISH_STOPWORDS = new Set(
  (
    'a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bien bueno cada casi como con contra cual ' +
    'cuales cuando de del desde donde dos el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta estaba ' +
    'estado estamos estan estar estas este esto estos estoy fue fueron ha hace hacer hacia han has hasta hay he hoy la las le ' +
    'les lo los mas me mi mis mismo mucho muy nada ni no nos nosotros nuestra nuestro o os otra otro para pero poco por porque ' +
    'pues que quien se sea ser si sin sobre solo son su sus tal tambien tan tanto te tener tengo tiene tienen todo todos tu tus ' +
    'un una uno unos usted vamos vale ver vez y ya yo eh mm vale gente cosa cosas decir dicho voy va van sido tenemos'
  ).split(' '),
);

/** Light Spanish stemmer, good enough to match "playas" with "playa". */
export function stem(token: string): string {
  let t = token;
  if (t.length > 5 && t.endsWith('es')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('s')) t = t.slice(0, -1);
  if (t.length > 5 && /[aoe]$/.test(t)) t = t.slice(0, -1);
  return t;
}

/** Splits a file name like "playa_atardecer-01.mp4" into keywords. */
export function filenameKeywords(name: string): string[] {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalizeWord)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !SPANISH_STOPWORDS.has(t));
}

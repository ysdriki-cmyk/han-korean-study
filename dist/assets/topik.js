import { parseCSV } from './core.js';

const clean = value => String(value ?? '').trim().normalize('NFC');
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
const fields = ['korean', 'english', 'japanese', 'exampleKo', 'exampleJa'];

function contentHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** E/F/G supply the word and its translations; K/N supply its usage sentence. */
export function parseTopikExamples(text) {
  const rows = parseCSV(text);
  const examples = [], warnings = [], identities = new Set();
  let excluded = 0, duplicates = 0;
  for (const row of rows.slice(1)) {
    const entry = {
      korean: clean(row[4]),
      english: clean(row[5]),
      japanese: clean(row[6]),
      exampleKo: clean(row[10]),
      exampleJa: clean(row[13]),
    };
    if (!HANGUL.test(entry.korean) || (!entry.english && !entry.japanese)) {
      excluded += 1;
      continue;
    }
    const identity = JSON.stringify(fields.map(field => entry[field]));
    if (identities.has(identity)) { duplicates += 1; continue; }
    identities.add(identity);
    examples.push({ id: `topik:${clean(row[0]) || 'entry'}:${contentHash(identity)}`, ...entry });
  }
  if (excluded) warnings.push(`韓国語または訳が未記入の${excluded}行を除外しました。`);
  if (duplicates) warnings.push(`内容が同じ${duplicates}行をまとめました。`);
  if (!examples.length) warnings.push('使用参考例がありません。');
  return { examples, warnings };
}

/** Literal E-column search: exact words first, then source-ordered character hits. */
export function findTopikExamples(examples, query) {
  const terms = [...new Set((Array.isArray(query) ? query : [query])
    .filter(value => typeof value === 'string').map(clean).filter(Boolean))];
  if (!terms.length) return [];
  const exact = [], partial = [];
  for (const entry of examples) {
    const word = clean(entry.korean);
    if (terms.includes(word)) exact.push(entry);
    else if (terms.some(term => word.includes(term))) partial.push(entry);
  }
  return [...exact, ...partial];
}

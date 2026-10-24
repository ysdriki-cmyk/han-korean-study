import { parseCSV } from './core.js';
import { matchHangul } from './learning.js';

const clean = (value) => String(value ?? '').normalize('NFC').trim();
const headerName = (value) => clean(value).toLowerCase();

function contentHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * A comma/slash list of single Hangul words explicitly names alternatives.
 * Periods count as a separator only when every part is a single word too.
 * Sentences, empty list parts and other punctuation keep the full prompt intact.
 * The older alternateHan column is deliberately not an answer candidate.
 */
export function acceptedVocabularyAnswers(card) {
  const full = clean(card?.han);
  if (!full) return [];
  let parts;
  if (/[,、/／]/u.test(full)) parts = full.split(/[,、/／]/u).map(clean);
  else if (full.includes('.')) parts = full.split('.').map(clean);
  if (parts?.length > 1 && parts.every((part) => /^-?[가-힣]+-?$/u.test(part))) {
    return [...new Set(parts)];
  }
  return [full];
}

/** Exact Hangul matching after NFC/whitespace normalization, without fuzziness. */
export function matchVocabularyAnswer(input, card) {
  return matchHangul(input, card?.han)
    || acceptedVocabularyAnswers(card).some((candidate) => matchHangul(input, candidate));
}

/**
 * Read the supplied vocabulary sheet without treating its auxiliary columns as
 * words. The first No is the unique source ID; the later No. is an older ID.
 * Also accepts clean No,Korean,Japanese,English,state headers for future sheets.
 * Rank interpretation is intentionally left to the learning module.
 */
export function normalizeVocabulary(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { cards: [], warnings: ['CSVにデータがありません。'], excludedRows: 0 };
  const headers = rows[0].map(headerName);
  const column = (...names) => headers.findIndex((header) => names.includes(header));
  // Prefer the main editable term over the older 한글 copy in the source sheet.
  const mainHan = column('korean', 'han', '韓国語', 'ハングル', 'ko_word', 'moments いろいろhello talk');
  const secondaryHan = column('alternatehan', 'alternate_han', '한글');
  const columns = {
    id: column('id', 'no', '番号'),
    han: mainHan >= 0 ? mainHan : secondaryHan,
    japanese: column('japanese', '日本語', '和訳', '意味', 'youtube subtitle'),
    english: column('english', '英語', 'en'),
    state: column('state', '状態', 'read'),
    remember: column('remember', 'sourceremember'),
    exampleKo: column('exampleko', 'example_ko', '例文（韓国語）', '例文(韓国語)'),
    exampleJp: column('examplejp', 'example_jp', '例文（日本語）', '例文(日本語)'),
    notes: column('notes', '備考', 'メモ'),
    tags: column('tags', 'タグ', '#chat'),
    alternateHan: secondaryHan,
  };
  if (columns.id < 0) columns.id = column('no.');
  const originalLayout = headers.length === 27 && columns.han === 4
    && columns.japanese === 6 && columns.english === 5;
  if (originalLayout) {
    columns.exampleKo = 10;
    columns.exampleJp = 13;
  }
  if (columns.han < 0) throw new Error('単語CSVに「Korean」または「韓国語」列が必要です。');
  if (columns.japanese < 0 && columns.english < 0) {
    throw new Error('単語CSVに「Japanese」「日本語」「English」のいずれかの訳の列が必要です。');
  }
  const cards = [];
  const ids = new Set();
  let excludedRows = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const value = (name) => columns[name] < 0 ? '' : clean(row[columns[name]]);
    const han = value('han');
    const japanese = value('japanese');
    const english = value('english');
    const isRepeatedHeader = headerName(han) === headers[columns.han]
      && ((columns.japanese >= 0 && headerName(japanese) === headers[columns.japanese])
        || (columns.english >= 0 && headerName(english) === headers[columns.english]));
    if (!han || (!japanese && !english) || isRepeatedHeader) {
      excludedRows += 1;
      continue;
    }
    const state = value('state');
    const id = value('id') || `han:${han}:${contentHash(JSON.stringify([han, japanese, english]))}`;
    if (ids.has(id)) throw new Error(`${index + 1}行目: ID「${id}」が重複しています。先頭のNoまたはidを一意にしてください。`);
    ids.add(id);
    cards.push({
      id,
      han,
      kanji: japanese,
      hanja: '',
      meaning: english,
      state,
      flagged: ['必須！', '必須!', '必須', 'required'].includes(state),
      kind: 'vocabulary',
      english,
      exampleKo: value('exampleKo'),
      exampleJp: value('exampleJp'),
      notes: value('notes'),
      tags: value('tags'),
      alternateHan: value('alternateHan'),
      sourceRemember: value('remember'),
    });
  }
  const warnings = [];
  if (excludedRows) warnings.push(`${excludedRows}行（韓国語や訳のない行・見出し行）を学習対象から除外しました。`);
  if (!cards.length) warnings.push('学習できる単語カードがありません。');
  return { cards, warnings, excludedRows };
}

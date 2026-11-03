import { parseCSV } from './core.js';
import { sheetHeader } from './sheet-fields.js';

const clean = value => String(value ?? '').trim().normalize('NFC');

/** Read only the correspondence cells; explanations and prompt hints are not references. */
export function parseWordKanjiReferences(text = '') {
  const [header = [], ...rows] = parseCSV(text);
  const headers = header.map(sheetHeader);
  const column = (...names) => names.map(name => headers.indexOf(name)).find(index => index >= 0) ?? -1;
  const korean = column('韓国語', 'ハングル', 'han', 'ko_word');
  const kanji = column('漢字', '漢字候補', 'hanja', 'kanji');
  if (korean < 0 || kanji < 0) return [];
  const seen = new Set();
  return rows.flatMap(row => {
    const entry = { korean: clean(row[korean]), kanji: clean(row[kanji]) };
    const identity = JSON.stringify(entry);
    if (!/^[가-힣]$/u.test(entry.korean) || !entry.kanji || seen.has(identity)) return [];
    seen.add(identity);
    return [entry];
  });
}

/** Match the word's syllables in word order, once each, without guessing its etymology. */
export function findWordKanjiReferences(entries, word) {
  return [...new Set(clean(word))].flatMap(syllable => entries.filter(entry => entry.korean === syllable));
}

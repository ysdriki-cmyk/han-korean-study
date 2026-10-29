import { parseCSV } from './core.js';
import { parseDeck } from './decks.js';
import { sheetHeader } from './sheet-fields.js';
import { essentialKanji } from './kanji.js';
import { examplesFromVocabulary } from './topik.js';

const common = [
  { names: ['韓国語','han','ハングル','korean','ko_word','moments いろいろhello talk'], use: '主な韓国語。쓰기の正解・읽기の問題・読み上げに使用。' },
  { names: ['有効'], use: '現在は未使用。値による出題の除外は行わない。' },
];
const fields = {
  kanji: [
    ...common,
    { names: ['id','id_one','id_kan','no.','no','番号'], use: '固定ID。既存のIDは変更・再利用しない。教材間の番号重複は可。' },
    { names: ['出題ヒント','漢字','kanji'], use: '쓰기の問題。空欄なら漢字候補、さらに空欄なら解説・一覧から1項目を出題。' },
    { names: ['漢字候補','一覧','hanja'], use: '対応する漢字・意味。出題ヒントが空欄なら問題に使用。解答後にも表示。' },
    { names: ['解説・一覧','解説','解説/一覧','解説一覧','意味','meaning','notes','メモ'], use: '解答後の説明・一覧。ヒントと漢字候補が空欄なら問題にも使用。' },
    { names: ['必須','essential'], use: '1周目の出題範囲。！・TRUE・1などを指定。空欄は対象外。' },
  ],
  vocabulary: [
    ...common,
    { names: ['id','id_word','no.','no','番号'], use: '固定ID。既存のIDは変更・再利用しない。教材間の番号重複は可。' },
    { names: ['日本語','japanese','和訳','意味','youtube subtitle'], use: '日本語訳。쓰기の問題と解答・使用参考例に使用。' },
    { names: ['英語','english','en'], use: '英語訳。日本語と少なくとも一方が必要。問題と解答・参考例に使用。' },
    { names: ['別解','正解表記','acceptedanswers'], use: '追加で正解と認める韓国語。複数はセル内改行。任意。' },
    { names: ['類語','synonyms'], use: '解答後に表示。自動採点の正解には追加しない。任意。' },
    { names: ['カテゴリ','tags','タグ','#chat'], use: '分類名を保持。テーマ別の出題画面は今後の対応。' },
    { names: ['例文_韓国語','exampleko','example_ko','例文（韓国語）','例文(韓国語)'], use: '解答後に表示する韓国語の例文・読み上げ。' },
    { names: ['例文_日本語','examplejp','example_jp','例文（日本語）','例文(日本語)'], use: '例文の日本語訳。解答後に表示。' },
    { names: ['解説','notes','備考','メモ'], use: '解答後の補足。問題のヒントや採点の別解には使わない。' },
    { names: ['topik1'], use: '空欄でない行を使用参考例に採用。#shopなどの分類名も保持。' },
  ],
};

export function columnLetter(index) {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}

/** Use the production parser, but never fall back or save content on an admin check. */
export function inspectContent(deckId, text) {
  const result = parseDeck(deckId, text);
  const rows = parseCSV(text);
  const columns = rows[0].map((header, index) => {
    const name = sheetHeader(header);
    const definition = fields[deckId]?.find(field => field.names.includes(name));
    const sampleIndex = rows.findIndex((row, rowIndex) => rowIndex > 0 && String(row[index] || '').trim());
    return {
      cell: `${columnLetter(index)}1`, header: header || '（見出しなし）',
      use: definition?.use || 'この列には専用の用途を設定していません。',
      sampleCell: sampleIndex > 0 ? `${columnLetter(index)}${sampleIndex + 1}` : '',
      sample: sampleIndex > 0 ? String(rows[sampleIndex][index]).slice(0, 260) : '',
    };
  });
  return {
    count: result.cards.length,
    rawRows: rows.slice(1).filter(row => row.some(value => String(value).trim())).length,
    essential: deckId === 'kanji' ? result.cards.filter(essentialKanji).length : null,
    references: deckId === 'vocabulary' ? examplesFromVocabulary(result.cards).length : null,
    warnings: result.warnings,
    categories: deckId === 'vocabulary' ? new Set(result.cards.flatMap(card => card.categories || [])).size : null,
    columns,
  };
}

export function summarizeLearning(value) {
  const summary = { records: 0, writing: 0, reading: 0 };
  if (value?.version !== 3 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) return summary;
  for (const [id, record] of Object.entries(value.records)) {
    if (!/^(kanji|vocabulary):.+$/.test(id) || !record || typeof record !== 'object' || Array.isArray(record)) continue;
    summary.records += 1;
    for (const [mode, key] of [['write','writing'],['read','reading']]) {
      const attempts = record.assessments?.[mode]?.attempts;
      if (Number.isSafeInteger(attempts) && attempts > 0) summary[key] += attempts;
    }
  }
  return summary;
}

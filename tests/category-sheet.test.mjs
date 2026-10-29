import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CATEGORY_SHEET_HEADERS, CATEGORY_SHEET_OPERATORS, parseCategorySheet } from '../dist/assets/category-sheet.js';
import { buildStudySets, cardsForStudySet, normalizeCustomSets } from '../dist/assets/study-sets.js';

const csv = (...rows) => [CATEGORY_SHEET_HEADERS.join(','), ...rows].join('\n');
const word = (id, values = {}) => ({ id: `vocabulary:${id}`, deckId: 'vocabulary', han: '가다', kanji: '行く', tags: '', topikCategory: '', ...values });
const kanji = (id, values = {}) => ({ id: `kanji:${id}`, deckId: 'kanji', han: '가', kanji: '家', hanja: '家', meaning: '', ...values });
const ids = cards => cards.map(card => card.id);

test('eight exact headers and documented operators form a safe public integration contract', () => {
  assert.deepEqual(CATEGORY_SHEET_HEADERS, ['category_id', 'カテゴリ名', '教材', '対象列', '条件', '値', '条件の結合', '表示順']);
  assert.deepEqual(CATEGORY_SHEET_OPERATORS.map(item => item.label), ['含む', '含まない', 'タグ一致', '等しい', '印あり', '空欄', '空欄でない', '全件']);
  const result = parseCategorySheet(csv('required,必須漢字,one,必須,印あり,,AND,10', 'travel,旅行単語,word,カテゴリ,タグ一致,#travel,AND,20'));
  assert.deepEqual(result.warnings, []);
  assert.equal(result.sets[0].id, 'custom:sheet:required');
  assert.equal(result.sets[0].deckId, 'kanji');
  assert.deepEqual(result.sets[0].rules, [{ field: 'essential', operator: 'equals', value: true }]);
  assert.equal(result.sets[1].rules[0].value, 'travel');
  assert.equal(result.sets[1].source, 'sheet');
  assert.deepEqual(normalizeCustomSets([result.sets[1]], 'vocabulary'), [result.sets[1]]);
});

test('AND and OR group conditions by fixed IDs with repeated or inherited metadata', () => {
  const result = parseCategorySheet(csv('mixed,旅行の動詞,word,カテゴリ,タグ一致,travel,AND,5', 'mixed,,,日本語,含む,する,,',
    'quotes,引用のヒント,one,出題ヒント,含む,『,OR,2', 'quotes,引用のヒント,kanji,出題ヒント,含む,』,OR,2'));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.sets.map(set => set.sourceId), ['quotes', 'mixed']);
  const cards = [word('a', { tags: '#travel', kanji: '予約する' }), word('b', { tags: '#travel', kanji: '駅' }), word('c', { tags: '#food', kanji: '食事する' })];
  assert.deepEqual(ids(cardsForStudySet(cards, result.sets[1])), ['vocabulary:a']);
  const letters = [kanji('a', { kanji: '『読む』' }), kanji('b', { kanji: '閉じ』' }), kanji('c')];
  assert.deepEqual(ids(cardsForStudySet(letters, result.sets[0])), ['kanji:a', 'kanji:b']);
});

test('empty and literal exclusions preserve raw field meaning and category-source separation', () => {
  const result = parseCategorySheet(csv('missing,未分類,word,カテゴリ,空欄,,AND,1', 'available,TOPIK対象,word,TOPIK1,空欄でない,,AND,2',
    'plain,引用なし,one,解説・一覧,含まない,『,AND,3', 'exact,英訳一致,word,英語,等しい,go,AND,4'));
  assert.deepEqual(result.warnings, []);
  const words = [word('a', { topikCategory: '#travel', english: 'go' }), word('b', { tags: '#travel', english: 'go home' })];
  assert.deepEqual(ids(cardsForStudySet(words, result.sets[0])), ['vocabulary:a']);
  assert.deepEqual(ids(cardsForStudySet(words, result.sets[1])), ['vocabulary:a']);
  assert.deepEqual(ids(cardsForStudySet([kanji('a', { meaning: '『引用』' }), kanji('b', { meaning: '普通' })], result.sets[2])), ['kanji:b']);
  assert.deepEqual(ids(cardsForStudySet(words, result.sets[3])), ['vocabulary:a']);
});

test('named full sets remain explicit and preserve labels and metadata through the builder', () => {
  const result = parseCategorySheet(csv('all_words,すべての単語,単語,,全件,,AND,0'));
  assert.deepEqual(result.warnings, []);
  const [set] = result.sets;
  assert.equal(set.kind, 'all');
  assert.equal(set.sourceId, 'all_words');
  const words = [word('a'), word('b')];
  assert.deepEqual(ids(cardsForStudySet(words, set)), ids(words));
  assert.deepEqual(buildStudySets('vocabulary', words, result.sets).find(item => item.id === set.id), set);
  assert.deepEqual(cardsForStudySet(words, { ...set, sourceId: 'wrong' }), []);
  assert.deepEqual(cardsForStudySet(words, { ...set, rules: [{ field: 'bad', operator: 'contains', value: 'x' }] }), []);
});

test('any invalid row excludes the whole category without broadening its selection', () => {
  const invalidRows = ['same,テーマ,word,未知の列,含む,가,OR,1', 'same,テーマ,word,韓国語,正規表現,.*,OR,1',
    'same,テーマ,word,韓国語,含む,,OR,1', 'same,テーマ,word,韓国語,タグ一致,가,OR,1',
    'same,別の名前,word,韓国語,含む,가,OR,1', 'same,テーマ,one,韓国語,含む,가,OR,1',
    'same,テーマ,word,韓国語,含む,가,AND,1', 'same,テーマ,word,韓国語,含む,가,OR,NaN',
    'same,テーマ,word,韓国語,含む,가,OR,2', 'same,テーマ,word,韓国語,空欄,value,OR,1',
    'same,テーマ,word,カテゴリ,印あり,,OR,1', 'same,テーマ,word,,全件,,OR,1'];
  for (const row of invalidRows) {
    const result = parseCategorySheet(csv('same,テーマ,word,韓国語,含む,가,OR,1', row, 'good,正常,word,韓国語,含む,나,AND,2'));
    assert.deepEqual(result.sets.map(set => set.sourceId), ['good'], row);
    assert.ok(result.warnings.length, row);
  }
});

test('deck and target aliases map each source column without mixing decks', () => {
  const result = parseCategorySheet(csv('a,読み,한漢,韓国語,等しい,가,AND,1', 'b,漢字,漢字,漢字候補,含む,家,AND,2',
    'c,説明,kanji,解説,含む,家,AND,3', 'd,TOPIK,word,TOPIK1,タグ一致,travel,AND,4',
    'e,日本語,vocabulary,日本語,含む,行く,AND,5', 'f,不要,one,必須,等しい,FALSE,AND,6'));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.sets.map(set => set.rules[0].field), ['han', 'hanja', 'meaning', 'topikCategory', 'kanji', 'essential']);
  assert.equal(result.sets.at(-1).rules[0].value, false);
  assert.deepEqual(parseCategorySheet(csv('a,不明,other,韓国語,含む,가,AND,1')).sets, []);
  assert.deepEqual(parseCategorySheet(csv('a,誤列,word,解説,含む,가,AND,1')).sets, []);
});

test('headers, CSV quotes, limits, and stable order are validated', () => {
  for (const input of ['', 'category_id,カテゴリ名', `${CATEGORY_SHEET_HEADERS.join(',')},category_id\na,b,word,日本語,含む,本,AND,1,x`, csv('bad id,名前,word,日本語,含む,本,AND,1'), csv('a,名前,word,日本語,含む,"unclosed,AND,1')]) {
    const result = parseCategorySheet(input);
    assert.deepEqual(result.sets, []);
    assert.ok(result.warnings.length);
  }
  const rows = ['z,後,word,日本語,含む,本,AND,10', 'a,先,word,日本語,含む,"本,棚",AND,-2'];
  assert.deepEqual(parseCategorySheet(csv(...rows)).sets, parseCategorySheet(csv(...rows.toReversed())).sets);
  assert.equal(parseCategorySheet(csv(...rows)).sets[0].rules[0].value, '本,棚');
  const tooManyRules = parseCategorySheet(csv(...Array.from({ length: 21 }, () => 'a,名前,word,日本語,含む,本,AND,1')));
  assert.deepEqual(tooManyRules.sets, []);
  assert.ok(tooManyRules.warnings.length);
});

test('the supplied eight-column CSV template parses into usable sets', async () => {
  const template = await readFile(new URL('../docs/templates/category_enshu.csv', import.meta.url), 'utf8');
  const result = parseCategorySheet(template);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.sets.length >= 7);
  assert.ok(result.sets.some(set => set.sourceId === 'required'));
  assert.ok(result.sets.some(set => set.sourceId === 'quoted_hint'));
  assert.ok(result.sets.some(set => set.sourceId === 'travel'));
  assert.ok(result.sets.some(set => set.sourceId === 'verbs'));
  assert.ok(result.sets.some(set => set.sourceId === 'conjunctions'));
});

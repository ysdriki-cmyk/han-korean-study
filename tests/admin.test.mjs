import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAGNOSTICS_KEY, readContentDiagnostics, recordContentDiagnostics } from '../dist/assets/content-diagnostics.js';
import { readContentCache, readContentSnapshot, writeContentCache } from '../dist/assets/content-cache.js';
import { columnLetter, inspectContent, inspectCategoryContent, summarizeLearning } from '../dist/assets/admin-data.js';

function memoryStorage() {
  const entries = new Map([['han-hanja:learning:v3', 'untouched learning records']]);
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test('diagnostics distinguish fresh content, cached content and bundled fallback without changing records', () => {
  const storage = memoryStorage();
  const successAt = '2026-10-29T10:00:00.000Z';
  recordContentDiagnostics(storage, 'kanji', { source: 'remote', checkedAt: successAt, cardCount: 650, httpStatus: 200 });
  recordContentDiagnostics(storage, 'kanji', { source: 'cached', checkedAt: '2026-10-29T11:00:00.000Z', cardCount: 650, httpStatus: 502, error: '取得失敗' });
  let state = readContentDiagnostics(storage);
  assert.equal(state.decks.kanji.source, 'cached');
  assert.equal(state.decks.kanji.lastSuccessAt, successAt);
  assert.equal(state.decks.kanji.httpStatus, 502);
  recordContentDiagnostics(storage, 'vocabulary', { source: 'bundled', cardCount: 4559, httpStatus: 502, error: '取得失敗' });
  state = readContentDiagnostics(storage);
  assert.equal(state.decks.vocabulary.source, 'bundled');
  assert.equal(state.decks.vocabulary.lastSuccessAt, null);
  assert.equal(storage.getItem('han-hanja:learning:v3'), 'untouched learning records');
  assert.deepEqual([...storage.entries.keys()].sort(), [DIAGNOSTICS_KEY, 'han-hanja:learning:v3'].sort());
});

test('a successful recheck clears the old error even when the CSV contents have not changed', () => {
  const storage = memoryStorage();
  recordContentDiagnostics(storage, 'kanji', { source: 'cached', error: 'HTTP 502', httpStatus: 502 });
  const checkedAt = '2026-10-29T12:00:00.000Z';
  recordContentDiagnostics(storage, 'kanji', { source: 'remote', checkedAt, cardCount: 650, httpStatus: 200 });
  const state = readContentDiagnostics(storage).decks.kanji;
  assert.equal(state.source, 'remote');
  assert.equal(state.error, '');
  assert.equal(state.lastSuccessAt, checkedAt);
});

test('diagnostics keep only operational fields and tolerate unavailable or malformed storage', () => {
  const storage = memoryStorage();
  recordContentDiagnostics(storage, 'kanji', { source: 'unavailable', csv: 'not saved', answer: 'not saved', token: 'not saved', error: 'x'.repeat(400) });
  const serialized = storage.getItem(DIAGNOSTICS_KEY);
  assert.doesNotMatch(serialized, /not saved|token|answer|csv/);
  assert.equal(readContentDiagnostics(storage).decks.kanji.error.length, 240);
  assert.equal(recordContentDiagnostics(storage, '__proto__', { source: 'remote' }), false);
  storage.setItem(DIAGNOSTICS_KEY, '{broken');
  assert.deepEqual(readContentDiagnostics(storage), { version: 1, decks: {} });
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(recordContentDiagnostics(blocked, 'kanji', { source: 'remote' }), false);
});

test('content timestamps do not invent an acquisition date for legacy cached CSVs', () => {
  const storage = memoryStorage();
  storage.setItem('han-hanja:content:v1:kanji', JSON.stringify({ url: '/api/content/kanji', text: 'old CSV' }));
  assert.deepEqual(readContentSnapshot(storage, 'kanji', '/api/content/kanji'), { text: 'old CSV', fetchedAt: null });
  const fetchedAt = '2026-10-29T10:00:00.000Z';
  writeContentCache(storage, 'kanji', '/api/content/kanji', 'new CSV', fetchedAt);
  assert.equal(readContentSnapshot(storage, 'kanji', '/api/content/kanji').fetchedAt, fetchedAt);
  assert.equal(readContentCache(storage, 'kanji', '/api/content/kanji'), 'new CSV');
  assert.equal(readContentSnapshot(storage, 'kanji', '/other'), null);
});

test('admin column locations follow actual reordered headers and preserve real cell samples', () => {
  const csv = '必須,解説・一覧,韓国語,id_one,漢字候補,出題ヒント\n！,家、歌,가,1,,\n,甲,갑,2,甲,';
  const data = inspectContent('kanji', csv);
  assert.equal(data.count, 2);
  assert.equal(data.essential, 1);
  assert.equal(data.columns[2].cell, 'C1');
  assert.equal(data.columns[2].sampleCell, 'C2');
  assert.equal(data.columns[2].sample, '가');
  assert.equal(data.columns[4].sampleCell, 'E3');
  assert.equal(data.columns[5].sample, '');
  assert.match(data.columns[3].use, /固定ID/);
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
  assert.equal(columnLetter(701), 'ZZ');
});

test('admin checks share production TOPIK and row exclusion rules and reject unusable CSVs', () => {
  const data = inspectContent('vocabulary', 'id,韓国語,日本語,TOPIK1,カテゴリ\n1,가게,店,#shop,#買い物\n2,,見出し,,');
  assert.equal(data.count, 1);
  assert.equal(data.rawRows, 2);
  assert.equal(data.references, 1);
  assert.equal(data.categories, 2);
  assert.equal(data.warnings.length, 1);
  assert.throws(() => inspectContent('kanji', '<html>not CSV</html>'), /列/);
  assert.throws(() => inspectContent('vocabulary', 'id,韓国語,日本語\n1,가게,店\n1,가구,家具'), /重複/);
});

test('local learning summaries expose counts only and ignore malformed or foreign records', () => {
  const summary = summarizeLearning({ version: 3, records: {
    'kanji:1': { assessments: { write: { attempts: 2, history: [{ submitted: 'not exposed' }] }, read: { attempts: 1 } } },
    'vocabulary:1': { assessments: { write: { attempts: 3 }, read: { attempts: -1 } } },
    'foreign:1': { assessments: { write: { attempts: 900 } } },
    'kanji:bad': null,
  } });
  assert.deepEqual(summary, { records: 2, writing: 5, reading: 1 });
  assert.deepEqual(summarizeLearning({ version: 2, records: {} }), { records: 0, writing: 0, reading: 0 });
});

test('category inspection follows real columns and retains valid definitions with warnings', () => {
  const header = 'カテゴリ名,category_id,教材,対象列,条件,値,条件の結合,表示順';
  const result = inspectCategoryContent(header + '\n必須,required,one,必須,印あり,,AND,1\n不正,bad,word,未知の列,含む,x,AND,2');
  assert.equal(result.valid, true);
  assert.equal(result.count, 1);
  assert.equal(result.rawRows, 2);
  assert.ok(result.warnings.length);
  assert.equal(result.columns[1].cell, 'B1');
  assert.equal(result.columns[1].sampleCell, 'B2');
  assert.equal(result.columns[1].sample, 'required');
});

test('empty or header-only category sheets cannot be mistaken for usable sets', () => {
  const header = 'category_id,カテゴリ名,教材,対象列,条件,値,条件の結合,表示順';
  for (const text of ['', header, header + '\nbad,不正,word,未知の列,含む,x,AND,1']) {
    const result = inspectCategoryContent(text);
    assert.equal(result.valid, false);
    assert.equal(result.count, 0);
    assert.ok(result.error);
  }
  assert.equal(inspectCategoryContent(header).columns.length, 8);
});

test('category source diagnostics stay separate from both learning decks', () => {
  const storage = memoryStorage();
  recordContentDiagnostics(storage, 'category_enshu', { source: 'unavailable', error: '条件行がありません。' });
  const state = readContentDiagnostics(storage);
  assert.equal(state.decks.category_enshu.source, 'unavailable');
  assert.equal(state.decks.kanji, undefined);
  assert.equal(state.decks.vocabulary, undefined);
  assert.equal(storage.getItem('han-hanja:learning:v3'), 'untouched learning records');
});

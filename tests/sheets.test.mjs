import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCards } from '../dist/assets/core.js';
import { normalizeVocabulary, matchVocabularyAnswer } from '../dist/assets/vocabulary.js';
import { parseDeck } from '../dist/assets/decks.js';
import { essentialKanji, kanjiPromptChoices } from '../dist/assets/kanji.js';
import { examplesFromVocabulary, findTopikExamples } from '../dist/assets/topik.js';
import { readContentCache, writeContentCache } from '../dist/assets/content-cache.js';
import { onRequest } from '../functions/api/content/[deck].js';

test('kanji sheet supports ID aliases, explicit essentials and an empty hint without leaking Korean', () => {
  const text = '韓国語,漢字候補,id_one(漢字),必須,解説,出題ヒント,有効\n'
    + '가,〔行く다〕,1,！,,,\n각,各、覚,2,FALSE,,,FALSE\n간,,3,TRUE,,,';
  const parsed = normalizeCards(text);
  assert.deepEqual(parsed.cards.map(card => card.id), ['1', '2']);
  assert.equal(essentialKanji(parsed.cards[0]), true);
  assert.equal(essentialKanji(parsed.cards[1]), false);
  assert.deepEqual(kanjiPromptChoices(parsed.cards[0]), ['行く']);
  assert.deepEqual(kanjiPromptChoices(parsed.cards[1]), ['各', '覚']);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /空/);
  assert.throws(() => normalizeCards(text + '\n가,家,1,TRUE,,,'), /重複/);
});

test('live words use names rather than positions and do not require the unused active column', () => {
  const text = 'id_word,韓国語,英語,日本語,別解,カテゴリ,例文_韓国語,例文_日本語,解説,TOPIK1,有効\n'
    + '1,가게,"store, shop",店,,#買い物,가게에 가요.,店に行きます。,補足,#shop,\n'
    + '2,가격,price,価格,,,,,,,FALSE\n3,,,,,,,,,,\n';
  const result = normalizeVocabulary(text);
  assert.equal(result.cards.length, 2);
  assert.equal(result.excludedRows, 1);
  assert.equal(result.hasTopikColumn, true);
  const first = result.cards[0];
  assert.equal(first.english, 'store, shop');
  assert.equal(first.kanji, '店');
  assert.equal(first.exampleKo, '가게에 가요.');
  assert.equal(first.exampleJp, '店に行きます。');
  assert.equal(first.notes, '補足');
  assert.deepEqual(first.categories, ['買い物', 'shop']);
  assert.equal(first.topikCategory, '#shop');
  assert.equal(first.topik, true);
  assert.equal(result.cards[1].topik, false);
  assert.deepEqual(examplesFromVocabulary(result.cards).map(item => item.korean), ['가게']);
});

test('the published explanation/list column supplies full-set hints when other answer fields are empty', () => {
  const { cards, warnings } = normalizeCards('id,韓国語,出題ヒント,漢字候補,解説・一覧,必須\n5,갑,,,甲,\n2,각,,各、覚,角、各、覚,！');
  assert.equal(cards.length, 2);
  assert.deepEqual(warnings, []);
  assert.equal(essentialKanji(cards[0]), false);
  assert.deepEqual(kanjiPromptChoices(cards[0]), ['甲']);
  assert.deepEqual(kanjiPromptChoices(cards[1]), ['各', '覚']);
  assert.equal(cards[1].meaning, '角、各、覚');
});

test('TOPIK markers are nonempty text, retaining genre labels and all substring matches', () => {
  const result = normalizeVocabulary('id,韓国語,日本語,TOPIK1,カテゴリ\n'
    + '1,나가다,出ていく,#travel,#必須動詞\n2,가게,店,#shop,\n3,가구,家具,,\n4,가,行く,FALSE,');
  const references = examplesFromVocabulary(result.cards);
  assert.equal(references.length, 3); // Even the literal text FALSE is nonempty by this sheet's convention.
  assert.deepEqual(findTopikExamples(references, '가').map(item => item.korean), ['가', '나가다', '가게']);
  assert.deepEqual(examplesFromVocabulary(normalizeVocabulary('id,韓国語,日本語\n1,가,行く').cards), []);
});

test('explicit answer spellings can be graded but display-only synonyms cannot', () => {
  const { cards } = normalizeVocabulary('id,韓国語,日本語,別解,類語\n'
    + '1,집,家,"가옥\n주택",댁');
  assert.equal(matchVocabularyAnswer('집', cards[0]), true);
  assert.equal(matchVocabularyAnswer('가옥', cards[0]), true);
  assert.equal(matchVocabularyAnswer('주택', cards[0]), true);
  assert.equal(cards[0].synonyms, '댁');
  assert.equal(matchVocabularyAnswer('댁', cards[0]), false);
});

test('renamed ID headers retain the same learning IDs and separate both decks', () => {
  const original = parseDeck('vocabulary', 'id,韓国語,日本語\n277,날,日').cards[0];
  const renamed = parseDeck('vocabulary', 'id_word（単語）,日本語,韓国語\n277,日,날').cards[0];
  const kanji = parseDeck('kanji', 'id_one,韓国語,漢字候補\n277,날,日').cards[0];
  assert.equal(renamed.id, original.id);
  assert.equal(renamed.id, 'vocabulary:277');
  assert.equal(kanji.id, 'kanji:277');
});

test('public content snapshots are source-specific and never overwrite learning records', () => {
  const values = new Map([['han-hanja:learning:v3', 'personal history']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(writeContentCache(storage, 'kanji', '/api/content/kanji', '韓国語,漢字候補\n가,家'), true);
  assert.equal(readContentCache(storage, 'kanji', '/api/content/kanji'), '韓国語,漢字候補\n가,家');
  assert.equal(readContentCache(storage, 'kanji', '/different-source'), null);
  assert.equal(readContentCache(storage, 'vocabulary', '/api/content/kanji'), null);
  assert.equal(values.get('han-hanja:learning:v3'), 'personal history');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  assert.equal(readContentCache(blocked, 'kanji', 'url'), null);
  assert.equal(writeContentCache(blocked, 'kanji', 'url', 'CSV'), false);
});

test('content endpoints select only the two fixed Sheets, ignoring caller-supplied targets', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url);
    return new Response('id,韓国語,日本語\n1,가게,店', { headers: { 'content-type': 'text/csv' } });
  });
  const request = new Request('https://study.test/api/content/vocabulary?url=https://attacker.test');
  const vocabulary = await onRequest({ request, params: { deck: 'vocabulary' }, env: {} });
  assert.equal(vocabulary.status, 200);
  assert.equal(vocabulary.headers.get('cache-control'), 'no-store');
  assert.equal(new URL(calls[0]).hostname, 'docs.google.com');
  assert.equal(new URL(calls[0]).searchParams.get('gid'), '0');
  const kanji = await onRequest({ request, params: { deck: 'kanji' }, env: {} });
  assert.equal(kanji.status, 200);
  assert.equal(new URL(calls[1]).searchParams.get('gid'), '29317581');
  assert.equal((await onRequest({ request, params: { deck: '__proto__' }, env: {} })).status, 404);
  assert.equal((await onRequest({ request: new Request(request.url, { method: 'POST' }), params: { deck: 'kanji' }, env: {} })).status, 405);
  assert.equal((await onRequest({ request, params: { deck: 'kanji' }, env: { KANJI_SHEET_CSV_URL: 'https://attacker.test/pub?output=csv' } })).status, 503);
  assert.equal(calls.length, 2);
});

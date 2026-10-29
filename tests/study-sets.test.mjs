import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudySets, cardsForStudySet, normalizeCustomSets, setProgress } from '../dist/assets/study-sets.js';
import { parseDeck } from '../dist/assets/decks.js';
import { getRecord } from '../dist/assets/learning.js';
import { recordAssessment } from '../dist/assets/assessment.js';

const word = (id, fields = {}) => ({ id: `vocabulary:${id}`, deckId: 'vocabulary', han: '가', kanji: '行く', english: '', tags: '', topikCategory: '', ...fields });
const kanji = (id, fields = {}) => ({ id: `kanji:${id}`, deckId: 'kanji', han: '가', kanji: '家', hanja: '家', meaning: '', ...fields });
const custom = (rules, match = 'all', fields = {}) => ({ id: 'custom:example', label: '条件セット', kind: 'custom', deckId: 'vocabulary', match, rules, ...fields });
const ids = cards => cards.map(card => card.id);
const select = (deck, cards, id) => cardsForStudySet(cards, buildStudySets(deck, cards).find(set => set.id === id));

test('built-ins filter real parsed cards and retain canonical identities', () => {
  const words = parseDeck('vocabulary', 'id,Korean,Japanese,English,カテゴリ,TOPIK1\n1,가다,行く,go,#動作,#移動\n2,집,家,house,#暮らし,\n3,집에,家へ,home,,false').cards;
  assert.deepEqual(ids(select('vocabulary', words, 'all')), ['vocabulary:1', 'vocabulary:2', 'vocabulary:3']);
  assert.deepEqual(ids(select('vocabulary', words, 'topik')), ['vocabulary:1', 'vocabulary:3']);
  const letters = [kanji('a', { essential: true }), kanji('b', { essential: false }), kanji('c', { kanji: '' }), kanji('d')];
  assert.deepEqual(ids(select('kanji', letters, 'essential')), ['kanji:a', 'kanji:d']);
  assert.deepEqual(ids(select('kanji', [...letters, ...words], 'all')), ids(letters));
  assert.equal(select('vocabulary', words, 'all')[0], words[0]);
  assert.deepEqual(buildStudySets('unknown', words), []);
});

test('category and TOPIK1 tag sets preserve their separate source columns', () => {
  const cards = [word('a', { tags: '#場所＃公共 施設', topikCategory: '#動作' }), word('b', { tags: '#動作', topikCategory: '#場所' }), word('c', { tags: '場所\n場所' }), word('d')];
  const sets = buildStudySets('vocabulary', cards);
  const places = sets.filter(set => set.label === '場所');
  assert.equal(places.length, 2);
  const category = places.find(set => set.field === 'tags'), topik = places.find(set => set.field === 'topikCategory');
  assert.notEqual(category.id, topik.id);
  assert.deepEqual(ids(cardsForStudySet(cards, category)), ['vocabulary:a', 'vocabulary:c']);
  assert.deepEqual(ids(cardsForStudySet(cards, topik)), ['vocabulary:b']);
  assert.ok(sets.some(set => set.label === '公共 施設'));
  assert.equal(sets.some(set => set.kind === 'tag' && !set.value), false);
  assert.equal(sets.some(set => set.label === '場所' && set.field === 'categories'), false);
});

test('built-in and tag IDs survive row reordering, additions, and NFC composition', () => {
  const cards = [word('a', { tags: '#가' }), word('b', { tags: '#場所', topikCategory: '#가' })];
  const before = buildStudySets('vocabulary', cards);
  const after = buildStudySets('vocabulary', [word('c', { tags: '#追加' }), ...cards.toReversed().map(card => ({ ...card, tags: card.tags.normalize('NFC') }))]);
  for (const set of before) assert.ok(after.some(next => next.id === set.id && next.label === set.label));
  assert.equal(before.filter(set => set.label === '가').length, 2);
});

test('literal NFC substring rules include Japanese brackets and combine all or any', () => {
  const cards = [word('a', { han: '가', kanji: '『本』を読む', english: 'read a book' }), word('b', { han: '가', kanji: '本', english: 'book' }), word('c', { han: '나', kanji: '『本』屋', english: 'bookshop' })];
  const rules = [{ field: 'kanji', operator: 'contains', value: '『本』' }, { field: 'han', operator: 'equals', value: '가' }];
  assert.deepEqual(ids(cardsForStudySet(cards, custom(rules))), ['vocabulary:a']);
  assert.deepEqual(ids(cardsForStudySet(cards, custom(rules, 'any'))), ['vocabulary:a', 'vocabulary:b', 'vocabulary:c']);
  assert.deepEqual(ids(cardsForStudySet(cards, custom([{ field: 'kanji', operator: 'contains', value: '.*' }]))), []);
  assert.deepEqual(ids(cardsForStudySet(cards, custom([{ field: 'kanji', operator: 'contains', value: '』' }]))), ['vocabulary:a', 'vocabulary:c']);
  assert.deepEqual(ids(cardsForStudySet(cards, custom([{ field: 'english', operator: 'equals', value: 'book' }]))), ['vocabulary:b']);
});

test('tag conditions match whole source tokens and essential uses the required boolean', () => {
  const cards = [word('a', { tags: '#食べ物', topikCategory: '#場所' }), word('b', { tags: '#物', topikCategory: '#食べ物' })];
  assert.deepEqual(ids(cardsForStudySet(cards, custom([{ field: 'tags', operator: 'tag', value: '物' }]))), ['vocabulary:b']);
  assert.deepEqual(ids(cardsForStudySet(cards, custom([{ field: 'tags', operator: 'tag', value: '＃物' }]))), ['vocabulary:b']);
  assert.deepEqual(ids(cardsForStudySet(cards, custom([{ field: 'topikCategory', operator: 'tag', value: '食べ物' }]))), ['vocabulary:b']);
  const letters = [kanji('a', { essential: false }), kanji('b', { essential: true }), kanji('c', { kanji: '' })];
  const set = custom([{ field: 'essential', operator: 'equals', value: false }], 'all', { deckId: 'kanji' });
  assert.deepEqual(ids(cardsForStudySet(letters, set)), ['kanji:a', 'kanji:c']);
});

test('unknown sets and invalid conditions fail closed without dropping bad rules', () => {
  const cards = [word('a')], valid = { field: 'han', operator: 'contains', value: '가' };
  const invalidSets = [null, {}, { kind: 'all' }, { id: 'missing', kind: 'all', deckId: 'vocabulary' },
    { id: 'all', kind: 'all', deckId: 'other' }, { id: 'essential', kind: 'essential', deckId: 'vocabulary' },
    custom([]), custom([valid], 'unknown'), custom([{ ...valid, field: 'constructor' }]),
    custom([{ ...valid, operator: 'regex' }]), custom([{ ...valid, value: '' }]), custom([{ ...valid, value: ' ' }]),
    custom([{ ...valid, value: 'x'.repeat(501) }]), custom([{ ...valid, field: 'essential', value: 'true', operator: 'equals' }]),
    custom([{ ...valid, operator: 'tag' }]), custom([{ field: 'tags', operator: 'tag', value: 'a#b' }]),
    custom([valid, { ...valid, field: 'unknown' }], 'any'), custom([valid], 'all', { id: 'all' }),
    custom(Array.from({ length: 21 }, () => valid)), custom([valid], 'all', { label: '' })];
  for (const set of invalidSets) assert.deepEqual(cardsForStudySet(cards, set), [], JSON.stringify(set));
  const tag = buildStudySets('vocabulary', [word('a', { tags: '#動作' })]).find(set => set.kind === 'tag');
  assert.deepEqual(cardsForStudySet(cards, { ...tag, value: 'other' }), []);
});

test('saved custom sets are normalized, scoped, bounded, and copied without mutation', () => {
  const set = custom([{ field: 'han', operator: 'equals', value: '가' }], 'all', { label: ' テーマ ', extra: true });
  const saved = [set, { ...set }, { ...set, id: 'custom:other', deckId: 'kanji' }, { ...set, id: 'custom:bad', rules: [] }];
  const before = JSON.stringify(saved), result = normalizeCustomSets(saved, 'vocabulary');
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'テーマ');
  assert.equal(result[0].rules[0].value, '가');
  assert.equal(result[0].extra, undefined);
  result[0].rules[0].value = '나';
  assert.equal(JSON.stringify(saved), before);
  assert.deepEqual(normalizeCustomSets({}, 'vocabulary'), []);
  assert.deepEqual(normalizeCustomSets(saved, 'invalid'), []);
  assert.equal(normalizeCustomSets(Array.from({ length: 110 }, (_, i) => ({ ...set, id: `custom:${i}` })), 'vocabulary').length, 100);
  assert.ok(buildStudySets('vocabulary', [], saved).some(item => item.id === set.id));
});

test('progress counts all six ratings and actual encounters independently by mode', () => {
  const ratings = ['solid', 'good', 'unsure', 'again', 'hard', 'unseen'];
  const cards = ratings.map(rating => word(rating));
  const records = Object.fromEntries(cards.map((card, i) => [card.id, {
    assessments: { read: { rating: ratings[i], attempts: i === 0 ? 0 : 1 }, write: { rating: 'unseen', attempts: 0 } },
  }]));
  const before = JSON.stringify(records);
  assert.deepEqual(setProgress(cards, records, 'read'), { total: 6, counts: { solid: 1, good: 1, unsure: 1, again: 1, hard: 1, unseen: 1 }, mastered: 2, masteredPercent: 33, attempted: 5, attemptedPercent: 83 });
  assert.deepEqual(setProgress(cards, records, 'write'), { total: 6, counts: { solid: 0, good: 0, unsure: 0, again: 0, hard: 0, unseen: 6 }, mastered: 0, masteredPercent: 0, attempted: 0, attemptedPercent: 0 });
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(setProgress([], records), { total: 0, counts: { solid: 0, good: 0, unsure: 0, again: 0, hard: 0, unseen: 0 }, mastered: 0, masteredPercent: 0, attempted: 0, attemptedPercent: 0 });
});

test('overlapping sets share canonical records without leaking across decks or directions', () => {
  const shared = word('same', { tags: '#場所', topikCategory: '#初級' }), other = kanji('same');
  const cards = [shared, word('fresh'), word('source', { state: 'read2' })];
  const sets = buildStudySets('vocabulary', cards);
  const records = { [shared.id]: recordAssessment(getRecord(shared), 'write', 'good', { now: '2026-10-29T00:00:00Z', correct: true }) };
  const all = cardsForStudySet(cards, sets.find(set => set.kind === 'all'));
  const category = cardsForStudySet(cards, sets.find(set => set.field === 'tags'));
  const topik = cardsForStudySet(cards, sets.find(set => set.kind === 'topik'));
  assert.equal(setProgress(all, records, 'write').attempted, 1);
  assert.equal(setProgress(category, records, 'write').counts.good, 1);
  assert.equal(setProgress(topik, records, 'write').counts.good, 1);
  assert.equal(setProgress(category, records, 'read').counts.unseen, 1);
  assert.equal(setProgress([other], records, 'write').counts.unseen, 1);
  assert.equal(setProgress([cards[2]], records, 'write').attempted, 0);
  assert.equal(setProgress([shared, shared], records, 'write').total, 1);
  assert.deepEqual(Object.keys(records), [shared.id]);
});

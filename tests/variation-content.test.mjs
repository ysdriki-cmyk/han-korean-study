import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVariationContent, combineSentenceSources } from '../dist/assets/variation-content.js';
import { parseDeck, restoreLearningRecords } from '../dist/assets/decks.js';
import { sentenceCollectionCards } from '../dist/assets/sentence-collections.js';
import { buildVariationLessons, matchVariationAnswer } from '../dist/assets/variations.js';
import { getRecord } from '../dist/assets/learning.js';
import { recordAssessment, ratingFor } from '../dist/assets/assessment.js';

const required = ['id_sentence','例文_韓国語','例文_日本語','セットID','順番'];
const cell = value => `"${String(value ?? '').replace(/"/gu, '""')}"`;
const csv = (rows, headers = required) => [headers,...rows.map(row => headers.map(header => row[header] ?? ''))].map(row => row.map(cell).join(',')).join('\n');
const sample = (overrides = {}) => ({id_sentence:'var_eat_001',例文_韓国語:'김밥을 먹었어.',例文_日本語:'キンパを食べた。',セットID:'eat-1',順番:'1',...overrides});
const ordinary = () => parseDeck('sentence', 'id_sentence,例文_韓国語,例文_日本語\nregular,집에 가요.,家に帰ります。').cards;

test('a dedicated variation sheet needs no reserved genre tag and retains existing sentence record IDs', () => {
  const text = csv([sample({id_sentence:'a-plain-ID'})]);
  const parsed = parseVariationContent(text);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.cards[0].id, 'sentence:a-plain-ID');
  assert.equal(parsed.cards[0].sourceId, 'a-plain-ID');
  assert.equal(parsed.cards[0].tags, '#variation');
  assert.equal(parsed.cards[0].variation.groupId, 'eat-1');
  assert.equal(parsed.cards[0].variation.order, 1);
  assert.deepEqual([parsed.warnings,parsed.excludedRows], [[],0]);
  assert.equal(sentenceCollectionCards(parsed.cards, 'variation').length, 1);
  for (const collection of ['core','extra','conversation']) assert.equal(sentenceCollectionCards(parsed.cards, collection).length, 0);
  assert.equal(sentenceCollectionCards(parseDeck('sentence', text).cards, 'core').length, 1);
});

test('ordinary tags and optional metadata survive dedicated parsing and headers may be reordered', () => {
  const headers = ['別解_韓国語','順番','例文_日本語','id_sentence','変化ポイント','セット名','練習指示','セットID','例文_韓国語','ジャンル','変形タイプ','訳2','使用韓国語_main','使用韓国語_1','話し方','距離感・対象','使い方メモ'];
  const row = sample({順番:'２',例文_韓国語:'김밥을 안 먹었어.'.normalize('NFD'),例文_日本語:'キンパを食べなかった。',
    別解_韓国語:'김밥을 먹지 않았어.\n김밥은 안 먹었어.',ジャンル:'#食事 #variations',セット名:'食べたことを話す',
    変形タイプ:'否定',練習指示:'食べなかったことにして',変化ポイント:'안 を加える',訳2:'食べなかったよ。',
    使用韓国語_main:'먹다',使用韓国語_1:'김밥',話し方:'タメ口','距離感・対象':'友達',使い方メモ:'自分のことを話す'});
  const {cards:[card]} = parseVariationContent(csv([row], headers));
  assert.equal(card.han, '김밥을 안 먹었어.');
  assert.equal(card.tags, '#食事 #variations #variation');
  assert.equal(card.translation2, '食べなかったよ。');
  assert.equal(card.mainKorean, '먹다');
  assert.equal(card.sentenceRefs[0].korean, '김밥');
  assert.equal(card.variation.title, '食べたことを話す');
  assert.equal(card.variation.order, 2);
  assert.equal(card.variation.speechStyle, 'タメ口');
  assert.equal(card.variation.audience, '友達');
  assert.equal(card.variation.usageNote, '自分のことを話す');
  assert.equal(matchVariationAnswer('김밥을 먹지 않았어.', card), true);
  assert.equal(matchVariationAnswer('김밥을 안 먹었어요.', card), false);
  const tagged = parseVariationContent(csv([sample({ジャンル:'＃ＶＡＲＩＡＴＩＯＮ ＃食事'})], [...required,'ジャンル']));
  assert.equal(tagged.cards[0].tags, '＃ＶＡＲＩＡＴＩＯＮ ＃食事');
});

test('header-only, transient, incomplete and structurally invalid dedicated snapshots are rejected', () => {
  for (const text of ['', 'Loading…', csv([]), csv([{}]), csv([sample({id_sentence:''})]), csv([sample({例文_韓国語:''})]),
    csv([sample({例文_日本語:''})]), csv([sample({セットID:''})]), csv([sample({順番:''})]), csv([sample({順番:'0'})]),
    csv([sample({順番:'1.5'})]), csv([sample()],required.filter(header => header !== 'セットID')),
    csv([sample()],required.filter(header => header !== '順番')), csv([sample()],[...required,'順番']),
    'id,韓国語,日本語,例文_韓国語,例文_日本語\n1,먹다,食べる,먹어요.,食べます。']) {
    assert.throws(() => parseVariationContent(text));
  }
  assert.equal(parseVariationContent(csv([sample()]) + '\n\n,,,,\n').cards.length, 1);
  assert.throws(() => parseVariationContent(csv([sample(),sample({順番:'2'})])), /id_sentence.*重複/u);
  assert.throws(() => parseVariationContent(csv([sample(),sample({id_sentence:'other',順番:'１'})])), /順番.*重複/u);
  assert.throws(() => parseVariationContent(csv([sample(),sample({id_sentence:'incomplete',例文_日本語:''})])), /日本語例文/u);
});

test('dedicated membership rejects other reserved collections and dialogue rows instead of leaking them', () => {
  for (const genre of ['#conversation','#subtitle','#variation #subtitle','＃ＣＯＮＶＥＲＳＡＴＩＯＮ']) {
    assert.throws(() => parseVariationContent(csv([sample({ジャンル:genre})], [...required,'ジャンル'])), /会話・字幕/u);
  }
  for (const turn of ['1','not-a-turn']) {
    assert.throws(() => parseVariationContent(csv([sample({ターン:turn,話者:'A'})], [...required,'ターン','話者'])), /会話・字幕/u);
  }
  assert.throws(() => parseVariationContent(csv([sample({カテゴリ:'#subtitle'})], [...required,'カテゴリ'])), /会話・字幕/u);
});

test('the dedicated source owns variation while ordinary source objects and migrating IDs stay intact', () => {
  const regular = ordinary();
  const legacy = parseDeck('sentence', csv([sample({ジャンル:'#variation'})], [...required,'ジャンル'])).cards;
  const independent = parseVariationContent(csv([sample({例文_韓国語:'피자를 먹었어.',例文_日本語:'ピザを食べた。'})])).cards;
  const original = [...regular,...legacy];
  const before = JSON.stringify([original,independent]);
  const combined = combineSentenceSources(original, independent);
  assert.deepEqual(combined.map(card => card.id), ['sentence:regular','sentence:var_eat_001']);
  assert.equal(combined[0], regular[0]);
  assert.equal(combined[1], independent[0]);
  assert.equal(combined[1].han, '피자를 먹었어.');
  assert.deepEqual(combineSentenceSources(original, []), regular);
  assert.equal(JSON.stringify([original,independent]), before);
  assert.equal(buildVariationLessons(combined)[0].baseCard, independent[0]);
});

test('cross-source and dedicated ID collisions fail before a complete snapshot can be replaced', () => {
  const regular = ordinary();
  const dedicated = parseVariationContent(csv([sample()])).cards;
  const previous = combineSentenceSources(regular, dedicated);
  const collision = parseVariationContent(csv([sample({id_sentence:'regular'})])).cards;
  let current = previous;
  assert.throws(() => { current = combineSentenceSources(regular, collision); }, /固定ID.*重複/u);
  assert.equal(current, previous);
  assert.equal(regular[0].han, '집에 가요.');
  assert.throws(() => combineSentenceSources(regular, [dedicated[0],dedicated[0]]), /固定ID.*重複/u);
  assert.throws(() => combineSentenceSources([...regular,regular[0]], dedicated), /固定ID.*重複/u);
  assert.throws(() => combineSentenceSources(regular, [{...dedicated[0],id:'sentence:other',variation:{...dedicated[0].variation}},dedicated[0]]), /順番.*重複/u);
  for (const invalid of [{...dedicated[0],tags:'#ordinary'},{...dedicated[0],variation:{}},{...dedicated[0],deckId:'vocabulary'}]) {
    assert.throws(() => combineSentenceSources(regular, [invalid]));
  }
});

test('moving variation to its own source preserves mode-specific learning and leaves ordinary records independent', () => {
  const text = csv([sample({ジャンル:'#variation'})], [...required,'ジャンル']);
  const [legacy] = parseDeck('sentence', text).cards;
  const [moved] = parseVariationContent(csv([sample()])).cards;
  const records = restoreLearningRecords({version:3,records:{
    [legacy.id]:recordAssessment(getRecord(legacy), 'write', 'good', {correct:true,now:Date.parse('2026-11-14T00:00:00Z')}),
    'sentence:regular':recordAssessment(getRecord(ordinary()[0]), 'read', 'unsure', {correct:false}),
  }});
  assert.equal(moved.id, legacy.id);
  assert.equal(ratingFor(moved, records, 'write'), 'good');
  assert.equal(ratingFor(moved, records, 'read'), 'unseen');
  assert.equal(records[moved.id].assessments.write.attempts, 1);
  assert.equal(ratingFor(ordinary()[0], records, 'read'), 'unsure');
  const reordered = parseVariationContent(csv([sample({id_sentence:'second',順番:'2'}),sample()]));
  assert.equal(buildVariationLessons(reordered.cards)[0].baseCard.id, legacy.id);
});

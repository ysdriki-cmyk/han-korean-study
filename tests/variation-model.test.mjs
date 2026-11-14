import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../dist/assets/decks.js';
import { matchSentenceAnswer } from '../dist/assets/sentences.js';
import { sentenceCollection, sentenceCollectionCards } from '../dist/assets/sentence-collections.js';
import { buildStudySets, cardsForStudySet } from '../dist/assets/study-sets.js';
import { buildVariationLessons, variationLessonCards, matchVariationAnswer } from '../dist/assets/variations.js';

const headers = ['id_sentence','例文_韓国語','例文_日本語','ジャンル','セットID','セット名','順番','変形タイプ','練習指示','変化ポイント','別解_韓国語','話し方','距離感・対象','使い方メモ','カテゴリ'];
const csvCell = value => `"${String(value ?? '').replace(/"/gu, '""')}"`;
const csvFor = rows => [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))].map(row => row.map(csvCell).join(',')).join('\n');
const sample = (overrides = {}) => ({id_sentence:'eat-base',例文_韓国語:'김밥을 먹었어.',例文_日本語:'キンパを食べた。',ジャンル:'#variation #食事',セットID:'eat-2',セット名:'食べたことを話す',順番:'1',変形タイプ:'基本',練習指示:'元の文を言ってみる',...overrides});
const parse = rows => parseDeck('sentence', csvFor(rows));

test('variation CSV preserves explicit metadata, complete alternatives and sentence identities', () => {
  const {cards, warnings} = parse([sample({順番:'２',変形タイプ:'否定',練習指示:'食べなかったことにする',変化ポイント:'안 を加える',別解_韓国語:'김밥을 먹지 않았어.\n김밥을 먹지 않았어.',話し方:'タメ口','距離感・対象':'親しい友達',使い方メモ:'自分のことを話す',カテゴリ:'食事'})]);
  assert.deepEqual(warnings, []);
  assert.equal(cards[0].id, 'sentence:eat-base');
  assert.equal(cards[0].sourceId, 'eat-base');
  assert.deepEqual(cards[0].variation, {
    groupId:'eat-2',title:'食べたことを話す',order:2,type:'否定',instruction:'食べなかったことにする',point:'안 を加える',
    answerVariants:['김밥을 먹지 않았어.'],speechStyle:'タメ口',audience:'親しい友達',usageNote:'自分のことを話す',category:'食事',
  });
  assert.deepEqual(cards[0].answerVariants, []);
});

test('exact normalized variation tags isolate the new collection without inferring from IDs or metadata', () => {
  const {cards} = parse([
    sample({ジャンル:'＃ＶＡＲＩＡＴＩＯＮ ＃subtitle'}),
    sample({id_sentence:'variation-ordinary',ジャンル:'#variations',セットID:'',順番:''}),
    sample({id_sentence:'subtitle',ジャンル:'#subtitle',セットID:'',順番:''}),
    sample({id_sentence:'conversation',ジャンル:'#conversation #variation',セットID:'talk',順番:''}),
  ]);
  assert.deepEqual(cards.map(sentenceCollection), ['variation','core','extra','conversation']);
  for (const collection of ['core','extra','conversation','variation']) assert.equal(sentenceCollectionCards(cards, collection).length, 1);
  assert.deepEqual(sentenceCollectionCards(cards, 'unknown'), []);
  assert.equal(sentenceCollection({...cards[0],deckId:'vocabulary'}), null);
  assert.equal(sentenceCollection({...cards[0],conversation:{turn:1,speaker:'A'}}), 'conversation');
});

test('families keep their full numeric order, base sentence and natural group ordering', () => {
  const {cards} = parse([
    sample({id_sentence:'eat-later',順番:'10',変形タイプ:'未来',例文_韓国語:'김밥을 먹을 거야.',例文_日本語:'キンパを食べるつもりだ。'}),
    sample({id_sentence:'eat-negative',順番:'2',変形タイプ:'否定',例文_韓国語:'김밥을 안 먹었어.',例文_日本語:'キンパを食べなかった。'}),
    sample({id_sentence:'other-base',セットID:'eat-10',セット名:'もう一つの文'}),
    sample(),
  ]);
  const lessons = buildVariationLessons(cards);
  assert.deepEqual(lessons.map(lesson => lesson.sourceId), ['eat-2','eat-10']);
  assert.deepEqual(lessons[0].cards.map(card => card.sourceId), ['eat-base','eat-negative','eat-later']);
  assert.equal(lessons[0].baseCard.sourceId, 'eat-base');
  assert.equal(lessons[0].label, '食べたことを話す');
  assert.equal(lessons[0].count, 3);
  const sets = buildStudySets('sentence', cards, [], {collection:'variation'});
  assert.deepEqual(sets.map(set => set.kind), ['variation','variation']);
  assert.deepEqual(cardsForStudySet(cards, sets[0]), lessons[0].cards);
  assert.deepEqual(buildStudySets('sentence', cards).flatMap(set => cardsForStudySet(cards, set)), []);
});

test('escaped group identities cannot turn malformed or cross-collection selections into all cards', () => {
  const {cards} = parse([sample({セットID:'family/あ:1'})]);
  const [lesson] = buildVariationLessons(cards);
  assert.equal(lesson.id, 'variation:family%2F%E3%81%82%3A1');
  assert.equal(variationLessonCards(cards, lesson.id).length, 1);
  for (const id of ['variation:family/あ:1','variation:%E0%A4%A','variation:missing','conversation:family%2F%E3%81%82%3A1',null]) {
    assert.deepEqual(variationLessonCards(cards, id), []);
    assert.deepEqual(cardsForStudySet(cards, {id,kind:'variation',deckId:'sentence',collection:'variation'}), []);
  }
  assert.deepEqual(cardsForStudySet(cards, {id:lesson.id,kind:'variation',deckId:'sentence',collection:'core'}), []);
});

test('malformed variation rows are excluded with diagnostics and duplicate order rejects the snapshot', () => {
  const {cards,warnings,excludedRows} = parse([
    sample({id_sentence:'no-group',セットID:''}),
    sample({id_sentence:'zero',順番:'0'}),
    sample({id_sentence:'fraction',順番:'1.5'}),
    sample({id_sentence:'empty',順番:''}),
    sample(),
  ]);
  assert.deepEqual(cards.map(card => card.sourceId), ['eat-base']);
  assert.equal(excludedRows, 4);
  assert.equal(warnings.length, 4);
  assert.ok(warnings.every(warning => warning.includes('variation')));
  assert.throws(() => parse([sample(),sample({id_sentence:'same-order'})]), /順番「1」が重複/u);
  assert.deepEqual(buildVariationLessons([{...cards[0],variation:{groupId:'bad'}}]), []);
});

test('variation grading accepts only the model sentence or explicitly supplied full Korean alternatives', () => {
  const {cards:[card]} = parse([sample({例文_韓国語:'김밥을 안 먹었어.',例文_日本語:'キンパを食べなかった。',別解_韓国語:'김밥을 먹지 않았어.\n김밥은 안 먹었어.'})]);
  assert.equal(matchVariationAnswer(' 김밥 을 안 먹었어！ ', card), true);
  assert.equal(matchVariationAnswer('김밥을 먹지 않았어.'.normalize('NFD'), card), true);
  assert.equal(matchVariationAnswer('김밥은 안 먹었어.', card), true);
  for (const input of ['', '안 먹었어.', '김밥을 안 먹었어요.', '김밥', '김밥을 먹었어.']) assert.equal(matchVariationAnswer(input, card), false);
  assert.equal(matchVariationAnswer('김밥을 먹지 않았어.', {...card,tags:'#ordinary'}), false);
  assert.equal(matchSentenceAnswer('김밥을 먹지 않았어.', card.han), false);
});

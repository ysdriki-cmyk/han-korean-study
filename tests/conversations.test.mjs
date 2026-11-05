import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../dist/assets/decks.js';
import { sentenceCollection, isConversationSentence, isExtraSentence, sentenceCollectionCards } from '../dist/assets/sentence-collections.js';
import { enrichConversationCards, buildConversationLessons, conversationLessonCards } from '../dist/assets/conversations.js';
import initialMetadata from '../dist/assets/conversation-metadata.js';

const card = (id, conversation = {}, tags = '#conversation') => ({
  id: `sentence:${id}`, sourceId: id, deckId: 'sentence', han: `한국어 ${id}`, kanji: `日本語 ${id}`, tags, conversation,
});
const ids = cards => cards.map(item => item.id);

test('conversation membership uses exact normalized tags or explicit turn and speaker, never ID alone', () => {
  assert.equal(sentenceCollection(card('talktou_10A', {}, '')), 'core');
  assert.equal(sentenceCollection(card('1', {}, '＃ＣＯＮＶＥＲＳＡＴＩＯＮ')), 'conversation');
  assert.equal(sentenceCollection(card('1', {}, '#conversation #subtitle')), 'conversation');
  assert.equal(isExtraSentence(card('1', {}, '#subtitle #conversation')), false);
  assert.equal(sentenceCollection(card('1', {}, '#conversations')), 'core');
  assert.equal(sentenceCollection(card('1', { turn: '２', speaker: 'B' }, '初対面・挨拶')), 'conversation');
  assert.equal(sentenceCollection(card('1', { turn: 1 }, '')), 'core');
  assert.equal(sentenceCollection(card('1', { turn: 0, speaker: 'A' }, '')), 'core');
  assert.equal(sentenceCollection({ ...card('1'), deckId: 'vocabulary' }), null);
  const rows = [card('1', {}, ''), card('2', {}, '#subtitle'), card('3'), card('4', { turn: 1, speaker: 'A' }, '')];
  assert.deepEqual(ids(sentenceCollectionCards(rows)), ['sentence:1']);
  assert.deepEqual(ids(sentenceCollectionCards(rows, 'extra')), ['sentence:2']);
  assert.deepEqual(ids(sentenceCollectionCards(rows, 'conversation')), ['sentence:3', 'sentence:4']);
  assert.deepEqual(sentenceCollectionCards(rows, 'invalid'), []);
});

test('optional dialogue columns preserve independent canonical IDs and original translation fields', () => {
  const csv = '話者,ターン,例文_日本語,id_sentence,例文_韓国語,ジャンル,セットID,シチュエーション,会話カテゴリ,カテゴリ番号,会話の役割,話し方,距離感・対象,学習優先度,使い方メモ,訳2\nB,２,こんにちは,talktou_20A,안녕하세요,初対面・挨拶,01-01,初めての通話,挨拶,1,返答,丁寧,初対面,A,音声を確認,やあ';
  const parsed = parseDeck('sentence', csv).cards[0];
  assert.equal(parsed.id, 'sentence:talktou_20A');
  assert.equal(parsed.han, '안녕하세요');
  assert.equal(parsed.kanji, 'こんにちは');
  assert.equal(parsed.translation2, 'やあ');
  assert.equal(isConversationSentence(parsed), true);
  assert.deepEqual(parsed.conversation, { lessonId: '01-01', situation: '初めての通話', category: '挨拶', categoryNo: '1', speaker: 'B', turn: 2,
    role: '返答', speechStyle: '丁寧', audience: '初対面', priority: 'A', usageNote: '音声を確認' });
  const plain = parseDeck('sentence', 'id_sentence,例文_韓国語,例文_日本語\n1,가요,行きます').cards[0];
  assert.equal(Object.hasOwn(plain, 'conversation'), false);
});

test('registry metadata requires matching canonical source ID and Korean; explicit nonempty cells win', () => {
  const original = card('one', { speaker: 'B', turn: 5, situation: '修正後', usageNote: '' });
  const registry = { lessons: { lesson: { situation: '元の状況', category: '会話', usageNote: 'メモ' } },
    utterances: { one: { expectedKorean: original.han, lessonId: 'lesson', turn: 1, speaker: 'A', role: '開始' } } };
  const enriched = enrichConversationCards([original], registry)[0];
  assert.equal(enriched.id, original.id);
  assert.equal(enriched.han, original.han);
  assert.equal(enriched.kanji, original.kanji);
  assert.deepEqual(enriched.conversation, { lessonId: 'lesson', situation: '修正後', category: '会話', usageNote: 'メモ', speaker: 'B', turn: 5, role: '開始' });
  assert.equal(original.conversation.lessonId, undefined);
  assert.equal(enrichConversationCards([{ ...original, tags: '', conversation: {} }], registry)[0].conversation.lessonId, undefined);
  assert.equal(enrichConversationCards([{ ...original, han: '別の韓国語' }], registry)[0].conversation.lessonId, undefined);
  assert.equal(enrichConversationCards([{ ...original, id: 'sentence:changed', sourceId: 'changed' }], registry)[0].conversation.lessonId, undefined);
  const emptyGuard = { ...registry, utterances: { one: { ...registry.utterances.one, expectedKorean: '' } } };
  assert.equal(enrichConversationCards([original], emptyGuard)[0].conversation.lessonId, undefined);
});

test('the initial registry reconstructs 158 complete seven-turn lessons without interpreting the A suffix', () => {
  const rows = Object.entries(initialMetadata.utterances).map(([id, metadata]) => ({ ...card(id), han: metadata.expectedKorean }));
  const enriched = enrichConversationCards(rows);
  const lessons = buildConversationLessons(enriched);
  assert.equal(rows.length, 1106);
  assert.equal(lessons.length, 158);
  assert.ok(lessons.every(lesson => lesson.cards.length === 7));
  assert.ok(lessons.every(lesson => lesson.cards.map(item => item.conversation.turn).join(',') === '1,2,3,4,5,6,7'));
  assert.equal(enriched.find(item => item.sourceId === 'talktou_20A').conversation.speaker, 'B');
  assert.equal(lessons[0].id, 'conversation:01-01');
  assert.equal(lessons[0].label, '初めての音声通話');
  assert.equal(lessons.at(-1).id, 'conversation:13-12');
  assert.equal(lessons.at(-1).label, 'ちょっと待って');
});

test('one selected lesson keeps every ordered turn, with natural lesson order and no mutation', () => {
  const rows = [card('b', { lessonId: '10', turn: 2 }), card('c', { lessonId: '2', turn: 1 }),
    card('a', { lessonId: '10', turn: 1 }), card('d', { lessonId: '10', turn: 3 })];
  const before = ids(rows);
  const lessons = buildConversationLessons(rows);
  assert.deepEqual(lessons.map(lesson => lesson.id), ['conversation:2', 'conversation:10']);
  assert.deepEqual(ids(conversationLessonCards(rows, 'conversation:10')), ['sentence:a', 'sentence:b', 'sentence:d']);
  assert.deepEqual(ids(rows), before);
  assert.equal(conversationLessonCards(rows, 'conversation:10')[0], rows[2]);
  assert.deepEqual(conversationLessonCards(rows, 'unknown'), []);
});

test('missing metadata becomes separate stable singletons; malformed or duplicate turns keep all records', () => {
  const rows = [card('unassigned2'), card('unassigned1'), card('last', { lessonId: 'lesson', turn: 'invalid' }),
    card('tie2', { lessonId: 'lesson', turn: 2 }), card('tie1', { lessonId: 'lesson', turn: 2 }), card('first', { lessonId: 'lesson', turn: 1 })];
  const lessons = buildConversationLessons(rows);
  const singles = lessons.filter(lesson => lesson.singleton);
  assert.equal(singles.length, 2);
  assert.ok(singles.every(lesson => lesson.cards.length === 1));
  assert.deepEqual(singles.map(lesson => lesson.id), buildConversationLessons([...rows].reverse()).filter(lesson => lesson.singleton).map(lesson => lesson.id));
  assert.deepEqual(ids(conversationLessonCards(rows, 'conversation:lesson')), ['sentence:first', 'sentence:tie1', 'sentence:tie2', 'sentence:last']);
  assert.equal(lessons.reduce((count, lesson) => count + lesson.count, 0), rows.length);
  const escaped = buildConversationLessons([card('a', { lessonId: 'single:other' }), card('other')]);
  assert.equal(new Set(escaped.map(lesson => lesson.id)).size, 2);
});

test('direct lesson selection matches grouped identities and rejects malformed or nonconversation input', () => {
  const rows = [null, undefined, {}, card('한:1'), card('one', { lessonId: 'single:한' }), card('two', { lessonId: 'single:한', turn: 1 }),
    card('plain', { lessonId: 'single:한' }, ''), card('extra', { lessonId: 'single:한' }, '#subtitle')];
  for (const lesson of buildConversationLessons(rows)) assert.deepEqual(conversationLessonCards(rows, lesson.id), lesson.cards);
  assert.deepEqual(ids(conversationLessonCards(rows, 'conversation:single:한')), []);
  assert.deepEqual(ids(conversationLessonCards(rows, 'conversation:single:%ED%95%9C%3A1')), ['sentence:한:1']);
  assert.deepEqual(ids(conversationLessonCards(rows, 'conversation:single%3A%ED%95%9C')), ['sentence:two', 'sentence:one']);
  for (const invalid of [null, undefined, 1, {}, '', 'other:single:one', 'conversation:', 'conversation:%', 'conversation:%ZZ', 'conversation:%ed%95%9c', 'conversation:unknown']) {
    assert.deepEqual(conversationLessonCards(rows, invalid), []);
  }
});

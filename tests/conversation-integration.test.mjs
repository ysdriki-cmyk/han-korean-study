import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeck } from '../dist/assets/decks.js';
import { enrichConversationCards, buildConversationLessons } from '../dist/assets/conversations.js';
import { sentenceCollectionCards } from '../dist/assets/sentence-collections.js';
import { buildStudySets, cardsForStudySet, setProgress } from '../dist/assets/study-sets.js';
import { recordAssessment } from '../dist/assets/assessment.js';
import { getRecord } from '../dist/assets/learning.js';

const source = readFileSync(new URL('../dist/data/startup/sentence.csv', import.meta.url), 'utf8');
const cards = enrichConversationCards(parseDeck('sentence', source).cards);

test('the shipped conversations form 158 complete lessons and never enter regular or extra sets', () => {
  const conversation = sentenceCollectionCards(cards, 'conversation');
  const sets = buildStudySets('sentence', cards, [], {collection:'conversation'});
  assert.equal(conversation.length, 1106);
  assert.equal(sets.length, 158);
  assert.equal(new Set(sets.map(set => set.group)).size, 13);
  assert.ok(sets.every(set => set.kind === 'conversation'));
  const selected = sets.flatMap(set => cardsForStudySet(cards, set));
  assert.equal(selected.length, 1106);
  assert.equal(new Set(selected.map(card => card.id)).size, 1106);
  for (const set of sets) {
    const members = cardsForStudySet(cards, set);
    assert.deepEqual(members.map(card => card.conversation.turn), [1,2,3,4,5,6,7]);
    assert.deepEqual(members.map(card => card.conversation.speaker), ['A','B','A','B','A','B','A']);
  }
  for (const collection of ['core','extra']) {
    const all = buildStudySets('sentence', cards, [], {collection})[0];
    assert.ok(!cardsForStudySet(cards, all).some(card => selected.includes(card)));
  }
  assert.equal(sets[0].label, '初めての音声通話');
  assert.equal(sets[1].label, '名前の呼び方');
});

test('whole dialogue selection and canonical records survive grading and CSV row reordering', () => {
  const lessons = buildConversationLessons(cards);
  const set = buildStudySets('sentence', cards, [], {collection:'conversation'})[0];
  const members = cardsForStudySet(cards, set);
  const first = members[0];
  const records = {[first.id]:recordAssessment(getRecord(first), 'read', 'good', {correct:true})};
  const persisted = JSON.parse(JSON.stringify(records));
  assert.deepEqual(cardsForStudySet([...cards].reverse(), set).map(card => card.id), members.map(card => card.id));
  assert.equal(setProgress(members, persisted, 'read').counts.good, 1);
  assert.equal(setProgress(members, persisted, 'write').counts.good, 0);
  assert.equal(setProgress(lessons[1].cards, persisted, 'read').counts.good, 0);
  assert.equal(cardsForStudySet(cards, {...set,id:'conversation:missing'}).length, 0);
});

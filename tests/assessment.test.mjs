import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecord, recordWriting } from '../dist/assets/learning.js';
import { RATINGS, UNSEEN, writingAssessment, ratingFor, recordAssessment, filterAssessments } from '../dist/assets/assessment.js';

const NOW = '2026-10-24T06:00:00.000Z';
const PREVIOUS = '2026-10-22T06:00:00.000Z';
const OLD = '2026-09-24T06:00:00.000Z';
const card = { id: 'vocabulary:1', han: '가', state: 'next' };

test('five symbol ratings and unseen state preserve legacy progress per mode', () => {
  assert.deepEqual(RATINGS.map(item => [item.id, item.symbol]), [
    ['hard', '❌❌❌'], ['again', '❌'], ['unsure', '△'], ['good', '○'], ['solid', '◎'],
  ]);
  assert.equal(UNSEEN.id, 'unseen');
  assert.deepEqual(UNSEEN, { id: 'unseen', symbol: 'ー', label: '未回答' });
  assert.equal(RATINGS.find(item => item.id === 'solid').label, '完璧');
  for (const [rank, read, write] of [
    ['required', 'unseen', 'unseen'], ['next', 'unseen', 'unseen'], ['later', 'unseen', 'unseen'],
    ['manji', 'again', 'unseen'], ['fair', 'unsure', 'unseen'], ['mastered', 'good', 'unseen'],
    ['read', 'good', 'unseen'], ['read2', 'solid', 'solid'],
  ]) {
    const source = { ...card, state: rank };
    assert.equal(ratingFor(source, {}, 'read'), read);
    assert.equal(ratingFor(source, {}, 'write'), write);
  }
  assert.equal(ratingFor(card, { [card.id]: { rank: 'manji', writing: { attempts: 1 } } }, 'write'), 'again');
});

test('correct writing becomes good, then solid only from a prior good or solid status', () => {
  for (const previous of ['unseen', 'hard', 'again', 'unsure']) {
    assert.equal(writingAssessment(previous, true), 'good');
  }
  assert.equal(writingAssessment('good', true), 'solid');
  assert.equal(writingAssessment('solid', true), 'solid');
  for (const previous of [...RATINGS.map(item => item.id), UNSEEN.id]) {
    assert.equal(writingAssessment(previous, false), 'again');
    assert.equal(writingAssessment(previous, null), 'unseen');
  }
  assert.throws(() => writingAssessment('good', 'true'), /採点/);
});

test('empty writing is saved as unanswered without increasing wrong or correct counts', () => {
  const correct = recordAssessment(getRecord(card), 'write', 'good', { correct: true, now: PREVIOUS });
  const blank = recordAssessment(correct, 'write', writingAssessment('good', null), { correct: null, now: NOW });
  assert.equal(blank.assessments.write.rating, 'unseen');
  assert.equal(blank.assessments.write.attempts, 2);
  assert.equal(blank.assessments.write.correct, 1);
  assert.equal(blank.assessments.write.wrong, 0);
  assert.deepEqual(blank.assessments.write.history.at(-1), { rating: 'unseen', correct: null, at: NOW });
  assert.equal(correct.assessments.write.rating, 'good');
});

test('writing promotion stays independent for both decks and both modes after saving', () => {
  const kanji = { id: 'kanji:1', han: '가', state: 'next' };
  const vocabulary = { id: 'vocabulary:1', han: '가', state: 'next' };
  let records = {
    [kanji.id]: recordAssessment(getRecord(kanji), 'read', 'solid', { now: PREVIOUS }),
    [vocabulary.id]: recordAssessment(getRecord(vocabulary), 'read', 'again', { now: PREVIOUS }),
  };
  const answer = selected => {
    const rating = writingAssessment(ratingFor(selected, records, 'write'), true);
    records[selected.id] = recordAssessment(getRecord(selected, records), 'write', rating, { correct: true, now: NOW });
    records = JSON.parse(JSON.stringify(records));
  };
  answer(kanji);
  assert.equal(ratingFor(kanji, records, 'write'), 'good');
  assert.equal(ratingFor(vocabulary, records, 'write'), 'unseen');
  answer(kanji);
  assert.equal(ratingFor(kanji, records, 'write'), 'solid');
  answer(vocabulary);
  assert.equal(ratingFor(vocabulary, records, 'write'), 'good');
  assert.equal(ratingFor(kanji, records, 'read'), 'solid');
  assert.equal(ratingFor(vocabulary, records, 'read'), 'again');
  assert.equal(records[kanji.id].assessments.write.correct, 2);
  assert.equal(records[vocabulary.id].assessments.write.correct, 1);
});

test('ratings and all dated events survive serialization and stay independent across modes', () => {
  const initial = getRecord(card);
  const read = recordAssessment(initial, 'read', 'hard', { now: PREVIOUS });
  const written = recordAssessment(read, 'write', 'good', { correct: true, now: NOW });
  const persisted = JSON.parse(JSON.stringify({ [card.id]: written }));
  assert.equal(ratingFor(card, persisted, 'read'), 'hard');
  assert.equal(ratingFor(card, persisted, 'write'), 'good');
  assert.deepEqual(written.assessments.read.history, [{ rating: 'hard', correct: null, at: PREVIOUS }]);
  assert.deepEqual(written.assessments.write.history, [{ rating: 'good', correct: true, at: NOW }]);
  assert.equal(written.assessments.read.attempts, 1);
  assert.equal(written.assessments.write.correct, 1);
  assert.equal(initial.assessments, undefined);
  written.assessments.read.history[0].rating = 'solid';
  assert.equal(read.assessments.read.history[0].rating, 'hard');
});

test('post-writing confidence cannot change objective grading or count the same attempt twice', () => {
  const objective = recordWriting(getRecord(card), false, NOW);
  const graded = recordAssessment(objective, 'write', 'again', { correct: false, now: NOW });
  const adjusted = recordAssessment(graded, 'write', 'unsure', { correct: true, now: NOW, countAttempt: false });
  assert.equal(adjusted.rank, 'manji');
  assert.deepEqual(adjusted.writing, objective.writing);
  assert.equal(adjusted.assessments.write.attempts, 1);
  assert.equal(adjusted.assessments.write.correct, 0);
  assert.equal(adjusted.assessments.write.wrong, 1);
  assert.deepEqual(adjusted.assessments.write.history, [{ rating: 'unsure', correct: false, at: NOW }]);
  assert.equal(graded.assessments.write.rating, 'again');
  const manual = recordAssessment(getRecord(card), 'read', 'solid', { now: NOW, countAttempt: false });
  assert.equal(manual.assessments.read.attempts, 0);
  assert.equal(manual.assessments.read.lastAt, null);
  assert.deepEqual(manual.assessments.read.history, []);
});

test('filtering can select any combination including unseen without mutating records', () => {
  const cards = [card, { ...card, id: 'kanji:1' }, { ...card, id: 'vocabulary:2' }];
  const records = {
    [cards[0].id]: recordAssessment(getRecord(card), 'read', 'hard', { now: PREVIOUS }),
    [cards[1].id]: recordAssessment(getRecord(card), 'read', 'solid', { now: NOW }),
  };
  assert.deepEqual(filterAssessments(cards, records, { ratings: ['hard', 'unseen'] }).map(item => item.id), ['vocabulary:1', 'vocabulary:2']);
  assert.equal(filterAssessments(cards, records, { ratings: [] }).length, 0);
  assert.equal(filterAssessments(cards, records, { ratings: ['invalid'] }).length, 0);
  assert.equal(filterAssessments(cards, records, { mode: 'write', ratings: ['unseen'] }).length, 3);
  assert.equal(filterAssessments(cards, records).length, 3);
  assert.equal(cards.length, 3);
  assert.equal(records['vocabulary:1'].assessments.read.rating, 'hard');
});

test('recent mistakes use dated attempt history even after a later correct result', () => {
  const cards = [card, { ...card, id: 'vocabulary:2' }, { ...card, id: 'vocabulary:3', state: 'manji' }];
  const first = recordAssessment(recordAssessment(getRecord(card), 'read', 'again', { correct: false, now: PREVIOUS }), 'read', 'solid', { correct: true, now: NOW });
  const second = recordAssessment(getRecord(card), 'read', 'hard', { now: OLD });
  const records = {
    [cards[0].id]: first,
    [cards[1].id]: second,
    // Aggregate legacy totals have no reliable timestamp for the wrong attempt.
    [cards[2].id]: { rank: 'manji', attempts: { 'ko-han': { right: 5, wrong: 1, lastAt: NOW } } },
  };
  assert.deepEqual(filterAssessments(cards, records, { recentMistakesDays: 7 }, NOW).map(item => item.id), ['vocabulary:1']);
  assert.deepEqual(filterAssessments(cards, records, { recentMistakesDays: 90 }, NOW).map(item => item.id), ['vocabulary:1', 'vocabulary:2']);
  assert.equal(filterAssessments(cards, records, { mode: 'write', recentMistakesDays: 7 }, NOW).length, 0);
});

test('recent-practice exclusion respects the current mode and exact day boundary', () => {
  const cards = [card, { ...card, id: 'vocabulary:2' }, { ...card, id: 'vocabulary:3' }];
  const records = {
    [cards[0].id]: recordAssessment(getRecord(card), 'read', 'good', { now: PREVIOUS }),
    [cards[1].id]: recordAssessment(getRecord(card), 'write', 'good', { correct: true, now: NOW }),
    [cards[2].id]: { attempts: { 'ko-han': { lastAt: NOW } } },
  };
  assert.deepEqual(filterAssessments(cards, records, { excludeRecentDays: 3 }, NOW).map(item => item.id), ['vocabulary:2']);
  assert.deepEqual(filterAssessments(cards, records, { mode: 'write', excludeRecentDays: 3 }, NOW).map(item => item.id), ['vocabulary:1', 'vocabulary:3']);
  assert.deepEqual(filterAssessments(cards, records, { excludeRecentDays: 2 }, NOW).map(item => item.id), ['vocabulary:2']);
});

test('malformed or future events do not create recent-mistake matches', () => {
  const records = { [card.id]: { assessments: { read: { rating: 'again', history: [null, { rating: 'again', at: 'invalid' }, { correct: false, at: '2027-01-01T00:00:00Z' }] } } } };
  assert.equal(filterAssessments([card], records, { recentMistakesDays: 7 }, NOW).length, 0);
  assert.throws(() => recordAssessment({}, 'other', 'good'), /モード/);
  assert.throws(() => recordAssessment({}, 'read', 'invalid'), /評価/);
  assert.throws(() => recordAssessment({}, 'write', 'good', { correct: 'true' }), /採点/);
});

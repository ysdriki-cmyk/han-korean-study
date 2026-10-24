import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecord } from '../dist/assets/learning.js';
import { recordAssessment } from '../dist/assets/assessment.js';
import { nextReviewFor, reviewDue, applyReviewSchedule, insertRetry } from '../dist/assets/review.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-25T06:00:00.000Z');
const card = { id: 'kanji:1', han: '가', state: 'next' };
function assess(record, mode, rating, at, correct = null) {
  return applyReviewSchedule(recordAssessment(record, mode, rating, { now: at, correct }), mode, rating, at);
}

test('good and solid answers gain longer per-mode review intervals', () => {
  let record = getRecord(card);
  for (const [index, interval] of [1, 3, 7, 14, 30, 30].entries()) {
    record = assess(record, 'read', 'good', NOW + index * DAY);
    assert.equal(record.assessments.read.intervalDays, interval);
    assert.equal(Date.parse(record.assessments.read.dueAt), NOW + index * DAY + interval * DAY);
  }
  for (const [index, interval] of [3, 7, 14, 30, 60, 60].entries()) {
    record = assess(record, 'write', 'solid', NOW + index * DAY, true);
    assert.equal(record.assessments.write.intervalDays, interval);
  }
  assert.equal(record.assessments.read.attempts, 6);
  assert.equal(record.assessments.write.attempts, 6);
});

test('a miss or uncertainty resets the successful streak without erasing history', () => {
  let record = assess(assess(getRecord(card), 'read', 'good', NOW), 'read', 'good', NOW + DAY);
  record = assess(record, 'read', 'hard', NOW + 2 * DAY);
  assert.equal(record.assessments.read.intervalDays, 0);
  record = assess(record, 'read', 'good', NOW + 3 * DAY);
  assert.equal(record.assessments.read.intervalDays, 1);
  record = assess(record, 'read', 'unsure', NOW + 4 * DAY);
  assert.equal(record.assessments.read.intervalDays, 1);
  record = assess(record, 'read', 'solid', NOW + 5 * DAY);
  assert.equal(record.assessments.read.intervalDays, 3);
  assert.equal(record.assessments.read.history.length, 6);
});

test('post-grading confidence revises spacing without another attempt or a false correct result', () => {
  const graded = assess(getRecord(card), 'write', 'good', NOW, true);
  const confidence = recordAssessment(graded, 'write', 'solid', { now: NOW + 1000, countAttempt: false });
  const revised = applyReviewSchedule(confidence, 'write', 'solid', NOW + 1000);
  assert.equal(revised.assessments.write.intervalDays, 3);
  assert.equal(Date.parse(revised.assessments.write.dueAt), NOW + 3 * DAY);
  assert.equal(revised.assessments.write.attempts, 1);
  assert.equal(revised.assessments.write.correct, 1);
  const wrong = assess(getRecord(card), 'write', 'again', NOW, false);
  const confidentWrong = applyReviewSchedule(recordAssessment(wrong, 'write', 'solid', { now: NOW, countAttempt: false }), 'write', 'solid', NOW);
  assert.equal(confidentWrong.assessments.write.intervalDays, 0);
  assert.equal(confidentWrong.assessments.write.wrong, 1);
  assert.equal(confidentWrong.assessments.write.history[0].correct, false);
});

test('due dates survive storage and become eligible exactly at the due time', () => {
  const record = assess(getRecord(card), 'read', 'good', NOW);
  const records = JSON.parse(JSON.stringify({ [card.id]: record }));
  assert.equal(reviewDue(card, records, 'read', NOW + DAY - 1), false);
  assert.equal(reviewDue(card, records, 'read', NOW + DAY), true);
  assert.equal(reviewDue(card, records, 'write', NOW), true);
  const before = JSON.stringify(record);
  const next = applyReviewSchedule(record, 'read', 'solid', NOW);
  assert.equal(JSON.stringify(record), before);
  next.assessments.read.history[0].rating = 'hard';
  assert.equal(record.assessments.read.history[0].rating, 'good');
});

test('existing dated history gains a schedule but undated legacy ranks do not gain invented dates', () => {
  const dated = recordAssessment(getRecord(card), 'read', 'solid', { now: NOW });
  assert.deepEqual(nextReviewFor(dated, 'read', NOW), { dueAt: new Date(NOW + 3 * DAY).toISOString(), intervalDays: 3 });
  const legacy = { ...getRecord(card), rank: 'read2' };
  assert.deepEqual(nextReviewFor(legacy, 'read', NOW), { dueAt: null, intervalDays: 0 });
  assert.equal(reviewDue(card, { [card.id]: legacy }, 'read', NOW), true);
  assert.throws(() => nextReviewFor(dated, 'invalid', NOW), /モード/);
});

test('hard and again retries appear after three and five other cards without mutating the base set', () => {
  const queue = Array.from({ length: 10 }, (_, i) => ({ id: `kanji:${i + 1}` }));
  const hard = insertRetry(queue, 0, queue[0], 'hard');
  const again = insertRetry(queue, 0, queue[0], 'again');
  assert.equal(hard.at, 4);
  assert.equal(again.at, 6);
  assert.equal(hard.queue[4].id, queue[0].id);
  assert.equal(again.queue[6].id, queue[0].id);
  assert.equal(queue.length, 10);
  assert.equal(hard.queue.length, 11);
  assert.equal(insertRetry(queue, 0, queue[0], 'good').inserted, false);
});

test('short-set retries use the remaining cards, avoid duplicates, and stop after two extra attempts', () => {
  const queue = [{ id: 'kanji:1' }, { id: 'kanji:2' }];
  const first = insertRetry(queue, 0, queue[0], 'again');
  assert.equal(first.at, 2);
  assert.equal(insertRetry(first.queue, 0, queue[0], 'hard').inserted, false);
  const second = insertRetry(first.queue, 2, queue[0], 'hard');
  assert.equal(second.at, 3);
  assert.equal(second.queue.length, 4);
  const third = insertRetry(second.queue, 3, queue[0], 'again');
  assert.equal(third.inserted, false);
  assert.equal(third.queue.filter(item => item.id === 'kanji:1').length, 3);
  assert.equal(insertRetry(queue, 0, queue[0], 'again', { maxRepeats: 0 }).inserted, false);
  assert.throws(() => insertRetry(queue, -1, queue[0], 'again'), /位置/);
});

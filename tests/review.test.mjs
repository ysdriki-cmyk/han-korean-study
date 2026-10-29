import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecord } from '../dist/assets/learning.js';
import { recordAssessment } from '../dist/assets/assessment.js';
import { nextReviewFor, reviewDue, applyReviewSchedule, mistakeCoolingDown } from '../dist/assets/review.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-25T06:00:00.000Z');
const card = { id: 'kanji:1', han: '가', state: 'next' };
function assess(record, mode, rating, at, correct = null) {
  return applyReviewSchedule(recordAssessment(record, mode, rating, { now: at, correct }), mode, rating, at);
}

test('good and solid answers gain longer per-mode review intervals', () => {
  let record = getRecord(card);
  for (const [index, interval] of [5, 7, 14, 30, 60, 60].entries()) {
    record = assess(record, 'read', 'good', NOW + index * DAY);
    assert.equal(record.assessments.read.intervalDays, interval);
    assert.equal(Date.parse(record.assessments.read.dueAt), NOW + index * DAY + interval * DAY);
  }
  for (const [index, interval] of [5, 14, 30, 60, 90, 90].entries()) {
    record = assess(record, 'write', 'solid', NOW + index * DAY, true);
    assert.equal(record.assessments.write.intervalDays, interval);
  }
  assert.equal(record.assessments.read.attempts, 6);
  assert.equal(record.assessments.write.attempts, 6);
});

test('a miss or uncertainty resets the successful streak without erasing history', () => {
  let record = assess(assess(getRecord(card), 'read', 'good', NOW), 'read', 'good', NOW + DAY);
  record = assess(record, 'read', 'hard', NOW + 2 * DAY);
  assert.equal(record.assessments.read.intervalDays, 2);
  record = assess(record, 'read', 'good', NOW + 3 * DAY);
  assert.equal(record.assessments.read.intervalDays, 5);
  record = assess(record, 'read', 'unsure', NOW + 4 * DAY);
  assert.equal(record.assessments.read.intervalDays, 5);
  record = assess(record, 'read', 'solid', NOW + 5 * DAY);
  assert.equal(record.assessments.read.intervalDays, 5);
  assert.equal(record.assessments.read.history.length, 6);
});

test('post-grading confidence revises spacing without another attempt or a false correct result', () => {
  const graded = assess(getRecord(card), 'write', 'good', NOW, true);
  const confidence = recordAssessment(graded, 'write', 'solid', { now: NOW + 1000, countAttempt: false });
  const revised = applyReviewSchedule(confidence, 'write', 'solid', NOW + 1000);
  assert.equal(revised.assessments.write.intervalDays, 5);
  assert.equal(Date.parse(revised.assessments.write.dueAt), NOW + 5 * DAY);
  assert.equal(revised.assessments.write.attempts, 1);
  assert.equal(revised.assessments.write.correct, 1);
  const wrong = assess(getRecord(card), 'write', 'again', NOW, false);
  const confidentWrong = applyReviewSchedule(recordAssessment(wrong, 'write', 'solid', { now: NOW, countAttempt: false }), 'write', 'solid', NOW);
  assert.equal(confidentWrong.assessments.write.intervalDays, 2);
  assert.equal(confidentWrong.assessments.write.wrong, 1);
  assert.equal(confidentWrong.assessments.write.history[0].correct, false);
});

test('due dates survive storage and become eligible exactly at the due time', () => {
  const record = assess(getRecord(card), 'read', 'good', NOW);
  const records = JSON.parse(JSON.stringify({ [card.id]: record }));
  assert.equal(reviewDue(card, records, 'read', NOW + 5 * DAY - 1), false);
  assert.equal(reviewDue(card, records, 'read', NOW + 5 * DAY), true);
  assert.equal(reviewDue(card, records, 'write', NOW), true);
  const before = JSON.stringify(record);
  const next = applyReviewSchedule(record, 'read', 'solid', NOW);
  assert.equal(JSON.stringify(record), before);
  next.assessments.read.history[0].rating = 'hard';
  assert.equal(record.assessments.read.history[0].rating, 'good');
});

test('existing dated history gains a schedule but undated legacy ranks do not gain invented dates', () => {
  const dated = recordAssessment(getRecord(card), 'read', 'solid', { now: NOW });
  assert.deepEqual(nextReviewFor(dated, 'read', NOW), { dueAt: new Date(NOW + 5 * DAY).toISOString(), intervalDays: 5 });
  const legacy = { ...getRecord(card), rank: 'read2' };
  assert.deepEqual(nextReviewFor(legacy, 'read', NOW), { dueAt: null, intervalDays: 0 });
  assert.equal(reviewDue(card, { [card.id]: legacy }, 'read', NOW), true);
  assert.throws(() => nextReviewFor(dated, 'invalid', NOW), /モード/);
});

test('mistakes wait exactly 48 hours independently in each deck and mode', () => {
  for (const deckId of ['kanji', 'vocabulary']) {
    const target = {id:`${deckId}:1`,han:'가'};
    const other = {id:`${deckId === 'kanji' ? 'vocabulary' : 'kanji'}:1`,han:'가'};
    for (const mode of ['read', 'write']) {
      for (const rating of ['hard', 'again']) {
        const record = assess(getRecord(target), mode, rating, NOW, mode === 'write' ? false : null);
        const saved = JSON.parse(JSON.stringify({[target.id]:record}));
        assert.equal(record.assessments[mode].intervalDays, 2);
        assert.equal(reviewDue(target, saved, mode, NOW + 2 * DAY - 1), false);
        assert.equal(reviewDue(target, saved, mode, NOW + 2 * DAY), true);
        assert.equal(mistakeCoolingDown(target, saved, mode, NOW + 2 * DAY - 1), true);
        assert.equal(mistakeCoolingDown(target, saved, mode, NOW + 2 * DAY), false);
        assert.equal(mistakeCoolingDown(target, saved, mode === 'read' ? 'write' : 'read', NOW), false);
        assert.equal(mistakeCoolingDown(other, saved, mode, NOW), false);
      }
    }
  }
});

test('saved zero-day mistakes gain a two-day minimum without rewriting history or resetting the clock', () => {
  const old = recordAssessment(getRecord(card), 'write', 'again', {correct:false, now:NOW});
  old.assessments.write.dueAt = new Date(NOW).toISOString();
  old.assessments.write.intervalDays = 0;
  const before = JSON.stringify(old);
  assert.deepEqual(nextReviewFor(old, 'write', NOW + DAY), {dueAt:new Date(NOW + 2 * DAY).toISOString(),intervalDays:2});
  assert.equal(JSON.stringify(old), before);
  assert.equal(reviewDue(card, {[card.id]:old}, 'write', NOW + 2 * DAY), true);

  const corrected = assess(old, 'write', 'good', NOW + 60000, true);
  assert.equal(Date.parse(corrected.assessments.write.dueAt), NOW + 60000 + 5 * DAY);
  const unscored = applyReviewSchedule(recordAssessment(old, 'write', 'unseen', {countAttempt:false,now:NOW}), 'write', 'unseen', NOW);
  assert.equal(Date.parse(unscored.assessments.write.dueAt), NOW + 2 * DAY);
  const legacy = {...getRecord(card),rank:'manji'};
  assert.equal(mistakeCoolingDown(card, {[card.id]:legacy}, 'write', NOW), false);
});

test('older short recall schedules gain five days from the original attempt without changing records', () => {
  for (const mode of ['read', 'write']) for (const rating of ['unsure', 'good', 'solid']) {
    const record = recordAssessment(getRecord(card), mode, rating, { now: NOW, correct: rating === 'unsure' ? null : true });
    record.assessments[mode].dueAt = new Date(NOW + DAY).toISOString();
    record.assessments[mode].intervalDays = 1;
    const before = JSON.stringify(record);
    assert.deepEqual(nextReviewFor(record, mode, NOW + 2 * DAY), {dueAt:new Date(NOW + 5 * DAY).toISOString(),intervalDays:5});
    assert.equal(reviewDue(card, {[card.id]:record}, mode, NOW + 5 * DAY - 1), false);
    assert.equal(reviewDue(card, {[card.id]:record}, mode, NOW + 5 * DAY), true);
    assert.equal(JSON.stringify(record), before);
    record.assessments[mode].dueAt = new Date(NOW + 14 * DAY).toISOString();
    record.assessments[mode].intervalDays = 14;
    assert.equal(nextReviewFor(record, mode, NOW).intervalDays, 14);
  }
});

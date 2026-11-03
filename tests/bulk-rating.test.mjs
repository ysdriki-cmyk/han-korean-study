import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBulkRating, undoBulkRating } from '../dist/assets/bulk-rating.js';
import { recordAssessment, ratingFor } from '../dist/assets/assessment.js';
import { getRecord } from '../dist/assets/learning.js';
import { practiceCount, lastPracticeAt } from '../dist/assets/practice.js';

const NOW = '2026-11-03T10:00:00.000Z';
const OLD = '2026-10-25T10:00:00.000Z';

test('all six ratings update only selected course/direction without inventing attempts', () => {
  for (const deck of ['kanji', 'vocabulary', 'sentence']) for (const mode of ['read', 'write']) {
    const cards = [{id:`${deck}:1`,han:'가'}, {id:`${deck}:2`,han:'나'}, {id:`${deck}:3`,han:'다'}];
    const other = mode === 'read' ? 'write' : 'read';
    const existing = recordAssessment(recordAssessment(getRecord(cards[0]), mode, 'again', {correct:false,now:OLD}), other, 'solid', {correct:true,now:OLD});
    existing.assessments[mode].dueAt = '2026-10-27T10:00:00.000Z';
    existing.assessments[mode].intervalDays = 2;
    const records = {[cards[0].id]:existing, 'unrelated:1':{custom:'keep'}};
    const before = JSON.stringify(records);
    for (const rating of ['hard','again','unsure','good','solid','unseen']) {
      const result = applyBulkRating(cards, records, [cards[0].id,cards[1].id,cards[0].id,'unrelated:1','missing'], mode, rating, NOW);
      assert.equal(result.edits.length, 2);
      assert.equal(ratingFor(cards[0], result.records, mode), rating);
      assert.equal(ratingFor(cards[1], result.records, mode), rating);
      assert.equal(result.records[cards[2].id], undefined);
      assert.deepEqual(result.records['unrelated:1'], records['unrelated:1']);
      assert.deepEqual(result.records[cards[0].id].assessments[other], existing.assessments[other]);
      for (const field of ['attempts','correct','wrong','lastAt','history','dueAt','intervalDays']) {
        assert.deepEqual(result.records[cards[0].id].assessments[mode][field], existing.assessments[mode][field]);
      }
      assert.equal(practiceCount(cards[0], result.records, mode), practiceCount(cards[0], records, mode));
      assert.equal(lastPracticeAt(cards[0], result.records, mode), lastPracticeAt(cards[0], records, mode));
      assert.equal(practiceCount(cards[1], result.records, mode), 0);
      assert.equal(lastPracticeAt(cards[1], result.records, mode), null);
      assert.equal(JSON.stringify(records), before);
      assert.equal(JSON.stringify(undoBulkRating(result.records, result.edits).records), before);
    }
  }
});

test('undo restores prior statuses and leaves later practice or edits untouched', () => {
  const cards = [{id:'vocabulary:1',han:'가'}, {id:'vocabulary:2',han:'나'}];
  const result = applyBulkRating(cards, {}, cards.map(card=>card.id), 'read', 'solid', NOW);
  const later = { ...result.records, [cards[0].id]:recordAssessment(result.records[cards[0].id], 'write', 'good', {correct:true,now:'2026-11-03T11:00:00Z'}) };
  const restored = undoBulkRating(later, result.edits);
  assert.equal(restored.restored, 1);
  assert.deepEqual(restored.records[cards[0].id], later[cards[0].id]);
  assert.equal(restored.records[cards[1].id], undefined);
  assert.equal(result.records[cards[0].id].assessments.write, undefined);
  assert.throws(()=>applyBulkRating(cards, {}, [], 'other', 'good'), /モード/);
  assert.throws(()=>applyBulkRating(cards, {}, [], 'read', 'invalid'), /ステータス/);
});

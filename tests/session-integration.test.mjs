import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSession } from '../dist/assets/core.js';
import { getRecord } from '../dist/assets/learning.js';
import { recordAssessment } from '../dist/assets/assessment.js';
import { practiceSettings, practicePool, restorePracticePreferences } from '../dist/assets/practice.js';
import { applyReviewSchedule } from '../dist/assets/review.js';

const NOW = Date.parse('2026-10-25T01:00:00.000Z');
const DAY = 86400000;

test('a wrong card stays out of new thirty-card sets until 48 hours have elapsed after persistence', () => {
  const cards = Array.from({length:30}, (_,index) => ({id:`kanji:${index+1}`,deckId:'kanji',han:'가',kanji:'家',state:'next'}));
  const settings = practiceSettings();
  const original = makeSession(practicePool(cards, {}, settings, NOW), {...settings,random:()=>0});
  const target = original[0];
  const wrong = applyReviewSchedule(recordAssessment(getRecord(target), 'write', 'again', {correct:false,now:NOW}), 'write', 'again', NOW);
  const persisted = JSON.parse(JSON.stringify({[target.id]:wrong}));
  assert.equal(original.length, 30);
  assert.equal(practicePool(cards, persisted, settings, NOW).length, 29);
  assert.equal(practicePool([target], persisted, settings, NOW + 2 * DAY - 1).length, 0);
  assert.equal(practicePool([target], persisted, settings, NOW + 2 * DAY).length, 1);
  for (const includeDue of [true,false]) {
    assert.equal(practicePool([target], persisted, {...settings,ratings:['hard','again','unsure','good','solid','unseen'],includeDue}, NOW + DAY).length, 0);
  }
  assert.equal(persisted[target.id].assessments.write.attempts, 1);
  assert.equal(persisted[target.id].assessments.write.wrong, 1);
  assert.equal(persisted[target.id].assessments.write.history.length, 1);
});

test('saving a first-pass custom profile survives a reload without changing existing assessment history', () => {
  const card = { id:'kanji:1', deckId:'kanji', han:'가', kanji:'家' };
  const learning = { [card.id]:applyReviewSchedule(recordAssessment(getRecord(card), 'write', 'hard', { correct:false, now:NOW }), 'write', 'hard', NOW) };
  const before = JSON.stringify(learning);
  const prefs = restorePracticePreferences(null, { courses:{ kanji:{ mode:'read', limit:'10' } } });
  prefs.courses.kanji = practiceSettings({ ...prefs.courses.kanji, scope:'all', limit:'50', shuffle:false, ratings:['hard','again'], includeDue:false });
  const reloaded = restorePracticePreferences(JSON.parse(JSON.stringify(prefs)));
  assert.equal(reloaded.courses.kanji.scope, 'all');
  assert.equal(reloaded.courses.kanji.limit, '50');
  assert.equal(reloaded.courses.kanji.shuffle, false);
  assert.equal(reloaded.courses.kanji.includeDue, false);
  assert.equal(practicePool([card], learning, reloaded.courses.kanji, NOW).length, 0);
  assert.equal(practicePool([card], learning, reloaded.courses.kanji, NOW + 2 * DAY).length, 1);
  assert.equal(JSON.stringify(learning), before);
});

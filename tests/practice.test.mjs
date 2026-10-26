import test from 'node:test';
import assert from 'node:assert/strict';
import { RANKS, getRecord, setRank, recordWriting, recordRecall } from '../dist/assets/learning.js';
import { resolvePracticeMode, practiceSettings, practicePool, restorePracticePreferences } from '../dist/assets/practice.js';
import { recordAssessment } from '../dist/assets/assessment.js';
import { applyReviewSchedule } from '../dist/assets/review.js';

const cards = RANKS.map(rank => ({ id: `vocabulary:${rank.id}`, han: '가', state: rank.id }));
const records = Object.fromEntries(cards.map(card => [card.id, getRecord(card)]));

test('both modes admit every rank without reading or recall prerequisites', () => {
  for (const mode of ['read', 'write']) {
    const pool = practicePool(cards, records, { mode });
    assert.deepEqual(pool.map(card => card.id), cards.map(card => card.id));
    for (const card of pool) {
      const before = getRecord(card, records);
      const result = mode === 'write' ? recordWriting(before, true) : recordRecall(before, 'ko-han', true);
      assert.equal(mode === 'write' ? result.rank : result.attempts['ko-han'].right, mode === 'write' ? 'read2' : 1);
      assert.deepEqual(getRecord(card, records), before);
    }
  }
});

test('rank filters and review work identically in both modes', () => {
  for (const mode of ['read', 'write']) {
    assert.equal(practicePool(cards, records, { mode, filter: 'review' }).length, 2);
    for (const rank of RANKS) {
      assert.deepEqual(practicePool(cards, records, { mode, filter: rank.id }).map(card => card.id), [`vocabulary:${rank.id}`]);
    }
  }
  assert.equal(practicePool(cards, records, { filter: 'invalid' }).length, cards.length);
});

test('new mode preferences override old stage/direction and old choices migrate deterministically', () => {
  assert.equal(resolvePracticeMode({ stage: 'write' }), 'write');
  assert.equal(resolvePracticeMode({ stage: 'read', direction: 'han-ko' }), 'read');
  assert.equal(resolvePracticeMode({ stage: 'recall', direction: 'han-ko' }), 'write');
  assert.equal(resolvePracticeMode({ stage: 'recall', direction: 'ko-han' }), 'read');
  assert.equal(resolvePracticeMode({ mode: 'read', stage: 'write' }), 'read');
  assert.equal(resolvePracticeMode({ mode: 'write', stage: 'read' }), 'write');
  assert.equal(resolvePracticeMode({}), 'write');
  assert.equal(resolvePracticeMode(null), 'write');
  assert.equal(practiceSettings(null).filter, 'all');
  assert.deepEqual(practiceSettings({}), { mode: 'write', sessionType: 'practice', reviewDays: 7, filter: 'all', limit: '30', shuffle: true, libraryDirection: 'ko-han', ratings: ['hard', 'again', 'unseen'], recentMistakesDays: 0, excludeRecentDays: 0, scope: 'essential', includeDue: true });
  assert.deepEqual(practiceSettings({ mode: 'write', filter: 'required', limit: 50, shuffle: true }), { mode: 'write', sessionType: 'practice', reviewDays: 7, filter: 'required', limit: '50', shuffle: true, libraryDirection: 'ko-han', ratings: ['unseen'], recentMistakesDays: 0, excludeRecentDays: 0, scope: 'essential', includeDue: true });
});

test('selecting cards for practice can preserve their shared ranks and direction histories', () => {
  const card = cards[0];
  const existing = setRank(recordRecall(records[card.id], 'han-ko', true), 'later');
  const selectedRecords = { [card.id]: existing };
  const pool = practicePool([card], selectedRecords, { mode: 'write' });
  assert.equal(pool[0].id, card.id);
  assert.equal(selectedRecords[card.id].rank, 'later');
  assert.equal(selectedRecords[card.id].attempts['han-ko'].right, 1);
});

test('status settings validate multi-selection, history periods and legacy filters', () => {
  assert.deepEqual(practiceSettings({ ratings: ['again', 'solid', 'bad', 'again'], recentMistakesDays: 7, excludeRecentDays: '3' }).ratings, ['again', 'solid']);
  assert.equal(practiceSettings({ recentMistakesDays: 7 }).recentMistakesDays, 7);
  assert.equal(practiceSettings({ excludeRecentDays: 2 }).excludeRecentDays, 0);
  assert.deepEqual(practiceSettings({ filter: 'review' }).ratings, ['hard', 'again', 'unsure']);
  assert.equal(practicePool(cards, records, practiceSettings({ ratings: [] })).length, 0);
  assert.deepEqual(practicePool(cards, records, practiceSettings({ mode: 'read', ratings: ['unsure'] })).map(card => card.state), ['fair']);
});


test('new defaults use writing, thirty shuffled cards, and only unpractised or failed ratings', () => {
  const defaults = practiceSettings();
  assert.equal(defaults.mode, 'write');
  assert.equal(defaults.limit, '30');
  assert.equal(defaults.shuffle, true);
  assert.deepEqual(defaults.ratings, ['hard', 'again', 'unseen']);
  assert.equal(defaults.scope, 'essential');
  assert.equal(defaults.includeDue, true);
  assert.equal(practiceSettings({ shuffle: false }).shuffle, false);
  assert.equal(practiceSettings({ limit: 30 }).limit, '30');
  assert.equal(practiceSettings({ limit: 99 }).limit, '30');
});

test('v4 saved preferences persist and v3 migrates once without retaining the old defaults', () => {
  const previous = { deckId: 'vocabulary', courses: { kanji: { mode: 'read', limit: '10', shuffle: false, ratings: ['good'], libraryDirection: 'han-ko' } } };
  const migrated = restorePracticePreferences(null, previous);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.deckId, 'kanji');
  assert.equal(migrated.courses.kanji.mode, 'write');
  assert.equal(migrated.courses.kanji.limit, '30');
  assert.equal(migrated.courses.kanji.libraryDirection, 'han-ko');
  assert.deepEqual(migrated.courses.kanji.ratings, ['hard', 'again', 'unseen']);
  const saved = { ...migrated, deckId: 'vocabulary', courses: { ...migrated.courses, kanji: practiceSettings({ mode: 'read', scope: 'all', limit: '50', shuffle: false, ratings: ['unsure'], includeDue: false }) } };
  assert.deepEqual(restorePracticePreferences(JSON.parse(JSON.stringify(saved)), previous), saved);
  assert.equal(previous.courses.kanji.limit, '10');
});

test('the first-pass scope filters F-column kanji cards, leaving vocabulary and older untyped cards available', () => {
  const source = [
    { id:'kanji:1', deckId:'kanji', han:'가', kanji:'家' },
    { id:'kanji:2', deckId:'kanji', han:'각', kanji:' ', hanja:'角' },
    { id:'vocabulary:1', deckId:'vocabulary', han:'가', kanji:'' },
    { id:'legacy:1', han:'가', kanji:'' },
  ];
  assert.deepEqual(practicePool(source, {}, practiceSettings()).map(card => card.id), ['kanji:1', 'vocabulary:1', 'legacy:1']);
  assert.deepEqual(practicePool(source, {}, practiceSettings({ scope:'all' })).map(card => card.id), source.map(card => card.id));
  assert.equal(practicePool([{ id:'plain:1', han:'가', kanji:'' }], {}, { ...practiceSettings(), deckId:'kanji' }).length, 0);
});

const timestamp = '2026-10-25T00:00:00.000Z';
const afterDays = days => new Date(Date.parse(timestamp) + days * 86400000).toISOString();
function assessed(card, rating, { correct = null, at = timestamp } = {}) {
  return applyReviewSchedule(recordAssessment(getRecord(card), 'write', rating, { correct, now: at }), 'write', rating, at);
}

test('due successful or uncertain cards rejoin the default pool after their saved intervals', () => {
  const source = ['unsure','good','solid','legacy'].map(id => ({id:`vocabulary:${id}`, han:'가', state:id === 'legacy' ? 'read2' : ''}));
  const saved = Object.fromEntries(source.slice(0, 3).map(card => [card.id, assessed(card, card.id.split(':')[1])]));
  const defaults = practiceSettings();
  assert.deepEqual(practicePool(source, saved, defaults, timestamp), []);
  assert.deepEqual(practicePool(source, saved, defaults, afterDays(1)).map(card => card.id), ['vocabulary:unsure', 'vocabulary:good']);
  assert.deepEqual(practicePool(source, saved, defaults, afterDays(3)).map(card => card.id), ['vocabulary:unsure', 'vocabulary:good', 'vocabulary:solid']);
  assert.equal(practicePool(source, saved, { ...defaults, includeDue:false }, afterDays(3)).length, 0);
  assert.equal(practicePool(source, saved, { ...defaults, ratings:[] }, afterDays(3)).length, 0);
  assert.equal(practicePool(source, saved, { ...defaults, ratings:['good','solid'] }, timestamp).length, 1); // Undated legacy status can still be selected explicitly.
});

test('due supplements still obey recent-practice exclusion and dated-mistake filters', () => {
  const card = {id:'vocabulary:spaced', han:'가'};
  const saved = {[card.id]:assessed(card, 'good', {correct:true})};
  const defaults = practiceSettings();
  assert.equal(practicePool([card], saved, defaults, afterDays(1)).length, 1);
  assert.equal(practicePool([card], saved, { ...defaults, excludeRecentDays:3 }, afterDays(1)).length, 0);
  assert.equal(practicePool([card], saved, { ...defaults, recentMistakesDays:7 }, afterDays(1)).length, 0);
  const wrong = assessed(card, 'solid', {correct:false});
  assert.equal(practicePool([card], {[card.id]:wrong}, { ...defaults, recentMistakesDays:7 }, afterDays(1)).length, 0);
  assert.equal(practicePool([card], {[card.id]:wrong}, { ...defaults, recentMistakesDays:7 }, afterDays(2)).length, 1);
});

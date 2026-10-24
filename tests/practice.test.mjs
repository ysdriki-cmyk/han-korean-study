import test from 'node:test';
import assert from 'node:assert/strict';
import { RANKS, getRecord, setRank, recordWriting, recordRecall } from '../dist/assets/learning.js';
import { resolvePracticeMode, practiceSettings, practicePool } from '../dist/assets/practice.js';

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
  assert.equal(resolvePracticeMode({}), 'read');
  assert.equal(resolvePracticeMode(null), 'read');
  assert.equal(practiceSettings(null).filter, 'all');
  assert.deepEqual(practiceSettings({}), { mode: 'read', filter: 'all', limit: '10', shuffle: false, libraryDirection: 'ko-han', ratings: ['hard', 'again', 'unsure', 'good', 'solid', 'unseen'], recentMistakesDays: 0, excludeRecentDays: 0 });
  assert.deepEqual(practiceSettings({ mode: 'write', filter: 'required', limit: 50, shuffle: true }), { mode: 'write', filter: 'required', limit: '50', shuffle: true, libraryDirection: 'ko-han', ratings: ['unseen'], recentMistakesDays: 0, excludeRecentDays: 0 });
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
  assert.deepEqual(practicePool(cards, records, practiceSettings({ ratings: ['unsure'] })).map(card => card.state), ['fair']);
});

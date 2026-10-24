import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS, initialRank, getRecord, setRank, recordRecall, recordReading,
  recordWriting, isEligible, matchHangul, migrateLegacy,
} from '../dist/assets/learning.js';

const NOW = '2026-10-24T06:00:00.000Z';
const LATER = '2026-10-24T06:10:00.000Z';
const card = { id: '1', han: '가', kanji: '家', state: '', flagged: true };

test('all eight ranks use the requested labels and source state precedes flag', () => {
  assert.deepEqual(RANKS.map(({ id, label }) => [id, label]), [
    ['required', '優先'], ['next', '次に学ぶ'], ['later', 'あとで'], ['manji', 'テスト待ち'],
    ['fair', '練習中'], ['mastered', '覚えた'], ['read', '読むテスト済み'], ['read2', '定着'],
  ]);
  assert.equal(initialRank(card), 'required');
  assert.equal(initialRank({ ...card, flagged: false }), 'next');
  for (const rank of RANKS) assert.equal(initialRank({ ...card, state: rank.label }), rank.id);
  assert.equal(initialRank({ ...card, state: '不明' }), 'required');
});

test('source aliases and previously saved rank labels retain their learning position', () => {
  const aliases = [
    ['必須！', 'required'], ['必須', 'required'], ['必須!', 'required'], ['！', 'required'],
    ['次', 'next'], ['卍マジ', 'manji'], ['卍GO', 'manji'], ['卍行け', 'manji'],
    ['まあまあ', 'fair'], ['read', 'read'], ['read2', 'read2'], ['read3', 'read2'],
    ['書ける', 'read2'], ['remember', 'mastered'], ['パス', 'later'],
  ];
  for (const [state, expected] of aliases) {
    // An explicit source state wins even when the original priority flag is set.
    assert.equal(initialRank({ ...card, state: ` ${state} ` }), expected, state);
    assert.equal(getRecord(card, { [card.id]: { rank: state } }).rank, expected, state);
    assert.equal(setRank(getRecord(card), state, NOW).rank, expected, state);
  }
  assert.equal(initialRank({ ...card, state: '', flagged: false, sourceRemember: true }), 'next');
});

test('source reading state unlocks the matching checkpoint without erasing local progress', () => {
  const readingCard = { ...card, state: 'read' };
  const sourceRecord = getRecord(readingCard);
  assert.equal(sourceRecord.rank, 'read');
  assert.equal(isEligible(readingCard, sourceRecord, 'read'), false);
  assert.equal(isEligible(readingCard, sourceRecord, 'write'), true);
  assert.equal(recordWriting(sourceRecord, true, NOW).rank, 'read2');

  const locallyRelearning = { [card.id]: { rank: 'manji' } };
  assert.equal(getRecord(readingCard, locallyRelearning).rank, 'manji');
  assert.equal(getRecord({ ...card, state: 'read3' }).rank, 'read2');
  assert.equal(isEligible(card, getRecord({ ...card, state: 'remember' }), 'read'), true);
});

test('record defaults and normalization give independent nested histories', () => {
  const source = { '1': { rank: 'fair', attempts: { 'ko-han': { right: 3, wrong: -1 } }, reading: { attempts: 2 } } };
  const record = getRecord(card, source);
  assert.equal(record.rank, 'fair');
  assert.deepEqual(record.attempts['ko-han'], { right: 3, wrong: 0, lastAt: null });
  assert.deepEqual(record.attempts['han-ko'], { right: 0, wrong: 0, lastAt: null });
  assert.deepEqual(record.reading, { attempts: 2, passedAt: null });
  assert.deepEqual(record.writing, { attempts: 0, passedAt: null });
  record.attempts['ko-han'].right = 100;
  assert.equal(source['1'].attempts['ko-han'].right, 3);
});

test('correct recalls progress early -> fair -> mastered, with direction-specific counts', () => {
  const start = getRecord(card);
  const first = recordRecall(start, 'ko-han', true, NOW);
  const second = recordRecall(first, 'han-ko', true, LATER);
  assert.equal(start.rank, 'required');
  assert.equal(start.attempts['ko-han'].right, 0);
  assert.equal(first.rank, 'fair');
  assert.equal(second.rank, 'mastered');
  assert.deepEqual(second.attempts['ko-han'], { right: 1, wrong: 0, lastAt: NOW });
  assert.deepEqual(second.attempts['han-ko'], { right: 1, wrong: 0, lastAt: LATER });
  for (const rank of ['required', 'next', 'later', 'manji']) {
    assert.equal(recordRecall(setRank(start, rank, NOW), 'ko-han', true, NOW).rank, 'fair');
  }
  for (const rank of ['mastered', 'read', 'read2']) {
    assert.equal(recordRecall(setRank(start, rank, NOW), 'ko-han', true, NOW).rank, rank);
  }
});

test('reading and writing checkpoints advance in sequence without changing recall counts', () => {
  const mastered = setRank(getRecord(card), 'mastered', NOW);
  const read = recordReading(mastered, true, NOW);
  assert.equal(read.rank, 'read');
  assert.deepEqual(read.reading, { attempts: 1, passedAt: NOW });
  assert.equal(read.writing.passedAt, null);
  const written = recordWriting(read, true, LATER);
  assert.equal(written.rank, 'read2');
  assert.deepEqual(written.writing, { attempts: 1, passedAt: LATER });
  assert.equal(written.reading.passedAt, NOW);
  assert.deepEqual(written.attempts, mastered.attempts);
  assert.equal(recordReading(getRecord(card), true, NOW).rank, 'required');
});

test('failure at any stage returns to manji and clears both pass markers, retaining counts', () => {
  const passed = recordWriting(recordReading(setRank(getRecord(card), 'mastered', NOW), true, NOW), true, NOW);
  const failures = [
    recordRecall(passed, 'ko-han', false, LATER),
    recordReading(passed, false, LATER),
    recordWriting(passed, false, LATER),
  ];
  for (const failed of failures) {
    assert.equal(failed.rank, 'manji');
    assert.equal(failed.reading.passedAt, null);
    assert.equal(failed.writing.passedAt, null);
    assert.equal(failed.updatedAt, LATER);
    assert.ok(failed.reading.attempts >= 1 && failed.writing.attempts >= 1);
  }
  assert.equal(failures[0].attempts['ko-han'].wrong, 1);
  assert.equal(failures[1].reading.attempts, 2);
  assert.equal(failures[2].writing.attempts, 2);
  assert.equal(passed.rank, 'read2');
  assert.equal(passed.reading.passedAt, NOW);
});

test('stage eligibility matches ranks exactly and manual rank selection preserves history', () => {
  const baseline = recordRecall(getRecord(card), 'han-ko', true, NOW);
  for (const rank of RANKS) {
    const record = setRank(baseline, rank.id, LATER);
    assert.equal(isEligible(card, record, 'all'), true);
    assert.equal(isEligible(card, record, 'recall'), ['manji', 'fair'].includes(rank.id));
    assert.equal(isEligible(card, record, 'read'), rank.id === 'mastered');
    assert.equal(isEligible(card, record, 'write'), rank.id === 'read');
    assert.equal(record.attempts['han-ko'].right, 1);
  }
  assert.equal(isEligible(card, null, 'read'), false);
  assert.equal(isEligible(card, baseline, 'unknown'), false);
  assert.throws(() => setRank(baseline, 'unknown'), /ランク/);
  assert.throws(() => recordRecall(baseline, 'unknown', true), /方向/);
});

test('Hangul comparison composes Unicode and ignores spaces without accepting near spellings', () => {
  assert.equal(matchHangul(' 가 \n', '가'), true);
  assert.equal(matchHangul('한 국 어', '한국어'), true);
  assert.equal(matchHangul('각', '가'), false);
  assert.equal(matchHangul('카', '가'), false);
  assert.equal(matchHangul('가', '각'), false);
  assert.equal(matchHangul('', ''), false);
  assert.equal(matchHangul(null, '가'), false);
});

test('legacy migration merges shared rank conservatively and retains direction attempts', () => {
  const cards = [card, { ...card, id: '2', state: '卍マジ' }, { ...card, id: '3', flagged: false }];
  const old = {
    'ko-han:1': { status: 'mastered', reviews: 20, reviewedAt: NOW },
    'han-ko:1': { status: 'review', reviews: 8, reviewedAt: LATER },
    'ko-han:2': { status: 'mastered', right: 4, wrong: 2, reviewedAt: NOW },
  };
  const migrated = migrateLegacy(cards, old);
  assert.equal(migrated['1'].rank, 'manji');
  assert.equal(migrated['1'].attempts['ko-han'].right, 1);
  assert.equal(migrated['1'].attempts['han-ko'].wrong, 1);
  assert.equal(migrated['1'].updatedAt, LATER);
  assert.equal(migrated['2'].rank, 'mastered');
  assert.deepEqual(migrated['2'].attempts['ko-han'], { right: 4, wrong: 2, lastAt: NOW });
  assert.equal(migrated['3'], undefined);
  assert.equal(getRecord(cards[2], migrated).rank, 'next');
  assert.equal(old['ko-han:1'].reviews, 20);
});

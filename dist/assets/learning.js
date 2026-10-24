/** Shared learning ranks. The rank belongs to a card, across both directions. */
export const RANKS = Object.freeze([
  { id: 'required', label: '優先', description: '優先して覚えたいカード' },
  { id: 'next', label: '次に学ぶ', description: '次に取り組むカード' },
  { id: 'later', label: 'あとで', description: 'あとで取り組むカード' },
  { id: 'manji', label: 'テスト待ち', description: '次の思い出すテストに出すカード' },
  { id: 'fair', label: '練習中', description: '思い出す練習で一度答えられたカード' },
  { id: 'mastered', label: '覚えた', description: '思い出せたので読みを確認するカード' },
  { id: 'read', label: '読むテスト済み', description: '読むテストを終え、書くテストに進むカード' },
  { id: 'read2', label: '定着', description: '書くテストまで確認できたカード' },
].map(Object.freeze));

const DIRECTIONS = ['ko-han', 'han-ko'];
const EARLY_RANKS = new Set(['required', 'next', 'later', 'manji']);
const STAGES = Object.freeze({ recall: new Set(['manji', 'fair']), read: new Set(['mastered']), write: new Set(['read']) });
const clean = (value) => String(value ?? '').normalize('NFC').trim();
// Keep existing browser records and the two original spreadsheets readable.
// These source aliases never appear as the public-facing rank labels.
const LEGACY_RANKS = new Map([
  ['必須！', 'required'], ['必須', 'required'], ['必須!', 'required'], ['！', 'required'], ['!', 'required'],
  ['次', 'next'], ['卍マジ', 'manji'], ['卍GO', 'manji'], ['卍行け', 'manji'],
  ['まあまあ', 'fair'], ['書ける', 'read2'], ['read3', 'read2'],
  ['remember', 'mastered'], ['パス', 'later'],
]);

function rankId(value) {
  const candidate = clean(value);
  return RANKS.find((rank) => rank.id === candidate || rank.label === candidate)?.id
    ?? LEGACY_RANKS.get(candidate) ?? null;
}

/** Explicit sheet state takes precedence over the original ！ flag. */
export function initialRank(card) {
  return rankId(card?.state) ?? (card?.flagged ? 'required' : 'next');
}

const counter = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const storedTime = (value) => typeof value === 'string' && value ? value : null;
function time(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'number' && Number.isFinite(now)) return new Date(now).toISOString();
  return storedTime(now) ?? new Date().toISOString();
}

/** Fresh nested objects keep updates independent of the stored record. */
function normalizeRecord(value, fallbackRank = 'next') {
  const record = object(value);
  const attempts = object(record.attempts);
  const normalizedAttempts = {};
  for (const direction of DIRECTIONS) {
    const attempt = object(attempts[direction]);
    normalizedAttempts[direction] = {
      ...attempt,
      right: counter(attempt.right),
      wrong: counter(attempt.wrong),
      lastAt: storedTime(attempt.lastAt),
    };
  }
  const checkpoint = (value) => {
    const source = object(value);
    return { ...source, attempts: counter(source.attempts), passedAt: storedTime(source.passedAt) };
  };
  return {
    ...record,
    rank: rankId(record.rank) ?? fallbackRank,
    attempts: normalizedAttempts,
    reading: checkpoint(record.reading),
    writing: checkpoint(record.writing),
    updatedAt: storedTime(record.updatedAt),
  };
}

/** Records are keyed by stable card.id, without direction in that shared key. */
export function getRecord(card, records = {}) {
  const allRecords = object(records);
  const record = card && Object.hasOwn(allRecords, card.id) ? allRecords[card.id] : undefined;
  return normalizeRecord(record, initialRank(card));
}

export function setRank(record, rank, now) {
  const selected = rankId(rank);
  if (!selected) throw new RangeError('学習ランクが正しくありません。');
  return { ...normalizeRecord(record), rank: selected, updatedAt: time(now) };
}

function requireBoolean(value) {
  if (typeof value !== 'boolean') throw new TypeError('判定はtrueまたはfalseで指定してください。');
}

function clearPasses(record) {
  record.reading.passedAt = null;
  record.writing.passedAt = null;
  return record;
}

/** A correct recall advances early ranks to fair, then fair to mastered. */
export function recordRecall(record, direction, outcome, now) {
  if (!DIRECTIONS.includes(direction)) throw new RangeError('学習方向が正しくありません。');
  requireBoolean(outcome);
  const next = normalizeRecord(record);
  const timestamp = time(now);
  const attempt = next.attempts[direction];
  attempt[outcome ? 'right' : 'wrong'] += 1;
  attempt.lastAt = timestamp;
  if (!outcome) { next.rank = 'manji'; clearPasses(next); }
  else if (EARLY_RANKS.has(next.rank)) next.rank = 'fair';
  else if (next.rank === 'fair') next.rank = 'mastered';
  next.updatedAt = timestamp;
  return next;
}

/** Reading is the checkpoint after mastered; passing it unlocks writing. */
export function recordReading(record, passed, now) {
  requireBoolean(passed);
  const next = normalizeRecord(record);
  const timestamp = time(now);
  next.reading.attempts += 1;
  if (!passed) { next.rank = 'manji'; clearPasses(next); }
  else if (['mastered', 'read', 'read2'].includes(next.rank)) {
    if (next.rank !== 'read2') next.rank = 'read';
    next.reading.passedAt = timestamp;
  }
  next.updatedAt = timestamp;
  return next;
}

/** The caller selects eligible read cards before recording a writing attempt. */
export function recordWriting(record, passed, now) {
  requireBoolean(passed);
  const next = normalizeRecord(record);
  const timestamp = time(now);
  next.writing.attempts += 1;
  if (passed) { next.rank = 'read2'; next.writing.passedAt = timestamp; }
  else { next.rank = 'manji'; clearPasses(next); }
  next.updatedAt = timestamp;
  return next;
}

export function isEligible(card, record, stage = 'all') {
  if (stage === 'all') return true;
  const eligibleRanks = STAGES[stage];
  if (!eligibleRanks) return false;
  return eligibleRanks.has(normalizeRecord(record, initialRank(card)).rank);
}

/** Only Unicode composition and whitespace are ignored; spelling stays exact. */
export function matchHangul(input, expected) {
  const comparable = (value) => clean(value).replace(/\s+/gu, '');
  const target = comparable(expected);
  return Boolean(target) && comparable(input) === target;
}

/**
 * Migrate the earlier direction-specific local history once. A review rating in
 * either direction takes priority, because that card still needs practice.
 * Old reviews had no historical right/wrong split, so only the last known result
 * is counted unless the old record already supplies explicit right/wrong counts.
 */
export function migrateLegacy(cards, oldProgress = {}) {
  const legacy = object(oldProgress);
  const records = {};
  for (const card of cards) {
    let result = getRecord(card);
    let hasReview = false;
    let hasMastered = false;
    let hasRating = false;
    const timestamps = [];
    for (const direction of DIRECTIONS) {
      const key = `${direction}:${card.id}`;
      if (!Object.hasOwn(legacy, key)) continue;
      const oldValue = legacy[key];
      const old = typeof oldValue === 'string' ? { status: oldValue } : object(oldValue);
      const isReview = ['review', 'retry', 'again'].includes(old.status);
      const isMastered = ['mastered', 'known', 'learned'].includes(old.status);
      if (!isReview && !isMastered) continue;
      hasRating = true;
      hasReview ||= isReview;
      hasMastered ||= isMastered;
      const timestamp = storedTime(old.reviewedAt) ?? storedTime(old.lastAt);
      result.attempts[direction] = {
        right: old.right == null ? Number(isMastered) : counter(old.right),
        wrong: old.wrong == null ? Number(isReview) : counter(old.wrong),
        lastAt: timestamp,
      };
      if (timestamp) timestamps.push(timestamp);
    }
    if (hasRating) {
      result.rank = hasReview ? 'manji' : hasMastered ? 'mastered' : result.rank;
      result.updatedAt = timestamps.sort().at(-1) ?? null;
      records[card.id] = result;
    }
  }
  return records;
}

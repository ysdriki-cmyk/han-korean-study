import { getRecord } from './learning.js';

/** Self-assessments are independent for recognition and writing. */
export const RATINGS = Object.freeze([
  { id: 'hard', symbol: '❌❌❌', label: '全く思い出せない' },
  { id: 'again', symbol: '❌', label: '思い出せない' },
  { id: 'unsure', symbol: '△', label: 'あいまい' },
  { id: 'good', symbol: '○', label: 'できた' },
  { id: 'solid', symbol: '◎', label: '自信あり' },
].map(Object.freeze));
export const UNSEEN = Object.freeze({ id: 'unseen', symbol: '—', label: '未演習' });

const RATING_IDS = new Set([...RATINGS.map(item => item.id), UNSEEN.id]);
const MODES = new Set(['read', 'write']);
const DAY = 24 * 60 * 60 * 1000;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const counter = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0;
const modeKey = mode => mode === 'write' ? 'write' : 'read';
const timestamp = value => {
  const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) ? result : null;
};

function normalizedAssessment(value) {
  const source = object(value);
  return {
    ...source,
    rating: RATING_IDS.has(source.rating) ? source.rating : UNSEEN.id,
    attempts: counter(source.attempts),
    correct: counter(source.correct),
    wrong: counter(source.wrong),
    lastAt: timestamp(source.lastAt) === null ? null : source.lastAt,
    history: Array.isArray(source.history) ? source.history.map(event => ({ ...object(event) })) : [],
  };
}

/** Existing sheet/browser ranks remain readable without inventing dated events. */
export function ratingFor(card, records = {}, mode = 'read') {
  const record = getRecord(card, records);
  const selected = object(object(record.assessments)[modeKey(mode)]).rating;
  if (RATING_IDS.has(selected)) return selected;
  if (modeKey(mode) === 'write') {
    if (record.writing.passedAt || record.rank === 'read2') return 'solid';
    return record.writing.attempts > 0 ? 'again' : 'unseen';
  }
  return ({ manji: 'again', fair: 'unsure', mastered: 'good', read: 'good', read2: 'solid' })[record.rank] || 'unseen';
}

/**
 * Append one actual attempt. A post-grading self-rating uses countAttempt:false
 * to revise only the latest rating, retaining its objective result and time.
 */
export function recordAssessment(record, mode, rating, { correct = null, now, countAttempt = true } = {}) {
  if (!MODES.has(mode)) throw new RangeError('演習モードが正しくありません。');
  if (!RATING_IDS.has(rating)) throw new RangeError('評価が正しくありません。');
  if (correct !== null && typeof correct !== 'boolean') throw new TypeError('採点結果はtrue、false、nullで指定してください。');
  const source = object(record);
  const assessments = Object.fromEntries(Object.entries(object(source.assessments)).map(([key, value]) => [key, normalizedAssessment(value)]));
  const current = normalizedAssessment(assessments[mode]);
  current.rating = rating;
  const at = new Date(timestamp(now) ?? Date.now()).toISOString();
  if (countAttempt) {
    current.attempts += 1;
    current.correct += Number(correct === true);
    current.wrong += Number(correct === false);
    current.lastAt = at;
    current.history.push({ rating, correct, at });
  } else if (current.history.length) {
    current.history[current.history.length - 1] = { ...current.history.at(-1), rating };
  }
  assessments[mode] = current;
  return { ...source, assessments, updatedAt: at };
}

function lastAttemptTime(record, mode) {
  const assessment = object(object(record.assessments)[mode]);
  const values = [assessment.lastAt];
  if (mode === 'write') values.push(object(record.writing).passedAt, object(object(record.attempts)['han-ko']).lastAt);
  else values.push(object(object(record.attempts)['ko-han']).lastAt);
  const times = values.map(timestamp).filter(value => value !== null);
  return times.length ? Math.max(...times) : null;
}

/** Filters apply to the current mode, preserving all cards and records. */
export function filterAssessments(cards, records = {}, settings = {}, now = Date.now()) {
  const { mode = 'read', ratings, recentMistakesDays = 0, excludeRecentDays = 0 } = object(settings);
  const selectedMode = modeKey(mode);
  const selectedRatings = Array.isArray(ratings) ? new Set(ratings.filter(id => RATING_IDS.has(id))) : null;
  const nowTime = timestamp(now) ?? Date.now();
  const mistakeDays = Number(recentMistakesDays) > 0 ? Number(recentMistakesDays) : 0;
  const exclusionDays = Number(excludeRecentDays) > 0 ? Number(excludeRecentDays) : 0;
  return cards.filter(card => {
    if (selectedRatings && !selectedRatings.has(ratingFor(card, records, selectedMode))) return false;
    const record = getRecord(card, records);
    if (mistakeDays) {
      const history = object(object(record.assessments)[selectedMode]).history;
      const hasMistake = Array.isArray(history) && history.some(event => {
        const item = object(event), at = timestamp(item.at);
        return (item.correct === false || ['hard', 'again'].includes(item.rating))
          && at !== null && at >= nowTime - mistakeDays * DAY && at <= nowTime;
      });
      if (!hasMistake) return false;
    }
    if (exclusionDays) {
      const at = lastAttemptTime(record, selectedMode);
      if (at !== null && at >= nowTime - exclusionDays * DAY && at <= nowTime) return false;
    }
    return true;
  });
}

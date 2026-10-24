import { getRecord } from './learning.js';

const DAY = 24 * 60 * 60 * 1000;
const MODES = new Set(['read', 'write']);
const RATINGS = new Set(['hard', 'again', 'unsure', 'good', 'solid', 'unseen']);
const INTERVALS = Object.freeze({ good: [1, 3, 7, 14, 30], solid: [3, 7, 14, 30, 60] });
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const timestamp = value => {
  const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(result) ? result : null;
};
const nowTime = value => timestamp(value) ?? Date.now();
function requireMode(mode) {
  if (!MODES.has(mode)) throw new RangeError('演習モードが正しくありません。');
}

/** A graded miss is still a miss when the learner chooses a confident rating. */
function successful(event) {
  const source = object(event);
  return source.correct !== false && ['good', 'solid'].includes(source.rating);
}
function calculatedSchedule(assessment, rating, now) {
  const source = object(assessment);
  const history = Array.isArray(source.history) ? source.history : [];
  const latest = object(history.at(-1));
  const anchor = timestamp(latest.at) ?? timestamp(source.lastAt) ?? nowTime(now);
  let intervalDays = 0;
  if (latest.correct !== false) {
    if (rating === 'unsure') intervalDays = 1;
    else if (INTERVALS[rating]) {
      let streak = 0;
      for (let index = history.length - 1; index >= 0 && successful(history[index]); index -= 1) streak += 1;
      // An explicitly rated record without dated history starts at the first interval.
      const intervals = INTERVALS[rating];
      intervalDays = intervals[Math.min(Math.max(0, streak - 1), intervals.length - 1)];
    }
  }
  return { dueAt: new Date(anchor + intervalDays * DAY).toISOString(), intervalDays };
}

/**
 * Return a saved schedule, or derive one from an existing dated assessment.
 * Undated legacy ranks have no inferred review date and are available now.
 */
export function nextReviewFor(record, mode = 'read', now = Date.now()) {
  requireMode(mode);
  const assessment = object(object(object(record).assessments)[mode]);
  const storedDue = timestamp(assessment.dueAt);
  if (storedDue !== null) {
    return {
      dueAt: new Date(storedDue).toISOString(),
      intervalDays: Number.isFinite(Number(assessment.intervalDays)) && Number(assessment.intervalDays) >= 0 ? Number(assessment.intervalDays) : 0,
    };
  }
  const history = Array.isArray(assessment.history) ? assessment.history : [];
  const hasDatedAttempt = timestamp(object(history.at(-1)).at) !== null || timestamp(assessment.lastAt) !== null;
  if (!hasDatedAttempt) return { dueAt: null, intervalDays: 0 };
  return calculatedSchedule(assessment, RATINGS.has(assessment.rating) ? assessment.rating : 'unseen', now);
}

/** Review eligibility is independent for writing and reading. */
export function reviewDue(card, records = {}, mode = 'read', now = Date.now()) {
  const { dueAt } = nextReviewFor(getRecord(card, records), mode, now);
  const due = timestamp(dueAt);
  return due === null || due <= nowTime(now);
}

/**
 * Apply after recordAssessment, including a countAttempt:false confidence edit.
 * The latest event, rather than a previous computed due date, determines the
 * interval, so changing confidence never counts another successful attempt.
 */
export function applyReviewSchedule(record, mode, rating, now = Date.now()) {
  requireMode(mode);
  if (!RATINGS.has(rating)) throw new RangeError('評価が正しくありません。');
  const source = object(record);
  const assessments = object(source.assessments);
  const assessment = object(assessments[mode]);
  const schedule = calculatedSchedule(assessment, rating, now);
  return {
    ...source,
    assessments: {
      ...assessments,
      [mode]: {
        ...assessment,
        history: Array.isArray(assessment.history) ? assessment.history.map(event => ({ ...object(event) })) : [],
        ...schedule,
      },
    },
  };
}

/**
 * Insert one bounded retry after a few other cards. At the end of a short set,
 * use every available intervening card rather than adding fabricated filler.
 * A pending retry is reused; each card can occur at most 1 + maxRepeats times.
 */
export function insertRetry(queue, position, card, rating, { maxRepeats = 2 } = {}) {
  if (!Array.isArray(queue)) throw new TypeError('演習キューが正しくありません。');
  if (!Number.isInteger(position) || position < 0 || position >= queue.length) throw new RangeError('演習位置が正しくありません。');
  if (!card || typeof card.id !== 'string' || !card.id) throw new TypeError('カードIDが必要です。');
  if (!Number.isInteger(maxRepeats) || maxRepeats < 0) throw new RangeError('再出題回数が正しくありません。');
  const copied = [...queue];
  const unchanged = { queue: copied, inserted: false, at: null };
  if (!['hard', 'again'].includes(rating)) return unchanged;
  const occurrences = queue.filter(item => item?.id === card.id).length;
  if (occurrences >= maxRepeats + 1 || queue.slice(position + 1).some(item => item?.id === card.id)) return unchanged;
  const gap = rating === 'hard' ? 3 : 5;
  const at = Math.min(queue.length, position + 1 + gap);
  copied.splice(at, 0, card);
  return { queue: copied, inserted: true, at };
}

import { getRecord } from './learning.js';

const DAY = 24 * 60 * 60 * 1000;
const MODES = new Set(['read', 'write']);
const RATINGS = new Set(['hard', 'again', 'unsure', 'good', 'solid', 'unseen']);
const MISTAKE_INTERVAL_DAYS = 2;
const RECALL_INTERVAL_DAYS = 5;
const INTERVALS = Object.freeze({ good: [5, 7, 14, 30, 60], solid: [5, 14, 30, 60, 90] });
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
function mistakeReviewAt(assessment) {
  const source = object(assessment);
  const history = Array.isArray(source.history) ? source.history : [];
  const mistakes = history.filter(event => object(event).correct === false || ['hard', 'again'].includes(object(event).rating))
    .map(event => timestamp(object(event).at)).filter(at => at !== null);
  // Older records may have a rating and timestamp without an event history.
  if (['hard', 'again'].includes(source.rating) && timestamp(source.lastAt) !== null) mistakes.push(timestamp(source.lastAt));
  return mistakes.length ? Math.max(...mistakes) + MISTAKE_INTERVAL_DAYS * DAY : null;
}
function withMistakeInterval(schedule, assessment) {
  const floor = mistakeReviewAt(assessment);
  if (floor === null || timestamp(schedule.dueAt) >= floor) return schedule;
  const source = object(assessment), history = Array.isArray(source.history) ? source.history : [];
  const anchor = timestamp(object(history.at(-1)).at) ?? timestamp(source.lastAt) ?? floor - MISTAKE_INTERVAL_DAYS * DAY;
  return { dueAt: new Date(floor).toISOString(), intervalDays: Math.ceil((floor - anchor) / DAY) };
}
function withRecallInterval(schedule, assessment, rating) {
  const source = object(assessment), history = Array.isArray(source.history) ? source.history : [];
  const latest = object(history.at(-1));
  const anchor = timestamp(latest.at) ?? timestamp(source.lastAt);
  // Reinterpret older short schedules from the original attempt, without a storage migration.
  if (anchor === null || latest.correct === false || !['unsure', 'good', 'solid'].includes(rating)) return schedule;
  const floor = anchor + RECALL_INTERVAL_DAYS * DAY;
  return timestamp(schedule.dueAt) >= floor ? schedule : { dueAt: new Date(floor).toISOString(), intervalDays: RECALL_INTERVAL_DAYS };
}

function calculatedSchedule(assessment, rating, now) {
  const source = object(assessment);
  const history = Array.isArray(source.history) ? source.history : [];
  const latest = object(history.at(-1));
  const anchor = timestamp(latest.at) ?? timestamp(source.lastAt) ?? nowTime(now);
  let intervalDays = 0;
  if (latest.correct === false || ['hard', 'again'].includes(rating)) intervalDays = MISTAKE_INTERVAL_DAYS;
  else {
    if (rating === 'unsure') intervalDays = RECALL_INTERVAL_DAYS;
    else if (INTERVALS[rating]) {
      let streak = 0;
      for (let index = history.length - 1; index >= 0 && successful(history[index]); index -= 1) streak += 1;
      // An explicitly rated record without dated history starts at the first interval.
      const intervals = INTERVALS[rating];
      intervalDays = intervals[Math.min(Math.max(0, streak - 1), intervals.length - 1)];
    }
  }
  return withMistakeInterval({ dueAt: new Date(anchor + intervalDays * DAY).toISOString(), intervalDays }, assessment);
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
    return withRecallInterval(withMistakeInterval({
      dueAt: new Date(storedDue).toISOString(),
      intervalDays: Number.isFinite(Number(assessment.intervalDays)) && Number(assessment.intervalDays) >= 0 ? Number(assessment.intervalDays) : 0,
    }, assessment), assessment, assessment.rating);
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

/** The minimum break also applies when a card is explicitly selected in the library. */
export function mistakeCoolingDown(card, records = {}, mode = 'read', now = Date.now()) {
  requireMode(mode);
  const assessment = object(object(getRecord(card, records).assessments)[mode]);
  const due = mistakeReviewAt(assessment);
  return due !== null && due > nowTime(now);
}

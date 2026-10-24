import { RANKS, getRecord } from './learning.js';
import { RATINGS, filterAssessments, ratingFor } from './assessment.js';
import { essentialKanji } from './kanji.js';
import { reviewDue } from './review.js';

const FILTERS = new Set(['all', 'review', ...RANKS.map(rank => rank.id)]);
const RATING_IDS = [...RATINGS.map(item => item.id), 'unseen'];
const DEFAULT_RATINGS = ['hard', 'again', 'unseen'];
const SCHEDULED_RATINGS = ['unsure', 'good', 'solid'];
const oldRatings = filter => ({ all: RATING_IDS, review: ['hard', 'again', 'unsure'], manji: ['hard', 'again'], fair: ['unsure'], mastered: ['good'], read: ['good'], read2: ['solid'], required: ['unseen'], next: ['unseen'], later: ['unseen'] })[filter] || DEFAULT_RATINGS;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** An explicit previous choice is retained; new learners begin with writing. */
export function resolvePracticeMode(preference = {}) {
  const source = object(preference);
  if (source.mode === 'read' || source.mode === 'write') return source.mode;
  if (source.stage === 'write') return 'write';
  if (source.stage === 'read') return 'read';
  if (source.stage === 'recall') return source.direction === 'han-ko' ? 'write' : 'read';
  return 'write';
}

export function practiceSettings(preference = {}) {
  const source = object(preference);
  return {
    mode: resolvePracticeMode(source),
    filter: FILTERS.has(source.filter) ? source.filter : 'all',
    limit: ['10', '20', '30', '50', 'all'].includes(String(source.limit)) ? String(source.limit) : '30',
    shuffle: source.shuffle !== false,
    libraryDirection: source.libraryDirection === 'han-ko' ? 'han-ko' : 'ko-han',
    ratings: Array.isArray(source.ratings) ? RATING_IDS.filter(id => source.ratings.includes(id)) : [...oldRatings(source.filter)],
    recentMistakesDays: [7, 14, 30, 90].includes(Number(source.recentMistakesDays)) ? Number(source.recentMistakesDays) : 0,
    excludeRecentDays: [3, 7, 14, 30, 90].includes(Number(source.excludeRecentDays)) ? Number(source.excludeRecentDays) : 0,
    scope: source.scope === 'all' ? 'all' : 'essential',
    includeDue: source.includeDue !== false,
  };
}

/** Start the requested defaults once; later v4 saves keep the learner's choices. */
export function restorePracticePreferences(current, previous = null) {
  const saved = object(current);
  if (saved.version === 4 && saved.courses && typeof saved.courses === 'object' && !Array.isArray(saved.courses)) {
    return {
      ...saved,
      version: 4,
      deckId: ['kanji', 'vocabulary'].includes(saved.deckId) ? saved.deckId : 'kanji',
      courses: {
        ...saved.courses,
        kanji: practiceSettings(saved.courses.kanji),
        vocabulary: practiceSettings(saved.courses.vocabulary),
      },
    };
  }
  const legacy = object(previous ?? current);
  return {
    version: 4,
    deckId: 'kanji',
    courses: Object.fromEntries(['kanji', 'vocabulary'].map(id => [id, practiceSettings({ libraryDirection: object(object(legacy.courses)[id]).libraryDirection })])),
  };
}

function hasDatedAssessment(record, mode) {
  const assessment = object(object(record.assessments)[mode]);
  const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  return validTime(assessment.dueAt) || validTime(assessment.lastAt)
    || (Array.isArray(assessment.history) && assessment.history.some(event => validTime(object(event).at)));
}

/** Scope and due dates select a pool without modifying cards or learning records. */
export function practicePool(cards, records = {}, settings = {}, now = Date.now()) {
  const source = object(settings);
  const { filter = 'all', mode = 'read' } = source;
  const scoped = source.scope === 'all' ? [...cards] : cards.filter(card => (card.deckId !== 'kanji' && source.deckId !== 'kanji') || essentialKanji(card));
  if (Array.isArray(source.ratings)) {
    if (!source.ratings.length) return [];
    const selectedMode = mode === 'write' ? 'write' : 'read';
    const selected = filterAssessments(scoped, records, source, now);
    const included = new Set(selected.map(card => card.id));
    if (source.includeDue !== false) {
      const dueCandidates = filterAssessments(scoped, records, { ...source, ratings: SCHEDULED_RATINGS }, now);
      for (const card of dueCandidates) {
        if (hasDatedAssessment(getRecord(card, records), selectedMode) && reviewDue(card, records, selectedMode, now)) included.add(card.id);
      }
    }
    return scoped.filter(card => {
      if (!included.has(card.id)) return false;
      const rating = ratingFor(card, records, selectedMode);
      return !SCHEDULED_RATINGS.includes(rating) || !hasDatedAssessment(getRecord(card, records), selectedMode) || reviewDue(card, records, selectedMode, now);
    });
  }
  // Retain raw legacy rank-filter calls for integrations using the older API.
  if (!FILTERS.has(filter) || filter === 'all') return scoped;
  return scoped.filter(card => {
    const rank = getRecord(card, records).rank;
    return filter === 'review' ? rank === 'manji' || rank === 'fair' : rank === filter;
  });
}

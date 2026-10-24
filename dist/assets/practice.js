import { RANKS, getRecord } from './learning.js';
import { RATINGS, filterAssessments } from './assessment.js';

const FILTERS = new Set(['all', 'review', ...RANKS.map(rank => rank.id)]);
const RATING_IDS = [...RATINGS.map(item => item.id), 'unseen'];
const oldRatings = filter => ({ review: ['hard', 'again', 'unsure'], manji: ['hard', 'again'], fair: ['unsure'], mastered: ['good'], read: ['good'], read2: ['solid'], required: ['unseen'], next: ['unseen'], later: ['unseen'] })[filter] || RATING_IDS;

/** Preserve v3 preferences while replacing the old stages with two modes. */
export function resolvePracticeMode(preference = {}) {
  if (!preference || typeof preference !== 'object') preference = {};
  if (preference.mode === 'read' || preference.mode === 'write') return preference.mode;
  if (preference.stage === 'write') return 'write';
  if (preference.stage === 'read') return 'read';
  return preference.stage === 'recall' && preference.direction === 'han-ko' ? 'write' : 'read';
}

export function practiceSettings(preference = {}) {
  if (!preference || typeof preference !== 'object') preference = {};
  return {
    mode: resolvePracticeMode(preference),
    filter: FILTERS.has(preference.filter) ? preference.filter : 'all',
    limit: ['10', '20', '50', 'all'].includes(String(preference.limit)) ? String(preference.limit) : '10',
    shuffle: preference.shuffle === true,
    libraryDirection: preference.libraryDirection === 'han-ko' ? 'han-ko' : 'ko-han',
    ratings: Array.isArray(preference.ratings) ? RATING_IDS.filter(id => preference.ratings.includes(id)) : [...oldRatings(preference.filter)],
    recentMistakesDays: [7, 14, 30, 90].includes(Number(preference.recentMistakesDays)) ? Number(preference.recentMistakesDays) : 0,
    excludeRecentDays: [3, 7, 14, 30, 90].includes(Number(preference.excludeRecentDays)) ? Number(preference.excludeRecentDays) : 0,
  };
}

/** Mode never limits eligibility: ranks are optional filters, not prerequisites. */
export function practicePool(cards, records = {}, settings = {}) {
  const { filter = 'all', mode = 'read' } = settings;
  if (Array.isArray(settings.ratings)) return filterAssessments(cards, records, settings);
  // Both valid modes intentionally use the same pool.
  void mode;
  if (!FILTERS.has(filter) || filter === 'all') return [...cards];
  return cards.filter(card => {
    const rank = getRecord(card, records).rank;
    return filter === 'review' ? rank === 'manji' || rank === 'fair' : rank === filter;
  });
}

import { RANKS, getRecord } from './learning.js';
import { makeSession } from './core.js';
import { RATINGS, filterAssessments } from './assessment.js';
import { essentialKanji } from './kanji.js';
import { reviewDue } from './review.js?v=3';

const FILTERS = new Set(['all', 'review', ...RANKS.map(rank => rank.id)]);
const RATING_IDS = [...RATINGS.map(item => item.id), 'unseen'];
const DEFAULT_RATINGS = ['hard', 'again', 'unseen'];
const SCHEDULED_RATINGS = ['unsure', 'good', 'solid'];
const oldRatings = filter => ({ all: RATING_IDS, review: ['hard', 'again', 'unsure'], manji: ['hard', 'again'], fair: ['unsure'], mastered: ['good'], read: ['good'], read2: ['solid'], required: ['unseen'], next: ['unseen'], later: ['unseen'] })[filter] || DEFAULT_RATINGS;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0;
const timestamp = value => {
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Count actual recorded encounters, independently for each deck and direction. */
export function practiceCount(card, records = {}, mode = 'read') {
  const record = getRecord(card, records), selected = mode === 'write' ? 'write' : 'read';
  const assessment = object(object(record.assessments)[selected]);
  const history = Array.isArray(assessment.history) ? assessment.history : [];
  const recall = object(record.attempts[selected === 'write' ? 'han-ko' : 'ko-han']);
  return Math.max(count(assessment.attempts), history.length) + count(recall.right) + count(recall.wrong) + count(record[selected === 'write' ? 'writing' : 'reading'].attempts);
}

/** Source ranks and future due dates never invent a recent practice event. */
export function lastPracticeAt(card, records = {}, mode = 'read') {
  const record = getRecord(card, records), selected = mode === 'write' ? 'write' : 'read';
  const assessment = object(object(record.assessments)[selected]);
  const history = Array.isArray(assessment.history) ? assessment.history : [];
  const values = [assessment.lastAt, ...history.map(event => object(event).at), record.attempts[selected === 'write' ? 'han-ko' : 'ko-han'].lastAt, record[selected === 'write' ? 'writing' : 'reading'].passedAt];
  const times = values.map(timestamp).filter(value => value !== null);
  return times.length ? Math.max(...times) : null;
}

/** Select low-count cards before applying the limit; randomize only equal counts. */
export function makePracticeSession(cards, records = {}, settings = {}, { random = Math.random } = {}) {
  const limit = settings.limit ?? '30';
  const size = limit === 'all' || limit === Infinity ? Infinity : Number(limit);
  if (size !== Infinity && (!Number.isInteger(size) || size < 0)) throw new RangeError('学習枚数は0以上の整数またはallを指定してください。');
  const groups = new Map(), result = [];
  for (const card of cards) {
    const attempts = practiceCount(card, records, settings.mode);
    if (!groups.has(attempts)) groups.set(attempts, []);
    groups.get(attempts).push(card);
  }
  for (const attempts of [...groups.keys()].sort((a, b) => a - b)) {
    if (result.length >= size) break;
    result.push(...makeSession(groups.get(attempts), { limit: size === Infinity ? 'all' : size - result.length, shuffle: settings.shuffle !== false, random }));
  }
  return result;
}

/** Explicit choices win; word/sentence practice starts with reading, kanji with writing. */
export function resolvePracticeMode(preference = {}, deckId = 'kanji') {
  const source = object(preference);
  if (source.mode === 'read' || source.mode === 'write') return source.mode;
  if (source.stage === 'write') return 'write';
  if (source.stage === 'read') return 'read';
  if (source.stage === 'recall') return source.direction === 'han-ko' ? 'write' : 'read';
  return deckId === 'vocabulary' || deckId === 'sentence' ? 'read' : 'write';
}

export function practiceSettings(preference = {}, deckId = 'kanji') {
  const source = object(preference);
  return {
    mode: resolvePracticeMode(source, deckId),
    sessionType: source.sessionType === 'review' ? 'review' : 'practice',
    reviewDays: source.reviewDays !== null && source.reviewDays !== '' && [0, 1, 7, 30].includes(Number(source.reviewDays)) ? Number(source.reviewDays) : 7,
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

const BASIC_FIELDS = ['ratings', 'limit', 'shuffle', 'includeDue', 'recentMistakesDays', 'excludeRecentDays', 'reviewDays'];

/** Basic question criteria can be shared without changing direction, session type or selected sets. */
export function sharedPracticeSettings(preference = {}) {
  const normalized = practiceSettings(preference);
  return Object.fromEntries(BASIC_FIELDS.map(key => [key, normalized[key]]));
}

/** Common saves explicitly align all courses; individual saves keep the common template intact. */
export function applyPracticeSettings(preferences, draft, { target = 'common', deckId = 'kanji' } = {}) {
  if (!['common', 'course'].includes(target) || !['kanji', 'vocabulary', 'sentence'].includes(deckId)) throw new RangeError('設定の適用先を確認してください。');
  const source = restorePracticePreferences(preferences);
  const basic = sharedPracticeSettings(draft);
  const courses = { ...source.courses };
  for (const id of target === 'common' ? ['kanji', 'vocabulary', 'sentence'] : [deckId]) {
    courses[id] = practiceSettings({ ...courses[id], ...basic, filter: 'all' }, id);
  }
  return { ...source, courses, ...(target === 'common' ? { commonPractice: basic } : {}) };
}

/** Apply the reading-first defaults once; later saves retain explicit mode choices. */
export function restorePracticePreferences(current, previous = null) {
  const saved = object(current);
  if (saved.version === 4 && saved.courses && typeof saved.courses === 'object' && !Array.isArray(saved.courses)) {
    return {
      ...saved,
      version: 4,
      modeDefaultsVersion: 1,
      deckId: ['kanji', 'vocabulary', 'sentence'].includes(saved.deckId) ? saved.deckId : 'kanji',
      courses: {
        ...saved.courses,
        kanji: practiceSettings(saved.courses.kanji, 'kanji'),
        vocabulary: practiceSettings(saved.modeDefaultsVersion === 1 ? saved.courses.vocabulary : { ...object(saved.courses.vocabulary), mode: 'read' }, 'vocabulary'),
        sentence: practiceSettings(saved.modeDefaultsVersion === 1 ? saved.courses.sentence : { ...object(saved.courses.sentence), mode: 'read' }, 'sentence'),
      },
    };
  }
  const legacy = object(previous ?? current);
  return {
    version: 4,
    modeDefaultsVersion: 1,
    deckId: 'kanji',
    courses: Object.fromEntries(['kanji', 'vocabulary', 'sentence'].map(id => [id, practiceSettings({ libraryDirection: object(object(legacy.courses)[id]).libraryDirection }, id)])),
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
  if (source.sessionType === 'review') {
    const current = timestamp(now) ?? Date.now();
    const days = practiceSettings(source).reviewDays;
    return scoped.filter(card => {
      const at = lastPracticeAt(card, records, mode);
      return at !== null && at <= current && (days === 0 || at >= current - days * 86400000);
    });
  }
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
      return !hasDatedAssessment(getRecord(card, records), selectedMode) || reviewDue(card, records, selectedMode, now);
    });
  }
  // Retain raw legacy rank-filter calls for integrations using the older API.
  if (!FILTERS.has(filter) || filter === 'all') return scoped;
  return scoped.filter(card => {
    const rank = getRecord(card, records).rank;
    return filter === 'review' ? rank === 'manji' || rank === 'fair' : rank === filter;
  });
}

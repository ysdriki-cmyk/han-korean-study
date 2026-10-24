import { RANKS, getRecord } from './learning.js';

const FILTERS = new Set(['all', 'review', ...RANKS.map(rank => rank.id)]);

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
  };
}

/** Mode never limits eligibility: ranks are optional filters, not prerequisites. */
export function practicePool(cards, records = {}, { filter = 'all', mode = 'read' } = {}) {
  // Both valid modes intentionally use the same pool.
  void mode;
  if (!FILTERS.has(filter) || filter === 'all') return [...cards];
  return cards.filter(card => {
    const rank = getRecord(card, records).rank;
    return filter === 'review' ? rank === 'manji' || rank === 'fair' : rank === filter;
  });
}

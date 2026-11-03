import { RATINGS, UNSEEN } from './assessment.js';
import { getRecord } from './learning.js';

const modes = new Set(['read', 'write']);
const ratings = new Set([...RATINGS.map(item => item.id), UNSEEN.id]);
const clone = value => JSON.parse(JSON.stringify(value));

/** Status organization is not an attempt: preserve counters, history and review dates. */
export function applyBulkRating(cards, records, ids, mode, rating, now = new Date().toISOString()) {
  if (!modes.has(mode)) throw new RangeError('演習モードを確認してください。');
  if (!ratings.has(rating)) throw new RangeError('ステータスを確認してください。');
  const selected = new Set(ids), handled = new Set(), next = { ...records }, edits = [];
  for (const card of cards) {
    if (!selected.has(card.id) || handled.has(card.id)) continue;
    handled.add(card.id);
    const before = Object.hasOwn(records, card.id) ? clone(records[card.id]) : undefined;
    const record = getRecord(card, records);
    const assessment = record.assessments?.[mode] || { attempts: 0, correct: 0, wrong: 0, lastAt: null, history: [] };
    const after = {
      ...record,
      assessments: {
        ...record.assessments,
        [mode]: { ...assessment, rating, ratingEditedAt: now },
      },
      updatedAt: now,
    };
    next[card.id] = clone(after);
    edits.push({ id: card.id, before, after: clone(after) });
  }
  return { records: next, edits };
}

/** Never overwrite a card that has since been studied or edited again. */
export function undoBulkRating(records, edits) {
  const next = { ...records };
  let restored = 0;
  for (const edit of edits) {
    if (JSON.stringify(records[edit.id]) !== JSON.stringify(edit.after)) continue;
    if (edit.before === undefined) delete next[edit.id];
    else next[edit.id] = clone(edit.before);
    restored += 1;
  }
  return { records: next, restored };
}

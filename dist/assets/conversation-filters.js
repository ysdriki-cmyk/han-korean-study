import { categoryLabels } from './sheet-fields.js';
import { practiceCount } from './practice.js?v=18';

const FIELDS = Object.freeze(['speechStyle', 'audience', 'priority', 'role', 'speaker', 'wordTag']);
const clean = value => typeof value === 'string' ? value.normalize('NFKC').trim() : '';
const key = value => clean(value).toLocaleLowerCase('ja-JP');
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
const validLessons = lessons => Array.isArray(lessons)
  ? lessons.filter(lesson => lesson && typeof lesson === 'object' && Array.isArray(lesson.cards) && lesson.cards.length)
  : [];
const metadata = card => card?.conversation && typeof card.conversation === 'object' ? card.conversation : {};
const tags = value => categoryLabels(typeof value === 'string' ? value.normalize('NFKC') : '').map(clean).filter(Boolean);

/** Saved conditions are optional, bounded strings. Unknown settings are ignored. */
export function normalizeConversationFilters(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(FIELDS.map(field => {
    let selected = Object.hasOwn(source, field) ? clean(source[field]) : '';
    if (selected.length > 200) selected = '';
    if (field === 'wordTag' && selected) {
      const labels = tags(selected);
      // One selection names exactly one tag. Multiple supplied tags remain a
      // nonmatching condition rather than silently choosing the first one.
      if (labels.length === 1) selected = labels[0];
    }
    return [field, selected];
  }));
}

/** Offer only metadata actually present on an utterance, not inferred labels. */
export function conversationFilterOptions(lessons) {
  const options = Object.fromEntries(FIELDS.map(field => [field, new Map()]));
  for (const lesson of validLessons(lessons)) for (const card of lesson.cards) {
    const meta = metadata(card);
    for (const field of FIELDS) {
      const values = field === 'wordTag' ? tags(meta.wordTags) : [clean(meta[field])];
      for (const value of values) if (value && !options[field].has(key(value))) options[field].set(key(value), value);
    }
  }
  return Object.fromEntries(FIELDS.map(field => [field, [...options[field].values()].sort((a, b) => collator.compare(a, b))]));
}

/** The list and every start action share one searchable lesson representation. */
export function conversationLessonSearchText(lesson) {
  const cards=Array.isArray(lesson?.cards)?lesson.cards:[];
  return [lesson?.label,lesson?.category,lesson?.situation,lesson?.usageNote,lesson?.wordTags,
    ...cards.flatMap(card=>{
      const meta=metadata(card);
      return [meta.category,meta.situation,meta.usageNote,meta.wordTags];
    })].map(clean).filter(Boolean).join(' ');
}

/**
 * A matching utterance selects its entire dialogue. Conditions such as speaker
 * and role must occur together on that utterance; turns are never removed.
 */
export function filterConversationLessons(lessons, { query = '', group = 'all', filters = {} } = {}) {
  const active = Object.entries(normalizeConversationFilters(filters)).filter(([, value]) => value);
  const needle = key(query), selectedGroup = clean(group);
  return validLessons(lessons).filter(lesson => {
    if (selectedGroup && selectedGroup !== 'all' && key(lesson.category || '会話') !== key(selectedGroup)) return false;
    if (needle && !key(conversationLessonSearchText(lesson)).includes(needle)) return false;
    return !active.length || lesson.cards.some(card => {
      const meta = metadata(card);
      return active.every(([field, value]) => field === 'wordTag'
        ? tags(meta.wordTags).some(tag => key(tag) === key(value))
        : key(meta[field]) === key(value));
    });
  });
}

/** A scene is new only when none of its turns has an attempt in this direction. */
export function unpracticedConversationLessons(lessons, records = {}, mode = 'read') {
  return validLessons(lessons).filter(lesson => lesson.cards.every(card => practiceCount(card, records, mode) === 0));
}

/** Choose uniformly between lessons, with no influence from their turn count. */
export function randomConversationLesson(lessons, { excludeId = '', random = Math.random } = {}) {
  const available = validLessons(lessons);
  if (!available.length) return null;
  const alternatives = available.filter(lesson => lesson.id !== excludeId);
  const pool = alternatives.length ? alternatives : available;
  const sample = Number((typeof random === 'function' ? random : Math.random)());
  const unit = Number.isFinite(sample) ? Math.max(0, Math.min(sample, 1 - Number.EPSILON)) : 0;
  return pool[Math.floor(unit * pool.length)];
}

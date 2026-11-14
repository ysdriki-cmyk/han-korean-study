import { isVariationSentence } from './sentence-collections.js?v=3';

const clean = value => String(value ?? '').normalize('NFC').trim();
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
const compare = (a, b) => collator.compare(String(a), String(b)) || String(a).localeCompare(String(b));
const stringFields = ['groupId', 'title', 'type', 'instruction', 'point', 'speechStyle', 'audience', 'usageNote', 'category'];
const numericOrder = value => {
  const number = Number(clean(value).normalize('NFKC'));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const sourceId = card => clean(card?.sourceId ?? card?.id).replace(/^sentence:/u, '');
const normalizeAnswer = value => clean(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/[。.!！?？]+$/u, '');

/** Optional cells never invent a transformation or a Korean answer. */
export function normalizeVariationMetadata(value = {}) {
  const result = {};
  for (const field of stringFields) if (clean(value?.[field])) result[field] = clean(value[field]);
  const order = numericOrder(value?.order);
  if (order !== null) result.order = order;
  const alternatives = Array.isArray(value?.answerVariants) ? value.answerVariants : clean(value?.answerVariants).split(/\r?\n/u);
  const answerVariants = [...new Set(alternatives.map(clean).filter(Boolean))];
  if (answerVariants.length) result.answerVariants = answerVariants;
  return result;
}

const lessonIdentity = card => {
  const groupId = clean(card?.variation?.groupId);
  return groupId ? { id: `variation:${encodeURIComponent(groupId)}`, sourceId: groupId } : null;
};
const validVariation = card => isVariationSentence(card) && lessonIdentity(card) && numericOrder(card.variation?.order) !== null;
const compareCards = (a, b) => numericOrder(a.variation.order) - numericOrder(b.variation.order) || compare(sourceId(a), sourceId(b));

/** The first ordered sentence is the base; every later row stays in its family. */
export function buildVariationLessons(cards) {
  const groups = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!validVariation(card)) continue;
    const identity = lessonIdentity(card);
    if (!groups.has(identity.id)) groups.set(identity.id, { ...identity, cards: [] });
    groups.get(identity.id).cards.push(card);
  }
  return [...groups.values()].map(group => {
    const ordered = group.cards.sort(compareCards);
    const metadata = {};
    for (const card of ordered) {
      for (const [field, value] of Object.entries(normalizeVariationMetadata(card.variation))) {
        if (metadata[field] === undefined) metadata[field] = value;
      }
    }
    const title = metadata.title || clean(ordered[0].kanji) || `文 ${group.sourceId}`;
    return { ...group, title, label: title, category: metadata.category || '', cards: ordered,
      baseCard: ordered[0], count: ordered.length };
  }).sort((a, b) => compare(a.sourceId, b.sourceId) || compare(a.id, b.id));
}

/** Canonical generated keys reject unknown, malformed or cross-collection IDs. */
export function variationLessonCards(cards, lessonId) {
  if (typeof lessonId !== 'string' || !lessonId.startsWith('variation:')) return [];
  return (Array.isArray(cards) ? cards : []).filter(card => validVariation(card) && lessonIdentity(card).id === lessonId).sort(compareCards);
}

/** Only the full model answer and explicit sentence alternatives are accepted. */
export function matchVariationAnswer(input, card) {
  if (!isVariationSentence(card)) return false;
  const submitted = normalizeAnswer(input);
  if (!submitted) return false;
  const variants = Array.isArray(card.variation?.answerVariants) ? card.variation.answerVariants : [];
  return [card.han, ...variants].some(answer => Boolean(normalizeAnswer(answer)) && normalizeAnswer(answer) === submitted);
}

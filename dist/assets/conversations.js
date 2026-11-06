import { isConversationSentence } from './sentence-collections.js?v=2';
import initialConversationMetadata from './conversation-metadata.js';

const clean = value => String(value ?? '').normalize('NFC').trim();
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
const compare = (a, b) => collator.compare(String(a), String(b)) || String(a).localeCompare(String(b));
const sourceId = card => clean(card?.sourceId ?? card?.id).replace(/^sentence:/u, '');
const numericTurn = value => {
  const number = Number(clean(value).normalize('NFKC'));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const stringFields = ['lessonId', 'situation', 'category', 'categoryNo', 'speaker', 'role', 'speechStyle', 'audience', 'priority', 'usageNote', 'wordTags'];

/** Missing optional cells must not erase known metadata from an earlier import. */
export function normalizeConversationMetadata(value = {}) {
  const result = {};
  for (const field of stringFields) if (clean(value?.[field])) result[field] = clean(value[field]);
  const turn = numericTurn(value?.turn);
  if (turn !== null) result.turn = turn;
  return result;
}

/**
 * The source sheet owns text and IDs. A checked-in registry only fills metadata
 * missing from the initial conversation import, guarded by both ID and Korean.
 * Explicit nonempty sheet cells always win, including new lesson assignments.
 */
export function enrichConversationCards(cards, registry = initialConversationMetadata) {
  return cards.map(card => {
    if (!isConversationSentence(card)) return card;
    const utterance = registry?.utterances?.[sourceId(card)];
    const matches = Boolean(clean(utterance?.expectedKorean) && clean(utterance.expectedKorean) === clean(card.han));
    const fallback = matches
      ? normalizeConversationMetadata({ ...registry?.lessons?.[utterance.lessonId], ...utterance })
      : {};
    const conversation = { ...fallback, ...normalizeConversationMetadata(card.conversation) };
    return Object.keys(conversation).length ? { ...card, conversation } : card;
  });
}

const compareTurns = (a, b) => {
  const left = numericTurn(a.conversation?.turn), right = numericTurn(b.conversation?.turn);
  if (left !== null || right !== null) {
    if (left === null) return 1;
    if (right === null) return -1;
    if (left !== right) return left - right;
  }
  return compare(sourceId(a), sourceId(b));
};

const lessonIdentity = card => {
  const groupId = clean(card?.conversation?.lessonId);
  return groupId
    ? { id: `conversation:${encodeURIComponent(groupId)}`, sourceId: groupId, singleton: false }
    : { id: `conversation:single:${encodeURIComponent(sourceId(card))}`, sourceId: sourceId(card), singleton: true };
};

/** Whole lessons retain every turn, irrespective of grade, due date or card limit. */
export function buildConversationLessons(cards) {
  const groups = new Map();
  for (const card of cards) {
    if (!isConversationSentence(card)) continue;
    const identity = lessonIdentity(card);
    if (!groups.has(identity.id)) groups.set(identity.id, { ...identity, cards: [] });
    groups.get(identity.id).cards.push(card);
  }
  return [...groups.values()].map(group => {
    const ordered = group.cards.sort(compareTurns);
    const metadata = {};
    for (const card of ordered) {
      for (const [key, value] of Object.entries(normalizeConversationMetadata(card.conversation))) {
        if (metadata[key] === undefined) metadata[key] = value;
      }
    }
    const { turn, speaker, role, ...lessonMetadata } = metadata;
    return { ...lessonMetadata, ...group, cards: ordered,
      label: metadata.situation || (group.singleton ? clean(ordered[0]?.han) : `会話 ${group.sourceId}`),
      count: ordered.length };
  }).sort((a, b) => compare(a.sourceId, b.sourceId) || compare(a.id, b.id));
}

/** Select one complete ordered lesson; callers must not run card-level sampling. */
export function conversationLessonCards(cards, lessonId) {
  if (typeof lessonId !== 'string' || !lessonId.startsWith('conversation:')) return [];
  // Compare canonical generated keys rather than decoding arbitrary input. This
  // rejects malformed/unknown IDs and distinguishes escaped group IDs from
  // singleton IDs without rebuilding every other lesson for each home row.
  return cards.filter(card => lessonIdentity(card).id === lessonId && isConversationSentence(card)).sort(compareTurns);
}

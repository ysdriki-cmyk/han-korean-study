import { essentialKanji } from './kanji.js';
import { categoryLabels } from './sheet-fields.js';
import { ratingFor } from './assessment.js';
import { practiceCount } from './practice.js';

const DECKS = new Set(['kanji', 'vocabulary', 'sentence']);
const TEXT_FIELDS = new Set(['han', 'kanji', 'hanja', 'meaning', 'english', 'tags', 'topikCategory']);
const TAG_FIELDS = new Set(['tags', 'topikCategory']);
const MAX_CUSTOM_SETS = 100, MAX_RULES = 20, MAX_VALUE = 500, MAX_LABEL = 80;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => String(value ?? '').normalize('NFC');
const clean = value => text(value).trim();
const tagId = (field, value) => `tag:${field}:${encodeURIComponent(value)}`;

function cardDeck(card) {
  if (!object(card) || typeof card.id !== 'string') return null;
  const prefix = card.id.split(':', 1)[0];
  if (!DECKS.has(prefix) || !card.id.slice(prefix.length + 1)) return null;
  return card.deckId == null || card.deckId === prefix ? prefix : null;
}

function deckCards(cards, deckId) {
  return Array.isArray(cards) ? cards.filter(card => cardDeck(card) === deckId) : [];
}

function normalizeRule(rule) {
  if (!object(rule) || typeof rule.field !== 'string') return null;
  const { field, operator } = rule;
  if (field === 'essential') {
    return operator === 'equals' && typeof rule.value === 'boolean'
      ? { field, operator, value: rule.value } : null;
  }
  if (!TEXT_FIELDS.has(field)) return null;
  if (['empty', 'not_empty'].includes(operator)) {
    return rule.value == null || (typeof rule.value === 'string' && !clean(rule.value)) ? { field, operator } : null;
  }
  if (!['contains', 'not_contains', 'tag', 'equals'].includes(operator)
    || (operator === 'tag' && !TAG_FIELDS.has(field)) || typeof rule.value !== 'string') return null;
  let value = operator === 'tag' ? clean(rule.value) : text(rule.value);
  if (!value.trim() || value.length > MAX_VALUE) return null;
  // One tag rule always names exactly one complete token.
  if (operator === 'tag') {
    const labels = categoryLabels(value);
    if (labels.length !== 1) return null;
    value = labels[0];
  }
  return { field, operator, value };
}

function normalizeCustomSet(value, deckId) {
  if (!DECKS.has(deckId) || !object(value)
    || (value.deckId != null && value.deckId !== deckId)
    || typeof value.id !== 'string' || !/^custom:[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/u.test(value.id)
    || typeof value.label !== 'string') return null;
  const label = clean(value.label);
  if (!label || label.length > MAX_LABEL) return null;
  let metadata = {};
  if (value.source === 'sheet') {
    if (typeof value.sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(value.sourceId)
      || value.id !== `custom:sheet:${value.sourceId}` || typeof value.order !== 'number'
      || !Number.isFinite(value.order) || Math.abs(value.order) > 1e9) return null;
    metadata = { source: 'sheet', sourceId: value.sourceId, order: value.order };
  }
  const base = { id: value.id, label, group: value.source === 'sheet' ? 'セット' : 'カスタム', kind: value.kind, deckId, ...metadata };
  if (value.kind === 'all' && value.source === 'sheet') {
    if ((value.rules != null && (!Array.isArray(value.rules) || value.rules.length))
      || (value.match != null && value.match !== 'all')) return null;
    return base;
  }
  if (value.kind !== 'custom' || !['all', 'any'].includes(value.match)
    || !Array.isArray(value.rules) || !value.rules.length || value.rules.length > MAX_RULES) return null;
  const rules = value.rules.map(normalizeRule);
  // Reject the whole condition rather than accidentally widening its meaning.
  if (rules.some(rule => !rule)) return null;
  return { ...base, match: value.match, rules };
}

/** Validate saved conditions without accepting partial or cross-course rules. */
export function normalizeCustomSets(value, deckId) {
  if (!Array.isArray(value) || !DECKS.has(deckId)) return [];
  const result = [], ids = new Set();
  for (const candidate of value.slice(0, MAX_CUSTOM_SETS)) {
    const set = normalizeCustomSet(candidate, deckId);
    if (!set || ids.has(set.id)) continue;
    ids.add(set.id);
    result.push(set);
  }
  return result;
}

/** Set identities depend on their conditions, never their row order or count. */
export function buildStudySets(deckId, cards, customSets = []) {
  if (!DECKS.has(deckId)) return [];
  const source = deckCards(cards, deckId);
  const sets = [{ id: 'all', label: 'すべて', group: '基本', kind: 'all', deckId }];
  if (deckId === 'kanji') {
    sets.push({ id: 'essential', label: '必須漢字', group: '基本', kind: 'essential', deckId });
  } else {
    sets.push({ id: 'topik', label: 'TOPIK1', group: '基本', kind: 'topik', deckId });
    for (const [field, group] of [['tags', 'カテゴリ'], ['topikCategory', 'TOPIK1']]) {
      const labels = [...new Set(source.flatMap(card => categoryLabels(card[field])))];
      labels.sort((a, b) => a.localeCompare(b, 'ja'));
      for (const value of labels) sets.push({ id: tagId(field, value), label: value, group, kind: 'tag', deckId, field, value });
    }
  }
  return [...sets, ...normalizeCustomSets(customSets, deckId)];
}

/** Reuse word-set conditions on the original words, then select only their complete examples. */
export function projectSentenceSets(wordSets) {
  return wordSets.filter(set => set.deckId === 'vocabulary').map(set => ({
    id: `sentence:${set.id}`, label: set.label, group: set.group,
    kind: 'sentence', deckId: 'sentence', sourceSet: set,
  }));
}

function matchesRule(card, rule) {
  if (rule.field === 'essential') {
    const essential = cardDeck(card) === 'kanji' && essentialKanji(card);
    return essential === rule.value;
  }
  const value = text(card[rule.field]);
  if (rule.operator === 'empty') return !clean(value);
  if (rule.operator === 'not_empty') return Boolean(clean(value));
  if (rule.operator === 'tag') return categoryLabels(value).includes(rule.value);
  if (rule.operator === 'equals') return value === rule.value;
  if (rule.operator === 'not_contains') return !value.includes(rule.value);
  return value.includes(rule.value);
}

/** Unknown sets and malformed saved criteria never fall back to all cards. */
export function cardsForStudySet(cards, set) {
  if (!object(set) || !DECKS.has(set.deckId)) return [];
  const source = deckCards(cards, set.deckId);
  if (set.kind === 'sentence' && set.deckId === 'sentence' && set.sourceSet?.deckId === 'vocabulary') {
    const words = source.map(card => card.sourceWord).filter(Boolean);
    const included = new Set(cardsForStudySet(words, set.sourceSet).map(card => card.id));
    return source.filter(card => included.has(card.sourceWord?.id));
  }
  if (set.kind === 'all' && set.id === 'all') return source;
  if (set.kind === 'essential' && set.id === 'essential' && set.deckId === 'kanji') return source.filter(essentialKanji);
  if (set.kind === 'topik' && set.id === 'topik' && ['vocabulary', 'sentence'].includes(set.deckId)) {
    return source.filter(card => Boolean(clean(card.topikCategory)) || card.topik === true);
  }
  if (set.kind === 'tag' && ['vocabulary', 'sentence'].includes(set.deckId) && TAG_FIELDS.has(set.field)
    && typeof set.value === 'string' && clean(set.value) === set.value && set.value
    && categoryLabels(set.value).length === 1 && categoryLabels(set.value)[0] === set.value
    && set.id === tagId(set.field, set.value)) {
    return source.filter(card => categoryLabels(card[set.field]).includes(set.value));
  }
  const custom = normalizeCustomSet(set, set.deckId);
  if (!custom) return [];
  if (custom.kind === 'all') return source;
  return source.filter(card => custom.match === 'all'
    ? custom.rules.every(rule => matchesRule(card, rule))
    : custom.rules.some(rule => matchesRule(card, rule)));
}

/** Overlapping sets read the same canonical card records in the selected mode. */
export function setProgress(cards, records = {}, mode = 'read') {
  const counts = { solid: 0, good: 0, unsure: 0, again: 0, hard: 0, unseen: 0 };
  const seen = new Set();
  let attempted = 0;
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!object(card) || typeof card.id !== 'string' || !card.id || seen.has(card.id)) continue;
    seen.add(card.id);
    counts[ratingFor(card, records, mode)] += 1;
    attempted += Number(practiceCount(card, records, mode) > 0);
  }
  const total = seen.size, mastered = counts.solid + counts.good;
  return { total, counts, mastered, masteredPercent: total ? Math.round(mastered / total * 100) : 0,
    attempted, attemptedPercent: total ? Math.round(attempted / total * 100) : 0 };
}

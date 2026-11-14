import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeck } from '../dist/assets/decks.js';
import { buildVariationLessons } from '../dist/assets/variations.js';
import { renderVariationPrompt, renderVariationAnswer, variationDifference } from '../dist/assets/variation-view.js';

const cards = parseDeck('sentence', readFileSync(new URL('../dist/data/variation.csv', import.meta.url), 'utf8')).cards;
const lesson = buildVariationLessons(cards)[0];

test('writing prompts show the base only after the first sentence and keep current and future answers hidden', () => {
  const first = renderVariationPrompt(lesson, 0);
  assert.ok(!first.includes(lesson.baseCard.han));
  assert.ok(!first.includes('variation-base'));
  const later = renderVariationPrompt(lesson, 1);
  assert.ok(later.includes(lesson.baseCard.han));
  assert.ok(later.includes('variation-base" open'));
  assert.ok(!later.includes(lesson.cards[1].han));
  assert.ok(!later.includes(lesson.cards[2].han));
  const combined = renderVariationPrompt(lesson, 7);
  assert.ok(combined.includes('variation-base"'));
  assert.ok(!combined.includes('variation-base" open'));
  assert.equal(renderVariationPrompt(lesson, 100), '');
});

test('reading prompts never disclose the current Japanese meaning through writing instructions or base translations', () => {
  for (let position = 0; position < lesson.cards.length; position++) {
    const html = renderVariationPrompt(lesson, position, { mode: 'read' });
    assert.ok(html.includes('文の意味を答えてみましょう。'));
    assert.ok(!html.includes(lesson.cards[position].variation.instruction));
    assert.ok(!html.includes(lesson.baseCard.kanji));
    assert.ok(!html.includes(lesson.cards[position].kanji));
  }
});

test('difference marks retain complete Korean strings, escaped markup and composed characters', () => {
  const withoutMarks = html => html.replace(/<\/?mark[^>]*>/gu, '');
  for (const [before, after] of [['김밥을 먹었어.', '어제 김밥을 먹었어.'], ['김밥을 먹었어.', '김밥을 먹었어요.'], ['😀 가', '😀 나'], ['가', '가']]) {
    const diff = variationDifference(before, after);
    assert.equal(withoutMarks(diff.before), before.normalize('NFC'));
    assert.equal(withoutMarks(diff.after), after.normalize('NFC'));
  }
  const html = variationDifference('<script>x</script>', '<img src=x>');
  assert.ok(!html.before.includes('<script>'));
  assert.ok(!html.after.includes('<img'));
  assert.ok(html.before.includes('&lt;'));
  const long = variationDifference('가'.repeat(600), '나'.repeat(600));
  assert.equal(withoutMarks(long.before), '가'.repeat(600));
  assert.equal(withoutMarks(long.after), '나'.repeat(600));
});

test('revealed answers show comparison and only explicitly supplied alternate sentences', () => {
  const negative = lesson.cards[3];
  const html = renderVariationAnswer(negative, lesson.baseCard);
  assert.ok(html.includes('variation-comparison'));
  assert.ok(html.includes('variation-after'));
  assert.ok(html.includes(negative.variation.answerVariants[0]));
  assert.ok(html.includes(negative.variation.point));
  const unsafe = { han:'나', variation:{ point:'<script>bad</script>', answerVariants:['<img src=x onerror=bad>'] } };
  const escaped = renderVariationAnswer(unsafe, { han:'가' });
  assert.ok(!escaped.includes('<script>'));
  assert.ok(!escaped.includes('<img'));
  assert.equal(renderVariationAnswer(null), '');
});

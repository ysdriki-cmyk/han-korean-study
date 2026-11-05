import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConversationPrompt, renderConversationNotes } from '../dist/assets/conversation-view.js';

const lesson = { label: '初めての通話', cards: [
  { han:'잘 들려요?', kanji:'聞こえますか？', conversation:{speaker:'A'} },
  { han:'네, 잘 들려요.', kanji:'はい、聞こえます。', conversation:{speaker:'B'} },
  { han:'반가워요.', kanji:'うれしいです。', conversation:{speaker:'A'} },
] };
test('conversation context exposes only the preceding turn, never future or current answers', () => {
  const first = renderConversationPrompt(lesson, 0);
  assert.ok(first.includes('話者 A'));
  assert.ok(!first.includes('잘 들려요?'));
  const second = renderConversationPrompt(lesson, 1);
  assert.ok(second.includes('話者 B'));
  assert.ok(second.includes('잘 들려요?'));
  assert.ok(second.includes('聞こえますか？'));
  assert.ok(!second.includes('네, 잘 들려요.'));
  assert.ok(!second.includes('반가워요.'));
  assert.equal(renderConversationPrompt(lesson, 3), '');
});
test('conversation labels and optional notes are escaped and omit empty content', () => {
  assert.equal(renderConversationNotes({}), '');
  assert.equal(renderConversationNotes({conversation:{}}), '');
  const html = renderConversationNotes({conversation:{role:'返答',speechStyle:'丁寧',usageNote:'<script>bad</script>'}});
  assert.ok(html.includes('返答'));
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
});

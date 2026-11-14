import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStudyHome } from '../dist/assets/study-home.js';

const courses = [{ id: 'sentence', label: 'sentence', count: 772 }];
const families = [
  { id: 'variation:eat', kind: 'variation', collection: 'variation', label: 'キンパを食べた', group: '食事', count: 6, unpracticed: false, counts: { good: 6 } },
  { id: 'variation:go', kind: 'variation', collection: 'variation', label: '学校に行く', group: '移動', count: 5, unpracticed: true },
];
const render = fields => renderStudyHome({ courses, activeDeck: 'sentence', variationProgress: { total: 11, lessonCount: 2, counts: { good: 6 } }, ...fields });

test('sentence home places variation after conversation and keeps its family and sentence counts accessible', () => {
  const html = render({ extraProgress: { total: 10 }, conversationProgress: { total: 7, lessonCount: 1 } });
  assert.ok(html.indexOf('data-sentence-collection="variation"') > html.indexOf('data-sentence-collection="conversation"'));
  assert.ok(html.includes('class="home-extra-card home-variation-card"'));
  assert.ok(html.includes('variation 一つの文を変形する、2セット、11文'));
  assert.ok(html.includes('variationの評価：◎ 完璧 0文、○ できた 6文'));
  assert.equal((html.match(/data-home-deck=/gu) || []).length, 1);
  assert.ok(!html.includes('data-sentence-collection="variation" disabled'));
});

test('variation remains available for repeated practice and has no conversation controls', () => {
  const html = render({ sentenceCollection: 'variation', sets: [families[0]], canResume: true,
    conversationFilters: { priority: 'A' }, conversationFilterOptions: { priority: ['A'] } });
  assert.ok(html.includes('data-sentence-collection="core"'));
  assert.ok(html.includes('variation<span>のセット</span>'));
  assert.ok(html.includes('一つの文を、少しずつ変えて練習します。'));
  assert.ok(html.includes('data-start-practice>練習を開始する'));
  assert.ok(html.includes('data-start-set="variation:eat"'));
  assert.ok(!html.includes('data-start-set="variation:eat" disabled'));
  assert.ok(html.includes('で変形を練習"'));
  assert.ok(html.includes('>練習<span'));
  assert.ok(html.includes('6文'));
  assert.ok(html.includes('data-resume-study'));
  assert.ok(!html.includes('data-conversation-details'));
  assert.ok(!html.includes('data-conversation-filter='));
  assert.ok(!html.includes('data-sentence-collection="extra"'));
  assert.ok(!html.includes('data-sentence-collection="variation"'));
});

test('empty variation is disabled and search only starts visible nonempty families', () => {
  const empty = render({ variationProgress: { total: 0, lessonCount: 0 } });
  assert.ok(empty.includes('data-sentence-collection="variation" disabled'));
  const noData = render({ sentenceCollection: 'variation', sets: [] });
  assert.ok(noData.includes('data-start-practice disabled'));
  const noResults = render({ sentenceCollection: 'variation', sets: families, query: '該当しない' });
  assert.ok(noResults.includes('data-start-practice disabled'));
  const found = render({ sentenceCollection: 'variation', sets: families, query: 'キンパ' });
  assert.ok(found.includes('1 セット'));
  assert.ok(found.includes('data-start-practice>練習を開始する'));
  assert.ok(!found.includes('data-start-set="variation:go"'));
  const unavailable = render({ courses: [{ ...courses[0], available: false }], sentenceCollection: 'variation', sets: families });
  assert.ok(unavailable.includes('data-start-practice disabled'));
});

test('variation titles, IDs and search input are escaped', () => {
  const html = render({ sentenceCollection: 'variation', query: '"', sets: [{ ...families[0], label: '<img src=x>"', group: '" onfocus="bad', id: 'variation:1" onclick="bad' }] });
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('&lt;img src=x&gt;&quot;'));
  assert.ok(html.includes('data-start-set="variation:1&quot; onclick=&quot;bad"'));
  assert.ok(html.includes('value="&quot;"'));
});

test('variation collection controls stay absent outside sentence or within other sentence collections', () => {
  for (const fields of [
    { activeDeck: 'kanji', sentenceCollection: 'variation' },
    { activeDeck: 'vocabulary', sentenceCollection: 'variation' },
    { sentenceCollection: 'conversation' },
    { sentenceCollection: 'extra' },
  ]) {
    const html = render(fields);
    assert.ok(!html.includes('data-sentence-collection="variation"'));
    assert.ok(!html.includes('home-variation-note'));
    assert.ok(!html.includes('data-start-practice>練習を開始する'));
  }
});

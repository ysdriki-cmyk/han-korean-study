import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStudyHome } from '../dist/assets/study-home.js';
import { setProgress } from '../dist/assets/study-sets.js';

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

test('practiced variation remains available individually while the random start requires unpracticed sets', () => {
  const html = render({ sentenceCollection: 'variation', sets: [families[0]], canResume: true,
    conversationFilters: { priority: 'A' }, conversationFilterOptions: { priority: ['A'] } });
  assert.ok(html.includes('data-sentence-collection="core"'));
  assert.ok(html.includes('variation<span>のセット</span>'));
  assert.ok(html.includes('未演習のセットをランダムに選び、原型から派生の順に練習します。'));
  assert.ok(html.includes('title="未演習のセットをランダムに選んで開始"'));
  assert.ok(html.includes('data-start-practice disabled>未演習のセットはありません'));
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
  assert.ok(found.includes('data-start-practice disabled>未演習のセットはありません'));
  assert.ok(found.includes('data-start-set="variation:eat"'));
  assert.ok(!found.includes('data-start-set="variation:go"'));
  const fresh = render({ sentenceCollection: 'variation', sets: families, query: '学校' });
  assert.ok(fresh.includes('data-start-practice>練習を開始する'));
  assert.ok(!fresh.includes('data-start-set="variation:eat"'));
  const unavailable = render({ courses: [{ ...courses[0], available: false }], sentenceCollection: 'variation', sets: families });
  assert.ok(unavailable.includes('data-start-practice disabled'));
});

test('only matching unpracticed sets enable random start while all individual sets stay visible',()=>{
  const mixed=render({sentenceCollection:'variation',sets:families});
  assert.ok(mixed.includes('data-start-practice>練習を開始する'));
  assert.ok(mixed.includes('data-start-set="variation:eat"'));
  assert.ok(mixed.includes('data-start-set="variation:go"'));
  const practicedGroup=render({sentenceCollection:'variation',sets:families,group:'食事'});
  assert.ok(practicedGroup.includes('data-start-practice disabled>未演習のセットはありません'));
  assert.ok(!practicedGroup.includes('data-start-set="variation:go"'));
  const freshGroup=render({sentenceCollection:'variation',sets:families,group:'移動'});
  assert.ok(freshGroup.includes('data-start-practice>練習を開始する'));
});

test('home eligibility follows direction-specific attempts rather than visible rating symbols',()=>{
  const members=[{id:'sentence:one',han:'가요'},{id:'sentence:two',han:'갔어요'}];
  const records={
    'sentence:one':{assessments:{read:{rating:'unseen',attempts:1},write:{rating:'solid',attempts:0}}},
    'sentence:two':{assessments:{write:{rating:'good',attempts:0,ratingEditedAt:'2026-11-17T00:00:00Z'}}},
  };
  const before=JSON.stringify(records);
  const renderDirection=mode=>{
    const progress=setProgress(members,records,mode);
    return render({sentenceCollection:'variation',mode,sets:[{...families[0],...progress,unpracticed:progress.attempted===0}]});
  };
  const read=renderDirection('read');
  assert.ok(read.includes('data-start-practice disabled>未演習のセットはありません'));
  assert.ok(!read.includes('data-start-set="variation:eat" disabled'));
  const write=renderDirection('write');
  assert.ok(write.includes('data-start-practice>練習を開始する'));
  assert.equal(JSON.stringify(records),before);
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

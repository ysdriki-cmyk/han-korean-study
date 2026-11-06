import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStudyHome } from '../dist/assets/study-home.js';

const courses = [{ id: 'sentence', label: 'sentence', count: 773 }];
const conversationProgress = { total: 1106, lessonCount: 158, counts: { good: 7 } };
const lessons = [
  { id: 'conversation:01-01', kind: 'conversation', collection: 'conversation', label: '音声の確認', group: '初対面・挨拶', count: 7, counts: { good: 7 } },
  { id: 'conversation:02-01', kind: 'conversation', collection: 'conversation', label: '週末の過ごし方', group: '日常・近況', count: 7 },
];
const render = fields => renderStudyHome({ courses, activeDeck: 'sentence', conversationProgress, ...fields });

test('sentence home exposes isolated extra and conversation entries without adding a course', () => {
  const html = render({ extraProgress: { total: 1378 } });
  assert.equal((html.match(/data-home-deck=/gu) || []).length, 1);
  assert.ok(html.includes('data-sentence-collection="extra"'));
  assert.ok(html.includes('data-sentence-collection="conversation"'));
  assert.ok(html.includes('158レッスン、1,106発話'));
  assert.ok(html.includes('conversationの評価：◎ 完璧 0発話、○ できた 7発話'));
});

test('conversation has lesson actions, speech counts and independent navigation', () => {
  const html = render({ sentenceCollection: 'conversation', sets: lessons });
  assert.ok(html.includes('data-sentence-collection="core"'));
  assert.ok(html.includes('conversation<span>のレッスン</span>'));
  assert.ok(html.includes('レッスンを開始する'));
  assert.ok(html.includes('2 レッスン'));
  assert.ok(html.includes('7発話'));
  assert.ok(html.includes('音声の確認のレッスンを開始'));
  assert.ok(html.includes('data-start-set="conversation:01-01"'));
  assert.equal(html.includes('data-sentence-collection="extra"'), false);
  assert.ok(html.includes('aria-label="○・◎の割合 100%"'));
  assert.equal(/class="home-set-count">7枚/u.test(html), false);
});

test('conversation lesson filters match categories and situations without leaking other lessons', () => {
  const html = render({ sentenceCollection: 'conversation', sets: lessons, query: '近況' });
  assert.ok(html.includes('data-start-set="conversation:02-01"'));
  assert.equal(html.includes('data-start-set="conversation:01-01"'), false);
  assert.ok(html.includes('1 レッスン'));
  const empty = render({ sentenceCollection: 'conversation', sets: lessons, group: '初対面・挨拶', query: '旅行' });
  assert.ok(empty.includes('該当するレッスンがありません'));
});

test('empty conversation entry and lesson launch are disabled', () => {
  const progress = { total: 0, lessonCount: 0 };
  assert.ok(render({ conversationProgress: progress }).includes('data-sentence-collection="conversation" disabled'));
  assert.ok(render({ sentenceCollection: 'conversation', conversationProgress: progress }).includes('data-start-practice disabled'));
});

test('conversation lesson labels, groups and identifiers are escaped', () => {
  const html = render({ sentenceCollection: 'conversation', sets: [{ ...lessons[0], label: '<img src=x>', group: '" onfocus="alert(1)', id: 'conversation:01" onclick="bad' }] });
  assert.equal(html.includes('<img src=x>'), false);
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(html.includes('data-start-set="conversation:01&quot; onclick=&quot;bad"'));
});

test('conversation exposes collapsed metadata selectors and a lesson-level random action', () => {
  const html = render({ sentenceCollection:'conversation', sets:lessons,
    conversationFilterOptions:{speechStyle:['丁寧','タメ口'],audience:['初対面〜知人'],priority:['A','B'],role:['返答'],speaker:['A','B'],wordTag:[]} });
  assert.ok(html.includes('data-random-lesson>ランダムに開始'));
  assert.ok(html.includes('data-conversation-details>'));
  assert.ok(!html.includes('data-conversation-details open'));
  for (const key of ['speechStyle','audience','priority','role','speaker']) assert.ok(html.includes(`data-conversation-filter="${key}"`));
  assert.ok(!html.includes('data-conversation-filter="wordTag"'));
  assert.ok(html.includes('placeholder="場面・使い方メモを検索"'));
  assert.ok(html.includes('data-reset-conversation-filters disabled'));
});

test('metadata selectors retain escaped choices and expose active conditions without prose', () => {
  const html = render({ sentenceCollection:'conversation', sets:lessons, conversationDetailsOpen:true,
    conversationFilters:{speechStyle:'丁寧',wordTag:'<img src=x>"',unknown:'ignored'},
    conversationFilterOptions:{speechStyle:['丁寧','タメ口'],wordTag:['<img src=x>"']} });
  assert.ok(html.includes('data-conversation-details open'));
  assert.ok(html.includes('aria-label="2件の条件を選択中"'));
  assert.ok(html.includes('<option value="丁寧" selected>丁寧</option>'));
  assert.ok(html.includes('<option value="&lt;img src=x&gt;&quot;" selected>'));
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('data-reset-conversation-filters>条件をクリア'));
  const stale = render({sentenceCollection:'conversation', sets:lessons, conversationFilters:{speechStyle:'旧分類'},conversationFilterOptions:{speechStyle:['丁寧']}});
  assert.ok(stale.includes('<option value="旧分類" selected>旧分類（対象なし）</option>'));
});

test('random launch and default lesson launch share visible search and category availability', () => {
  const enriched = lessons.map((lesson,index)=>({...lesson,searchText:index ? '予定を相談する #travel' : '音声が聞こえるか確かめる'}));
  const found = render({sentenceCollection:'conversation',sets:enriched,query:'予定を相談'});
  assert.ok(found.includes('1 レッスン'));
  assert.ok(found.includes('data-start-set="conversation:02-01"'));
  assert.ok(found.includes('data-random-lesson>ランダムに開始'));
  const empty = render({sentenceCollection:'conversation',sets:enriched,query:'予定',group:'初対面・挨拶'});
  assert.ok(empty.includes('data-start-practice disabled'));
  assert.ok(empty.includes('data-random-lesson disabled'));
  const noData = render({sentenceCollection:'conversation',sets:[{...lessons[0],count:0}]});
  assert.ok(noData.includes('data-random-lesson disabled'));
});

test('saved filter spelling variants select the available normalized option without a stale warning', () => {
  const html = render({sentenceCollection:'conversation',sets:lessons,
    conversationFilters:{priority:'ａ',speaker:'b',wordTag:'＃SHOP'},
    conversationFilterOptions:{priority:['A','B'],speaker:['A','B'],wordTag:['shop','SHOP','travel']}});
  assert.ok(html.includes('<option value="A" selected>A</option>'));
  assert.ok(html.includes('<option value="B" selected>B</option>'));
  assert.ok(html.includes('<option value="shop" selected>shop</option>'));
  assert.ok(!html.includes('対象なし'));
  assert.ok(!html.includes('<option value="SHOP"'));
  assert.ok(html.includes('aria-label="3件の条件を選択中"'));
});

test('conversation search uses the canonical joined text without duplicate boundary matches', () => {
  const sets = [{...lessons[0],label:'音声確認',group:'電話',searchText:'音声確認 電話 初めての音声通話'}];
  const found = render({sentenceCollection:'conversation',sets,query:'音声確認 電話'});
  assert.ok(found.includes('1 レッスン'));
  assert.ok(found.includes('data-random-lesson>ランダムに開始'));
  const absent = render({sentenceCollection:'conversation',sets,query:'電話 音声確認'});
  assert.ok(absent.includes('0 レッスン'));
  assert.ok(absent.includes('data-start-practice disabled'));
  assert.ok(absent.includes('data-random-lesson disabled'));
  assert.ok(!absent.includes('data-start-set="conversation:01-01"'));
  const fallback = render({sentenceCollection:'conversation',sets:lessons,query:'音声の確認 初対面'});
  assert.ok(fallback.includes('1 レッスン'));
});

test('conversation controls stay absent from ordinary courses and extra collections', () => {
  for (const fields of [{},{sentenceCollection:'extra'},{activeDeck:'vocabulary'},{activeDeck:'kanji',sentenceCollection:'conversation'}]) {
    const html = render({...fields,conversationFilters:{priority:'A'},conversationFilterOptions:{priority:['A']}});
    assert.ok(!html.includes('data-random-lesson'));
    assert.ok(!html.includes('data-conversation-details'));
    assert.ok(!html.includes('data-conversation-filter='));
  }
});

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

import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTopikUsage} from '../dist/assets/topik-view.js';

test('reference words, sentences and search terms remain escaped text', () => {
  const rows = [{korean:'가<script>alert(1)</script>',english:'<img src=x onerror=alert(1)>',japanese:'価格 & 値段',exampleKo:'가다 <svg onload=alert(1)>',exampleJa:'「行く」<script>bad()</script>'}];
  const html = renderTopikUsage(rows, '가', 'ready', {showSentences:true});
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<svg onload='));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('価格 &amp; 値段'));
  assert.ok(html.includes('<mark class="usage-hit">가</mark>'));
});

test('vocabulary keeps all three columns, optional usage sentences and every hit', () => {
  const rows = Array.from({length:6},(_,i)=>({korean:`가${i}`,english:i ? '' : 'go',japanese:'行く',exampleKo:i ? '' : '가세요',exampleJa:i ? '' : '行ってください'}));
  const html = renderTopikUsage(rows, '가', 'ready', {showSentences:true});
  assert.ok(html.includes('韓国単語</th><th scope="col">英語</th><th scope="col">日本語'));
  assert.ok(html.includes('가세요'.replace('가','<mark class="usage-hit">가</mark>')));
  assert.ok(html.includes('行ってください'));
  assert.ok(!html.includes('<details'));
  assert.ok(!html.includes('ほか2件を見る'));
  assert.equal((html.match(/<table /g)||[]).length,1);
  assert.equal((html.match(/scope="row"/g)||[]).length,6);
  assert.equal((html.match(/data-speak=/g)||[]).length,7); // Six words and the available Korean sentence.
  assert.ok(html.includes('aria-label="未記入">—'));
  assert.equal(renderTopikUsage(rows,'없다'),'');
  assert.ok(renderTopikUsage([], '가','error').includes('data-action="reload-examples"'));
});

test('character references reveal sentences only for rows with examples and keep every word', () => {
  const rows = Array.from({length:22}, (_,index) => ({korean:`가${index}`,english:'go',japanese:'行く',exampleKo:index === 0 || index === 1 ? '가세요' : '',exampleJa:index === 0 || index === 2 ? '行ってください' : ''}));
  const before = JSON.stringify(rows);
  const html = renderTopikUsage(rows, '가', 'ready', {showSentences:false});
  assert.ok(html.includes('usage-compact'));
  assert.ok(html.includes('TOPIK1 · 22件'));
  assert.equal((html.match(/scope="row"/g)||[]).length,22);
  assert.equal((html.match(/data-speak=/g)||[]).length,24); // Every word plus the two available Korean sentences.
  assert.equal((html.match(/data-usage-example-row/g)||[]).length,3);
  assert.equal((html.match(/data-usage-toggle aria-expanded="false"/g)||[]).length,3);
  assert.equal((html.match(/class="usage-word-toggle"/g)||[]).length,3);
  assert.ok(!html.includes('usage-example-toggle'));
  assert.ok(!html.includes('usage-example-chevron'));
  assert.equal((html.match(/class="usage-example-row" hidden/g)||[]).length,3);
  for (let index = 0; index < 3; index++) {
    assert.ok(html.includes(`aria-controls="usage-example-${index}"`));
    assert.ok(html.includes(`id="usage-example-${index}"`));
  }
  assert.ok(!html.includes('aria-controls="usage-example-3"'));
  assert.ok(html.includes('colspan="3"'));
  assert.ok(html.includes('行ってください'));
  assert.ok(!html.includes('<details'));
  assert.equal(JSON.stringify(rows),before);
  assert.equal(renderTopikUsage(rows,'가'),html);
});

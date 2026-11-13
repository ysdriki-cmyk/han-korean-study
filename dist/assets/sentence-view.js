import { resolveSentenceWords } from './sentences.js?v=5';
import { speechButton } from './speech-view.js';
import { findSentenceWordExamples } from './sentence-examples.js';
import { RATINGS, UNSEEN, ratingFor } from './assessment.js?v=3';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Optional reference translation, rendered only inside the revealed answer. */
export function renderSentenceTranslation2(card) {
  const text=String(card.translation2 ?? '').trim();
  return text ? `<div class="answer-row"><span class="answer-label">訳2</span><p class="answer-value" lang="ja">${esc(text)}</p></div>` : '';
}

const statuses=[...RATINGS,UNSEEN];
const labels={hard:'全然',again:'もう一度',unsure:'あいまい',good:'できた',solid:'完璧',unseen:'未回答'};
const modeLabel=mode=>mode==='write'?'쓰기':'읽기';

/** Give homonymous dictionary entries separate controls; never change several senses at once. */
export function sentenceWordEntries(card, words) {
  const {rows,main}=resolveSentenceWords(card,words);
  return rows.flatMap((row,index)=>row.words.length?row.words.map(word=>({
    ...row,key:`${index}:${word.id}`,word,words:[word],lemma:word.han,
    english:word.english||word.meaning||'',japanese:row.translation?.trim()||word.kanji||'',
    main:Boolean(main?.words.some(item=>item.id===word.id)),
  })):[{...row,key:`${index}:missing`,word:null}]);
}

export function renderSentenceWords(card, words, records={}, mode='read') {
  const entries=sentenceWordEntries(card,words);
  if (!entries.length) return '';
  const {rows,main}=resolveSentenceWords(card,words);
  const separateMain=main && !rows.some(row=>row.main) ? `<p class="sentence-main-outside">今回の単語：<strong lang="ko">${esc(main.lemma)}</strong>${speechButton(main.lemma)}</p>` : '';
  const body=entries.map((row,index)=>{
    const rating=row.word?ratingFor(row.word,records,mode):'unseen';
    const status=statuses.find(item=>item.id===rating)||UNSEEN;
    const statusLabel=row.word?`${row.lemma}の単語ステータス：${modeLabel(mode)} ${status.symbol} ${labels[status.id]}。変更する`:`${row.lemma}は単語帳に未登録`;
    const statusButton=`<button type="button" class="sentence-word-status rating-${status.id}" data-sentence-word-status="${index}" aria-label="${esc(statusLabel)}" aria-haspopup="dialog"${row.word?'':' disabled'}><span class="rating-symbol">${status.symbol}</span></button>`;
    return `<tr${row.main?' class="sentence-main-row"':''}><td>${statusButton}</td><td lang="ko"><button type="button" class="sentence-word-open" data-sentence-word-open="${index}" aria-label="${esc(row.lemma)}の意味と例文" aria-haspopup="dialog">${esc(row.lemma)}</button></td><td lang="ja">${esc(row.japanese)||'—'}</td></tr>`;
  }).join('');
  return `<section class="sentence-word"><div class="sentence-word-heading"><h3>使用単語</h3><span>単語 · ${modeLabel(mode)}</span></div>${separateMain}<div class="table-wrap"><table><thead><tr><th scope="col"><span class="sr-only">単語のステータス</span></th><th scope="col">原形</th><th scope="col">日本語</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

/** A bounded page keeps every related example accessible without extending the study page. */
export function sentenceWordExamplePage(row,words,sentences,card,page=0) {
  const examples=findSentenceWordExamples(row,words,sentences,card);
  const pages=Math.max(1,Math.ceil(examples.length/2));
  const current=Math.max(0,Math.min(Number.isFinite(page)?Math.floor(page):0,pages-1));
  return {examples:examples.slice(current*2,current*2+2),total:examples.length,page:current,pages};
}

export function renderSentenceWordSheet(row,words,sentences,card,records,mode,page=0) {
  const rating=row.word?ratingFor(row.word,records,mode):'unseen';
  const examples=sentenceWordExamplePage(row,words,sentences,card,page);
  return `<div class="word-sheet-handle" aria-hidden="true"></div><header class="word-sheet-heading"><div><h2 id="sentence-word-title" lang="ko">${esc(row.lemma)}</h2>${speechButton(row.lemma)}</div><button type="button" class="icon-button" data-word-sheet-close aria-label="単語パネルを閉じる">×</button></header>
    <div class="word-sheet-body"><div class="word-sheet-meaning"><p lang="ja">${esc(row.japanese)||'—'}</p>${row.english?`<p lang="en">${esc(row.english)}</p>`:''}</div>
    <section class="word-sheet-status"><div class="word-sheet-status-heading"><h3>単語のステータス</h3><div class="word-sheet-modes" role="group" aria-label="単語の評価方向">${['read','write'].map(item=>`<button type="button" data-word-sheet-mode="${item}" aria-pressed="${mode===item}">${modeLabel(item)}</button>`).join('')}</div></div>
    ${row.word?`<div class="word-sheet-ratings" role="group" aria-label="単語のステータスを変更">${statuses.map(item=>`<button type="button" class="rating-${item.id}" data-word-sheet-rating="${item.id}" aria-label="${esc(row.lemma)}を${modeLabel(mode)} ${item.symbol} ${labels[item.id]}に変更" aria-pressed="${rating===item.id}"><span class="rating-symbol">${item.symbol}</span><span>${labels[item.id]}</span></button>`).join('')}</div>`:'<p class="word-sheet-unregistered">単語帳に未登録</p>'}
    <p class="word-sheet-feedback" role="status" aria-live="polite"></p></section>
    <section class="word-sheet-examples"><h3>他の例文 <span>${examples.total}件</span></h3>${examples.examples.length?examples.examples.map(example=>`<div class="sentence-linked-example">${example.korean?`<p lang="ko">${esc(example.korean)}${speechButton(example.korean)}</p>`:''}${example.japanese?`<p lang="ja">${esc(example.japanese)}</p>`:''}</div>`).join(''):'<p class="word-sheet-empty">他の例文はまだありません</p>'}</section></div>
    <footer class="word-sheet-pages"${examples.pages===1?' hidden':''}><button type="button" data-word-sheet-page="${examples.page-1}" aria-label="前の例文"${examples.page===0?' disabled':''}>←</button><span>${examples.page+1} / ${examples.pages}</span><button type="button" data-word-sheet-page="${examples.page+1}" aria-label="次の例文"${examples.page===examples.pages-1?' disabled':''}>→</button></footer>`;
}

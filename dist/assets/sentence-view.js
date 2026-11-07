import { resolveSentenceWords } from './sentences.js?v=5';
import { speechButton } from './speech-view.js';
import { findSentenceWordExamples } from './sentence-examples.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Optional reference translation, rendered only inside the revealed answer. */
export function renderSentenceTranslation2(card) {
  const text=String(card.translation2 ?? '').trim();
  return text ? `<div class="answer-row"><span class="answer-label">訳2</span><p class="answer-value" lang="ja">${esc(text)}</p></div>` : '';
}

export function renderSentenceWords(card, words, sentences=[]) {
  const {rows,main}=resolveSentenceWords(card,words);
  if (!rows.length) return '';
  const separateMain=main && !rows.some(row=>row.main) ? `<p class="sentence-main-outside">今回の単語：<strong lang="ko">${esc(main.lemma)}</strong>${speechButton(main.lemma)}</p>` : '';
  const body=rows.map((row,index)=>{
    const expandable=findSentenceWordExamples(row,words,sentences,card).length>0;
    const exampleId=`sentence-word-examples-${index}`;
    const word=expandable?`<button type="button" class="usage-word-toggle" data-usage-toggle data-sentence-word-index="${index}" aria-expanded="false" aria-controls="${exampleId}" aria-label="${esc(row.lemma)}の例文を開閉">${esc(row.lemma)}</button>`:esc(row.lemma);
    const classes=[row.main?'sentence-main-row':'',expandable?'usage-expandable':''].filter(Boolean).join(' ');
    const examples=expandable?`<tr id="${exampleId}" class="sentence-example-row" hidden><td colspan="3"><div class="sentence-example-content"></div></td></tr>`:'';
    return `<tbody><tr${classes?` class="${classes}"`:''}${expandable?' data-usage-example-row':''}><td lang="ko">${word}${speechButton(row.lemma)}</td><td lang="en">${esc(row.english)||'—'}</td><td lang="ja">${esc(row.japanese)||'—'}</td></tr>${examples}</tbody>`;
  }).join('');
  return `<section class="sentence-word"><h3>使用単語</h3>${separateMain}<div class="table-wrap"><table><thead><tr><th scope="col">原形</th><th scope="col">英語</th><th scope="col">日本語</th></tr></thead>${body}</table></div></section>`;
}

/** Example bodies are created only when the learner expands a word. */
export function renderSentenceWordExamples(card,words,sentences,index) {
  const row=resolveSentenceWords(card,words).rows[index];
  const examples=findSentenceWordExamples(row,words,sentences,card);
  return examples.length?`<h4>他の例文</h4>${examples.map(example=>`<div class="sentence-linked-example">${example.korean?`<p lang="ko">${esc(example.korean)}${speechButton(example.korean)}</p>`:''}${example.japanese?`<p lang="ja">${esc(example.japanese)}</p>`:''}</div>`).join('')}`:'';
}

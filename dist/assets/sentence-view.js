import { resolveSentenceWords } from './sentences.js?v=2';
import { speechButton } from './speech-view.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function renderSentenceWords(card, words) {
  const {rows,main}=resolveSentenceWords(card,words);
  if (!rows.length) return '';
  const separateMain=main && !rows.some(row=>row.main) ? `<p class="sentence-main-outside">今回の単語：<strong lang="ko">${esc(main.lemma)}</strong>${speechButton(main.lemma)}</p>` : '';
  return `<section class="sentence-word"><h3>使用単語</h3>${separateMain}<div class="table-wrap"><table><thead><tr><th scope="col">韓国語</th><th scope="col">原形</th><th scope="col">日本語</th></tr></thead><tbody>${rows.map(row=>`<tr${row.main ? ' class="sentence-main-row"' : ''}><td lang="ko">${esc(row.surface)}${speechButton(row.surface)}</td><td lang="ko">${esc(row.lemma)}${row.main ? '<small class="sentence-main-label" lang="ja">メイン</small>' : ''}</td><td lang="ja">${esc(row.japanese) || '—'}</td></tr>`).join('')}</tbody></table></div></section>`;
}

import { speechButton } from './speech-view.js';
import { findTopikExamples } from './topik.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Highlight literal matches only; source cells always remain escaped text. */
function highlight(value, query) {
  const text = String(value ?? '').normalize('NFC');
  const terms = [...new Set((Array.isArray(query) ? query : [query]).filter(term => typeof term === 'string').map(term => term.normalize('NFC').trim()).filter(Boolean))].sort((a,b) => b.length-a.length);
  let cursor = 0, result = '';
  while (cursor < text.length) {
    let found = -1, term = '';
    for (const candidate of terms) {
      const at = text.indexOf(candidate, cursor);
      if (at !== -1 && (found === -1 || at < found)) { found = at; term = candidate; }
    }
    if (found === -1) { result += esc(text.slice(cursor)); break; }
    result += esc(text.slice(cursor, found)) + `<mark class="usage-hit">${esc(text.slice(found, found + term.length))}</mark>`;
    cursor = found + term.length;
  }
  return result;
}
function exampleTable(entries, query, showSentences) {
  const rows = entries.map((entry, index) => {
    const expandable = !showSentences && Boolean(entry.exampleKo || entry.exampleJa);
    const exampleId = `usage-example-${index}`;
    const toggle = expandable ? `<button type="button" class="usage-example-toggle" data-usage-toggle aria-expanded="false" aria-controls="${exampleId}" aria-label="${esc(entry.korean)}の例文"><span>例文</span><span class="usage-example-chevron" aria-hidden="true"></span></button>` : '';
    const sentence = expandable ? `<tr id="${exampleId}" class="usage-example-row" hidden><td colspan="3"><div class="usage-example-content">${entry.exampleKo ? `<p class="usage-sentence" lang="ko"><small class="usage-sentence-label" lang="ja">例文</small>${highlight(entry.exampleKo, query)}${speechButton(entry.exampleKo)}</p>` : ''}${entry.exampleJa ? `<p class="usage-sentence" lang="ja"><small class="usage-sentence-label">日本語訳</small>${esc(entry.exampleJa)}</p>` : ''}</div></td></tr>` : '';
    return `<tbody><tr${expandable ? ' class="usage-expandable" data-usage-example-row' : ''}><th scope="row" class="usage-word" lang="ko"><span>${highlight(entry.korean, query)}</span>${speechButton(entry.korean)}${showSentences && entry.exampleKo ? `<p class="usage-sentence"><small class="usage-sentence-label">例文</small>${highlight(entry.exampleKo, query)}${speechButton(entry.exampleKo)}</p>` : ''}</th><td lang="en">${esc(entry.english) || '<span class="usage-missing" aria-label="未記入">—</span>'}</td><td lang="ja"><span>${esc(entry.japanese) || '<span class="usage-missing" aria-label="未記入">—</span>'}</span>${toggle}${showSentences && entry.exampleJa ? `<p class="usage-sentence"><small class="usage-sentence-label">例文訳</small>${esc(entry.exampleJa)}</p>` : ''}</td></tr>${sentence}</tbody>`;
  }).join('');
  return `<div class="usage-table-wrap"><table class="usage-table"><caption class="sr-only">TOPIK1 使用参考例</caption><colgroup><col><col><col></colgroup><thead><tr><th scope="col">韓国単語</th><th scope="col">英語</th><th scope="col">日本語</th></tr></thead>${rows}</table></div>`;
}

export function renderTopikUsage(examples, query, state = 'ready', {showSentences = false} = {}) {
  if (state === 'error') return '<section class="usage-reference usage-error" aria-label="使用参考例"><div class="usage-heading"><h3>使用参考例</h3><span class="usage-source-tag">TOPIK1</span></div><p>使用参考例を読み込めませんでした。</p><button class="button secondary" data-action="reload-examples">再読み込み</button></section>';
  if (state === 'loading') return '<section class="usage-reference" role="status">使用参考例を読み込み中…</section>';
  const matches = findTopikExamples(examples, query);
  if (!matches.length) return '';
  return `<section id="usage-reference" class="usage-reference${showSentences ? '' : ' usage-compact'}" aria-labelledby="usage-reference-title"><div class="usage-heading"><h3 id="usage-reference-title">使用参考例</h3><span class="usage-source-tag">TOPIK1 · ${matches.length}件</span></div>${exampleTable(matches, query, showSentences)}</section>`;
}

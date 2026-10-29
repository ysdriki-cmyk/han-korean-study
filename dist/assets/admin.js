import { DECKS } from './decks.js';
import { inspectContent, inspectCategoryContent, summarizeLearning } from './admin-data.js?v=2';
import { readContentSnapshot } from './content-cache.js?v=2';
import { readContentDiagnostics, DIAGNOSTICS_KEY } from './content-diagnostics.js?v=2';
import { nextReviewFor } from './review.js?v=3';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const names = { kanji: '한漢', vocabulary: '単語', category_enshu: '演習セット（category_enshu）' };
const sourceNames = { remote: 'スプシ', cached: '保存済み教材', bundled: '同梱教材', unavailable: '教材なし' };
const routes = {
  overview: { path: '/admin/', title: '運用チェック', label: '概要' },
  content: { path: '/admin/content/', title: '教材・接続状態', label: '教材' },
  schema: { path: '/admin/schema/', title: 'CSV・セルの対応', label: 'CSV' },
  storage: { path: '/admin/storage/', title: 'ログイン・保存', label: '保存' },
  guide: { path: '/admin/guide/', title: '更新ガイド', label: 'ガイド' },
};
const config = window.APP_CONFIG || {};
const contentIds = [...DECKS.map(deck => deck.id), ...(config.categorySetsCsvUrl ? ['category_enshu'] : [])];
const results = new Map();
let checking = false;
const storage = { getItem: key => localStorage.getItem(key) };
const formatTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ja-JP', { timeZoneName: 'short' }) : '記録なし';
const number = value => Number(value || 0).toLocaleString('ja-JP');
const badge = (label, kind = '') => `<span class="status ${kind}">${esc(label)}</span>`;
const fact = (label, content) => `<div><dt>${esc(label)}</dt><dd>${content}</dd></div>`;
const dateFact = (label, time) => fact(label, esc(formatTime(time)));
const endpoint = id => id === 'category_enshu' ? config.categorySetsCsvUrl || '' : config.decks?.[id]?.csvUrl || '';
const inspectSource = (id, text) => id === 'category_enshu' ? inspectCategoryContent(text) : inspectContent(id, text);
const contentUnit = id => id === 'category_enshu' ? 'セット' : '枚';
const sourceName = (id, source) => id === 'category_enshu'
  ? ({ remote: 'スプシのセット定義', cached: '保存済みセット定義', unavailable: '定義未取得（教材のタグから自動生成）' })[source] || '未確認'
  : sourceNames[source] || '未確認';
const resultBadge = result => result?.ok ? badge('取得成功', 'ok')
  : result?.error ? badge(result.failureKind === 'input' ? 'CSV入力不備' : '取得失敗', 'error') : badge('確認中');

function readJSON(key) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}
function routeTo(key, push = false) {
  const route = routes[key] || routes.overview;
  $$('[data-page]').forEach(section => { section.hidden = routes[section.dataset.page] !== route; });
  $$('.sidebar [data-route]').forEach(link => {
    if (routes[link.dataset.route] === route) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('#page-title').textContent = route.title;
  $('#route-label').textContent = route.label;
  document.title = `${route.title} — 한と漢 管理`;
  if (push) { history.pushState({}, '', route.path); window.scrollTo(0, 0); }
}
function routeFromURL() {
  const path = location.pathname.replace(/\/?$/, '/');
  return Object.keys(routes).find(key => routes[key].path === path) || 'overview';
}
function cachedInfo(id) {
  const snapshot = readContentSnapshot(storage, id, endpoint(id));
  if (!snapshot) return null;
  try {
    const data = inspectSource(id, snapshot.text);
    return { ...data, ...(id === 'category_enshu' ? { invalid: !data.valid } : {}), fetchedAt: snapshot.fetchedAt };
  }
  catch { return { invalid: true, fetchedAt: snapshot.fetchedAt }; }
}
function renderOverview() {
  const succeeded = [...results.values()].filter(item => item.ok).length;
  const failed = [...results.values()].filter(item => item.error).length;
  const summary = summarizeLearning(readJSON('han-hanja:learning:v3'));
  $('#overview-cards').innerHTML = [
    ['教材の接続', checking ? '確認中' : `${succeeded} / ${contentIds.length} 成功`, failed ? `${failed}件の接続・CSV入力を確認してください` : '管理画面から現在のAPIを確認'],
    ['ログイン', '未導入', '学習記録はこのブラウザに保存'],
    ['記録のあるカード', number(summary.records), '読み書きの評価は教材・方向別に独立'],
  ].map(([label, value, note]) => `<article class="summary-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');
}
function renderContent() {
  const diagnostics = readContentDiagnostics(storage);
  $('#content-cards').innerHTML = contentIds.map(id => {
    const result = results.get(id), previous = diagnostics.decks[id], cached = cachedInfo(id);
    const state = resultBadge(result);
    let facts = fact('管理画面の確認', state) + dateFact('確認した時刻', result?.checkedAt);
    facts += fact('API', `<code>${esc(endpoint(id) || '未設定')}</code>${result?.httpStatus ? `<span class="small">HTTP ${esc(result.httpStatus)}${result.dataSource ? ` · ${esc(result.dataSource)}` : ''}</span>` : ''}`);
    if (result?.data) {
      const data = result.data;
      facts += fact(id === 'category_enshu' ? '有効なセット' : '有効なカード', `${number(data.count)} ${contentUnit(id)}`);
      if (id !== 'category_enshu') facts += fact(id === 'kanji' ? '必須文字' : 'TOPIK1参考例', `${number(id === 'kanji' ? data.essential : data.references)} 件`);
      facts += fact('CSVのデータ行', `${number(data.rawRows)} 行`);
      if (id === 'vocabulary') facts += fact('保持している分類', `${number(data.categories)} 種類`);
    }
    facts += fact('通常画面の前回読込', previous ? badge(sourceName(id, previous.source), previous.source === 'remote' ? 'ok' : 'warn') + `<span class="small">${number(previous.cardCount)}${contentUnit(id)} · ${esc(formatTime(previous.checkedAt))}</span>` : '未記録（通常画面を一度開くと記録）');
    facts += dateFact('通常画面の取得成功', previous?.lastSuccessAt);
    facts += fact(id === 'category_enshu' ? 'ブラウザの予備定義' : 'ブラウザの予備教材', cached ? cached.invalid ? badge('解析できません', 'error') + `<span class="small">取得：${esc(formatTime(cached.fetchedAt))}</span>` : `${number(cached.count)} ${contentUnit(id)}<span class="small">取得：${esc(formatTime(cached.fetchedAt))}</span>` : 'なし');
    const notes = [result?.error, ...(result?.data?.warnings || []), previous?.error ? `通常画面の直近エラー：${previous.error}` : '', id === 'category_enshu' && cached?.invalid ? `保存済み定義：${cached.error || '有効な演習セットがありません。'}` : ''].filter(Boolean);
    return `<section class="panel deck-panel"><div class="deck-title"><h2>${names[id]}</h2>${state}</div><dl class="facts">${facts}</dl>${notes.length ? `<p class="checks-note">${notes.map(esc).join('\n')}</p>` : ''}</section>`;
  }).join('');
}
function renderSchema() {
  $('#schema-tables').innerHTML = contentIds.map(id => {
    const result = results.get(id);
    if (!result?.data) return `<section class="panel"><h2>${names[id]}</h2><p class="muted">${esc(result?.error || 'CSVを確認しています。')} 接続に成功すると実際の列とセルを表示します。</p></section>`;
    const rows = result.data.columns.map(field => `<tr><td class="cell-name">${esc(field.cell)}</td><td><strong>${esc(field.header)}</strong></td><td>${esc(field.use)}</td><td class="sample">${field.sampleCell ? `<code>${esc(field.sampleCell)}</code><br>${esc(field.sample)}` : '空欄'}</td></tr>`).join('');
    const notes = [result.error, ...(result.data.warnings || [])].filter(Boolean);
    return `<section class="panel"><div class="schema-heading"><h2>${names[id]}</h2><p>${number(result.data.count)}${contentUnit(id)} · 取得 ${esc(formatTime(result.checkedAt))}</p></div>${notes.length ? `<p class="checks-note">${notes.map(esc).join('\n')}</p>` : ''}${rows ? `<div class="table-wrap"><table><thead><tr><th>見出しセル</th><th>実際の列名</th><th>アプリでの用途</th><th>実際のセルの例</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">表示できる見出し・セルがありません。</p>'}</section>`;
  }).join('');
}
function renderStorage() {
  const learning = readJSON('han-hanja:learning:v3');
  const summary = summarizeLearning(learning);
  const keys = [
    ['han-hanja:learning:v3', '評価・回数・履歴・復習日'],
    ['han-hanja:preferences:v4', '教材・読み書き・出題設定'],
    ['han-hanja:content:v1:kanji', '漢字教材の正常取得版'],
    ['han-hanja:content:v1:vocabulary', '単語教材の正常取得版'],
    ['han-hanja:content:v1:category_enshu', '演習セット定義の正常取得版'],
    [DIAGNOSTICS_KEY, '通常画面の教材取得状態'],
  ];
  let readable = true;
  const rows = keys.map(([key, purpose]) => {
    let raw = null;
    try { raw = storage.getItem(key); } catch { readable = false; }
    const size = raw ? `${(new TextEncoder().encode(raw).byteLength / 1024).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} KB` : '—';
    return `<tr><td><code>${key}</code></td><td>${purpose}</td><td>${raw ? '保存あり' : '未保存'}</td><td>${size}</td></tr>`;
  }).join('');
  $('#storage-summary').innerHTML = `<dl class="facts">${fact('保存領域の読み取り', readable ? badge('利用可能', 'ok') : badge('利用できません', 'error'))}${fact('記録のあるカード', `${number(summary.records)} 枚`)}${fact('쓰기の試行回数', `${number(summary.writing)} 回`)}${fact('읽기の試行回数', `${number(summary.reading)} 回`)}</dl><div class="table-wrap storage-keys"><table><thead><tr><th>保存キー</th><th>内容</th><th>状態</th><th>サイズ</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const schedules = learning?.version === 3 && learning.records && typeof learning.records === 'object'
    ? Object.entries(learning.records).flatMap(([id, record]) => ['write', 'read'].flatMap(mode => {
      const assessment = record?.assessments?.[mode];
      if (!assessment) return [];
      const schedule = nextReviewFor(record, mode);
      return schedule.dueAt ? [{ id, mode, assessment, ...schedule }] : [];
    })).sort((a, b) => (Date.parse(b.assessment.lastAt) || 0) - (Date.parse(a.assessment.lastAt) || 0)).slice(0, 30) : [];
  const symbols = { hard: '❌❌❌', again: '❌', unsure: '△', good: '○', solid: '◎', unseen: 'ー' };
  $('#storage-summary').insertAdjacentHTML('beforeend', `<h3>復習予定（最新30件）</h3>${schedules.length ? `<div class="table-wrap"><table><thead><tr><th>カードID</th><th>方向</th><th>評価</th><th>最終演習</th><th>次の復習</th><th>間隔</th></tr></thead><tbody>${schedules.map(row => `<tr><td><code>${esc(row.id)}</code></td><td>${row.mode === 'write' ? '쓰기' : '읽기'}</td><td>${symbols[row.assessment.rating] || 'ー'}</td><td>${esc(formatTime(row.assessment.lastAt))}</td><td>${esc(formatTime(row.dueAt))}</td><td>${number(row.intervalDays)}日</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">このブラウザには、日時付きの演習記録がまだありません。</p>'}`);
}
function render() { renderOverview(); renderContent(); renderSchema(); renderStorage(); }

async function inspectEndpoint(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs || 20000);
  let httpStatus = null;
  try {
    if (!endpoint(id)) throw new Error('教材APIが未設定です。');
    const url = new URL(endpoint(id), location.origin);
    if (url.origin !== location.origin) throw new Error('この確認画面は同じサイトの教材APIだけに接続します。');
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
    httpStatus = response.status;
    if (!response.ok) throw new Error(`HTTP ${response.status}：最新のCSVを取得できませんでした。`);
    if (/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('APIがCSVではなくHTMLを返しています。');
    const text = await response.text();
    if (text.length > 3 * 1024 * 1024) throw new Error('CSVがサイズ上限を超えています。');
    const data = inspectSource(id, text);
    const invalid = id === 'category_enshu' && !data.valid;
    return { ok: !invalid, httpStatus, dataSource: response.headers.get('x-data-source') || '', data, ...(invalid ? { failureKind: 'input', error: data.error } : {}), checkedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, httpStatus, error: controller.signal.aborted ? '取得がタイムアウトしました。' : error instanceof Error ? error.message : '接続を確認できませんでした。', checkedAt: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}
async function recheck() {
  if (checking) return;
  checking = true; $('#recheck').disabled = true; $('#recheck').textContent = '確認中…';
  results.clear(); render();
  await Promise.all(contentIds.map(async id => { results.set(id, await inspectEndpoint(id)); render(); }));
  checking = false; $('#recheck').disabled = false; $('#recheck').textContent = '接続を再確認'; render();
}
document.addEventListener('click', event => {
  const link = event.target.closest('[data-route]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault(); routeTo(link.dataset.route, true);
});
window.addEventListener('popstate', () => routeTo(routeFromURL()));
window.addEventListener('storage', event => { if (event.key === null || event.key?.startsWith('han-hanja:')) render(); });
$('#recheck').addEventListener('click', recheck);
$('#sheet-link').href = 'https://docs.google.com/spreadsheets/d/1eBOPXITG1MNnBZtNDk2mAFkxuRGqjtJVd7AtiiqtUkQ/edit';
routeTo(routeFromURL());
recheck();

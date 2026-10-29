import { DECKS } from './decks.js';
import { inspectContent, summarizeLearning } from './admin-data.js';
import { readContentSnapshot } from './content-cache.js?v=2';
import { readContentDiagnostics, DIAGNOSTICS_KEY } from './content-diagnostics.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const names = { kanji: '한漢', vocabulary: '単語' };
const sourceNames = { remote: 'スプシ', cached: '保存済み教材', bundled: '同梱教材', unavailable: '教材なし' };
const routes = {
  overview: { path: '/admin/', title: '運用チェック', label: '概要' },
  content: { path: '/admin/content/', title: '教材・接続状態', label: '教材' },
  schema: { path: '/admin/schema/', title: 'CSV・セルの対応', label: 'CSV' },
  storage: { path: '/admin/storage/', title: 'ログイン・保存', label: '保存' },
  guide: { path: '/admin/guide/', title: '更新ガイド', label: 'ガイド' },
};
const config = window.APP_CONFIG || {};
const results = new Map();
let checking = false;
const storage = { getItem: key => localStorage.getItem(key) };
const formatTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ja-JP', { timeZoneName: 'short' }) : '記録なし';
const number = value => Number(value || 0).toLocaleString('ja-JP');
const badge = (label, kind = '') => `<span class="status ${kind}">${esc(label)}</span>`;
const fact = (label, content) => `<div><dt>${esc(label)}</dt><dd>${content}</dd></div>`;
const dateFact = (label, time) => fact(label, esc(formatTime(time)));
const endpoint = id => config.decks?.[id]?.csvUrl || '';

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
  try { return { ...inspectContent(id, snapshot.text), fetchedAt: snapshot.fetchedAt }; }
  catch { return { invalid: true, fetchedAt: snapshot.fetchedAt }; }
}
function renderOverview() {
  const succeeded = [...results.values()].filter(item => item.ok).length;
  const failed = [...results.values()].filter(item => item.error).length;
  const summary = summarizeLearning(readJSON('han-hanja:learning:v3'));
  $('#overview-cards').innerHTML = [
    ['教材の接続', checking ? '確認中' : `${succeeded} / ${DECKS.length} 成功`, failed ? `${failed}教材の取得を確認してください` : '管理画面から現在のAPIを確認'],
    ['ログイン', '未導入', '学習記録はこのブラウザに保存'],
    ['記録のあるカード', number(summary.records), '読み書きの評価は教材・方向別に独立'],
  ].map(([label, value, note]) => `<article class="summary-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');
}
function renderContent() {
  const diagnostics = readContentDiagnostics(storage);
  $('#content-cards').innerHTML = ['kanji','vocabulary'].map(id => {
    const result = results.get(id), previous = diagnostics.decks[id], cached = cachedInfo(id);
    const state = result?.ok ? badge('取得成功', 'ok') : result?.error ? badge('取得失敗', 'error') : badge('確認中');
    let facts = fact('管理画面の確認', state) + dateFact('確認した時刻', result?.checkedAt);
    facts += fact('API', `<code>${esc(endpoint(id) || '未設定')}</code>${result?.httpStatus ? `<span class="small">HTTP ${esc(result.httpStatus)}${result.dataSource ? ` · ${esc(result.dataSource)}` : ''}</span>` : ''}`);
    if (result?.ok) {
      const data = result.data;
      facts += fact('有効なカード', `${number(data.count)} 枚`) + fact(id === 'kanji' ? '必須文字' : 'TOPIK1参考例', `${number(id === 'kanji' ? data.essential : data.references)} 件`);
      facts += fact('CSVのデータ行', `${number(data.rawRows)} 行`);
      if (id === 'vocabulary') facts += fact('保持している分類', `${number(data.categories)} 種類`);
    }
    facts += fact('通常画面の前回読込', previous ? badge(sourceNames[previous.source] || '未確認', previous.source === 'remote' ? 'ok' : 'warn') + `<span class="small">${number(previous.cardCount)}枚 · ${esc(formatTime(previous.checkedAt))}</span>` : '未記録（通常画面を一度開くと記録）');
    facts += dateFact('通常画面の取得成功', previous?.lastSuccessAt);
    facts += fact('ブラウザの予備教材', cached ? cached.invalid ? badge('解析できません', 'error') : `${number(cached.count)} 枚<span class="small">取得：${esc(formatTime(cached.fetchedAt))}</span>` : 'なし');
    const notes = [result?.error, ...(result?.data?.warnings || []), previous?.error ? `通常画面の直近エラー：${previous.error}` : ''].filter(Boolean);
    return `<section class="panel deck-panel"><div class="deck-title"><h2>${names[id]}</h2>${state}</div><dl class="facts">${facts}</dl>${notes.length ? `<p class="checks-note">${notes.map(esc).join('\n')}</p>` : ''}</section>`;
  }).join('');
}
function renderSchema() {
  $('#schema-tables').innerHTML = ['kanji','vocabulary'].map(id => {
    const result = results.get(id);
    if (!result?.ok) return `<section class="panel"><h2>${names[id]}</h2><p class="muted">${esc(result?.error || 'CSVを確認しています。')} 接続に成功すると実際の列とセルを表示します。</p></section>`;
    const rows = result.data.columns.map(field => `<tr><td class="cell-name">${esc(field.cell)}</td><td><strong>${esc(field.header)}</strong></td><td>${esc(field.use)}</td><td class="sample">${field.sampleCell ? `<code>${esc(field.sampleCell)}</code><br>${esc(field.sample)}` : '空欄'}</td></tr>`).join('');
    return `<section class="panel"><div class="schema-heading"><h2>${names[id]}</h2><p>${number(result.data.count)}枚 · 取得 ${esc(formatTime(result.checkedAt))}</p></div><div class="table-wrap"><table><thead><tr><th>見出しセル</th><th>実際の列名</th><th>アプリでの用途</th><th>実際のセルの例</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join('');
}
function renderStorage() {
  const summary = summarizeLearning(readJSON('han-hanja:learning:v3'));
  const keys = [
    ['han-hanja:learning:v3', '評価・回数・履歴・復習日'],
    ['han-hanja:preferences:v4', '教材・読み書き・出題設定'],
    ['han-hanja:content:v1:kanji', '漢字教材の正常取得版'],
    ['han-hanja:content:v1:vocabulary', '単語教材の正常取得版'],
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
    return { ok: true, httpStatus, dataSource: response.headers.get('x-data-source') || '', data: inspectContent(id, text), checkedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, httpStatus, error: controller.signal.aborted ? '取得がタイムアウトしました。' : error instanceof Error ? error.message : '接続を確認できませんでした。', checkedAt: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}
async function recheck() {
  if (checking) return;
  checking = true; $('#recheck').disabled = true; $('#recheck').textContent = '確認中…';
  results.clear(); render();
  await Promise.all(['kanji','vocabulary'].map(async id => { results.set(id, await inspectEndpoint(id)); render(); }));
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

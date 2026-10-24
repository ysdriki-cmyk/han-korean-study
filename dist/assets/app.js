import { makeSession } from './core.js';
import { DECKS, getDeck, parseDeck, restoreLearningRecords, answerFields } from './decks.js';
import { matchVocabularyAnswer } from './vocabulary.js';
import { RANKS, getRecord, setRank, recordRecall, recordWriting, matchHangul } from './learning.js';
import { practiceSettings, practicePool } from './practice.js';
import { icon } from './icons.js?v=2';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const config = window.APP_CONFIG || {};
const RECORD_KEY = 'han-hanja:learning:v3', PREF_KEY = 'han-hanja:preferences:v3';
const rankById = new Map(RANKS.map(rank => [rank.id, rank]));
const pageSize = 30;
let cards = [], records = Object.create(null), view = 'study', activeDeck = 'vocabulary';
let preferences = { courses: {} }, settings = practiceSettings(), deckData = new Map();
let session = [], position = 0, revealed = false, writeResult = null, submitted = '';
let answers = new Map(), cycleSeen = new Set();
let rankFilter = 'all', page = 0, selected = new Set(), revealedRows = new Set(), pageCards = [];
let loaded = false, storageAvailable = true, polling = false, composing = false, compositionEndedAt = 0, toastTimer;

function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function notice(text, error = false) {
  if (!storageAvailable && !text) text = 'このブラウザでは記録を保存できません。サイトデータの保存を許可してください。';
  $('#notice').textContent = text; $('#notice').hidden = !text;
  $('#notice').classList.toggle('error', error || !storageAvailable);
}
function safeWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { storageAvailable = false; $('#save-status').textContent = '一時記録'; notice('このブラウザでは記録を保存できません。サイトデータの保存を許可すると、続きから演習できます。', true); return false; }
}
function toast(text, error = false) {
  clearTimeout(toastTimer); const el = $('#toast'); if (!el) return;
  el.textContent = text; el.hidden = false; el.classList.toggle('error', error);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}
function record(card) { return getRecord(card, records); }
function rank(card) { return record(card).rank; }
function badge(id) { return `<span class="rank-badge rank-${id}">${esc(rankById.get(id)?.label || '')}</span>`; }
function saveRecords() { safeWrite(RECORD_KEY, { version: 3, records }); }
function savePreferences() {
  preferences.deckId = activeDeck;
  preferences.courses[activeDeck] = { ...preferences.courses[activeDeck], ...settings };
  safeWrite(PREF_KEY, preferences);
}
function counts() {
  const result = Object.fromEntries(RANKS.map(item => [item.id, 0]));
  cards.forEach(card => { result[rank(card)] += 1; }); return result;
}
function pool() { return practicePool(cards, records, settings); }
function updateCourseChrome() {
  const deck = getDeck(activeDeck), target = deck.answerLabel;
  $$('[data-deck]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.deck === activeDeck));
    button.disabled = loaded && !deckData.has(button.dataset.deck);
  });
  $$('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode)));
  for (const item of DECKS) {
    const el = $(`#deck-${item.id}-count`);
    if (el) el.textContent = deckData.has(item.id) ? deckData.get(item.id).cards.length.toLocaleString('ja-JP') : '—';
  }
  $('#read-mode-caption').textContent = `韓国語 → ${target}`;
  $('#write-mode-caption').textContent = `${target} → 韓国語`;
  $('#library-answer-label').textContent = target;
  const searchText = activeDeck === 'vocabulary' ? '韓国語・日本語・英語を検索' : 'ハングル・漢字・意味を検索';
  $('#library-search').placeholder = searchText; $('#library-search').setAttribute('aria-label', searchText);
  document.title = `한と漢 — ${activeDeck === 'vocabulary' ? '単語暗記' : '漢字対応'}`;
}
function renderOverview() {
  const totals = counts(), mastered = totals.mastered + totals.read + totals.read2;
  $('#nav-count').textContent = cards.length.toLocaleString('ja-JP');
  $('#library-total').textContent = cards.length.toLocaleString('ja-JP');
  $('#settled-count').textContent = mastered.toLocaleString('ja-JP');
  $('#settled-percent').textContent = `${cards.length ? Math.round(mastered / cards.length * 100) : 0}%`;
  $('#rank-distribution').innerHTML = RANKS.filter(item => totals[item.id]).map(item => `<span class="rank-${item.id}" style="width:${totals[item.id] / cards.length * 100}%" title="${esc(item.label)} ${totals[item.id]}枚"></span>`).join('');
  $('#rank-distribution').setAttribute('role', 'img');
  $('#rank-distribution').setAttribute('aria-label', RANKS.map(item => `${item.label}${totals[item.id]}枚`).join('、'));
  $('#rank-board').innerHTML = RANKS.map(item => `<button class="rank-tile rank-${item.id}" data-rank-tile="${item.id}">${badge(item.id)}<strong>${totals[item.id].toLocaleString('ja-JP')}<small>枚</small></strong></button>`).join('');
  $('#rank-filters').innerHTML = `<button class="rank-filter" data-rank-filter="all" aria-pressed="${rankFilter === 'all'}">すべて <strong>${cards.length}</strong></button>` + RANKS.map(item => `<button class="rank-filter" data-rank-filter="${item.id}" aria-pressed="${rankFilter === item.id}"><span class="rank-dot rank-${item.id}"></span>${esc(item.label)} <strong>${totals[item.id]}</strong></button>`).join('');
  renderSessionStats();
}
function renderSessionStats() {
  const right = [...answers.values()].filter(answer => answer.passed).length;
  $('#session-done').textContent = answers.size; $('#session-total').textContent = session.length;
  $('#session-score').textContent = `正解 ${right}`;
  $('#session-progress').style.width = `${session.length ? answers.size / session.length * 100 : 0}%`;
  $('.session-progress').setAttribute('aria-valuemax', String(session.length));
  $('.session-progress').setAttribute('aria-valuenow', String(answers.size));
}
function syncSettingsForm() {
  $('#practice-filter').value = settings.filter; $('#session-limit').value = settings.limit; $('#shuffle').checked = settings.shuffle;
}
function startSession(custom = null, { continuing = false, all = false } = {}) {
  composing = false; compositionEndedAt = 0;
  if (!continuing) cycleSeen = new Set();
  session = makeSession(custom ?? pool(), { limit: all ? 'all' : settings.limit, shuffle: settings.shuffle });
  position = 0; revealed = false; writeResult = null; submitted = ''; answers = new Map();
  updateCourseChrome(); renderOverview(); renderCard();
}
function switchDeck(id) {
  if (!DECKS.some(deck => deck.id === id) || id === activeDeck || !deckData.has(id)) return;
  savePreferences(); activeDeck = id; settings = practiceSettings(preferences.courses[id]);
  cards = deckData.get(id).cards; selected.clear(); revealedRows.clear(); rankFilter = 'all'; page = 0;
  $('#library-search').value = ''; syncSettingsForm(); startSession(); renderLibrary(); savePreferences();
}
function switchMode(mode) {
  if (!['read', 'write'].includes(mode) || mode === settings.mode) return;
  settings.mode = mode; savePreferences(); startSession();
}
function answerRows(card) {
  const main = settings.mode === 'write'
    ? `<div class="answer-row"><span class="answer-label">韓国語</span><p class="answer-value hangul" lang="ko">${esc(card.han)}</p></div>`
    : answerFields(card, activeDeck).map(field => `<div class="answer-row"><span class="answer-label">${esc(field.label)}</span><p class="answer-value" lang="${field.lang}">${esc(field.text)}</p></div>`).join('');
  const examples = activeDeck === 'vocabulary' && (card.exampleKo || card.exampleJp)
    ? `<details class="example-block"><summary>例文</summary>${card.exampleKo ? `<p lang="ko">${esc(card.exampleKo)}</p>` : ''}${card.exampleJp ? `<p lang="ja">${esc(card.exampleJp)}</p>` : ''}</details>` : '';
  return main + examples;
}
function questionMarkup(card) {
  if (settings.mode === 'read') return `<p class="question-word${card.han.length > 4 ? ' long' : ''}" lang="ko">${esc(card.han)}</p>`;
  if (activeDeck === 'vocabulary') {
    const japanese = card.kanji, english = card.english || card.meaning;
    return `<p class="question-word reverse" lang="${japanese ? 'ja' : 'en'}">${esc(japanese || english)}</p>${japanese && english ? `<p class="question-english" lang="en">${esc(english)}</p>` : ''}`;
  }
  return `<p class="question-word reverse" lang="ja">${esc(answerFields(card, activeDeck).map(field => field.text).join('\n'))}</p>`;
}
function renderCard() {
  const el = $('#flashcard'); el.setAttribute('aria-busy', String(!loaded)); el.dataset.mode = settings.mode; el.classList.toggle('revealed', revealed);
  if (!loaded) return;
  if (!cards.length) { el.innerHTML = '<div class="empty-state"><h2>データを読み込めませんでした</h2><button class="button primary" data-action="reload">再読み込み</button></div>'; return; }
  if (!session.length) { el.innerHTML = '<div class="empty-state"><h2>該当するカードがありません</h2><button class="button primary" data-action="settings">出題設定を変更</button></div>'; return; }
  if (position >= session.length) { renderComplete(el); return; }
  const card = session[position], current = record(card), writing = settings.mode === 'write';
  let actions;
  if (writing) {
    actions = writeResult === null
      ? `<button type="submit" form="write-form" class="reveal-button" id="check-writing">答えを確認</button><button type="button" class="text-button" data-action="skip-writing">答えを見る</button>`
      : '<button id="next-writing" class="reveal-button" data-action="advance">次へ</button>';
  } else if (!revealed) actions = '<button id="reveal-card" class="reveal-button" data-action="reveal">答えを見る</button>';
  else actions = `<div class="rating-buttons${current.rank === 'fair' ? ' three' : ''}"><button id="rate-again" class="rating-review" data-action="again">もう一度</button>${current.rank === 'fair' ? '<button class="rating-fair" data-action="stay-fair">練習中のまま</button>' : ''}<button id="rate-right" class="rating-right" data-action="right">${current.rank === 'fair' ? '覚えた' : '答えられた'}</button></div>`;
  el.innerHTML = `<div class="card-topline"><div class="card-kicker"><span class="card-type">${writing ? esc(getDeck(activeDeck).answerLabel) : '韓国語'}</span><span class="card-number">${position + 1} / ${session.length}</span></div>${badge(current.rank)}</div><div class="question-area">${questionMarkup(card)}${writing && writeResult === null ? '<form id="write-form" class="write-form"><label class="sr-only" for="hangul-input">韓国語の答え</label><input id="hangul-input" placeholder="韓国語を入力" lang="ko" autocomplete="off" autocapitalize="off" spellcheck="false" required></form>' : ''}</div>${writing && writeResult !== null ? `<div class="result-banner${writeResult ? '' : ' wrong'}" role="status">${writeResult ? '正解' : '不正解'}</div>${submitted && !writeResult ? `<p class="write-submission">入力した答え：<span lang="ko">${esc(submitted)}</span></p>` : ''}` : ''}${revealed ? `<div class="answer-panel">${answerRows(card)}</div>` : ''}<div class="card-action-area">${actions}</div>`;
}
function renderComplete(el) {
  const right = [...answers.values()].filter(answer => answer.passed).length;
  const retry = session.filter(card => answers.get(card.id)?.passed === false);
  el.innerHTML = `<div class="complete-state"><h2>セット完了</h2><p>${session.length}枚中 ${right}枚正解</p><div class="complete-actions">${retry.length ? `<button class="button secondary" data-action="retry">間違えた${retry.length}枚を再演習</button>` : ''}<button class="button primary" data-action="next-set">次のセット</button></div></div>`;
}
function reveal() {
  if (!session[position] || revealed || settings.mode !== 'read') return;
  revealed = true; renderCard(); $('#rate-right')?.focus({ preventScroll: true });
}
function finishRecall(passed, { stay = false } = {}) {
  const card = session[position]; if (!card || !revealed || settings.mode !== 'read') return;
  let next = recordRecall(record(card), 'ko-han', passed);
  if (stay) next = setRank(next, 'fair');
  records[card.id] = next; answers.set(card.id, { passed, rank: next.rank }); saveRecords(); advance();
}
function checkWriting(skipped = false) {
  const card = session[position]; if (!card || writeResult !== null || composing || settings.mode !== 'write') return;
  const input = $('#hangul-input'); submitted = input?.value.trim() || '';
  if (!skipped && !submitted) { input?.reportValidity(); return; }
  const passed = !skipped && (activeDeck === 'vocabulary' ? matchVocabularyAnswer(submitted, card) : matchHangul(submitted, card.han));
  records[card.id] = recordWriting(record(card), passed); answers.set(card.id, { passed, rank: records[card.id].rank });
  writeResult = passed; revealed = true; saveRecords(); renderOverview(); renderCard(); $('#next-writing')?.focus({ preventScroll: true });
}
function advance() {
  position += 1; revealed = false; writeResult = null; submitted = ''; composing = false;
  renderOverview(); renderCard(); ($('#reveal-card') || $('#hangul-input') || $('.complete-actions .button'))?.focus({ preventScroll: true });
}
function setView(next, { hash = true } = {}) {
  view = ['study', 'library', 'progress'].includes(next) ? next : 'study';
  $$('.view').forEach(el => { el.hidden = el.id !== `${view}-view`; });
  $$('.main-nav [data-view]').forEach(button => {
    const active = button.dataset.view === view; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (hash && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (view === 'library') renderLibrary(); else if (view === 'study') renderCard();
}
function renderLibrary() {
  const query = $('#library-search').value.normalize('NFC').trim().toLowerCase();
  const matching = cards.filter(card => (rankFilter === 'all' || rank(card) === rankFilter)
    && (!query || [card.id, card.han, card.kanji, card.hanja, card.meaning, card.tags, card.notes].some(text => String(text || '').normalize('NFC').toLowerCase().includes(query))));
  page = Math.max(0, Math.min(page, Math.ceil(matching.length / pageSize) - 1));
  pageCards = matching.slice(page * pageSize, (page + 1) * pageSize);
  const hide = $('#library-hide').checked;
  $('#library-body').innerHTML = pageCards.length ? pageCards.map(card => {
    const id = esc(card.id), current = rank(card), mask = hide && !revealedRows.has(card.id);
    const hideHan = mask && settings.libraryDirection === 'han-ko', hideMean = mask && settings.libraryDirection === 'ko-han';
    const accessibleName = hideHan ? 'このカード' : esc(card.han);
    const revealButton = `<button class="masked-answer" data-reveal-row="${id}">表示</button>`;
    const options = RANKS.map(item => `<option value="${item.id}"${item.id === current ? ' selected' : ''}>${esc(item.label)}</option>`).join('');
    const fields = answerFields(card, activeDeck);
    const text = fields.map((field, index) => index ? `<small lang="${field.lang}">${esc(field.text)}</small>` : `<span lang="${field.lang}">${esc(field.text)}</span>`).join('');
    return `<tr><td><input type="checkbox" data-select-card="${id}" aria-label="${accessibleName}を選ぶ"${selected.has(card.id) ? ' checked' : ''}></td><td class="han-cell">${hideHan ? revealButton : `<span lang="ko">${esc(card.han)}</span>`}</td><td class="meaning-cell">${hideMean ? revealButton : text}</td><td><select class="rank-select rank-${current}" data-set-rank="${id}" aria-label="${accessibleName}のランク">${options}</select></td><td><button class="table-queue" data-queue-card="${id}" aria-label="${accessibleName}で演習">演習</button></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty-row">該当するカードがありません</td></tr>';
  $('#page-info').textContent = matching.length ? `${page * pageSize + 1} – ${Math.min((page + 1) * pageSize, matching.length)} / ${matching.length}枚` : '0枚';
  $('#prev-page').disabled = page === 0; $('#next-page').disabled = (page + 1) * pageSize >= matching.length;
  $('#library-direction').textContent = settings.libraryDirection === 'ko-han' ? `韓 → ${getDeck(activeDeck).answerShort}` : `${getDeck(activeDeck).answerShort} → 韓`;
  updateSelection();
}
function updateSelection() {
  const present = new Set(cards.map(card => card.id)); selected = new Set([...selected].filter(id => present.has(id)));
  $('#selection-count').textContent = `${selected.size}枚選択`; $('#queue-selected').disabled = !selected.size;
  $('#select-page').checked = !!pageCards.length && pageCards.every(card => selected.has(card.id));
  $('#select-page').indeterminate = pageCards.some(card => selected.has(card.id)) && !$('#select-page').checked;
}
function practiceSelected(ids) {
  const selectedCards = cards.filter(card => ids.has(card.id)); if (!selectedCards.length) return;
  // Selecting a set is a navigation action. It never changes any learning rank.
  selected.clear(); startSession(selectedCards, { all: true }); setView('study'); renderLibrary();
}
function filteredLibrary(id) { rankFilter = id; page = 0; selected.clear(); renderOverview(); setView('library'); }
function courseConfig(id) {
  const course = config.decks?.[id] || {};
  return { csvUrl: course.csvUrl || (id === 'kanji' ? config.csvUrl : '') || '', fallbackCsvUrl: course.fallbackCsvUrl || (id === 'kanji' ? config.fallbackCsvUrl : '') || getDeck(id).path };
}
async function fetchText(url, deckId) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs || 10000);
  try {
    const target = new URL(url, location.href);
    if (target.protocol !== 'https:' && target.origin !== location.origin) throw new Error('取得先を確認してください。');
    const response = await fetch(target, { signal: controller.signal, cache: 'no-store', credentials: target.origin === location.origin ? 'same-origin' : 'omit' });
    if (!response.ok) throw new Error('学習データを取得できませんでした。');
    const text = await response.text(); if (text.length > 3 * 1024 * 1024) throw new Error('学習データを読み込めませんでした。');
    return { text, ...parseDeck(deckId, text) };
  } finally { clearTimeout(timer); }
}
function restoreRecords() {
  records = restoreLearningRecords(readJSON(RECORD_KEY, null), readJSON('han-hanja:learning:v2', null), readJSON('han-hanja:progress:v1', {})); saveRecords();
}
async function loadCourse(id) {
  const source = courseConfig(id);
  if (source.csvUrl) { try { return await fetchText(source.csvUrl, id); } catch { notice('更新データを取得できないため、保存済みの教材を表示しています。'); } }
  return fetchText(source.fallbackCsvUrl, id);
}
async function refreshRemote() {
  if (polling || document.visibilityState !== 'visible') return; polling = true;
  try {
    for (const deck of DECKS) {
      const source = courseConfig(deck.id); if (!source.csvUrl) continue;
      const result = await fetchText(source.csvUrl, deck.id);
      if (result.text !== deckData.get(deck.id)?.text) {
        deckData.set(deck.id, result); updateCourseChrome();
        if (deck.id === activeDeck) { cards = result.cards; renderOverview(); renderLibrary(); toast('教材を更新しました。今のセットは続けられます。'); }
      }
    }
    notice('');
  } catch { notice('教材の更新を確認できませんでした。今の教材で演習を続けられます。'); }
  finally { polling = false; }
}
function openSettings() { syncSettingsForm(); $('#practice-settings').showModal(); }
function handleCardAction(action) {
  if (action === 'reveal') reveal();
  else if (action === 'right') finishRecall(true);
  else if (action === 'again') finishRecall(false);
  else if (action === 'stay-fair') finishRecall(true, { stay: true });
  else if (action === 'advance') advance();
  else if (action === 'skip-writing') checkWriting(true);
  else if (action === 'reload') location.reload();
  else if (action === 'settings') openSettings();
  else if (action === 'retry') startSession(session.filter(card => answers.get(card.id)?.passed === false), { all: true });
  else if (action === 'next-set') {
    session.forEach(card => cycleSeen.add(card.id));
    let remaining = pool().filter(card => !cycleSeen.has(card.id));
    if (!remaining.length) { cycleSeen.clear(); remaining = pool(); }
    startSession(remaining, { continuing: true });
  }
}
function bind() {
  document.addEventListener('click', event => {
    const target = event.target.closest('button,a'); if (!target) return;
    if (target.dataset.deck && loaded) switchDeck(target.dataset.deck);
    if (target.dataset.mode && loaded) switchMode(target.dataset.mode);
    if (target.dataset.view) setView(target.dataset.view);
    if (target.dataset.action) handleCardAction(target.dataset.action);
    if (target.dataset.rankFilter) filteredLibrary(target.dataset.rankFilter);
    if (target.dataset.rankTile) filteredLibrary(target.dataset.rankTile);
    if (target.dataset.revealRow) { revealedRows.add(target.dataset.revealRow); renderLibrary(); }
    if (target.dataset.queueCard) practiceSelected(new Set([target.dataset.queueCard]));
  });
  $('#flashcard').addEventListener('compositionstart', () => { composing = true; });
  $('#flashcard').addEventListener('compositionend', () => { composing = false; compositionEndedAt = performance.now(); });
  $('#flashcard').addEventListener('keydown', event => {
    if (event.target.id === 'hangul-input' && event.key === 'Enter'
      && (event.isComposing || composing || event.keyCode === 229 || (compositionEndedAt > 0 && performance.now() - compositionEndedAt < 120))) event.preventDefault();
  });
  $('#flashcard').addEventListener('submit', event => {
    if (event.target.id === 'write-form') { event.preventDefault(); if (!composing) checkWriting(); }
  });
  $('#new-session').onclick = () => startSession();
  $('#open-settings').onclick = openSettings;
  $('#close-settings').onclick = () => $('#practice-settings').close();
  $('#settings-form').onsubmit = event => {
    event.preventDefault(); settings = practiceSettings({ ...settings, filter: $('#practice-filter').value, limit: $('#session-limit').value, shuffle: $('#shuffle').checked });
    savePreferences(); $('#practice-settings').close(); startSession();
  };
  $('#library-search').oninput = () => { page = 0; renderLibrary(); };
  $('#library-hide').onchange = () => { revealedRows.clear(); renderLibrary(); };
  $('#library-direction').onclick = () => { settings.libraryDirection = settings.libraryDirection === 'ko-han' ? 'han-ko' : 'ko-han'; savePreferences(); revealedRows.clear(); renderLibrary(); };
  $('#library-body').onchange = event => {
    const el = event.target;
    if (el.dataset.selectCard) { if (el.checked) selected.add(el.dataset.selectCard); else selected.delete(el.dataset.selectCard); updateSelection(); }
    if (el.dataset.setRank) {
      const card = cards.find(item => item.id === el.dataset.setRank);
      if (card) { records[card.id] = setRank(record(card), el.value); saveRecords(); renderOverview(); renderLibrary(); }
    }
  };
  $('#select-page').onchange = event => { pageCards.forEach(card => { if (event.target.checked) selected.add(card.id); else selected.delete(card.id); }); renderLibrary(); };
  $('#queue-selected').onclick = () => practiceSelected(new Set(selected));
  $('#prev-page').onclick = () => { page -= 1; renderLibrary(); }; $('#next-page').onclick = () => { page += 1; renderLibrary(); };
  window.addEventListener('hashchange', () => setView(location.hash.slice(1), { hash: false }));
  document.addEventListener('keydown', event => {
    if (view !== 'study' || settings.mode !== 'read' || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || $('#practice-settings').open) return;
    const target = event.target; if (target.closest('input,select,textarea,[contenteditable=true]')) return;
    if (event.code === 'Space' && !revealed && (!target.closest('button,a') || target.closest('#reveal-card'))) { event.preventDefault(); reveal(); }
    else if (revealed && ['1', '2'].includes(event.key)) { event.preventDefault(); finishRecall(event.key === '2'); }
  });
}
async function init() {
  $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); bind();
  const savedPref = readJSON(PREF_KEY, null), oldPref = readJSON('han-hanja:preferences:v2', {});
  if (savedPref?.courses && typeof savedPref.courses === 'object' && !Array.isArray(savedPref.courses)) preferences = { courses: { ...savedPref.courses } };
  else preferences = { courses: { kanji: oldPref && typeof oldPref === 'object' ? oldPref : {} } };
  activeDeck = getDeck(savedPref?.deckId || config.defaultDeck).id; settings = practiceSettings(preferences.courses[activeDeck]);
  syncSettingsForm(); updateCourseChrome(); setView(location.hash.slice(1), { hash: false });
  const results = await Promise.allSettled(DECKS.map(deck => loadCourse(deck.id)));
  results.forEach((result, index) => { if (result.status === 'fulfilled') deckData.set(DECKS[index].id, result.value); });
  if (!deckData.has(activeDeck) && deckData.size) {
    activeDeck = deckData.keys().next().value; settings = practiceSettings(preferences.courses[activeDeck]);
    notice('選んだ教材を開けなかったため、別の教材を表示しています。', true);
  }
  cards = deckData.get(activeDeck)?.cards || []; restoreRecords(); loaded = true; syncSettingsForm(); startSession(); renderLibrary(); savePreferences();
  if (!cards.length) notice('学習データを読み込めませんでした。通信を確認して再読み込みしてください。', true);
  if (DECKS.some(deck => courseConfig(deck.id).csvUrl)) setInterval(refreshRemote, config.refreshIntervalMs || 60000);
}
init().catch(() => { loaded = true; notice('画面を開けませんでした。再読み込みしてください。', true); renderCard(); });

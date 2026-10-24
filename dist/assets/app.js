import { makeSession } from './core.js';
import { DECKS, getDeck, parseDeck, restoreLearningRecords, answerFields } from './decks.js';
import { matchVocabularyAnswer } from './vocabulary.js';
import { getRecord, matchHangul } from './learning.js';
import { RATINGS, UNSEEN, ratingFor, recordAssessment } from './assessment.js';
import { practiceSettings, practicePool, restorePracticePreferences } from './practice.js?v=10';
import { essentialKanji, kanjiPromptChoices, kanjiAnswersForPrompt } from './kanji.js';
import { applyReviewSchedule, insertRetry, nextReviewFor } from './review.js';
import { icon } from './icons.js?v=2';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const config = window.APP_CONFIG || {};
const RECORD_KEY = 'han-hanja:learning:v3', PREF_KEY = 'han-hanja:preferences:v4';
const STATUSES = [...RATINGS, UNSEEN];
const ratingById = new Map(STATUSES.map(item => [item.id, item]));
const ratingLabels = { hard: '全然', again: 'もう一度', unsure: 'あいまい', good: 'できた', solid: '自信あり', unseen: '未演習' };
let draftSettings = null;
const pageSize = 30;
let cards = [], records = Object.create(null), view = 'study', activeDeck = 'kanji';
let preferences = { courses: {} }, settings = practiceSettings(), deckData = new Map();
let session = [], position = 0, revealed = false, writeResult = null, submitted = '';
let answers = new Map(), cycleSeen = new Set(), hintSeeds = new Map(), initialCount = 0, sessionScope = 'essential';
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
function rank(card) { return ratingFor(card, records, settings.mode); }
function badge(id) { const item = ratingById.get(id) || UNSEEN; return `<span class="assessment-badge rating-${item.id}" title="${esc(item.label)}"><span class="rating-symbol">${item.symbol}</span><span>${ratingLabels[item.id]}</span></span>`; }
function saveRecords() { safeWrite(RECORD_KEY, { version: 3, records }); }
function savePreferences() {
  preferences.version = 4; preferences.deckId = activeDeck;
  preferences.courses[activeDeck] = { ...preferences.courses[activeDeck], ...settings };
  safeWrite(PREF_KEY, preferences);
}
function counts() {
  const result = Object.fromEntries(STATUSES.map(item => [item.id, 0]));
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
  const shortTarget = activeDeck === 'kanji' ? '漢' : '訳';
  $('#read-mode-label').textContent = `읽기（한→${shortTarget}）`;
  $('#write-mode-label').textContent = `쓰기（${shortTarget}→한）`;
  $('#library-answer-label').textContent = target;
  const searchText = activeDeck === 'vocabulary' ? '韓国語・日本語・英語を検索' : 'ハングル・漢字・意味を検索';
  $('#library-search').placeholder = searchText; $('#library-search').setAttribute('aria-label', searchText);
  document.title = `한と漢 — ${activeDeck === 'vocabulary' ? '単語暗記' : '漢字対応'}`;
}
function renderOverview() {
  const totals = counts(), mastered = totals.good + totals.solid;
  $('#nav-count').textContent = cards.length.toLocaleString('ja-JP');
  $('#library-total').textContent = cards.length.toLocaleString('ja-JP');
  $('#settled-count').textContent = mastered.toLocaleString('ja-JP');
  $('#settled-percent').textContent = `${cards.length ? Math.round(mastered / cards.length * 100) : 0}%`;
  $('#rank-distribution').innerHTML = STATUSES.filter(item => totals[item.id]).map(item => `<span class="rating-${item.id}" style="width:${totals[item.id] / cards.length * 100}%;background:var(--rating-line)" title="${esc(item.symbol)} ${totals[item.id]}枚"></span>`).join('');
  $('#rank-distribution').setAttribute('role', 'img');
  $('#rank-distribution').setAttribute('aria-label', STATUSES.map(item => `${item.label}${totals[item.id]}枚`).join('、'));
  $('#rank-board').innerHTML = STATUSES.map(item => `<button class="rank-tile rating-${item.id}" data-rank-tile="${item.id}">${badge(item.id)}<strong>${totals[item.id].toLocaleString('ja-JP')}<small>枚</small></strong></button>`).join('');
  $('#rank-filters').innerHTML = `<button data-rank-filter="all" aria-pressed="${rankFilter === 'all'}">すべて <strong>${cards.length.toLocaleString('ja-JP')}</strong></button>` + STATUSES.map(item => `<button class="rating-${item.id}" data-rank-filter="${item.id}" aria-pressed="${rankFilter === item.id}" aria-label="${esc(item.label)} ${totals[item.id]}枚"><span class="rating-symbol">${item.symbol}</span>${item.id === 'unseen' ? '<span>未演習</span>' : ''}<strong>${totals[item.id].toLocaleString('ja-JP')}</strong></button>`).join('');
  renderSessionStats();
}
function renderSessionStats() {
  const right = [...answers.values()].filter(answer => answer.passed).length;
  $('.session-label').textContent = activeDeck === 'kanji' && sessionScope === 'essential' ? '1周目' : '進捗';
  $('#session-done').textContent = answers.size; $('#session-total').textContent = session.length;
  $('#session-score').textContent = `${settings.mode === 'write' ? '正解' : '○・◎'} ${right}`;
  $('#session-progress').style.width = `${session.length ? answers.size / session.length * 100 : 0}%`;
  $('.session-progress').setAttribute('aria-valuemax', String(session.length));
  $('.session-progress').setAttribute('aria-valuenow', String(answers.size));
}
function syncSettingsForm() { draftSettings = { ...settings, ratings: [...settings.ratings] }; }
function choiceButtons(field, options) {
  return options.map(([value, label]) => `<button type="button" class="choice-chip" data-choice="${field}" data-choice-value="${value}" aria-pressed="${String(draftSettings[field]) === String(value)}">${label}</button>`).join('');
}
function renderSettings() {
  if (!draftSettings) syncSettingsForm();
  const scopedCards = activeDeck === 'kanji' && draftSettings.scope === 'essential' ? cards.filter(essentialKanji) : cards;
  const totals = Object.fromEntries(STATUSES.map(item => [item.id, 0]));
  scopedCards.forEach(card => { totals[rank(card)] += 1; });
  const presets = [{id:'default', label:'未演習・❌以下', ratings:['hard','again','unseen']}, {id:'all', label:'すべて', ratings:STATUSES.map(item => item.id)}, {id:'weak', label:'苦手を集中', ratings:['hard','again','unsure']}, {id:'new', label:'未演習から', ratings:['unseen']}];
  $('#settings-presets').innerHTML = presets.map(item => `<button type="button" class="preset-button" data-preset="${item.id}" aria-pressed="${!draftSettings.recentMistakesDays && !draftSettings.excludeRecentDays && item.ratings.length === draftSettings.ratings.length && item.ratings.every(id => draftSettings.ratings.includes(id))}">${item.label}</button>`).join('');
  $('#settings-ratings').innerHTML = STATUSES.map(item => `<button type="button" class="rating-choice rating-${item.id}" data-settings-rating="${item.id}" aria-pressed="${draftSettings.ratings.includes(item.id)}" aria-label="${esc(item.label)} ${totals[item.id]}枚"><span class="rating-symbol">${item.symbol}</span><span class="rating-label">${ratingLabels[item.id]}</span><span class="rating-count">${totals[item.id].toLocaleString('ja-JP')}枚</span></button>`).join('');
  $('#settings-limit').innerHTML = choiceButtons('limit', [['10','10枚'],['20','20枚'],['30','30枚'],['50','50枚'],['all','すべて']]);
  $('#settings-scope-section').hidden = activeDeck !== 'kanji';
  const requiredCount = cards.filter(essentialKanji).length;
  $('#settings-scope').innerHTML = choiceButtons('scope', [['essential',`1周目・必須文字 ${requiredCount}枚`],['all',`全問題 ${cards.length}枚`]]);
  $('#settings-due').checked = draftSettings.includeDue;
  $('#settings-order').innerHTML = choiceButtons('shuffle', [[true,`${icon('shuffle')}ランダム`],[false,`${icon('layers')}順番に`]]);
  $('#settings-mistakes').innerHTML = choiceButtons('recentMistakesDays', [[0,'指定しない'],[7,'1週間'],[14,'2週間'],[30,'1か月'],[90,'3か月']]);
  $('#settings-recent').innerHTML = choiceButtons('excludeRecentDays', [[0,'除外しない'],[3,'3日以内'],[7,'1週間以内'],[14,'2週間以内'],[30,'1か月以内'],[90,'3か月以内']]);
  const matching = practicePool(cards, records, draftSettings).length;
  const amount = draftSettings.limit === 'all' ? matching : Math.min(matching, Number(draftSettings.limit));
  $('#settings-match').textContent = matching.toLocaleString('ja-JP');
  $('#apply-settings').textContent = amount ? `${amount.toLocaleString('ja-JP')}枚で始める` : '対象がありません';
  $('#apply-settings').disabled = !amount;
}

function startSession(custom = null, { continuing = false, all = false } = {}) {
  composing = false; compositionEndedAt = 0;
  if (!continuing) cycleSeen = new Set();
  session = makeSession(custom ?? pool(), { limit: all ? 'all' : settings.limit, shuffle: settings.shuffle });
  initialCount = session.length; sessionScope = settings.scope;
  hintSeeds = new Map(session.map(card => [card.id, Math.floor(Math.random() * Math.max(1, kanjiPromptChoices(card).length))]));
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
  settings.mode = mode; savePreferences(); rankFilter = 'all'; page = 0; startSession(); renderLibrary();
}
function answerRows(card) {
  const main = settings.mode === 'write'
    ? `<div class="answer-row"><span class="answer-label">韓国語</span><p class="answer-value hangul" lang="ko">${esc(card.han)}</p></div>`
    : answerFields(card, activeDeck).map(field => `<div class="answer-row"><span class="answer-label">${esc(field.label)}</span><p class="answer-value" lang="${field.lang}">${esc(field.text)}</p></div>`).join('');
  const examples = activeDeck === 'vocabulary' && (card.exampleKo || card.exampleJp)
    ? `<details class="example-block"><summary>例文</summary>${card.exampleKo ? `<p lang="ko">${esc(card.exampleKo)}</p>` : ''}${card.exampleJp ? `<p lang="ja">${esc(card.exampleJp)}</p>` : ''}</details>` : '';
  const otherHints = activeDeck === 'kanji' && settings.mode === 'write' ? answerFields(card, activeDeck).map(field => `<div class="answer-row"><span class="answer-label">${esc(field.label)}</span><p class="answer-value" lang="ja">${esc(field.text)}</p></div>`).join('') : '';
  const alternatives = activeDeck === 'kanji' && settings.mode === 'write' ? kanjiAnswersForPrompt(cards, currentKanjiHint(card)).filter(answer => answer !== card.han) : [];
  return main + (alternatives.length ? `<div class="answer-row"><span class="answer-label">別の対応</span><p class="answer-value" lang="ko">${esc(alternatives.join('・'))}</p></div>` : '') + otherHints + examples;
}
function currentKanjiHint(card) {
  const hints = kanjiPromptChoices(card);
  const repeats = session.slice(0, position).filter(item => item.id === card.id).length;
  return hints.length ? hints[((hintSeeds.get(card.id) || 0) + repeats) % hints.length] : '';
}
function failedCards() {
  const latest = new Map();
  for (const result of answers.values()) latest.set(result.cardId, result);
  return [...new Map(session.filter(card => latest.get(card.id)?.passed === false).map(card => [card.id, card])).values()];
}
function reviewNote(card) {
  const review = nextReviewFor(record(card), settings.mode);
  const days = review.dueAt ? Math.max(0, Math.ceil((Date.parse(review.dueAt) - Date.now()) / 86400000)) : 0;
  return days > 0 ? `<p class="review-note">次の復習：${days}日後</p>` : '';
}
function questionMarkup(card) {
  if (settings.mode === 'read') return `<p class="question-word${card.han.length > 4 ? ' long' : ''}" lang="ko">${esc(card.han)}</p>`;
  if (activeDeck === 'vocabulary') {
    const japanese = card.kanji, english = card.english || card.meaning;
    return `<p class="question-word reverse" lang="${japanese ? 'ja' : 'en'}">${esc(japanese || english)}</p>${japanese && english ? `<p class="question-english" lang="en">${esc(english)}</p>` : ''}`;
  }
  return `<p class="question-word reverse" lang="ja">${esc(currentKanjiHint(card))}</p>`;
}
function assessmentButtons(selectedRating = null) {
  return `${settings.mode === 'write' ? '<p class="assessment-heading">手ごたえは？</p>' : ''}<div class="assessment-buttons" role="group" aria-label="今回の自己評価">${RATINGS.map(item => `<button type="button" class="assessment-button rating-${item.id}" data-rating="${item.id}" aria-label="${esc(item.symbol)} ${esc(item.label)}"${selectedRating ? ` aria-pressed="${item.id === selectedRating}"` : ''}><span class="rating-symbol">${item.symbol}</span><span class="rating-label">${ratingLabels[item.id]}</span></button>`).join('')}</div>`;
}
function assessmentHistory(card) {
  const history = record(card).assessments?.[settings.mode]?.history;
  if (!Array.isArray(history) || !history.length) return '';
  return `<details class="assessment-history"><summary>これまでの評価 <span>${history.length}回</span></summary><div>${history.slice(-8).reverse().map(event => {
    const item = ratingById.get(event.rating) || UNSEEN;
    const at = new Date(event.at);
    const date = Number.isFinite(at.getTime()) ? at.toLocaleString('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    return `<span class="history-entry rating-${item.id}" title="${esc(item.label)}"><strong>${item.symbol}</strong><time>${date}</time>${settings.mode === 'write' && typeof event.correct === 'boolean' ? `<small>${event.correct ? '正解' : '不正解'}</small>` : ''}</span>`;
  }).join('')}</div></details>`;
}
function renderCard() {
  const el = $('#flashcard'); el.setAttribute('aria-busy', String(!loaded)); el.dataset.mode = settings.mode; el.classList.toggle('revealed', revealed);
  if (!loaded) return;
  if (!cards.length) { el.innerHTML = '<div class="empty-state"><h2>データを読み込めませんでした</h2><button class="button primary" data-action="reload">再読み込み</button></div>'; return; }
  if (!session.length) {
    const scoped = activeDeck === 'kanji' && settings.scope === 'essential' ? cards.filter(essentialKanji) : cards;
    const scheduled = settings.includeDue && !settings.recentMistakesDays && !settings.excludeRecentDays ? scoped.map(card => nextReviewFor(record(card), settings.mode).dueAt).filter(at => at && Date.parse(at) > Date.now()).sort()[0] : null;
    el.innerHTML = `<div class="empty-state"><h2>${scheduled ? '今日の演習は完了' : 'この条件のカードはありません'}</h2>${scheduled ? `<p>次の復習：${new Date(scheduled).toLocaleDateString('ja-JP')}</p>` : ''}<button class="button primary" data-action="settings">出題設定を開く</button></div>`; return;
  }
  if (position >= session.length) { renderComplete(el); return; }
  const card = session[position], writing = settings.mode === 'write';
  let actions;
  if (writing) {
    actions = writeResult === null
      ? `<button type="submit" form="write-form" class="reveal-button" id="check-writing">答えを見る・採点</button><button type="button" class="text-button" data-action="skip-writing">わからない・正解を見る</button>`
      : `${assessmentButtons(answers.get(position)?.rating)}<button id="next-writing" class="text-button assessment-next" data-action="advance">この評価で次へ ${icon('arrow')}</button>`;
  } else if (!revealed) actions = '<button id="reveal-card" class="reveal-button" data-action="reveal">答えを見る</button>';
  else actions = assessmentButtons();
  const input = writing && writeResult === null ? '<form id="write-form" class="write-form"><label class="writing-input-label" for="hangul-input">韓国語で書く</label><input id="hangul-input" placeholder="ここに韓国語を入力" lang="ko" autocomplete="off" autocapitalize="off" spellcheck="false" required></form>' : !writing && !revealed ? `<div class="write-form recall-form"><label class="writing-input-label" for="recall-input">答えを書いてみる</label><textarea id="recall-input" rows="2" placeholder="${esc(getDeck(activeDeck).answerLabel)}を入力（任意）" autocomplete="off"></textarea></div>` : '';
  const result = writing && writeResult !== null ? `<div class="result-banner${writeResult ? '' : ' wrong'}" role="status">${icon(writeResult ? 'check-circle' : 'repeat')}<strong>${writeResult ? '正解' : '不正解'}</strong><span>自動採点</span></div>${submitted ? `<p class="write-submission">あなたの解答：<span lang="ko">${esc(submitted)}</span></p>` : ''}` : '';
  el.innerHTML = `<div class="card-topline"><div class="card-kicker"><span class="card-type">${writing ? esc(getDeck(activeDeck).answerLabel) : '韓国語'}</span><span class="card-number">${position + 1} / ${session.length}${session.slice(0, position).some(item => item.id === card.id) ? ' · 復習' : ''}</span></div>${badge(rank(card))}</div><div class="question-area">${questionMarkup(card)}${input}</div>${result}${!writing && revealed && submitted ? `<p class="write-submission">あなたの解答：${esc(submitted)}</p>` : ''}${revealed ? `<div class="answer-panel">${answerRows(card)}${assessmentHistory(card)}${writing ? reviewNote(card) : ''}</div>` : ''}<div class="card-action-area">${actions}</div>`;
}
function renderComplete(el) {
  const right = [...answers.values()].filter(answer => answer.passed).length;
  const retry = failedCards();
  el.innerHTML = `<div class="complete-state"><h2>セット完了</h2><p>${initialCount}枚${session.length > initialCount ? `＋復習${session.length - initialCount}回` : ''} / ${session.length}回中 ${right}枚${settings.mode === 'write' ? '正解' : 'が○・◎'}</p><div class="complete-actions">${retry.length ? `<button class="button secondary" data-action="retry">間違えた${retry.length}枚を再演習</button>` : ''}<button class="button primary" data-action="next-set">次のセット</button></div></div>`;
}
function reveal() {
  if (!session[position] || revealed || settings.mode !== 'read') return;
  submitted = $('#recall-input')?.value.trim() || ''; revealed = true; renderCard(); $('.assessment-button')?.focus({ preventScroll: true });
}
function rateCard(rating) {
  const card = session[position];
  if (!card || !revealed || !RATINGS.some(item => item.id === rating)) return;
  const writing = settings.mode === 'write';
  if (writing && writeResult === null) return;
  records[card.id] = applyReviewSchedule(recordAssessment(record(card), settings.mode, rating, { correct: null, countAttempt: !writing }), settings.mode, rating);
  const passed = writing ? answers.get(position)?.passed === true : ['good','solid'].includes(rating);
  answers.set(position, { ...answers.get(position), cardId: card.id, passed, rating });
  saveRecords(); advance();
}
function checkWriting(skipped = false) {
  const card = session[position]; if (!card || writeResult !== null || composing || settings.mode !== 'write') return;
  const input = $('#hangul-input'); submitted = input?.value.trim() || '';
  if (!skipped && !submitted) { input?.reportValidity(); return; }
  const passed = !skipped && (activeDeck === 'vocabulary' ? matchVocabularyAnswer(submitted, card) : kanjiAnswersForPrompt(cards, currentKanjiHint(card)).some(answer => matchHangul(submitted, answer)));
  const rating = passed ? 'good' : 'again';
  records[card.id] = applyReviewSchedule(recordAssessment(record(card), 'write', rating, { correct: passed }), 'write', rating); answers.set(position, { cardId: card.id, passed, rating });
  writeResult = passed; revealed = true; saveRecords(); renderOverview(); renderCard(); $('#next-writing')?.focus({ preventScroll: true });
}
function advance() {
  const card = session[position], result = answers.get(position);
  if (card && result) {
    const retryRating = settings.mode === 'write' && !result.passed && !['hard', 'again'].includes(result.rating) ? 'again' : result.rating;
    session = insertRetry(session, position, card, retryRating).queue;
  }
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
    const fields = answerFields(card, activeDeck);
    const text = fields.map((field, index) => index ? `<small lang="${field.lang}">${esc(field.text)}</small>` : `<span lang="${field.lang}">${esc(field.text)}</span>`).join('');
    return `<tr><td><input type="checkbox" data-select-card="${id}" aria-label="${accessibleName}を選ぶ"${selected.has(card.id) ? ' checked' : ''}></td><td class="han-cell">${hideHan ? revealButton : `<span lang="ko">${esc(card.han)}</span>`}</td><td class="meaning-cell">${hideMean ? revealButton : text}</td><td>${badge(current)}</td><td><button class="table-queue" data-queue-card="${id}" aria-label="${accessibleName}で演習">演習</button></td></tr>`;
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
function openSettings() { syncSettingsForm(); renderSettings(); $('#practice-settings').showModal(); }
function handleCardAction(action) {
  if (action === 'reveal') reveal();
  else if (action === 'advance') advance();
  else if (action === 'skip-writing') checkWriting(true);
  else if (action === 'reload') location.reload();
  else if (action === 'settings') openSettings();
  else if (action === 'retry') startSession(failedCards(), { all: true });
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
    if (target.dataset.rating) rateCard(target.dataset.rating);
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
  $('#settings-form').onclick = event => {
    const target = event.target.closest('button'); if (!target) return;
    let focusSelector;
    if (target.dataset.settingsRating) {
      const id = target.dataset.settingsRating;
      draftSettings.ratings = draftSettings.ratings.includes(id) ? draftSettings.ratings.filter(value => value !== id) : [...draftSettings.ratings, id];
      focusSelector = `[data-settings-rating="${id}"]`;
    } else if (target.dataset.preset) {
      draftSettings.ratings = target.dataset.preset === 'default' ? ['hard','again','unseen'] : target.dataset.preset === 'weak' ? ['hard','again','unsure'] : target.dataset.preset === 'new' ? ['unseen'] : STATUSES.map(item => item.id);
      draftSettings.recentMistakesDays = 0; draftSettings.excludeRecentDays = 0;
      focusSelector = `[data-preset="${target.dataset.preset}"]`;
    } else if (target.dataset.choice) {
      const field = target.dataset.choice, raw = target.dataset.choiceValue;
      draftSettings[field] = field === 'shuffle' ? raw === 'true' : ['limit','scope'].includes(field) ? raw : Number(raw);
      focusSelector = `[data-choice="${field}"][data-choice-value="${raw}"]`;
    } else if (target.id === 'reset-settings') {
      draftSettings = practiceSettings({ libraryDirection: settings.libraryDirection });
      focusSelector = '#reset-settings';
    } else return;
    renderSettings(); $(focusSelector)?.focus({ preventScroll: true });
  };
  $('#settings-due').onchange = event => { draftSettings.includeDue = event.target.checked; renderSettings(); };
  $('#save-settings').onclick = () => {
    const modeChanged = settings.mode !== draftSettings.mode;
    settings = practiceSettings({ ...draftSettings, filter: 'all' }); savePreferences();
    if (modeChanged) { startSession(); renderLibrary(); }
    $('#practice-settings').close(); toast('演習設定を保存しました');
  };
  $('#settings-form').onsubmit = event => {
    event.preventDefault(); if (!practicePool(cards, records, draftSettings).length) return;
    settings = practiceSettings({ ...draftSettings, filter: 'all' });
    savePreferences(); $('#practice-settings').close(); startSession(); setView('study'); renderLibrary();
  };
  $('#library-search').oninput = () => { page = 0; renderLibrary(); };
  $('#library-hide').onchange = () => { revealedRows.clear(); renderLibrary(); };
  $('#library-direction').onclick = () => { settings.libraryDirection = settings.libraryDirection === 'ko-han' ? 'han-ko' : 'ko-han'; savePreferences(); revealedRows.clear(); renderLibrary(); };
  $('#library-body').onchange = event => {
    const el = event.target;
    if (el.dataset.selectCard) { if (el.checked) selected.add(el.dataset.selectCard); else selected.delete(el.dataset.selectCard); updateSelection(); }

  };
  $('#select-page').onchange = event => { pageCards.forEach(card => { if (event.target.checked) selected.add(card.id); else selected.delete(card.id); }); renderLibrary(); };
  $('#queue-selected').onclick = () => practiceSelected(new Set(selected));
  $('#prev-page').onclick = () => { page -= 1; renderLibrary(); }; $('#next-page').onclick = () => { page += 1; renderLibrary(); };
  window.addEventListener('hashchange', () => setView(location.hash.slice(1), { hash: false }));
  document.addEventListener('keydown', event => {
    if (view !== 'study' || settings.mode !== 'read' || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || $('#practice-settings').open) return;
    const target = event.target; if (target.closest('input,select,textarea,[contenteditable=true]')) return;
    if (event.code === 'Space' && !revealed && (!target.closest('button,a') || target.closest('#reveal-card'))) { event.preventDefault(); reveal(); }
    else if (revealed && /^[1-5]$/.test(event.key)) { event.preventDefault(); rateCard(RATINGS[Number(event.key) - 1].id); }
  });
}
async function init() {
  $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); bind();
  preferences = restorePracticePreferences(readJSON(PREF_KEY, null), readJSON('han-hanja:preferences:v3', null));
  activeDeck = getDeck(preferences.deckId || config.defaultDeck).id; settings = practiceSettings(preferences.courses[activeDeck]);
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

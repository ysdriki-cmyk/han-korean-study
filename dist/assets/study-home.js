import { normalizeConversationFilters } from './conversation-filters.js?v=2';

const STATUSES = Object.freeze([
  { id: 'solid', symbol: '◎', label: '完璧' },
  { id: 'good', symbol: '○', label: 'できた' },
  { id: 'unsure', symbol: '△', label: 'あいまい' },
  { id: 'again', symbol: '❌', label: 'もう一度' },
  { id: 'hard', symbol: '❌❌❌', label: '全然' },
  { id: 'unseen', symbol: 'ー', label: '未回答' },
]);
const GROUPS = ['基本', 'カテゴリ', 'TOPIK1', 'セット', 'カスタム'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const number = value => count(value).toLocaleString('ja-JP');
const percentage = value => Number.isFinite(Number(value)) ? Math.round(Math.max(0, Math.min(100, Number(value)))) : 0;
const searchValue = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP');
const CONVERSATION_FILTER_FIELDS = Object.freeze([
  ['speechStyle', '話し方'], ['audience', '距離感・対象'], ['priority', '学習優先度'],
  ['role', '会話の役割'], ['speaker', '話者'], ['wordTag', '単語由来タグ'],
]);

function conversationFilterControls(filters, options, open) {
  const normalized = normalizeConversationFilters(filters);
  const active = CONVERSATION_FILTER_FIELDS.filter(([key]) => normalized[key]).length;
  const fields = CONVERSATION_FILTER_FIELDS.map(([key, label]) => {
    const optionKey = value => searchValue(normalizeConversationFilters({ [key]: value })[key]).trim();
    const byValue = new Map();
    if (Array.isArray(options?.[key])) for (const value of options[key]) {
      const shown = String(value ?? '').trim(), identity = optionKey(shown);
      if (identity && !byValue.has(identity)) byValue.set(identity, shown);
    }
    const choices = [...byValue.values()];
    if (!choices.length) return '';
    const selected = byValue.get(optionKey(normalized[key])) ?? normalized[key];
    const stale = selected && !choices.includes(selected) ? `<option value="${esc(selected)}" selected>${esc(selected)}（対象なし）</option>` : '';
    return `<label class="home-conversation-filter" for="conversation-filter-${key}"><span>${label}</span><select id="conversation-filter-${key}" data-conversation-filter="${key}"><option value=""${selected ? '' : ' selected'}>すべて</option>${stale}${choices.map(value => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(value)}</option>`).join('')}</select></label>`;
  }).join('');
  return `<details id="conversation-filters" class="home-conversation-filters" data-conversation-details${open ? ' open' : ''}><summary>詳細な絞り込み${active ? `<span class="home-filter-count" aria-label="${active}件の条件を選択中">${active}</span>` : ''}</summary><div class="home-conversation-filter-grid">${fields}</div><div class="home-conversation-filter-footer"><button type="button" class="home-filter-reset" data-reset-conversation-filters${active ? '' : ' disabled'}>条件をクリア</button></div></details>`;
}

function progressFor(source = {}) {
  const total = count(source.total ?? source.count);
  const counts = Object.fromEntries(STATUSES.map(status => [status.id, count(source.counts?.[status.id])]));
  const ratedTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (ratedTotal < total) counts.unseen += total - ratedTotal;
  const denominator = Math.max(total, ratedTotal);
  const mastered = counts.solid + counts.good;
  return {
    total,
    counts,
    denominator,
    masteredPercent: percentage(source.masteredPercent ?? (total ? mastered / total * 100 : 0)),
    attemptedPercent: percentage(source.attemptedPercent ?? (total ? (total - counts.unseen) / total * 100 : 0)),
  };
}

function distribution(progress, label, compact = false, unit = '枚') {
  const summary = STATUSES.map(status => `${status.symbol} ${status.label} ${number(progress.counts[status.id])}${unit}`).join('、');
  return `<div class="home-distribution${compact ? ' home-distribution-compact' : ''}" role="img" aria-label="${esc(label)}の評価：${esc(summary)}">${STATUSES.filter(status => progress.counts[status.id]).map(status => {
    const amount = progress.counts[status.id];
    const width = progress.denominator ? amount / progress.denominator * 100 : 0;
    return `<span class="home-distribution-segment home-rating-${status.id}" style="width:${width}%" title="${esc(status.symbol)} ${esc(status.label)} ${number(amount)}${unit}" aria-hidden="true">${!compact && width >= 8 ? `<span>${number(amount)}</span>` : ''}</span>`;
  }).join('')}</div>`;
}

function courseCard(course, activeDeck) {
  const selected = course.id === activeDeck;
  const progress = progressFor({ ...course, ...course.progress });
  const loaded = course.available !== false;
  return `<button type="button" class="home-course${selected ? ' is-selected' : ''}" data-home-deck="${esc(course.id)}" aria-pressed="${selected}" aria-label="${esc(course.label)}の学習セット、${loaded ? `${number(progress.total)}枚、習得 ${progress.masteredPercent}%` : '読み込み中'}">
    <span class="home-course-top"><strong class="home-course-label">${esc(course.label)}</strong><span class="home-course-check" aria-hidden="true">${selected ? '✓' : '→'}</span></span>
    <span class="home-course-bottom"><span class="home-course-count">${loaded ? `<strong>${number(progress.total)}</strong> 枚` : '読み込み中…'}</span><span class="home-course-percent">○・◎ <strong>${loaded ? progress.masteredPercent : '—'}%</strong></span></span>
    ${distribution(progress, course.label, true)}
  </button>`;
}

function setRow(set, canCreate) {
  const progress = progressFor(set);
  const label = String(set.label ?? '');
  const custom = set.group === 'カスタム' || set.kind === 'custom';
  const conversation = set.kind === 'conversation';
  const unit = conversation ? '発話' : '枚';
  return `<li class="home-set-row">
    <div class="home-set-main">
      <div class="home-set-title"><h3>${esc(label)}</h3><span class="home-set-group">${esc(set.group)}</span><span class="home-set-count">${number(progress.total)}${unit}</span></div>
      <div class="home-set-progress">${distribution(progress, label, false, unit)}<span class="home-set-percent" aria-label="○・◎の割合 ${progress.masteredPercent}%"><span>○・◎</span> <strong>${progress.masteredPercent}<small>%</small></strong></span></div>
    </div>
    <div class="home-set-actions"><button type="button" class="home-button home-button-primary" data-start-set="${esc(set.id)}" aria-label="${esc(label)}${conversation ? 'のレッスンを開始' : 'で演習'}"${progress.total ? '' : ' disabled'}>${conversation ? '開始' : '演習'}<span aria-hidden="true">→</span></button><button type="button" class="home-button home-button-secondary" data-list-set="${esc(set.id)}" aria-label="${esc(label)}のカード一覧">一覧</button>${canCreate && custom ? `<button type="button" class="home-delete" data-delete-set="${esc(set.id)}" aria-label="${esc(label)}を削除" title="セットを削除"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v6M14 10v6"/></svg></button>` : ''}</div>
  </li>`;
}

/** Render the home screen. The caller owns state, event handling, and the set builder dialog. */
export function renderStudyHome({ courses = [], activeDeck = 'kanji', mode = null, sets = [], query = '', group = 'all', canResume = false, canCreate = false, sentenceCollection='core', extraProgress={}, conversationProgress={}, conversationFilters={}, conversationFilterOptions={}, conversationDetailsOpen=false } = {}) {
  const selectedCourse = courses.find(course => course.id === activeDeck);
  const available = selectedCourse?.available !== false;
  const normalizedQuery = searchValue(query).trim();
  const filteredSets = sets.filter(set => {
    const haystack = activeDeck === 'sentence' && sentenceCollection === 'conversation' && typeof set.searchText === 'string'
      ? set.searchText : `${set.label ?? ''} ${set.group ?? ''} ${set.searchText ?? ''}`;
    return (group === 'all' || set.group === group) && (!normalizedQuery || searchValue(haystack).includes(normalizedQuery));
  });
  const groups = [...new Set([...GROUPS, ...sets.map(set => String(set.group ?? ''))])].filter(Boolean);
  const shownGroups = groups.filter(value => value === group || sets.some(set => set.group === value));
  const modes = [{ id: 'read', label: '읽기', direction: activeDeck === 'sentence' ? '한→日' : activeDeck === 'vocabulary' ? '단어→単語' : '한→漢' }, { id: 'write', label: '쓰기', direction: activeDeck === 'sentence' ? '日→한' : activeDeck === 'vocabulary' ? '単語→단어' : '漢→한' }];
  const selectedMode = mode === 'read' || mode === 'write' ? mode : activeDeck === 'kanji' ? 'write' : 'read';
  const extra=activeDeck==='sentence' && sentenceCollection==='extra';
  const conversation=activeDeck==='sentence' && sentenceCollection==='conversation';
  const additional=progressFor(extraProgress);
  const dialogue=progressFor(conversationProgress);
  const collectionEntry=activeDeck!=='sentence' ? '' : extra || conversation
    ? `<div class="home-collection-nav"><button type="button" data-sentence-collection="core">← いつものsentenceへ</button><strong>${conversation?'conversation':'extra'}<span>${conversation?'会話レッスン':'追加の例文'}</span></strong></div>`
    : `<div class="home-collections"><button type="button" class="home-extra-card" data-sentence-collection="extra"${!additional.total?' disabled':''} aria-label="extra 追加の例文、${number(additional.total)}枚"><span class="home-extra-title"><strong>extra</strong><span>追加の例文</span></span><span class="home-extra-count">${number(additional.total)}枚 <span aria-hidden="true">→</span></span>${distribution(additional,'extra',true)}</button><button type="button" class="home-extra-card home-conversation-card" data-sentence-collection="conversation"${!dialogue.total?' disabled':''} aria-label="conversation 会話レッスン、${number(conversationProgress.lessonCount)}レッスン、${number(dialogue.total)}発話"><span class="home-extra-title"><strong>conversation</strong><span>会話レッスン</span></span><span class="home-extra-count">${number(conversationProgress.lessonCount)}レッスン <span aria-hidden="true">→</span></span>${distribution(dialogue,'conversation',true,'発話')}</button></div>`;
  const collectionTitle=conversation?'conversation':extra?'extra':selectedCourse?.label ?? (activeDeck === 'vocabulary' ? '単語' : '한漢');
  const itemLabel=conversation?'レッスン':'セット';
  const canStart=available && (!extra || additional.total) && (!conversation || filteredSets.some(set => progressFor(set).total && set.unpracticed !== false));
  const noUnpracticed=conversation && available && filteredSets.some(set => progressFor(set).total) && !canStart;
  const searchLabel=conversation?'場面・使い方メモを検索':`${itemLabel}を検索`;
  return `<div class="study-home">
    <h1 class="sr-only">ホーム</h1>
    <div class="home-courses" role="group" aria-label="教材を選ぶ">${courses.map(course => courseCard(course, activeDeck)).join('')}</div>
    <div class="home-start-actions"><button type="button" class="home-button home-button-primary home-start" ${conversation ? 'title="未演習のシーンをランダムに選んで開始" ' : ''}data-start-practice${canStart ? '' : ' disabled'}>${conversation?(noUnpracticed?'未演習のシーンはありません':'レッスンを開始する'):extra?'extraの演習を開始する':'演習を開始する'}<span aria-hidden="true">→</span></button>${canResume ? '<button type="button" class="home-resume" data-resume-study>演習を続ける<span aria-hidden="true">→</span></button>' : ''}</div>
    ${collectionEntry}
    <section class="home-sets" aria-labelledby="home-sets-title">
      <div class="home-sets-heading"><h2 id="home-sets-title">${esc(collectionTitle)}<span>の${itemLabel}</span></h2><div class="home-mode-switch" role="group" aria-label="演習モード">${modes.map(item => `<button type="button" data-home-mode="${item.id}" aria-pressed="${selectedMode === item.id}" title="${esc(item.direction)}"><strong lang="ko">${item.label}</strong><span>${esc(item.direction)}</span></button>`).join('')}</div></div>
      <div class="home-set-tools"><label class="home-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input id="set-search" type="search" value="${esc(query)}" aria-label="${searchLabel}" placeholder="${searchLabel}" autocomplete="off"></label>${canCreate ? '<button type="button" class="home-button home-create" data-create-set aria-haspopup="dialog"><span aria-hidden="true">＋</span>セットを作成</button>' : ''}</div>
      ${conversation ? conversationFilterControls(conversationFilters, conversationFilterOptions, conversationDetailsOpen) : ''}
      <div class="home-set-tabs" role="group" aria-label="${itemLabel}の種類"><button type="button" data-set-group="all" aria-pressed="${group === 'all'}">すべて</button>${shownGroups.map(value => `<button type="button" data-set-group="${esc(value)}" aria-pressed="${group === value}">${esc(value)}</button>`).join('')}</div>
      <div class="home-list-heading"><span class="home-set-results">${available ? `${number(filteredSets.length)} ${itemLabel}` : '読み込み中…'}</span><div class="home-legend" aria-label="評価の色">${STATUSES.map(status => `<span class="home-legend-item home-rating-${status.id}" title="${esc(status.label)}" aria-label="${esc(status.symbol)} ${esc(status.label)}"><i aria-hidden="true"></i><span aria-hidden="true">${status.symbol}</span></span>`).join('')}</div></div>
      ${!available ? '<div class="home-empty" role="status"><span class="home-loading-dot" aria-hidden="true"></span><p>学習セットを読み込み中…</p></div>' : filteredSets.length ? `<ul class="home-set-list">${filteredSets.map(set => setRow(set, canCreate)).join('')}</ul>` : `<div class="home-empty" role="status"><p>${query || group !== 'all' ? `該当する${itemLabel}がありません` : `${itemLabel}がありません`}</p>${canCreate && group === 'カスタム' && !query ? '<button type="button" class="home-button home-button-secondary" data-create-set aria-haspopup="dialog">セットを作成</button>' : ''}</div>`}
    </section>
  </div>`;
}

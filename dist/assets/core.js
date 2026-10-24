/** Pure data helpers shared by the app and Node tests. No browser state here. */

/** Parse RFC 4180 style CSV, including a UTF-8 BOM and quoted line breaks. */
export function parseCSV(text) {
  if (typeof text !== 'string') throw new TypeError('CSVは文字列で指定してください。');
  const input = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') { cell += '"'; index += 1; }
        else { quoted = false; closedQuote = true; }
      } else cell += char;
      continue;
    }
    if (char === ',' || char === '\r' || char === '\n') {
      row.push(cell);
      cell = '';
      closedQuote = false;
      if (char !== ',') {
        rows.push(row);
        row = [];
        if (char === '\r' && input[index + 1] === '\n') index += 1;
      }
    } else if (char === '"') {
      if (cell || closedQuote) throw new Error('CSVの引用符が正しくありません。');
      quoted = true;
    } else {
      if (closedQuote && char.trim()) throw new Error('CSVの引用符の後に区切り文字が必要です。');
      if (!closedQuote) cell += char;
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じられていません。');
  if (cell || row.length || closedQuote) { row.push(cell); rows.push(row); }
  return rows;
}

const clean = (value) => String(value ?? '').trim().normalize('NFC');
const uniqueText = (values) => [...new Set(values.map(clean).filter(Boolean))];

function contentHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Return all source answer fields without inventing linguistic interpretations. */
export function getAnswer(card) {
  return uniqueText([card.kanji, card.hanja, card.meaning]).join('\n');
}

/**
 * Accept the supplied sheet (including its unnamed columns), or a named schema:
 * id, Han, 漢字, 一覧, 意味, state, flagged. Existing No. values remain stable IDs.
 */
export function normalizeCards(text) {
  const rows = parseCSV(text);
  const warnings = [];
  const cards = [];
  if (!rows.length) return { cards, warnings: ['CSVにデータがありません。'] };
  const headers = rows[0].map((value) => clean(value).toLowerCase());
  const findColumn = (...names) => headers.findIndex((header) => names.includes(header));
  const column = {
    id: findColumn('id', 'no.', 'no', '番号'),
    han: findColumn('han', 'ハングル', '韓国語', 'ko_word'),
    kanji: findColumn('漢字', 'kanji'),
    hanja: findColumn('一覧', 'hanja'),
    meaning: findColumn('意味', 'meaning', 'notes', 'メモ'),
    state: findColumn('state', '状態'),
    flagged: findColumn('flagged', 'flag', '重点'),
  };
  const legacy = headers.length === 10 && column.han === 4 && column.kanji === 5 && column.hanja === 8;
  if (legacy && column.meaning < 0) column.meaning = 9;
  if (legacy && column.flagged < 0) column.flagged = 0;
  if (column.han < 0) throw new Error('CSVに「Han」または「韓国語」列が必要です。');
  if (column.kanji < 0 && column.hanja < 0 && column.meaning < 0) {
    throw new Error('CSVに「漢字」「一覧」「意味」のいずれかの列が必要です。');
  }
  const ids = new Set();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.every((value) => !clean(value))) continue;
    const value = (name) => column[name] < 0 ? '' : clean(row[column[name]]);
    const han = value('han');
    const flag = value('flagged');
    const card = {
      id: value('id'),
      han,
      kanji: value('kanji'),
      hanja: value('hanja'),
      meaning: value('meaning'),
      state: value('state'),
      flagged: ['！', '!', 'true', '1', 'yes', '重点'].includes(flag.toLowerCase()),
    };
    if (!card.id) {
      // Metadata may be edited without changing the identity of a study item.
      const fields = [card.han, card.kanji, card.hanja, card.meaning];
      card.id = `han:${han}:${contentHash(JSON.stringify(fields))}`;
    }
    if (!han || !getAnswer(card)) {
      warnings.push(`${index + 1}行目: ${!han ? 'Han' : '漢字・意味'}が空のため学習対象から除外しました。`);
      continue;
    }
    if (ids.has(card.id)) throw new Error(`${index + 1}行目: ID「${card.id}」が重複しています。No.またはidを一意にしてください。`);
    ids.add(card.id);
    cards.push(card);
  }
  if (!cards.length) warnings.push('学習できるカードがありません。');
  return { cards, warnings };
}

/** Each direction has its own recall history. */
export function progressKey(cardId, direction = 'ko-han') {
  return `${direction}:${cardId}`;
}

function normalizedStatus(value) {
  const status = typeof value === 'string' ? value : value?.status;
  if (['known', 'learned', 'mastered'].includes(status)) return 'mastered';
  if (['retry', 'again', 'review'].includes(status)) return 'review';
  return 'new';
}

/** Search and session filters never change the original cards or source state. */
export function filterCards(cards, options = {}) {
  const { query = '', category = 'all', status = 'all', progress = {}, direction = 'ko-han' } = options;
  const needle = clean(query).toLocaleLowerCase();
  const selectedStatus = status === 'all' ? 'all' : normalizedStatus(status);
  return cards.filter((card) => {
    if (needle && ![card.id, card.han, card.kanji, card.hanja, card.meaning, card.state]
      .some((value) => clean(value).toLocaleLowerCase().includes(needle))) return false;
    if (category === 'flagged' && !card.flagged) return false;
    if (category === 'hanja' && !card.hanja) return false;
    if (category === 'meaning' && !card.kanji && !card.meaning) return false;
    if (category === 'unflagged' && card.flagged) return false;
    const key = progressKey(card.id, direction);
    const record = Object.hasOwn(progress, key) ? progress[key] : undefined;
    return selectedStatus === 'all' || normalizedStatus(record) === selectedStatus;
  });
}

/** Fisher-Yates shuffle: select after shuffling so all cards may be chosen. */
export function makeSession(cards, options = {}) {
  const { limit = 20, shuffle = true, random = Math.random } = options;
  const selected = [...cards];
  if (shuffle) {
    for (let index = selected.length - 1; index > 0; index -= 1) {
      const sample = random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError('randomは0以上1未満の数値を返す必要があります。');
      const swap = Math.floor(sample * (index + 1));
      [selected[index], selected[swap]] = [selected[swap], selected[index]];
    }
  }
  const size = limit === 'all' || limit === Infinity ? selected.length : Number(limit);
  if (!Number.isInteger(size) || size < 0) throw new RangeError('学習枚数は0以上の整数またはallを指定してください。');
  return selected.slice(0, size);
}

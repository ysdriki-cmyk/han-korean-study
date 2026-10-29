import { parseCSV } from './core.js';
import { normalizeCustomSets } from './study-sets.js';

export const CATEGORY_SHEET_HEADERS = Object.freeze(['category_id', 'カテゴリ名', '教材', '対象列', '条件', '値', '条件の結合', '表示順']);
export const CATEGORY_SHEET_OPERATORS = Object.freeze([
  { label: '含む', operator: 'contains', valueRequired: true },
  { label: '含まない', operator: 'not_contains', valueRequired: true },
  { label: 'タグ一致', operator: 'tag', valueRequired: true },
  { label: '等しい', operator: 'equals', valueRequired: true },
  { label: '印あり', operator: 'equals', valueRequired: false },
  { label: '空欄', operator: 'empty', valueRequired: false },
  { label: '空欄でない', operator: 'not_empty', valueRequired: false },
  { label: '全件', operator: 'all', valueRequired: false },
].map(Object.freeze));

const clean = value => String(value ?? '').normalize('NFC').trim();
const DECK_ALIASES = new Map([
  ['one', 'kanji'], ['kanji', 'kanji'], ['한漢', 'kanji'], ['漢字', 'kanji'],
  ['word', 'vocabulary'], ['vocabulary', 'vocabulary'], ['単語', 'vocabulary'],
]);
const TARGETS = Object.freeze({
  kanji: Object.freeze({ 韓国語: 'han', 出題ヒント: 'kanji', 漢字候補: 'hanja', '解説・一覧': 'meaning', 解説: 'meaning', 必須: 'essential' }),
  vocabulary: Object.freeze({ 韓国語: 'han', カテゴリ: 'tags', TOPIK1: 'topikCategory', 日本語: 'kanji', 英語: 'english' }),
});
const MAX_ROWS = 10000, MAX_CATEGORIES = 100;
const own = (object, key) => Object.hasOwn(object, key);
const deckFor = value => DECK_ALIASES.get(value) ?? DECK_ALIASES.get(value.toLowerCase());

function sheetRule(deckId, target, condition, rawValue) {
  const value = String(rawValue ?? '').normalize('NFC');
  const operation = CATEGORY_SHEET_OPERATORS.find(item => item.label === condition);
  if (!operation) return { error: `条件「${condition || '空欄'}」を確認してください。` };
  if (operation.operator === 'all') return !target && !clean(value)
    ? { all: true } : { error: '全件の対象列と値は空欄にしてください。' };
  if (!own(TARGETS[deckId], target)) return { error: `教材に対応しない対象列「${target || '空欄'}」です。` };
  const field = TARGETS[deckId][target];
  if (!operation.valueRequired && clean(value)) return { error: `「${condition}」の値は空欄にしてください。` };
  if (operation.valueRequired && (!clean(value) || value.length > 500)) return { error: `「${condition}」の値を1〜500文字で入力してください。` };
  if (condition === '印あり') return field === 'essential'
    ? { rule: { field, operator: 'equals', value: true } } : { error: '印ありは「必須」列に指定してください。' };
  if (field === 'essential') {
    if (operation.operator !== 'equals') return { error: '必須の条件は「印あり」または「等しい」を使ってください。' };
    const boolean = ({ true: true, false: false, '1': true, '0': false })[clean(value).toLowerCase()];
    return typeof boolean === 'boolean' ? { rule: { field, operator: 'equals', value: boolean } }
      : { error: '必須の値はTRUE、FALSE、1、0のいずれかにしてください。' };
  }
  return { rule: { field, operator: operation.operator, ...(operation.valueRequired ? { value } : {}) } };
}

/** One row is one condition; an invalid row excludes its entire named set. */
export function parseCategorySheet(text) {
  const warnings = [], groups = new Map();
  let rows;
  try {
    if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new Error('カテゴリCSVのサイズまたは形式を確認してください。');
    rows = parseCSV(text);
  } catch (error) {
    return { sets: [], warnings: [error instanceof Error ? error.message : 'カテゴリCSVを読み取れませんでした。'] };
  }
  if (!rows.length) return { sets: [], warnings: ['カテゴリCSVに見出しがありません。'] };
  if (rows.length > MAX_ROWS + 1) return { sets: [], warnings: [`カテゴリCSVは${MAX_ROWS}行以内にしてください。`] };
  const headers = rows[0].map(clean);
  const invalidHeaders = CATEGORY_SHEET_HEADERS.filter(header => headers.filter(value => value === header).length !== 1);
  if (invalidHeaders.length) return { sets: [], warnings: [`カテゴリCSVの見出しを確認してください: ${invalidHeaders.join('、')}`] };
  const columns = Object.fromEntries(CATEGORY_SHEET_HEADERS.map(header => [header, headers.indexOf(header)]));
  const warn = (index, id, message) => warnings.push(`${index + 1}行目${id ? `（${id}）` : ''}: ${message}`);
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.every(value => !clean(value))) continue;
    const get = header => clean(row[columns[header]]);
    const id = get('category_id');
    if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(id)) {
      warn(index, id, 'category_idは1〜100文字の半角英数字・_・-で入力してください。');
      continue;
    }
    if (!groups.has(id)) {
      if (groups.size >= MAX_CATEGORIES) return { sets: [], warnings: [...warnings, `カテゴリは${MAX_CATEGORIES}件以内にしてください。`] };
      groups.set(id, { id, label: '', deckId: '', match: 'all', order: 0, rules: [], all: false, invalid: false, rows: 0 });
    }
    const group = groups.get(id), fail = message => { group.invalid = true; warn(index, id, message); };
    const label = get('カテゴリ名') || group.label;
    const deckValue = get('教材');
    const deckId = deckValue ? deckFor(deckValue) : group.deckId;
    const matchValue = get('条件の結合').toUpperCase();
    const match = matchValue ? ({ AND: 'all', OR: 'any' })[matchValue] : group.match;
    const orderValue = get('表示順');
    const order = orderValue ? Number(orderValue) : group.order;
    if (!label || label.length > 80) fail('カテゴリ名を1〜80文字で入力してください。');
    if (!deckId) fail('教材はone（한漢）またはword（単語）を指定してください。');
    if (!match) fail('条件の結合はANDまたはORを指定してください。');
    if (!Number.isFinite(order) || Math.abs(order) > 1e9) fail('表示順は数値で入力してください。');
    if (group.rows && (label !== group.label || deckId !== group.deckId || match !== group.match || order !== group.order)) {
      fail('同じcategory_idのカテゴリ名・教材・条件の結合・表示順をそろえてください。');
    }
    if (row.slice(headers.length).some(value => clean(value))) fail('見出しのない列に値があります。CSVの区切りを確認してください。');
    if (!group.rows) Object.assign(group, { label, deckId, match, order });
    group.rows += 1;
    if (!deckId) continue;
    const result = sheetRule(deckId, get('対象列'), get('条件'), row[columns['値']]);
    if (result.error) { fail(result.error); continue; }
    if (result.all) group.all = true;
    else group.rules.push(result.rule);
    if ((group.all && group.rows > 1) || group.rules.length > 20) fail('全件は1行だけで指定し、通常の条件は1カテゴリ20行以内にしてください。');
  }
  const sets = [];
  for (const group of groups.values()) {
    if (group.invalid) continue;
    const candidate = { id: `custom:sheet:${group.id}`, label: group.label, group: 'セット', kind: group.all ? 'all' : 'custom',
      deckId: group.deckId, source: 'sheet', sourceId: group.id, order: group.order,
      ...(group.all ? {} : { match: group.match, rules: group.rules }) };
    const [set] = normalizeCustomSets([candidate], group.deckId);
    if (!set) { warnings.push(`カテゴリ「${group.id}」: 対象列と条件の組み合わせを確認してください。`); continue; }
    sets.push(set);
  }
  sets.sort((a, b) => a.order - b.order || a.sourceId.localeCompare(b.sourceId, 'en'));
  return { sets, warnings };
}

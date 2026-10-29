const clean = value => String(value ?? '').trim().normalize('NFC');

export function sheetHeader(value) {
  const name = clean(value).toLowerCase();
  // Optional explanatory suffixes do not change the ID column's role.
  return name.replace(/^(id_(?:one|word))\s*[（(].*[）)]$/u, '$1');
}

export function sheetFlag(value) {
  return ['true', '1', 'yes', '！', '!', '必須', '重点', '○', '◯', '〇', '✓', '✔', '☑'].includes(clean(value).toLowerCase());
}

/** Keep multiword labels intact; only a hashtag or a line break separates labels. */
export function categoryLabels(value) {
  const text = clean(value).replace(/＃/gu, '#');
  return [...new Set(text.split(/\r?\n/u).flatMap(line => line.split('#'))
    .map(item => item.trim()).filter(Boolean))];
}

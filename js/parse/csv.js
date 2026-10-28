// Text files: encoding detection and a CSV reader that guesses the separator.

export function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}

export function parseCSV(text) {
  const head = text.split(/\r?\n/).slice(0, 30).join('\n');
  let delim = ';', best = -1;
  for (const c of [';', ',', '\t', '|']) {
    const n = head.split(c).length - 1;
    if (n > best) { best = n; delim = c; }
  }
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}

// For the CSV export: Spanish Excel opens ';' files with decimal commas directly.
export function toCSV(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

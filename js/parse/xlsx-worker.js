// Reads spreadsheets in a separate thread: a malformed file can neither freeze the app nor reach its data.
/* global XLSX */
importScripts('../../vendor/xlsx.full.min.js');
self.onmessage = (e) => {
  try {
    const wb = XLSX.read(e.data, { type: 'array', cellDates: true, dense: true });
    const sheets = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
    self.postMessage({ ok: true, sheets });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};

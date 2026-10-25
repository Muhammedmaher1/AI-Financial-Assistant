/**
 * AI Personal Finance Assistant — Import past expenses from iPhone Notes
 * ---------------------------------------------------------------------
 * Add as Import.gs (next to Code.gs). No upgrade step needed.
 *   /import          start collecting: paste your note (one or many messages) or send a .txt file
 *   /done            read everything and show a preview (nothing is saved yet)
 *   /importdate 15/9 date to use for lines that have no date
 *   /import cancel   stop and discard
 * Dates: "5/10" or "5 اكتوبر" on its own line applies to the lines below it; "5/10 350 بنزين" applies to that line.
 * Lines like "المجموع 5000" / "total" are skipped. Entries already in your sheet (same date, amount and type) are skipped.
 * Imported investment contributions do NOT change your Thndr Cash (that balance is set with /thndrcash).
 */

const IMPORT_TTL = 6 * 3600;
const AR_MONTHS = { 'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'مايو': 5, 'يونيو': 6, 'يونيه': 6, 'يوليو': 7, 'يوليه': 7, 'اغسطس': 8, 'سبتمبر': 9, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12 };
const EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = ['السبت', 'الاحد', 'الاثنين', 'الاتنين', 'التلات', 'الثلاثاء', 'التلاتاء', 'الاربع', 'الاربعاء', 'الخميس', 'الجمعه', 'يوم', 'تاريخ',
  'sat', 'saturday', 'sun', 'sunday', 'mon', 'monday', 'tue', 'tuesday', 'wed', 'wednesday', 'thu', 'thursday', 'fri', 'friday', 'date'];
const TOTAL_WORDS = ['المجموع', 'مجموع', 'الاجمالي', 'اجمالي', 'الإجمالي', 'total', 'sum', 'subtotal'];

// ---------- pure parsing (unit-tested) ----------
function ymdOk_(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
function pickYear_(m, d, todayKey) {
  const ty = Number(todayKey.slice(0, 4));
  const k = ty + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return k <= todayKey ? ty : ty - 1; // never a future date
}
/** If the (normalized) line starts with a date, returns {date:'yyyy-mm-dd', rest}. Otherwise null. */
function leadingDate_(n, todayKey) {
  let s = n.replace(/^[\s•\-–*:،,.]+/, '');
  // drop leading weekday words ("السبت 5/10", "Sat, Oct 5")
  for (let i = 0; i < 3; i++) {
    const w = s.split(/[\s,،:]+/)[0];
    if (w && WEEKDAYS.indexOf(w.replace(/[,،:]$/, '')) >= 0) s = s.slice(s.indexOf(w) + w.length).replace(/^[\s,،:]+/, ''); else break;
  }
  let y, mo, d, len, m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/))) { y = +m[1]; mo = +m[2]; d = +m[3]; len = m[0].length; }
  else if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?(?![\d.,])/)) || (m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?!\d)/))) {
    d = +m[1]; mo = +m[2]; y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null; len = m[0].length;
  } else {
    const mn = '(' + Object.keys(AR_MONTHS).join('|') + '|' + Object.keys(EN_MONTHS).join('|') + ')[a-z]*';
    if ((m = s.match(new RegExp('^(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:من\\s+)?' + mn + '\\.?(?:\\s*,?\\s*(\\d{4}))?(?![\\u0600-\\u06FFa-z])')))) {
      d = +m[1]; mo = AR_MONTHS[m[2]] || EN_MONTHS[m[2].slice(0, 3)] || EN_MONTHS[m[2]]; y = m[3] ? +m[3] : null; len = m[0].length;
    } else if ((m = s.match(new RegExp('^' + mn + '\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?(?!\\d)')))) {
      mo = AR_MONTHS[m[1]] || EN_MONTHS[m[1].slice(0, 3)] || EN_MONTHS[m[1]]; d = +m[2]; y = m[3] ? +m[3] : null; len = m[0].length;
    } else return null;
  }
  if (!mo || mo > 12 || !d || d > 31) return null;
  if (!y) y = pickYear_(mo, d, todayKey);
  if (!ymdOk_(y, mo, d)) return null;
  const date = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  if (date > todayKey) return null;
  return { date: date, rest: s.slice(len).replace(/^[\s:\-–،,.]+/, '').trim() };
}
function isTotalLine_(n) { return TOTAL_WORDS.some(w => phraseIn(n, norm(w))); }

/** Lines → candidate transactions. Each item gets a date (or null) and keeps its source line. */
function parseImport_(text, rules, todayKey) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);
  const out = { items: [], skippedTotals: [], noAmount: [], dateHeaders: 0, lines: lines.length };
  let current = null;
  lines.forEach((line, li) => {
    const pre = preprocessAmounts(line);
    const n = norm(pre);
    const ld = leadingDate_(n, todayKey);
    let body = pre, date = current;
    if (ld) {
      if (!ld.rest || !extractAmounts(ld.rest).length) { current = ld.date; out.dateHeaders++; return; } // header line
      date = ld.date;
      // keep your original spelling: drop the same number of leading words from the un-normalized line
      const nt = n.split(/\s+/), rt = ld.rest.split(/\s+/), pt = pre.trim().split(/\s+/);
      body = (pt.length === nt.length && nt.length >= rt.length) ? pt.slice(nt.length - rt.length).join(' ') : ld.rest;
    }
    if (isTotalLine_(n)) { out.skippedTotals.push(line); return; }
    if (!extractAmounts(norm(body)).length) { if (/[A-Za-z\u0600-\u06FF0-9]/.test(line)) out.noAmount.push(line); else out.decor = (out.decor || 0) + 1; return; }
    const p = parseMessage(body, rules);
    p.items.forEach(it => {
      // In a notes import, a line with no income/transfer wording is an expense: then only the category may be unclear.
      if (!it.type && it.explicitType !== 'AMBIG') { it.type = 'Expense'; finalizeItem(it); }
      it.date = date; it.line = line; it.lineNo = li + 1; it.payment = p.payment;
      if (p.dateOffset && !date) it.date = null;
      out.items.push(it);
    });
  });
  return out;
}

/** Marks items already present in the sheet: same date + amount + type, counted (two coffees vs one recorded → one new). */
function markImportDuplicates_(items, existingRows, map) {
  const have = {};
  existingRows.forEach(r => {
    const k = dateKey(r[map.Transaction_Date]) + '|' + Number(r[map.Amount]) + '|' + r[map.Transaction_Type];
    have[k] = (have[k] || 0) + 1;
  });
  items.forEach(it => {
    it.dupe = false;
    if (!it.date || !it.type) return;
    const k = it.date + '|' + it.amount + '|' + it.type;
    if (have[k] > 0) { have[k]--; it.dupe = true; }
  });
}

// ---------- state (Script Cache, chunked) ----------
function cachePutBig_(key, str) {
  const c = CacheService.getScriptCache(); const size = 90000; const n = Math.ceil(str.length / size) || 1;
  const obj = { [key + ':n']: String(n) };
  for (let i = 0; i < n; i++) obj[key + ':' + i] = str.slice(i * size, (i + 1) * size);
  c.putAll(obj, IMPORT_TTL);
}
function cacheGetBig_(key) {
  const c = CacheService.getScriptCache(); const n = Number(c.get(key + ':n') || 0);
  if (!n) return null;
  const keys = []; for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  const got = c.getAll(keys); let s = '';
  for (let i = 0; i < n; i++) { if (got[key + ':' + i] === undefined || got[key + ':' + i] === null) return null; s += got[key + ':' + i]; }
  return s;
}
function cacheDelBig_(key) { const c = CacheService.getScriptCache(); const n = Number(c.get(key + ':n') || 0); const k = [key + ':n']; for (let i = 0; i < n; i++) k.push(key + ':' + i); c.removeAll(k); }
function importActive_() {
  const s = prop('IMPORT_MODE'); if (!s) return false;
  if (Date.now() - Number(s) > IMPORT_TTL * 1000) { PropertiesService.getScriptProperties().deleteProperty('IMPORT_MODE'); return false; }
  return true;
}
function importStop_() { PropertiesService.getScriptProperties().deleteProperty('IMPORT_MODE'); cacheDelBig_('impbuf'); cacheDelBig_('impres'); }

// ---------- Telegram flow ----------
/** Called by Code.gs for every message from you. While importing, text and .txt files are collected instead of saved. */
function importIntercept_(chatId, m, text) {
  if (!importActive_()) return false;
  if (text && text[0] === '/') return false; // commands still work (/done, /import cancel …)
  let add = '';
  if (m.document) {
    const name = String(m.document.file_name || '');
    if (!/\.(txt|csv|text|md)$/i.test(name) && !/^text\//.test(String(m.document.mime_type || ''))) {
      send(chatId, '⚠️ I can read text (.txt) files or pasted text. In Notes: Select All › Copy, then paste here.'); return true;
    }
    if (Number(m.document.file_size || 0) > 1000000) { send(chatId, '⚠️ That file is over 1 MB. Please split it.'); return true; }
    const f = tg('getFile', { file_id: m.document.file_id });
    if (!f.ok) { send(chatId, '⚠️ Could not download the file. Try pasting the text instead.'); return true; }
    add = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + prop('BOT_TOKEN') + '/' + f.result.file_path).getContentText('UTF-8');
  } else if (text) add = text;
  else { send(chatId, 'While importing I only read text. Send /done when you have pasted everything.'); return true; }
  const buf = (cacheGetBig_('impbuf') || '') + (add.endsWith('\n') ? add : add + '\n');
  cachePutBig_('impbuf', buf);
  const nLines = buf.split('\n').filter(x => x.trim()).length;
  send(chatId, '📥 Got it: ' + nLines + ' lines so far. Paste more, or send /done to read them.');
  return true;
}

function handleCommandImport(chatId, cmd, arg) {
  const a = String(arg || '').trim().toLowerCase();
  if (cmd === '/import' && (a === 'cancel' || a === 'stop')) cmd = '/cancel';
  if (cmd === '/import') {
    importStop_();
    setProp('IMPORT_MODE', String(Date.now()));
    send(chatId, '📥 Import mode is on.\n\nIn iPhone Notes: open the note › tap and hold › Select All › Copy. Then paste it here (long notes may arrive as several messages, that is fine). You can also send a .txt file.\n\nWhen everything is pasted, send /done. Nothing is saved until you confirm.\n/import cancel stops.');
    return true;
  }
  if (cmd === '/cancel') {
    if (!importActive_() && !cacheGetBig_('impres')) { send(chatId, 'Nothing to cancel.'); return true; }
    importStop_(); send(chatId, '❌ Import cancelled. Nothing was saved.'); return true;
  }
  if (cmd === '/done') {
    const buf = cacheGetBig_('impbuf');
    if (!buf) { send(chatId, importActive_() ? 'I have nothing yet. Paste your note first.' : 'Send /import first, then paste your note.'); return true; }
    buildImportPreview_(chatId, null, null);
    return true;
  }
  if (cmd === '/importdate') {
    const ld = leadingDate_(norm(a), fmt(new Date(), 'yyyy-MM-dd'));
    if (!ld) { send(chatId, 'Use a date like /importdate 15/9 or /importdate 2026-09-15'); return true; }
    buildImportPreview_(chatId, null, ld.date);
    return true;
  }
  return false;
}

function buildImportPreview_(chatId, msgId, defaultDate) {
  const buf = cacheGetBig_('impbuf');
  if (!buf) return reply(chatId, msgId, 'ℹ️ The import expired. Send /import and paste again.');
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const res = parseImport_(buf, getRules(), today);
  const old = JSON.parse(cacheGetBig_('impres') || 'null');
  const dflt = defaultDate || (old && old.defaultDate) || null;
  res.items.forEach(it => { if (!it.date && dflt) { it.date = dflt; it.dateAssumed = true; } });
  // keep AI results from a previous preview, matched by line + amount
  if (old && old.aiApplied) res.items.forEach(it => { const a = old.aiApplied[it.lineNo + '|' + it.amount]; if (a && it.missing.length) { it.type = a.type; it.category = a.category; it.subcategory = ''; it.source = 'ai'; finalizeItem(it); } });
  const { rows: data, map } = readTx();
  markImportDuplicates_(res.items, data, map);
  const state = { defaultDate: dflt, aiApplied: old ? old.aiApplied || null : null, items: res.items.map(slimItem_), skippedTotals: res.skippedTotals.length,
    noAmount: res.noAmount, decor: res.decor || 0, dateHeaders: res.dateHeaders, lines: res.lines };
  state.teach = teachGroups_(state);
  cachePutBig_('impres', JSON.stringify(state));
  return reply(chatId, msgId, previewText_(state), previewButtons_(state));
}
function slimItem_(it) {
  return { amount: it.amount, currency: it.currency, type: it.type, category: it.category, subcategory: it.subcategory || '', description: it.description || '',
    date: it.date, dateAssumed: !!it.dateAssumed, line: it.line, lineNo: it.lineNo, payment: it.payment || '', missing: it.missing, dupe: !!it.dupe, source: it.source };
}
function groups_(st) {
  const undated = st.items.filter(i => !i.date);
  const unclear = st.items.filter(i => i.date && i.missing.length);
  const dupes = st.items.filter(i => i.date && !i.missing.length && i.dupe);
  const ready = st.items.filter(i => i.date && !i.missing.length && !i.dupe);
  return { undated, unclear, dupes, ready };
}
function previewText_(st) {
  const g = groups_(st);
  const m = x => Math.round(x).toLocaleString('en-US');
  const dates = g.ready.concat(g.unclear).map(i => i.date).sort();
  const byType = {}; g.ready.forEach(i => { byType[i.type] = byType[i.type] || [0, 0]; byType[i.type][0]++; byType[i.type][1] += i.amount; });
  const byCat = {}; g.ready.filter(i => i.type === 'Expense').forEach(i => { byCat[i.category] = (byCat[i.category] || 0) + i.amount; });
  const top = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).slice(0, 6);
  let t = '📥 Import preview (nothing saved yet)\n' + st.lines + ' lines read' + (st.dateHeaders ? ', ' + st.dateHeaders + ' date lines' : '') +
    (dates.length ? '\nDates: ' + dates[0] + ' → ' + dates[dates.length - 1] : '') + '\n\n';
  t += '✅ Ready to import: ' + g.ready.length + '\n' + Object.keys(byType).map(k => '   ' + k + ': ' + byType[k][0] + ' (' + m(byType[k][1]) + ' EGP)').join('\n');
  if (top.length) t += '\n   Top spending: ' + top.map(c => c + ' ' + m(byCat[c])).join(', ');
  if (g.ready.some(i => i.dateAssumed)) t += '\n   ' + g.ready.filter(i => i.dateAssumed).length + ' use your chosen date ' + st.defaultDate;
  if (g.ready.some(i => i.currency !== 'EGP')) t += '\n   Includes non-EGP amounts (kept in their currency).';
  if (g.dupes.length) t += '\n\n♻️ Already in your sheet, will be skipped: ' + g.dupes.length;
  if (g.unclear.length) t += '\n\n❓ Not sure what these are (' + g.unclear.length + '):\n' + g.unclear.slice(0, 8).map(i => '   • ' + i.line.slice(0, 60) + ' → ' + (i.missing.indexOf('type') >= 0 ? 'type?' : 'category?')).join('\n') + (g.unclear.length > 8 ? '\n   …and ' + (g.unclear.length - 8) + ' more' : '');
  if (g.undated.length) t += '\n\n📅 No date found for ' + g.undated.length + ' entries (e.g. "' + g.undated[0].line.slice(0, 40) + '"). Choose a date below, or send /importdate 15/9';
  if (g.unclear.length && st.teach.length) t += '\n   👉 They use only ' + st.teach.length + ' different words. Tap "Teach me" and I will ask once per word and remember it.';
  if (st.noAmount.length) t += '\n\n🚫 Lines without an amount, ignored (' + st.noAmount.length + '): ' + st.noAmount.slice(0, 4).map(x => '"' + x.slice(0, 30) + '"').join(', ') + (st.noAmount.length > 4 ? ' …' : '');
  if (st.decor) t += '\n➖ Ignored ' + st.decor + ' separator line(s).';
  if (st.skippedTotals) t += '\n➖ Skipped ' + st.skippedTotals + ' total line(s).';
  if (t.length > 3900) t = t.slice(0, 3880) + '\n…';
  return t;
}
function previewButtons_(st) {
  const g = groups_(st), b = [];
  if (g.undated.length) b.push([{ text: '📅 Today', callback_data: 'im|d|0' }, { text: 'Yesterday', callback_data: 'im|d|1' }, { text: '1st of this month', callback_data: 'im|d|m' }]);
  if (g.ready.length) b.push([{ text: '✅ Import ' + g.ready.length, callback_data: 'im|go' }]);
  if (g.unclear.length && st.teach.length) b.push([{ text: '🧠 Teach me ' + st.teach.length + ' words (fixes ' + st.teach.reduce((a, x) => a + x.count, 0) + ' lines)', callback_data: 'im|tb' }]);
  if (g.unclear.length) {
    b.push([{ text: '➕ Import all, unclear ones as Other (' + (g.ready.length + g.unclear.length) + ')', callback_data: 'im|all' }]);
    if (prop('GEMINI_API_KEY') && !st.aiApplied) b.push([{ text: '🤖 Let AI sort the ' + g.unclear.length + ' unclear lines', callback_data: 'im|ai' }]);
  }
  b.push([{ text: '❌ Cancel', callback_data: 'im|x' }]);
  return b;
}

// ---------- "teach me": one question per unknown word, remembered in Category_Rules ----------
function teachKey_(it) { return norm(it.description || '').replace(/[^\u0600-\u06FFa-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function teachGroups_(st) {
  const g = {};
  groups_(st).unclear.forEach(it => {
    if (it.missing.indexOf('category') < 0) return;
    const k = teachKey_(it);
    if (!k || k.length > 30 || k.split(' ').length > 3) return;
    if (!g[k]) g[k] = { key: k, label: it.description, count: 0, example: it.line };
    g[k].count++;
  });
  return Object.keys(g).map(k => g[k]).sort((a, b) => b.count - a.count);
}
const TEACH_TYPES = { inc: ['Income', 'Additional Income', '💵 Income'], debt: ['Debt Payment', 'Debt', '🏦 Debt/loan payment'], sav: ['Savings Transfer', 'Savings', '💰 Savings'],
  inv: ['Investment Contribution', 'Investments', '📈 Investment'], trf: ['Internal Transfer', 'Transfers', '🔁 Between my accounts'] };
function askTeach_(chatId, msgId, st) {
  const w = st.teach[st.ti || 0];
  if (!w) return buildImportPreview_(chatId, msgId, null);
  const b = rows(EXPENSE_CATEGORIES.map((c, i) => ({ text: c, callback_data: 'im|tc|' + i })), 3);
  b.push([TEACH_TYPES.inc, TEACH_TYPES.debt, TEACH_TYPES.sav].map((t, i) => ({ text: t[2], callback_data: 'im|tt|' + ['inc', 'debt', 'sav'][i] })));
  b.push([{ text: TEACH_TYPES.inv[2], callback_data: 'im|tt|inv' }, { text: TEACH_TYPES.trf[2], callback_data: 'im|tt|trf' }]);
  b.push([{ text: '⏭ Skip this word', callback_data: 'im|ts' }, { text: '✔️ Finish, show preview', callback_data: 'im|tf' }]);
  return reply(chatId, msgId, '🧠 Word ' + ((st.ti || 0) + 1) + ' of ' + st.teach.length + ': "' + w.label + '"\n' +
    (w.count > 1 ? 'Used in ' + w.count + ' lines, e.g. ' : 'Line: ') + '"' + String(w.example).slice(0, 60) + '"\n\nWhat is it? I will remember it for the future too.', b);
}

function handleCallbackImport(chatId, msgId, parts) {
  if (parts[0] !== 'im') return false;
  const st = JSON.parse(cacheGetBig_('impres') || 'null');
  if (!st && parts[1] !== 'x') { edit(chatId, msgId, 'ℹ️ This import expired or was already done. Send /import to start again.'); return true; }
  if (parts[1] === 'x') { importStop_(); edit(chatId, msgId, '❌ Import cancelled. Nothing was saved.'); return true; }
  if (parts[1] === 'd') {
    const today = fmt(new Date(), 'yyyy-MM-dd');
    const d = parts[2] === '0' ? today : parts[2] === '1' ? fmt(new Date(Date.now() - 86400000), 'yyyy-MM-dd') : today.slice(0, 8) + '01';
    buildImportPreview_(chatId, msgId, d); return true;
  }
  if (parts[1] === 'tb') { st.ti = 0; cachePutBig_('impres', JSON.stringify(st)); askTeach_(chatId, msgId, st); return true; }
  if (parts[1] === 'tc' || parts[1] === 'tt' || parts[1] === 'ts' || parts[1] === 'tf') {
    const w = (st.teach || [])[st.ti || 0];
    if (parts[1] === 'tf' || !w) { buildImportPreview_(chatId, msgId, null); return true; }
    if (parts[1] === 'tc') learnRule(w.key, EXPENSE_CATEGORIES[Number(parts[2])], '', '');
    if (parts[1] === 'tt' && TEACH_TYPES[parts[2]]) learnRule(w.key, TEACH_TYPES[parts[2]][1], '', TEACH_TYPES[parts[2]][0]);
    st.ti = (st.ti || 0) + 1;
    cachePutBig_('impres', JSON.stringify(st));
    if (st.ti >= st.teach.length) { buildImportPreview_(chatId, msgId, null); return true; }
    askTeach_(chatId, msgId, st); return true;
  }
  if (parts[1] === 'ai') { importAi_(st); cachePutBig_('impres', JSON.stringify(st)); buildImportPreview_(chatId, msgId, null); return true; }
  if (parts[1] === 'go' || parts[1] === 'all') {
    const g = groups_(st);
    const items = g.ready.concat(parts[1] === 'all' ? g.unclear.map(i => Object.assign({}, i, { type: i.type || 'Expense', category: (i.type && i.type !== 'Expense' && i.type !== 'Refund') ? i.category : 'Other', subcategory: '', source: 'import-other' })) : []);
    cacheDelBig_('impres'); // single use: a second tap cannot import twice
    const n = writeImport_(items);
    importStop_();
    const skipped = g.dupes.length + (parts[1] === 'go' ? g.unclear.length : 0) + g.undated.length;
    edit(chatId, msgId, '✅ Imported ' + n + ' transactions.' + (skipped ? ' Skipped ' + skipped + '.' : '') +
      '\nYour budgets, trends and dashboard now include them.\n/undo removes this whole import.');
    return true;
  }
  return false;
}

function importAi_(st) {
  const g = groups_(st);
  const list = g.unclear.slice(0, 80);
  if (!list.length) return;
  const prompt = 'Classify each personal-finance line from Egypt (Egyptian Arabic or English). For each, return its index, type and category. ' +
    'type must be one of: ' + TYPES.join(', ') + '. For Expense or Refund, category must be one of: ' + EXPENSE_CATEGORIES.join(', ') +
    '. For Income: Salary or Additional Income. Do not change amounts. Return ONLY JSON: {"items":[{"i":number,"type":string,"category":string}]}.\nLINES:\n' +
    list.map((it, i) => i + ': ' + it.line).join('\n');
  const res = (typeof geminiText_ === 'function') ? geminiText_(prompt) : { error: 'no AI' };
  st.aiApplied = st.aiApplied || {};
  if (!res.text) return;
  let j; try { j = JSON.parse(res.text.replace(/```json|```/g, '').trim()); } catch (e) { return; }
  (j.items || []).forEach(x => {
    const it = list[Number(x.i)]; if (!it) return;
    const type = TYPES.indexOf(x.type) >= 0 ? x.type : null; if (!type) return;
    let cat = null;
    if (type === 'Expense' || type === 'Refund') cat = EXPENSE_CATEGORIES.indexOf(x.category) >= 0 ? x.category : null;
    else if (type === 'Income') cat = INCOME_CATEGORIES.indexOf(x.category) >= 0 ? x.category : 'Additional Income';
    else cat = TYPE_DEFAULT_CATEGORY[type][0];
    if (!cat) return;
    st.aiApplied[it.lineNo + '|' + it.amount] = { type: type, category: cat };
  });
}

function writeImport_(items) {
  if (!items.length) return 0;
  const sh = txSheet(); const map = headerMap(sh); const width = sh.getLastColumn();
  const batch = fmt(new Date(), 'yyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); // unique even for two imports in one second
  const now = new Date();
  const ids = [];
  const rowsOut = items.map((it, k) => {
    const row = new Array(width).fill('');
    const set = (c, v) => { if (map[c] !== undefined) row[map[c]] = v; };
    const id = 'TX-IMP-' + batch + '-' + (k + 1); ids.push(id);
    set('Transaction_ID', id); set('Transaction_Date', Utilities.parseDate(it.date, TZ, 'yyyy-MM-dd')); set('Transaction_Type', it.type);
    set('Amount', it.amount); set('Currency', it.currency || 'EGP'); set('Category', it.category); set('Subcategory', it.subcategory || '');
    set('Description', it.description || ''); set('Payment_Method', it.payment || ''); set('Recurring_Flag', it.category === 'Installments' ? 'Yes' : 'No');
    set('Source', 'Import'); set('Created_At', now);
    set('Notes', 'Import ' + batch + ': ' + String(it.line).slice(0, 150) + (it.source === 'ai' ? ' [AI]' : it.source === 'import-other' ? ' [unclear → Other]' : '') + (it.dateAssumed ? ' [date assumed]' : ''));
    return row;
  });
  sh.getRange(sh.getLastRow() + 1, 1, rowsOut.length, width).setValues(rowsOut);
  audit('IMPORT', 'TX-IMP-' + batch, null, { count: ids.length, first: ids[0], last: ids[ids.length - 1] }, 'Telegram');
  setProp('LAST_BATCH', JSON.stringify({ ids: ids, at: now.getTime() }));
  return ids.length;
}

/**
 * AI Personal Finance Assistant — Phase 4: commands & alerts
 * ----------------------------------------------------------
 * Add as a third script file (Phase4.gs). Then run `upgradePhase4` once (or Finance menu).
 * Commands read the values the SHEET calculates (Summary, Budgets, Commitments, Goals), so the bot
 * can never disagree with your spreadsheet.
 */

// ---------- reading sheet values ----------
function sheetObjects_(name, maxCols) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const w = maxCols || sh.getLastColumn();
  const vals = sh.getRange(1, 1, sh.getLastRow(), w).getValues();
  const head = vals[0].map(h => String(h).trim());
  return vals.slice(1).map((r, i) => { const o = { _row: i + 2 }; head.forEach((h, j) => { if (h) o[h] = r[j]; }); return o; });
}
function summaryValues_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Summary');
  const map = summaryRowMap_();
  const col = sh.getRange(1, 2, summaryLayout_().length + 2, 1).getValues().map(r => r[0]);
  const v = {}; Object.keys(map).forEach(k => { v[k] = col[map[k] - 1]; });
  return v;
}
function num_(x) { const n = Number(x); return isNaN(n) ? 0 : n; }
function money_(n) { return Math.round(num_(n)).toLocaleString('en-US'); }
function isErr_(x) { return String(x)[0] === '#'; }
/** Summary must show the current cycle for commands to be meaningful. Returns a warning line or ''. */
function cycleWarning_(sv) {
  const cur = cycleFor_(fmt(new Date(), 'yyyy-MM-dd'), cycleStartDay_());
  return dateKey(sv.start) === cur.start ? '' : '⚠️ Your sheet is showing another cycle (Settings › Report_Month is set). Clear it to see the current cycle.\n\n';
}

// ---------- commitment linking (used when saving from free text) ----------
function openCommitments_() {
  return sheetObjects_('Commitments', 15).filter(c => c.Commitment_ID &&
    ['Expected', 'Overdue', 'Partial'].indexOf(String(c.Payment_Status)) >= 0);
}
/** Marks items that pay an open commitment: by name in the text, or same category + amount ≈ remaining. */
function linkCommitments(p) {
  let open; try { open = openCommitments_(); } catch (e) { return; }
  if (!open.length) return;
  const used = {};
  p.items.forEach(it => {
    if (it.related || !(it.type === 'Expense' || it.type === 'Debt Payment')) return;
    const text = norm((it.description || '') + ' ' + (it.segment || ''));
    const hit = open.find(c => !used[c.Commitment_ID] && (
      phraseIn(text, norm(c.Name)) ||
      (c.Category === it.category && Math.abs(num_(c.Remaining_This_Cycle) - it.amount) <= Math.max(1, 0.01 * num_(c.Remaining_This_Cycle)))));
    if (hit) { it.related = hit.Commitment_ID; it.recurring = true; it.commitmentName = hit.Name; used[hit.Commitment_ID] = 1; }
  });
}

/** Button / command: log the remaining amount of a commitment as paid (goes through the normal confirm flow). */
function markCommitmentPaid(chatId, id) {
  const c = sheetObjects_('Commitments', 15).find(x => String(x.Commitment_ID) === String(id));
  if (!c) return send(chatId, 'Commitment ' + id + ' not found.');
  const remaining = num_(c.Remaining_This_Cycle);
  if (!(remaining > 0)) return send(chatId, '✅ ' + c.Name + ' is already recorded as paid this cycle.');
  const type = c.Category === 'Debt' ? 'Debt Payment' : 'Expense';
  const item = {
    amount: remaining, currency: 'EGP', explicitType: type, inheritedType: null, rule: null, type: type,
    category: (type === 'Expense' && EXPENSE_CATEGORIES.indexOf(c.Category) < 0) ? null : c.Category, subcategory: '',
    description: String(c.Name), segment: '', source: 'rules', dup: false, related: c.Commitment_ID, recurring: true, commitmentName: c.Name,
  };
  finalizeItem(item);
  const p = { id: shortId(), chatId: chatId, text: '[commitment ' + c.Commitment_ID + '] ' + c.Name, items: [item], payment: '', dateOffset: 0, usedAI: false, aiNote: '' };
  markDuplicates(p);
  advance(p, null);
}

// ---------- commands ----------
function handleCommand4(chatId, cmd, arg) {
  switch (cmd) {
    case '/budget': send(chatId, budgetText_()); return true;
    case '/saving': send(chatId, savingText_()); return true;
    case '/commitments': { const r = commitmentsText_(); send(chatId, r.text, r.buttons); return true; }
    case '/goals': send(chatId, goalsText_()); return true;
    case '/alerts': send(chatId, alertsSettingsText_(), alertsButtons_()); return true;
    case '/export': exportCsv_(chatId, arg); return true;
    case '/report': send(chatId, '📄 The monthly emailed report comes in Phase 7. /month and /budget cover the current cycle for now.'); return true;
  }
  return false;
}

function budgetText_() {
  const sv = summaryValues_();
  const rowsB = sheetObjects_('Budgets', 11).filter(b => b.Category && b.Category !== 'TOTAL' && (num_(b.Budgeted_Amount) > 0 || num_(b.Actual_Amount) > 0));
  const icon = s => ({ Over: '🔴', 'Likely over': '🟠', Warning: '🟡', OK: '🟢', 'No budget': '⚪' }[s] || '⚪');
  rowsB.sort((a, b) => (num_(b.Percent_Used) - num_(a.Percent_Used)));
  const total = sheetObjects_('Budgets', 11).find(b => b.Category === 'TOTAL') || {};
  const left = Math.max(0, Math.round((new Date(sv.end).getTime() - new Date(sv.today).getTime()) / 86400000));
  const lines = rowsB.map(b => icon(b.Status) + ' ' + b.Category + ': ' + money_(b.Actual_Amount) + ' / ' + money_(b.Budgeted_Amount) +
    (num_(b.Budgeted_Amount) > 0 ? ' (' + Math.round(num_(b.Percent_Used) * 100) + '%)' : '') +
    (b.Status === 'Likely over' ? ' → on pace for ' + money_(b.Projected_Cycle_End) : ''));
  return cycleWarning_(sv) + '📋 Budget · ' + dateKey(sv.start) + ' → ' + dateKey(sv.end) + ' (' + left + ' days left)\n' +
    (lines.length ? lines.join('\n') : 'No budgets or spending yet.') +
    '\n\nTotal: ' + money_(total.Actual_Amount) + ' / ' + money_(total.Budgeted_Amount) + ' EGP · projected ' + money_(total.Projected_Cycle_End);
}

function savingText_() {
  const sv = summaryValues_();
  const rec = sv.recdate;
  const recKey = num_(rec) === 0 || !dateKey(rec) || dateKey(rec) < '2000' ? '' : dateKey(rec);
  const age = recKey ? Math.round((Date.now() - new Date(recKey + 'T00:00:00Z').getTime()) / 86400000) : null;
  const warn = !recKey ? '⚠️ No account balances yet. Enter today\'s balances in the Accounts tab — until then cash figures are not reliable.\n\n'
    : age > 30 ? '⚠️ Balances last reconciled ' + age + ' days ago. Update the Accounts tab for accurate numbers.\n\n' : '';
  return cycleWarning_(sv) + warn + '💰 What you can save or invest now\n' +
    'Estimated cash: ' + money_(sv.cash) + '\n' +
    '− Bills still due: ' + money_(sv.due) + '\n' +
    '− Expected spending rest of cycle: ' + money_(sv.remvar) + '\n' +
    '− Minimum buffer: ' + money_(sv.buffer) + '\n' +
    '= Available surplus: ' + money_(sv.surplus) + ' EGP\n\n' +
    'Suggested order:\n1) Emergency fund: ' + money_(sv.toef) + (num_(sv.efgap) > 0 ? ' (gap ' + money_(sv.efgap) + ')' : ' (fully funded ✅)') +
    '\n2) Goals: ' + money_(sv.togoals) + ' (needs ' + money_(sv.goalsneed) + '/month)\n3) Free to invest: ' + money_(sv.free) +
    '\n\nSavings rate this cycle: ' + (num_(sv.income) ? Math.round(num_(sv.srate) * 1000) / 10 + '%' : 'n/a (no income recorded yet)') +
    (recKey ? '\nBalances from ' + recKey + '.' : '') + '\nRules-based estimate, not financial advice.';
}

function commitmentsText_() {
  const sv = summaryValues_();
  const rowsC = sheetObjects_('Commitments', 15);
  const noId = rowsC.filter(c => !c.Commitment_ID && c.Name);
  const all = rowsC.filter(c => c.Commitment_ID && (c.Active_Status === 'Active' || c.Active_Status === ''));
  const icon = s => ({ Paid: '✅', Partial: '🟡', Overdue: '🔴', Expected: '⏳', 'Not this cycle': '➖' }[s] || '•');
  all.sort((a, b) => String(dateKey(a.Due_In_Cycle)).localeCompare(String(dateKey(b.Due_In_Cycle))));
  const lines = all.map(c => icon(c.Payment_Status) + ' ' + c.Name + ': ' + money_(c.Expected_Amount) + ' · ' + c.Payment_Status +
    (c.Payment_Status !== 'Paid' && c.Payment_Status !== 'Not this cycle' ? ' · due ' + dateKey(c.Due_In_Cycle) : '') +
    (c.Payment_Status === 'Partial' ? ' (' + money_(c.Remaining_This_Cycle) + ' left)' : ''));
  const open = all.filter(c => ['Expected', 'Overdue', 'Partial'].indexOf(c.Payment_Status) >= 0).slice(0, 6);
  const buttons = open.map(c => [{ text: '✅ Mark paid: ' + String(c.Name).slice(0, 24), callback_data: 'cp|' + c.Commitment_ID }]);
  return {
    text: cycleWarning_(sv) + '📆 Commitments this cycle\n' + (lines.length ? lines.join('\n') : 'No active commitments. Add them in the Commitments tab.') +
      (noId.length ? '\n\n⚠️ Skipped (no Commitment_ID): ' + noId.map(c => c.Name).join(', ') + '. Use Finance › Fix commitments, or type an ID like CMT-010.' : '') +
      '\n\nStill due: ' + money_(sv.due) + ' EGP',
    buttons: buttons.length ? buttons : null,
  };
}

function goalsText_() {
  const g = sheetObjects_('Goals', 10).filter(x => x.Goal_ID && x.Goal_Name);
  if (!g.length) return '🎯 No goals yet. Add them in the Goals tab.';
  const bar = p => { const n = Math.max(0, Math.min(10, Math.round(num_(p) * 10))); return '▓'.repeat(n) + '░'.repeat(10 - n); };
  return '🎯 Goals\n' + g.map(x => x.Goal_Name + (x.Priority ? ' (' + x.Priority + ')' : '') + '\n' + bar(x.Progress_Pct) + ' ' +
    Math.round(num_(x.Progress_Pct) * 100) + '% · ' + money_(x.Current_Amount) + ' / ' + money_(x.Target_Amount) +
    '\nNeeds ' + money_(x.Required_Monthly_Contribution) + '/month · ' + num_(x.Months_Remaining) + ' months left').join('\n\n') +
    '\n\nUpdate Current_Amount in the Goals tab when you add money to a goal.';
}

function csvCell_(v) {
  if (isDate(v)) v = fmt(v, 'yyyy-MM-dd HH:mm').replace(' 00:00', '');
  const s = String(v === null || v === undefined ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCsv_(chatId, arg) {
  const all = String(arg || '').toLowerCase() === 'all';
  const { rows: data, map } = readTx();
  const c = cycleFor_(fmt(new Date(), 'yyyy-MM-dd'), cycleStartDay_());
  const head = Object.keys(map).sort((a, b) => map[a] - map[b]);
  const sel = data.filter(r => r[map.Amount] !== '' && (all || (dateKey(r[map.Transaction_Date]) >= c.start && dateKey(r[map.Transaction_Date]) <= c.end)));
  if (!sel.length) return send(chatId, 'No transactions to export.');
  const csv = '\ufeff' + [head.map(csvCell_).join(',')].concat(sel.map(r => head.map(h => csvCell_(r[map[h]])).join(','))).join('\n');
  const name = all ? 'transactions_all.csv' : 'transactions_' + c.start + '_' + c.end + '.csv';
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop('BOT_TOKEN') + '/sendDocument', {
    method: 'post', muteHttpExceptions: true,
    payload: { chat_id: String(chatId), caption: sel.length + ' transactions' + (all ? '' : ' (current cycle). Send /export all for everything.'), document: Utilities.newBlob(csv, 'text/csv', name) },
  });
  if (res.getResponseCode() !== 200) send(chatId, '⚠️ Export failed: ' + res.getContentText().slice(0, 150));
}

// ---------- alerts ----------
function alertsSettingsText_() {
  const st = getSettings();
  return '🔔 Alerts: ' + (String(st.Alerts_Enabled || 'ON').toUpperCase() === 'OFF' ? 'OFF' : 'ON') +
    '\nDaily check at ' + (st.Alert_Hour === '' || st.Alert_Hour === undefined ? 20 : st.Alert_Hour) + ':00 (Cairo). Only sent when there is something new.' +
    '\nIncludes: bills due within ' + (st.Bill_Reminder_Days || 2) + ' days and overdue bills, budgets crossing warning levels, unusual spending, ' +
    'missing salary, stale balances, and a nudge after ' + (st.Inactivity_Reminder_Days || 3) + ' days without entries.' +
    '\nChange hours/days in the Settings tab.';
}
function alertsButtons_() {
  const on = String(getSettings().Alerts_Enabled || 'ON').toUpperCase() !== 'OFF';
  return [[{ text: on ? 'Turn alerts OFF' : 'Turn alerts ON', callback_data: 'al|t' }, { text: 'Run check now', callback_data: 'al|now' }]];
}
function handleAlertsCallback(chatId, msgId, what) {
  if (what === 't') {
    const on = String(getSettings().Alerts_Enabled || 'ON').toUpperCase() !== 'OFF';
    setSetting('Alerts_Enabled', on ? 'OFF' : 'ON');
    return edit(chatId, msgId, alertsSettingsText_(), alertsButtons_());
  }
  if (what === 'now') {
    const sent = alertsJob(true);
    if (!sent) send(chatId, '✅ Nothing new to report right now.');
  }
}

/** Hourly trigger. Sends at most one combined message per day, at or after Alert_Hour, only if something is new. */
function alertsJob(force) {
  const st = getSettings();
  const owner = prop('OWNER_ID');
  if (!owner) return false;
  if (!force && String(st.Alerts_Enabled || 'ON').toUpperCase() === 'OFF') return false;
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const hour = st.Alert_Hour === '' || st.Alert_Hour === undefined ? 20 : Number(st.Alert_Hour);
  if (!force && (Number(fmt(new Date(), 'HH')) < hour || prop('ALERT_LAST_DAY') === today)) return false;
  setProp('ALERT_LAST_DAY', today);
  try { refreshInsights(); } catch (e) { console.error(e); }

  const cyc = cycleFor_(today, cycleStartDay_());
  let state = JSON.parse(prop('ALERT_STATE') || '{}');
  if (state.cycle !== cyc.start) state = { cycle: cyc.start, sent: {} };
  const seen = k => state.sent[k]; const mark = (k, v) => { state.sent[k] = v || 1; };
  const sv = summaryValues_();
  const current = dateKey(sv.start) === cyc.start;
  const sections = { bills: [], budgets: [], review: [], reminders: [] };
  const buttons = [];
  const addDays = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // Bills (only when the sheet shows the current cycle)
  if (current) {
    const horizon = addDays(today, Number(st.Bill_Reminder_Days) || 2);
    sheetObjects_('Commitments', 15).filter(c => c.Commitment_ID && (c.Active_Status === 'Active' || c.Active_Status === '')).forEach(c => {
      const due = dateKey(c.Due_In_Cycle);
      if (c.Payment_Status === 'Overdue') {
        sections.bills.push('🔴 ' + c.Name + ' ' + money_(c.Remaining_This_Cycle) + ' — overdue since ' + due);
        buttons.push([{ text: '✅ Paid: ' + String(c.Name).slice(0, 24), callback_data: 'cp|' + c.Commitment_ID }]);
      } else if ((c.Payment_Status === 'Expected' || c.Payment_Status === 'Partial') && due >= today && due <= horizon && !seen('bill|' + c.Commitment_ID + '|' + due)) {
        sections.bills.push('⏳ ' + c.Name + ' ' + money_(c.Remaining_This_Cycle) + ' — due ' + (due === today ? 'today' : due));
        buttons.push([{ text: '✅ Paid: ' + String(c.Name).slice(0, 24), callback_data: 'cp|' + c.Commitment_ID }]);
        mark('bill|' + c.Commitment_ID + '|' + due);
      }
    });
    // Budgets: alert only when a category escalates (Warning → Likely over → Over)
    const level = { Warning: 1, 'Likely over': 2, Over: 3 };
    sheetObjects_('Budgets', 11).forEach(b => {
      if (!b.Category || b.Category === 'TOTAL' || isErr_(b.Status)) return;
      const lv = level[b.Status] || 0, key = 'bud|' + b.Category;
      if (lv > (seen(key) || 0)) {
        sections.budgets.push((lv === 3 ? '🔴 ' : lv === 2 ? '🟠 ' : '🟡 ') + b.Category + ': ' +
          (lv === 3 ? 'over budget — ' + money_(b.Actual_Amount) + ' of ' + money_(b.Budgeted_Amount)
            : lv === 2 ? 'on pace for ' + money_(b.Projected_Cycle_End) + ' vs ' + money_(b.Budgeted_Amount)
              : Math.round(num_(b.Percent_Used) * 100) + '% used (' + money_(b.Actual_Amount) + ' of ' + money_(b.Budgeted_Amount) + ')'));
        mark(key, lv);
      }
    });
  }
  // Review items from Insights (each once per cycle)
  sheetObjects_('Insights', 7).forEach(i => {
    if (['Unusual transaction', 'High-spending day', 'Looks recurring'].indexOf(i.Type) < 0) return;
    const key = 'ins|' + i.Type + '|' + String(i.Transaction_ID || i.Date || '') + '|' + String(i.Detail).slice(0, 40);
    if (!seen(key)) { sections.review.push('• ' + i.Detail); mark(key); }
  });
  // Salary not recorded 2+ days after payday
  const sd = Number(st.Salary_Day);
  if (current && sd >= 1 && sd <= 31 && num_(sv.salary) === 0 && !seen('salary')) {
    const cand = [cyc.start.slice(0, 8), cyc.end.slice(0, 8)].map(p => p + String(Math.min(sd, 28)).padStart(2, '0')).filter(d => d >= cyc.start && d <= cyc.end);
    if (cand.length && addDays(cand[0], 2) <= today) {
      sections.reminders.push('💵 No salary recorded this cycle yet (payday ~' + cand[0] + '). Send e.g. "قبضت المرتب 30000".');
      mark('salary');
    }
  }
  // Stale balances (at most every Reconcile_Reminder_Days)
  const rDays = Number(st.Reconcile_Reminder_Days) || 30;
  const recKey = num_(sv.recdate) === 0 ? '' : dateKey(sv.recdate);
  const lastNag = prop('RECON_NAG') || '';
  if ((!recKey || addDays(recKey, rDays) <= today) && (!lastNag || addDays(lastNag, rDays) <= today)) {
    sections.reminders.push('🏦 ' + (recKey ? 'Balances last updated ' + recKey : 'Account balances not entered yet') + '. Update the Accounts tab so cash and net worth stay accurate.');
    setProp('RECON_NAG', today);
  }
  // Inactivity nudge (once per quiet streak)
  const iDays = Number(st.Inactivity_Reminder_Days) || 3;
  const { rows: data, map } = readTx();
  const lastTx = data.map(r => dateKey(r[map.Created_At] || r[map.Transaction_Date])).filter(Boolean).sort().pop() || '';
  if (lastTx && addDays(lastTx, iDays) <= today && prop('IDLE_NAG') !== lastTx) {
    sections.reminders.push('✍️ Nothing recorded since ' + lastTx + '. Any expenses to add?');
    setProp('IDLE_NAG', lastTx);
  }

  const keys = Object.keys(state.sent);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete state.sent[k]);
  setProp('ALERT_STATE', JSON.stringify(state));

  const parts = [];
  if (sections.bills.length) parts.push('Bills\n' + sections.bills.join('\n'));
  if (sections.budgets.length) parts.push('Budgets\n' + sections.budgets.join('\n'));
  if (sections.review.length) parts.push('Worth a look (not errors)\n' + sections.review.slice(0, 5).join('\n'));
  if (sections.reminders.length) parts.push(sections.reminders.join('\n'));
  if (!parts.length) return false;
  send(owner, '🔔 Daily check · ' + today + '\n\n' + parts.join('\n\n'), buttons.length ? buttons.slice(0, 5) : null);
  return true;
}

// ---------- upgrade ----------
function upgradePhase4() {
  const st = getSettings();
  const add = (k, v, d) => { if (st[k] === undefined) setSetting(k, v, d); };
  add('Alerts_Enabled', 'ON', 'ON/OFF. Daily Telegram check (only sent when something is new).');
  add('Alert_Hour', 20, 'Hour (0-23, Cairo) for the daily check.');
  add('Bill_Reminder_Days', 2, 'Remind about commitments due within this many days.');
  add('Inactivity_Reminder_Days', 3, 'Nudge after this many days without any recorded transaction.');
  add('Reconcile_Reminder_Days', 30, 'Remind to update Accounts balances this often.');
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'alertsJob').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('alertsJob').timeBased().everyHours(1).create();
  if (typeof botCommandList_ === 'function') tg('setMyCommands', { commands: botCommandList_() });
  else tg('setMyCommands', { commands: [
    { command: 'today', description: "Today's transactions" }, { command: 'month', description: 'This cycle so far' },
    { command: 'budget', description: 'Budget by category' }, { command: 'saving', description: 'What you can save or invest' },
    { command: 'commitments', description: 'Bills this cycle' }, { command: 'goals', description: 'Goal progress' },
    { command: 'undo', description: 'Remove the last saved entry' }, { command: 'export', description: 'CSV of this cycle (/export all)' },
    { command: 'alerts', description: 'Alert settings' }, { command: 'settings', description: 'Confirmation mode, AI' },
    { command: 'help', description: 'How to use' }] });
  console.log('Phase 4 ready: commands registered, hourly alert check scheduled.');
}

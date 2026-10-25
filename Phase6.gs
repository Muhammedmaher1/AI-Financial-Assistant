/**
 * AI Personal Finance Assistant — Phase 6: mobile dashboard
 * ---------------------------------------------------------
 * Files: Phase6.gs (this) + Dashboard.html (add with + › HTML, name it exactly "Dashboard").
 * Deploy: Deploy › New deployment › Web app › Execute as: Me › Who has access: Only myself.
 * The dashboard only READS values your sheet already calculates, so it always matches the sheet and the bot.
 */

/** Secret key that must be in the link (?k=…). Stored in Script Properties, never in the sheet. */
function dashKey_(rotate) {
  let k = prop('DASH_KEY');
  if (!k || rotate) {
    k = '';
    while (k.length < 40) k += Math.random().toString(36).slice(2);
    k = k.slice(0, 40);
    setProp('DASH_KEY', k);
  }
  return k;
}
function keyOk_(k) { const real = prop('DASH_KEY'); return !!real && String(k || '') === real; }

function doGet(e) {
  const k = e && e.parameter ? e.parameter.k : '';
  if (!keyOk_(k)) {
    return HtmlService.createHtmlOutput('<p style="font:16px system-ui;padding:24px">This link is not valid. Send /dashboard to your bot for your current link.</p>')
      .setTitle('My money').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  const t = HtmlService.createTemplateFromFile('Dashboard');
  t.key = k;
  return t.evaluate()
    .setTitle('My money')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setFaviconUrl('https://fonts.gstatic.com/s/e/notoemoji/latest/1f4b0/512.png');
}

function dk_(v) { return isDate(v) ? dateKey(v) : (num_(v) > 0 && typeof v === 'number' ? '' : String(v || '')); }

/** Everything the dashboard shows, in one call. Requires the secret key. */
function getDashboardData(k) {
  if (!keyOk_(k)) throw new Error('This link is not valid. Send /dashboard to your bot for your current link.');
  const sv = summaryValues_();
  const csd = cycleStartDay_();
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const cyc = cycleFor_(today, csd);
  const warnings = [];
  if (dateKey(sv.start) !== cyc.start) warnings.push('Your sheet is set to another cycle (Settings › Report_Month). Clear it to see the current cycle.');
  if (!num_(sv.recdate)) warnings.push('Enter your account balances on the Accounts tab so cash and net worth are accurate.');
  const pick = k => num_(sv[k]);
  const s = {};
  ['income', 'salary', 'consumption', 'fixed', 'variable', 'debt', 'due', 'projected', 'remvar', 'netsaved', 'srate', 'irate', 'cash',
    'savbal', 'portfolio', 'debts', 'networth', 'surplus', 'efgap', 'eftarget', 'toef', 'togoals', 'free', 'prev', 'avg3', 'days', 'elapsed', 'buffer'].forEach(k => { s[k] = pick(k); });

  const B = sheetObjects_('Budgets', 11);
  const tot = B.find(b => b.Category === 'TOTAL') || {};
  const budgets = B.filter(b => b.Category && b.Category !== 'TOTAL' && (num_(b.Budgeted_Amount) > 0 || num_(b.Actual_Amount) > 0))
    .map(b => ({ cat: b.Category, budget: num_(b.Budgeted_Amount), actual: num_(b.Actual_Amount), projected: num_(b.Projected_Cycle_End), status: String(b.Status), flag: String(b.Flag || '') }))
    .sort((a, b) => (b.budget ? b.actual / b.budget : 9) - (a.budget ? a.actual / a.budget : 9));

  // Daily net consumption in the cycle shown on the Summary (same definition: Expense − Refund, EGP only)
  const start = dateKey(sv.start), end = dateKey(sv.end);
  const { rows: data, map } = readTx();
  const byDay = {};
  const recent = [];
  data.forEach(r => {
    const d = dateKey(r[map.Transaction_Date]);
    if (!d || r[map.Amount] === '') return;
    recent.push({ d: d, t: r[map.Transaction_Type], a: num_(r[map.Amount]), cur: r[map.Currency] || 'EGP', cat: r[map.Category], desc: String(r[map.Description] || ''), c: isDate(r[map.Created_At]) ? r[map.Created_At].getTime() : 0 });
    if (d < start || d > end || r[map.Currency] !== 'EGP') return;
    const ty = r[map.Transaction_Type];
    if (ty === 'Expense') byDay[d] = (byDay[d] || 0) + num_(r[map.Amount]);
    if (ty === 'Refund') byDay[d] = (byDay[d] || 0) - num_(r[map.Amount]);
  });
  const daily = [];
  for (let i = 0; i < s.days; i++) {
    const dt = new Date(start + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + i);
    const k = dt.toISOString().slice(0, 10);
    if (k > today) break;
    daily.push({ d: k, a: byDay[k] || 0 });
  }
  recent.sort((x, y) => (y.d + String(y.c).padStart(15, '0')).localeCompare(x.d + String(x.c).padStart(15, '0')));

  const bills = sheetObjects_('Commitments', 15).filter(c => c.Commitment_ID && (c.Active_Status === 'Active' || c.Active_Status === ''))
    .map(c => ({ name: String(c.Name), amount: num_(c.Expected_Amount), remaining: num_(c.Remaining_This_Cycle), status: String(c.Payment_Status), due: dk_(c.Due_In_Cycle) }))
    .sort((a, b) => a.due.localeCompare(b.due));

  let portfolio = null;
  try {
    const ps = portfolioState_();
    portfolio = {
      value: num_(ps.v.value), cost: num_(ps.v.cost), unreal: num_(ps.v.unreal), unrealpct: num_(ps.v.unrealpct), profile: String(ps.v.profile || ''),
      newmoney: num_(ps.v.newmoney), thndrcash: num_(ps.v.thndrcash), oldest: dk_(ps.v.valdate),
      classes: ps.classes.map(c => ({ cls: c.cls, value: c.value, pct: c.pct, target: c.target, suggested: c.suggested })),
    };
  } catch (e) { /* Phase 5 not installed */ }

  const goals = sheetObjects_('Goals', 10).filter(g => g.Goal_ID && g.Goal_Name).map(g => ({
    name: String(g.Goal_Name), target: num_(g.Target_Amount), current: num_(g.Current_Amount), pct: num_(g.Progress_Pct),
    monthly: num_(g.Required_Monthly_Contribution), months: num_(g.Months_Remaining) }));

  const insights = sheetObjects_('Insights', 7).filter(i => i.Type && i.Type !== 'Note').slice(0, 8)
    .map(i => ({ type: String(i.Type), sev: String(i.Severity), detail: String(i.Detail) }));

  const history = sheetObjects_('Monthly_Snapshots', 24).filter(x => x.Month).slice(-5).map(x => ({
    label: String(x.Month).slice(0, 7), income: num_(x.Total_Income), spent: num_(x.Net_Consumption), srate: num_(x.Savings_Rate) }));
  history.push({ label: 'Now', income: s.income, spent: s.consumption, srate: s.srate, current: true });

  const pe = new Date(cyc.start + 'T00:00:00Z'); pe.setUTCDate(pe.getUTCDate() - 1);
  const prevCyc = cycleFor_(pe.toISOString().slice(0, 10), csd);
  return JSON.stringify({
    generated: fmt(new Date(), 'yyyy-MM-dd HH:mm'), today: today, start: start, end: end, s: s,
    cycleStart: cyc.start, prevStart: prevCyc.start, prevEnd: prevCyc.end,
    budgetTotal: num_(tot.Budgeted_Amount), budgets: budgets, daily: daily, bills: bills, portfolio: portfolio, goals: goals,
    insights: insights, history: history, recent: recent.slice(0, 8).map(r => { delete r.c; return r; }), warnings: warnings,
  });
}

/** The /exec URL, cleaned: drops "/u/1/"-style account segments (they break on phones with fewer
 *  Google accounts) and anything after "?". */
function cleanExecUrl_(u) {
  return String(u || '').trim().split('?')[0].split('#')[0].replace(/\/u\/\d+\//, '/');
}
/** Reads Settings › Dashboard_URL (last non-empty row wins). No automatic fallback: Google's own
 *  getUrl() can return an older deployment, which is confusing. */
function dashboardUrl_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  if (!sh || sh.getLastRow() < 2) return '';
  let url = '';
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
    if (String(r[0]).trim() !== 'Dashboard_URL') return;
    const cand = [r[1], r[2]].map(String).find(v => /script\.google\.com\/.*\/exec/.test(v)); // tolerate it pasted in the wrong column
    if (cand) url = cand;
  });
  return cleanExecUrl_(url);
}
function deploymentId_(url) { const m = String(url).match(/\/s\/([^/]+)\/exec/); return m ? m[1] : ''; }
function handleCommand6(chatId, cmd, arg) {
  if (cmd !== '/dashboard') return false;
  const a = String(arg || '').trim();
  if (/^url\b/i.test(a)) {
    const u = cleanExecUrl_(a.replace(/^url\s*/i, ''));
    if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[^/]+\/exec$/.test(u)) {
      send(chatId, 'That does not look like a web app URL. Copy it from Apps Script › Deploy › Manage deployments. It ends with /exec.');
      return true;
    }
    // overwrite every Dashboard_URL row so there is only one truth
    const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
    let found = false;
    if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach((r, i) => {
      if (String(r[0]).trim() === 'Dashboard_URL') { sh.getRange(i + 2, 2).setValue(u); found = true; }
    });
    if (!found) setSetting('Dashboard_URL', u, 'Web app URL of your dashboard. Set it with /dashboard url <link>.');
    send(chatId, '✅ Dashboard address saved (deployment …' + deploymentId_(u).slice(-6) + ').');
    arg = '';
  }
  const url = dashboardUrl_();
  if (!url) {
    send(chatId, 'No dashboard address saved yet. In Apps Script open Deploy › Manage deployments, copy the Web app URL, then send:\n/dashboard url <paste the URL here>');
    return true;
  }
  const rotate = String(arg || '').trim().toLowerCase() === 'new';
  if (/\/dev$/.test(url)) {
    send(chatId, '⚠️ Settings › Dashboard_URL ends in /dev (test link, needs sign-in). Use the /exec URL from Deploy › Manage deployments.');
    return true;
  }
  const link = url + '?k=' + dashKey_(rotate);
  send(chatId, (rotate ? '🔑 New link created. The old link no longer works.\n\n' : '') + '📊 Your dashboard (deployment …' + deploymentId_(url).slice(-6) + '):\n' + link +
    '\n\nThis link works without signing in, so treat it like a password: don\'t share it.' +
    '\nIf it ever leaks, send /dashboard new to replace it.\nOn iPhone: open in Safari › Share › Add to Home Screen.');
  return true;
}
function upgradePhase6() {
  if (getSettings().Dashboard_URL === undefined) setSetting('Dashboard_URL', '', 'Web app URL of your dashboard (from Deploy › Manage deployments). /dashboard sends it.');
  try { tg('setMyCommands', { commands: botCommandList_() }); } catch (e) { }
  console.log('Phase 6 ready. Now deploy the web app.');
}


/** Spending for any date range (Explore section). Same definitions as everywhere: Expense − Refund, EGP only. */
function getSpending(k, from, to) {
  if (!keyOk_(k)) throw new Error('This link is not valid. Send /dashboard to your bot for your current link.');
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(from)) || !re.test(String(to)) || from > to) throw new Error('Pick a valid date range (from must be before to).');
  const add = (key, n) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 1100) throw new Error('Please choose a range of up to 3 years.');
  const pFrom = add(from, -days), pTo = add(from, -1);
  const { rows: data, map } = readTx();
  const cur = { total: 0, count: 0, income: 0, refunds: 0, cats: {}, items: [], skipped: 0 };
  const prevCats = {}; let prevTotal = 0;
  data.forEach(r => {
    const d = dateKey(r[map.Transaction_Date]);
    if (!d || r[map.Amount] === '') return;
    const t = r[map.Transaction_Type], a = Number(r[map.Amount]) || 0, c = String(r[map.Category] || 'Other');
    const inCur = d >= from && d <= to, inPrev = d >= pFrom && d <= pTo;
    if (!inCur && !inPrev) return;
    if (r[map.Currency] !== 'EGP') { if (inCur && (t === 'Expense' || t === 'Refund')) cur.skipped++; return; }
    if (t !== 'Expense' && t !== 'Refund' && !(inCur && t === 'Income')) return;
    if (inCur && t === 'Income') { cur.income += a; return; }
    const signed = t === 'Expense' ? a : -a;
    if (inPrev) { prevTotal += signed; prevCats[c] = (prevCats[c] || 0) + signed; return; }
    cur.total += signed;
    if (t === 'Expense') cur.count++; else cur.refunds += a;
    cur.cats[c] = cur.cats[c] || { amount: 0, count: 0 };
    cur.cats[c].amount += signed; if (t === 'Expense') cur.cats[c].count++;
    cur.items.push({ d: d, a: signed, cat: c, desc: String(r[map.Description] || ''), t: t });
  });
  // chart buckets: daily up to 45 days, weekly up to 200, then monthly
  const gran = days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
  const buckets = [];
  if (gran === 'day') for (let i = 0; i < days; i++) { const k2 = add(from, i); buckets.push({ from: k2, to: k2, amount: 0 }); }
  else if (gran === 'week') for (let f = from; f <= to; f = add(f, 7)) buckets.push({ from: f, to: add(f, 6) > to ? to : add(f, 6), amount: 0 });
  else { let f = from; while (f <= to) { const y = +f.slice(0, 4), m = +f.slice(5, 7); const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); buckets.push({ from: f, to: end > to ? to : end, amount: 0 }); f = add(end, 1); } }
  cur.items.forEach(it => { const b = buckets.find(x => it.d >= x.from && it.d <= x.to); if (b) b.amount += it.a; });
  const cats = Object.keys(cur.cats).map(c => ({ cat: c, amount: cur.cats[c].amount, count: cur.cats[c].count, share: cur.total > 0 ? cur.cats[c].amount / cur.total : 0, prev: prevCats[c] || 0 }))
    .filter(c => Math.abs(c.amount) >= 0.5).sort((a, b) => b.amount - a.amount);
  cur.items.sort((a, b) => b.d.localeCompare(a.d) || b.a - a.a);
  const largest = cur.items.filter(i => i.t === 'Expense').slice().sort((a, b) => b.a - a.a).slice(0, 8);
  return JSON.stringify({
    from: from, to: to, days: days, gran: gran, total: cur.total, count: cur.count, refunds: cur.refunds, income: cur.income,
    dailyAvg: cur.total / days, prevFrom: pFrom, prevTo: pTo, prevTotal: prevTotal, change: prevTotal > 0 ? cur.total / prevTotal - 1 : null,
    cats: cats, buckets: buckets, largest: largest, items: cur.items.slice(0, 400), truncated: cur.items.length > 400, skipped: cur.skipped,
  });
}

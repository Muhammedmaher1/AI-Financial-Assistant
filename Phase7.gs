/**
 * AI Personal Finance Assistant — Phase 7: monthly report
 * -------------------------------------------------------
 * Add as Phase7.gs, then run Finance › Upgrade to Phase 7 (approve the email permission).
 *  - The morning after each cycle ends, a PDF report is emailed to Settings › Report_Email and sent in Telegram.
 *  - Headline numbers come from the frozen Monthly_Snapshots row; categories are frozen in Category_Snapshots,
 *    so re-sending an old report gives the same numbers.
 *  - AI commentary (optional) only receives totals; every number it writes is checked against the real data.
 *    If a check fails or AI is unavailable, rule-based commentary is used instead.
 * Commands: /report (last completed cycle), /report current (this cycle so far), add "email" to also email it.
 */

// ---------- capture a cycle using the sheet's own formulas ----------
function captureCycle_(cycle) {
  const original = getSettings().Report_Month;
  let sv, budgets, bills;
  try {
    setSetting('Report_Month', Utilities.parseDate(cycle.label, TZ, 'yyyy-MM-dd'));
    SpreadsheetApp.flush();
    sv = summaryValues_();
    budgets = sheetObjects_('Budgets', 11);
    bills = sheetObjects_('Commitments', 15);
  } finally {
    setSetting('Report_Month', original === undefined ? '' : original);
    SpreadsheetApp.flush();
  }
  if (dateKey(sv.start) !== cycle.start) throw new Error('Report check failed: the sheet did not switch to ' + cycle.start);
  return {
    sv: sv,
    cats: budgets.filter(b => b.Category && b.Category !== 'TOTAL').map(b => ({
      cat: String(b.Category), budget: num_(b.Budgeted_Amount), actual: num_(b.Actual_Amount), status: String(b.Status), prev: num_(b.Previous_Cycle) })),
    bills: billsFrom_(bills),
  };
}
function billsFrom_(rowsC) {
  return rowsC.filter(c => c.Commitment_ID && (c.Active_Status === 'Active' || c.Active_Status === '') && c.Payment_Status !== 'Not this cycle')
    .map(c => ({ name: String(c.Name), amount: num_(c.Expected_Amount), paid: num_(c.Paid_This_Cycle), status: String(c.Payment_Status) }));
}

function categorySnapshots_(cycle) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Category_Snapshots');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().filter(r => dateKey(r[1]) === cycle.start)
    .map(r => ({ cat: String(r[3]), budget: num_(r[4]), actual: num_(r[5]), status: String(r[6]), prev: num_(r[7]) }));
}
function writeCategorySnapshots_(cycle, cats) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Category_Snapshots');
  const rowsC = cats.map(c => [cycle.label.slice(0, 7), Utilities.parseDate(cycle.start, TZ, 'yyyy-MM-dd'), Utilities.parseDate(cycle.end, TZ, 'yyyy-MM-dd'),
    c.cat, c.budget, c.actual, c.status, c.prev]);
  if (rowsC.length) sh.getRange(sh.getLastRow() + 1, 1, rowsC.length, 8).setValues(rowsC);
}
function snapshotRow_(cycle) {
  return sheetObjects_('Monthly_Snapshots', 24).filter(x => dateKey(x.Cycle_Start) === cycle.start).pop() || null;
}
function previousCycle_(c) {
  const d = new Date(c.start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return cycleFor_(d.toISOString().slice(0, 10), cycleStartDay_());
}

/** Everything the report needs. current=true → the running cycle (live, not frozen). */
function buildReportData_(current) {
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const cur = cycleFor_(today, cycleStartDay_());
  const cycle = current ? cur : previousCycle_(cur);
  let f, cats, bills, frozen = false;
  if (current) {
    const sv = summaryValues_();
    f = {
      income: num_(sv.income), salary: num_(sv.salary), spent: num_(sv.consumption), fixed: num_(sv.fixed), variable: num_(sv.variable),
      debt: num_(sv.debt), savings: num_(sv.sav), invested: num_(sv.inv), withdrawn: num_(sv.wd), returns: num_(sv.ret), srate: num_(sv.srate),
      cash: num_(sv.cash), networth: num_(sv.networth), portfolio: num_(sv.portfolio), savbal: num_(sv.savbal), debts: num_(sv.debts),
    };
    cats = sheetObjects_('Budgets', 11).filter(b => b.Category && b.Category !== 'TOTAL').map(b => ({
      cat: String(b.Category), budget: num_(b.Budgeted_Amount), actual: num_(b.Actual_Amount), status: String(b.Status), prev: num_(b.Previous_Cycle) }));
    bills = billsFrom_(sheetObjects_('Commitments', 15));
  } else {
    if (!snapshotRow_(cycle)) takeSnapshot_(cycle);
    const snap = snapshotRow_(cycle);
    const cap = captureCycle_(cycle);
    cats = categorySnapshots_(cycle);
    if (!cats.length) { cats = cap.cats; writeCategorySnapshots_(cycle, cats); }
    bills = cap.bills;
    frozen = true;
    f = {
      income: num_(snap.Total_Income), salary: num_(snap.Salary), spent: num_(snap.Net_Consumption), fixed: num_(snap.Fixed_Commitments),
      variable: num_(snap.Variable_Expenses), debt: num_(snap.Debt_Payments), savings: num_(snap.Savings_Transfers), invested: num_(snap.Investment_Contributions),
      withdrawn: num_(snap.Investment_Withdrawals), returns: num_(snap.Investment_Returns), srate: num_(snap.Savings_Rate),
      cash: num_(snap.Cash_Balance), networth: num_(snap.Net_Worth), portfolio: num_(snap.Portfolio_Value), savbal: num_(snap.Savings_Balance), debts: num_(snap.Debts),
    };
  }
  f.netsaved = f.savings + f.invested - f.withdrawn;
  f.cashflow = f.income - f.spent - f.debt + f.returns - f.netsaved;
  const prevSnap = snapshotRow_(previousCycle_(cycle));
  const now = summaryValues_();
  const history = sheetObjects_('Monthly_Snapshots', 24).filter(x => x.Month && dateKey(x.Cycle_Start) && dateKey(x.Cycle_Start) <= cycle.start).slice(-6)
    .map(x => ({ label: String(x.Month).slice(0, 7), income: num_(x.Total_Income), spent: num_(x.Net_Consumption), srate: num_(x.Savings_Rate) }));
  let portfolio = null;
  try { const ps = portfolioState_(); portfolio = { value: num_(ps.v.value), unreal: num_(ps.v.unreal), unrealpct: num_(ps.v.unrealpct), profile: String(ps.v.profile || ''), classes: ps.classes }; } catch (e) { }
  const goals = sheetObjects_('Goals', 10).filter(g => g.Goal_ID && g.Goal_Name).map(g => ({ name: String(g.Goal_Name), target: num_(g.Target_Amount),
    current: num_(g.Current_Amount), pct: num_(g.Progress_Pct) }));
  return {
    cycle: cycle, current: !!current, frozen: frozen, f: f,
    prevSpent: prevSnap ? num_(prevSnap.Net_Consumption) : null, prevIncome: prevSnap ? num_(prevSnap.Total_Income) : null,
    cats: cats, bills: bills, history: history, portfolio: portfolio, goals: goals,
    now: { free: num_(now.free), efgap: num_(now.efgap) },
    generated: fmt(new Date(), 'yyyy-MM-dd HH:mm'),
  };
}

// ---------- commentary ----------
function targetRate_() { const t = Number(getSettings().Target_Savings_Rate); return t > 0 && t < 1 ? t : 0.2; }
function rulesCommentary_(d) {
  const f = d.f, obs = [], act = [];
  const m = x => Math.round(x).toLocaleString('en-US');
  const pc = x => (Math.round(x * 1000) / 10) + '%';   // same rounding as the headline
  const target = targetRate_();
  if (!f.income) obs.push('No income was recorded in this cycle. If your salary lands near the end of the month, setting Cycle_Start_Day to your payday lines income up with the spending it pays for.');
  else if (f.srate >= target) obs.push('You kept ' + pc(f.srate) + ' of your income after spending and debt payments, above your ' + pc(target) + ' target.');
  else if (f.srate >= 0) obs.push('You kept ' + pc(f.srate) + ' of your income after spending and debt payments, below your ' + pc(target) + ' target.');
  else obs.push('Spending and debt payments were ' + m(f.spent + f.debt - f.income) + ' EGP more than your income this cycle.');
  if (d.prevSpent) {
    const ch = f.spent / d.prevSpent - 1;
    if (Math.abs(ch) >= 0.1) obs.push('Spending was ' + Math.round(Math.abs(ch) * 100) + '% ' + (ch > 0 ? 'higher' : 'lower') + ' than the previous cycle (' + m(f.spent) + ' vs ' + m(d.prevSpent) + ' EGP).');
  }
  const over = d.cats.filter(c => c.budget > 0 && c.actual > c.budget).sort((a, b) => (b.actual - b.budget) - (a.actual - a.budget));
  if (over.length) obs.push('Over budget: ' + over.slice(0, 3).map(c => c.cat + ' by ' + m(c.actual - c.budget)).join(', ') + ' EGP.');
  else if (d.cats.some(c => c.budget > 0)) obs.push('Every category stayed within its budget.');
  const jumps = d.cats.filter(c => c.prev > 0 && c.actual - c.prev >= 500 && c.actual / c.prev - 1 >= 0.25).sort((a, b) => (b.actual - b.prev) - (a.actual - a.prev));
  if (jumps.length) obs.push('Biggest increase: ' + jumps[0].cat + ', up ' + m(jumps[0].actual - jumps[0].prev) + ' EGP on the previous cycle.');
  if (over.length) act.push('Look at ' + over[0].cat + ' first: trim it next cycle, or raise its budget to a realistic level so alerts stay meaningful.');
  const idle = d.cats.filter(c => c.budget >= 1000 && c.actual < 0.5 * c.budget);
  if (idle.length && over.length) act.push('Budget left unused in ' + idle.slice(0, 2).map(c => c.cat).join(' and ') + ' could cover the overspend instead of raising your total.');
  if (d.now.efgap > 0) act.push('Your emergency fund is ' + m(d.now.efgap) + ' EGP short of its target; it gets first call on any surplus.');
  else if (d.now.free > 0) act.push(m(d.now.free) + ' EGP is free to invest now. Send /invest to see how to split it.');
  if (!act.length) act.push('Keep recording daily; three complete cycles make the trend and average figures much more reliable.');
  return { observations: obs.slice(0, 5), actions: act.slice(0, 3), source: 'rules' };
}

/** Every number the AI may quote (rounded), including percentages written as whole numbers. */
function allowedNumbers_(payload) {
  const out = [];
  const walk = v => {
    if (typeof v === 'number') { out.push(Math.round(v), Math.round(Math.abs(v))); }
    else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k]));
  };
  walk(payload);
  return out;
}
/** True if every number in the text matches the data (±1 or ±1%). Small counts (≤12) and years are allowed. */
function numbersCheck_(text, allowed) {
  const nums = String(text).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).match(/\d[\d,]*(\.\d+)?/g) || [];
  return nums.every(sx => {
    const x = parseFloat(sx.replace(/,/g, ''));
    if (x <= 12 || (x >= 2020 && x <= 2040)) return true;
    return allowed.some(a => Math.abs(a - x) <= Math.max(1, 0.01 * Math.abs(a)));
  });
}
function aiPayload_(d) {
  const f = d.f;
  return {
    cycle: d.cycle.start + ' to ' + d.cycle.end, income: Math.round(f.income), spending: Math.round(f.spent), fixed: Math.round(f.fixed),
    variable: Math.round(f.variable), debtPayments: Math.round(f.debt), savedAndInvested: Math.round(f.netsaved), savingsRatePct: Math.round(f.srate * 100),
    previousSpending: d.prevSpent === null ? null : Math.round(d.prevSpent),
    categories: d.cats.filter(c => c.budget > 0 || c.actual > 0).map(c => ({ name: c.cat, budget: Math.round(c.budget), actual: Math.round(c.actual), previous: Math.round(c.prev) })),
    emergencyFundGap: Math.round(d.now.efgap), freeToInvestNow: Math.round(d.now.free), riskProfile: d.portfolio ? d.portfolio.profile : '',
    targetSavingsRatePct: Math.round(targetRate_() * 100),
  };
}
function aiCommentary_(d) {
  const st = getSettings();
  if (String(st.AI_Commentary || 'ON').toUpperCase() === 'OFF' || !prop('GEMINI_API_KEY')) return null;
  const payload = aiPayload_(d);
  const arabic = String(st.Report_Language || 'English').toLowerCase().indexOf('arab') === 0;
  const prompt = 'You are a careful personal-finance assistant for a salaried person in Egypt (currency EGP). Using ONLY the JSON data below, write ' +
    '3 to 5 short observations and up to 3 concrete, practical actions for next cycle. Rules: use only numbers that appear in the data; ' +
    'do not calculate new totals, differences or percentages; do not recommend specific stocks or funds; no greetings. Language: ' +
    (arabic ? 'Egyptian Arabic' : 'English') + '. Return ONLY JSON: {"observations":[string],"actions":[string]}.\nDATA: ' + JSON.stringify(payload);
  const res = geminiText_(prompt);
  if (!res.text) return { error: res.error };
  try {
    const j = JSON.parse(res.text.replace(/```json|```/g, '').trim());
    const obs = (j.observations || []).map(String).slice(0, 5), act = (j.actions || []).map(String).slice(0, 3);
    if (!obs.length) return { error: 'empty AI reply' };
    if (!numbersCheck_(obs.concat(act).join(' '), allowedNumbers_(payload))) return { error: 'AI numbers did not match your data' };
    return { observations: obs, actions: act, source: 'ai', model: res.model };
  } catch (e) { return { error: 'unreadable AI reply' }; }
}
function geminiText_(prompt) {
  const key = prop('GEMINI_API_KEY');
  const configured = String(getSettings().Gemini_Model || '').trim();
  const models = configured ? [configured].concat(DEFAULT_GEMINI_MODELS.filter(m => m !== configured)) : DEFAULT_GEMINI_MODELS;
  for (const model of models) {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
    });
    const code = r.getResponseCode();
    if (code === 404) continue;
    if (code === 429) return { error: 'free AI quota reached' };
    if (code !== 200) return { error: 'AI error ' + code };
    try { const j = JSON.parse(r.getContentText()); return { text: j.candidates[0].content.parts.map(p => p.text || '').join(''), model: model }; }
    catch (e) { return { error: 'unreadable AI reply' }; }
  }
  return { error: 'no AI model available' };
}

// ---------- rendering (tables + inline styles: safe for Gmail and Google's PDF converter) ----------
const MONTHS_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function reportLabel_(cycle) { return MONTHS_[Number(cycle.label.slice(5, 7)) - 1] + ' ' + cycle.label.slice(0, 4); }

function reportHtml_(d, c) {
  const m = x => Math.round(Number(x) || 0).toLocaleString('en-US');
  const p = x => (Math.round((Number(x) || 0) * 1000) / 10) + '%';
  const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const day = k => { const x = new Date(k + 'T00:00:00Z'); return x.getUTCDate() + ' ' + MONTHS_[x.getUTCMonth()].slice(0, 3); };
  const f = d.f;
  const C = { ink: '#16201D', muted: '#5E6B67', line: '#DDE5E2', nile: '#0F4C45', soft: '#D5E7E3', bad: '#B42318', warn: '#B7791F', ok: '#2F7D55' };
  const td = 'padding:7px 8px;border-bottom:1px solid ' + C.line + ';';
  const tdr = td + 'text-align:right;white-space:nowrap;';
  const th = (x, i) => '<th style="' + (i ? tdr : td + 'text-align:left;') + 'color:' + C.muted + ';font-weight:normal;">' + x + '</th>';
  const h2 = s => '<h2 style="font-size:16px;margin:26px 0 8px;color:' + C.ink + ';">' + s + '</h2>';
  const rtl = s => /[\u0600-\u06FF]/.test(s) ? ' dir="rtl" style="text-align:right;margin:4px 0;"' : ' style="margin:4px 0;"';
  let h = '<div style="font-family:Arial,Helvetica,sans-serif;color:' + C.ink + ';max-width:680px;margin:0 auto;font-size:14px;line-height:1.5;">';
  h += '<p style="color:' + C.muted + ';margin:0;">' + (d.current ? 'Cycle so far' : 'Monthly report') + ', ' + day(d.cycle.start) + ' to ' + day(d.cycle.end) + '</p>';
  h += '<h1 style="font-size:24px;margin:4px 0 6px;color:' + C.nile + ';">' + reportLabel_(d.cycle) + '</h1>';
  h += '<p style="font-size:17px;margin:0 0 14px;">You earned <b>' + m(f.income) + ' EGP</b>, spent <b>' + m(f.spent) + '</b> and saved or invested <b>' + m(f.netsaved) + '</b>' +
    (f.income ? ', a savings rate of <b style="color:' + (f.srate < 0 ? C.bad : C.ok) + ';">' + p(f.srate) + '</b>.' : '.') + '</p>';
  const rowsK = [['Income', f.income, d.prevIncome, 0], ['Spending (net of refunds)', f.spent, d.prevSpent, 0], ['Fixed bills', f.fixed, null, 1], ['Variable spending', f.variable, null, 1],
    ['Debt payments', f.debt, null, 0], ['Saved and invested', f.netsaved, null, 0], ['Cash flow after saving', f.cashflow, null, 0]];
  h += '<table style="width:100%;border-collapse:collapse;"><tr>' + ['', 'This cycle', 'Previous'].map(th).join('') + '</tr>';
  rowsK.forEach(r => { h += '<tr><td style="' + td + (r[3] ? 'padding-left:22px;color:' + C.muted + ';' : '') + '">' + r[0] + '</td><td style="' + tdr + (r[1] < 0 ? 'color:' + C.bad + ';' : '') + '">' + m(r[1]) + '</td><td style="' + tdr + 'color:' + C.muted + ';">' + (r[2] === null || r[2] === undefined ? '' : m(r[2])) + '</td></tr>'; });
  h += '</table>';

  h += h2(c.source === 'ai' ? 'Commentary' : 'What stands out');
  h += '<ul style="padding-left:20px;margin:0;">' + c.observations.map(o => '<li' + rtl(o) + '>' + e(o) + '</li>').join('') + '</ul>';
  if (c.actions.length) h += '<p style="margin:12px 0 4px;font-weight:bold;">For next cycle</p><ul style="padding-left:20px;margin:0;">' + c.actions.map(o => '<li' + rtl(o) + '>' + e(o) + '</li>').join('') + '</ul>';
  h += '<p style="color:' + C.muted + ';font-size:12px;margin:8px 0 0;">' + (c.source === 'ai' ? 'Written by AI from your totals; every number was checked against your data.' : 'Generated from fixed rules' + (c.note ? ' (' + e(c.note) + ')' : '') + '.') + '</p>';

  const cats = d.cats.filter(x => x.actual > 0 || x.prev > 0).sort((a, b) => b.actual - a.actual);
  const untouched = d.cats.filter(x => x.budget > 0 && !(x.actual > 0) && !(x.prev > 0));
  if (cats.length) {
    h += h2('Spending by category');
    h += '<table style="width:100%;border-collapse:collapse;"><tr>' + ['Category', 'Budget', 'Spent', 'Previous', ''].map(th).join('') + '</tr>';
    cats.forEach(x => {
      const pc = x.budget ? Math.min(100, x.actual / x.budget * 100) : 0, col = x.budget && x.actual > x.budget ? C.bad : x.budget && x.actual >= 0.8 * x.budget ? C.warn : C.ok;
      h += '<tr><td style="' + td + '">' + e(x.cat) + '</td><td style="' + tdr + 'color:' + C.muted + ';">' + (x.budget ? m(x.budget) : '–') + '</td><td style="' + tdr + (x.budget && x.actual > x.budget ? 'color:' + C.bad + ';font-weight:bold;' : '') + '">' + m(x.actual) +
        '</td><td style="' + tdr + 'color:' + C.muted + ';">' + m(x.prev) + '</td><td style="' + td + 'width:92px;">' + (x.budget ? '<div style="background:' + C.soft + ';height:8px;width:90px;"><div style="background:' + col + ';height:8px;width:' + Math.round(pc * 0.9) + 'px;"></div></div>' : '') + '</td></tr>';
    });
    h += '</table>';
    if (untouched.length) h += '<p style="color:' + C.muted + ';font-size:12px;margin:6px 0 0;">Nothing spent in: ' + untouched.map(x => e(x.cat)).join(', ') + '.</p>';
  }
  if (d.bills.length) {
    h += h2('Bills');
    h += '<table style="width:100%;border-collapse:collapse;">' + d.bills.map(b => '<tr><td style="' + td + '">' + e(b.name) + '</td><td style="' + tdr + '">' + m(b.amount) + '</td><td style="' + tdr +
      'color:' + (b.status === 'Paid' ? C.ok : b.status === 'Overdue' ? C.bad : C.muted) + ';">' + e(b.status === 'Overdue' && !d.current ? 'Not recorded as paid' : b.status) + '</td></tr>').join('') + '</table>';
  }
  h += h2('Where you stand');
  const pos = [['Estimated cash', f.cash], ['Savings', f.savbal], ['Investments', f.portfolio], ['Debts', -f.debts], ['Net worth', f.networth]];
  h += '<table style="width:100%;border-collapse:collapse;">' + pos.map((r, i) => '<tr><td style="' + td + (i === 4 ? 'font-weight:bold;' : '') + '">' + r[0] + '</td><td style="' + tdr + (i === 4 ? 'font-weight:bold;color:' + C.nile + ';' : '') + '">' + m(r[1]) + '</td></tr>').join('') + '</table>';
  h += '<p style="color:' + C.muted + ';font-size:12px;margin:6px 0 0;">Estimates from your last account reconciliation' + (d.frozen ? ', frozen at the end of the cycle' : '') + '.</p>';
  if (d.portfolio && d.portfolio.value) {
    h += h2('Investments now');
    h += '<p style="margin:0 0 6px;">Portfolio ' + m(d.portfolio.value) + ' EGP, unrealized ' + (d.portfolio.unreal >= 0 ? '+' : '') + m(d.portfolio.unreal) + ' (' + p(d.portfolio.unrealpct) + ')' + (d.portfolio.profile ? ', target mix ' + e(d.portfolio.profile) : '') + '.</p>';
    h += '<table style="width:100%;border-collapse:collapse;">' + d.portfolio.classes.filter(x => x.value > 0 || x.target > 0).map(x => '<tr><td style="' + td + '">' + e(x.cls) + '</td><td style="' + tdr + '">' + p(x.pct) + '</td><td style="' + tdr + 'color:' + C.muted + ';">' + (d.portfolio.profile ? 'target ' + Math.round(x.target * 100) + '%' : '') + '</td></tr>').join('') + '</table>';
  }
  if (d.goals.length) {
    h += h2('Goals');
    h += '<table style="width:100%;border-collapse:collapse;">' + d.goals.map(g => '<tr><td style="' + td + '">' + e(g.name) + '</td><td style="' + tdr + '">' + Math.round(g.pct * 100) + '%</td><td style="' + tdr + 'color:' + C.muted + ';">' + m(g.current) + ' of ' + m(g.target) + '</td></tr>').join('') + '</table>';
  }
  if (d.history.length > 1) {
    h += h2('Recent cycles');
    h += '<table style="width:100%;border-collapse:collapse;"><tr>' + ['Cycle', 'Income', 'Spending', 'Savings rate'].map(th).join('') + '</tr>' +
      d.history.map(r => '<tr><td style="' + td + '">' + e(r.label) + '</td><td style="' + tdr + '">' + m(r.income) + '</td><td style="' + tdr + '">' + m(r.spent) + '</td><td style="' + tdr + (r.srate < 0 ? 'color:' + C.bad + ';' : '') + '">' + (r.income ? p(r.srate) : '–') + '</td></tr>').join('') + '</table>';
  }
  h += '<p style="color:' + C.muted + ';font-size:12px;margin:26px 0 0;border-top:1px solid ' + C.line + ';padding-top:8px;">Generated ' + e(d.generated) +
    ' (Cairo). Every figure is defined on the Metric_Definitions tab of your sheet. Not financial advice.</p></div>';
  return h;
}

// ---------- produce & deliver ----------
function makeReport_(current) {
  const d = buildReportData_(current);
  let c = aiCommentary_(d);
  if (!c || !c.observations) { const note = c && c.error ? 'AI skipped: ' + c.error : ''; c = rulesCommentary_(d); c.note = note; }
  const html = reportHtml_(d, c);
  const name = (current ? 'Money_so_far_' : 'Money_report_') + d.cycle.label.slice(0, 7) + '.pdf';
  const pdf = Utilities.newBlob('<html><head><meta charset="utf-8"></head><body>' + html + '</body></html>', 'text/html', 'report.html').getAs('application/pdf').setName(name);
  return { data: d, commentary: c, html: html, pdf: pdf, name: name };
}

function deliverReport_(r, opts) {
  const sent = [];
  if (opts.email) {
    const to = String(getSettings().Report_Email || '').trim();
    if (to) {
      MailApp.sendEmail({ to: to, subject: (r.data.current ? 'Your money so far: ' : 'Your money report: ') + reportLabel_(r.data.cycle),
        htmlBody: r.html, attachments: [r.pdf], name: 'Finance assistant' });
      sent.push('emailed to ' + to);
    } else sent.push('not emailed: Settings › Report_Email is empty');
  }
  if (opts.chatId) {
    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop('BOT_TOKEN') + '/sendDocument', {
      method: 'post', muteHttpExceptions: true,
      payload: { chat_id: String(opts.chatId), caption: '📄 ' + (r.data.current ? 'Cycle so far: ' : 'Report: ') + reportLabel_(r.data.cycle) + (r.commentary.source === 'ai' ? ' (AI commentary, numbers checked)' : ''), document: r.pdf },
    });
    sent.push(res.getResponseCode() === 200 ? 'sent in Telegram' : 'Telegram failed (' + res.getResponseCode() + ')');
  }
  return sent;
}

/** Daily trigger (08:00 Cairo). Sends the report once, the morning after a cycle ends. */
function reportJob() {
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const prev = previousCycle_(cycleFor_(today, cycleStartDay_()));
  if (prop('LAST_REPORT_CYCLE') === prev.start) return false;
  const { rows: data, map } = readTx();
  if (!data.some(r => { const k = dateKey(r[map.Transaction_Date]); return k >= prev.start && k <= prev.end; })) {
    setProp('LAST_REPORT_CYCLE', prev.start); return false; // nothing recorded in that cycle
  }
  const r = makeReport_(false);
  deliverReport_(r, { email: true, chatId: prop('OWNER_ID') });
  setProp('LAST_REPORT_CYCLE', prev.start);
  return true;
}

function handleCommand7(chatId, cmd, arg) {
  if (cmd !== '/report') return false;
  const a = String(arg || '').toLowerCase();
  const current = a.indexOf('current') >= 0 || a.indexOf('now') >= 0;
  send(chatId, '⏳ Building your ' + (current ? 'cycle-so-far' : 'last-cycle') + ' report…');
  const r = makeReport_(current);
  const sent = deliverReport_(r, { email: a.indexOf('email') >= 0, chatId: chatId });
  const notes = [];
  if (r.commentary.note) notes.push('ℹ️ ' + r.commentary.note + '. Used rule-based commentary instead.');
  sent.filter(x => x.indexOf('mail') >= 0).forEach(x => notes.push('✉️ ' + x.charAt(0).toUpperCase() + x.slice(1) + '.'));
  if (notes.length) send(chatId, notes.join('\n'));
  return true;
}

function upgradePhase7() {
  const s = SpreadsheetApp.getActive();
  const st = getSettings();
  if (!st.Report_Email) { let me = ''; try { me = Session.getEffectiveUser().getEmail(); } catch (e) { } setSetting('Report_Email', me, 'Where the monthly report is emailed.'); }
  if (st.Report_Language === undefined) setSetting('Report_Language', 'English', 'English or Arabic, for the AI commentary.');
  if (st.Target_Savings_Rate === undefined) setSetting('Target_Savings_Rate', 0.2, 'Savings rate you aim for (0.2 = 20%). Used in the report commentary.');
  if (st.AI_Commentary === undefined) setSetting('AI_Commentary', 'ON', 'ON = AI writes the commentary (needs GEMINI_API_KEY). Numbers are always checked; otherwise rules are used.');
  setSetting('Report_Day', 'auto', 'Reports are sent automatically the morning after each cycle ends.');
  if (!s.getSheetByName('Category_Snapshots')) {
    const c = s.insertSheet('Category_Snapshots');
    c.getRange(1, 1, 1, 8).setValues([['Month', 'Cycle_Start', 'Cycle_End', 'Category', 'Budgeted', 'Actual', 'Status', 'Previous_Cycle']]);
  }
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'reportJob').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('reportJob').timeBased().everyDays(1).atHour(8).create();
  try {
    const list = botCommandList_();
    if (!list.some(x => x.command === 'report')) list.splice(5, 0, { command: 'report', description: 'PDF report (/report current)' });
    tg('setMyCommands', { commands: list });
  } catch (e) { }
  // Don't email a report for an old cycle right after installing; /report can still produce it.
  if (!prop('LAST_REPORT_CYCLE')) setProp('LAST_REPORT_CYCLE', previousCycle_(cycleFor_(fmt(new Date(), 'yyyy-MM-dd'), cycleStartDay_())).start);
  console.log('Phase 7 ready. Try /report in Telegram.');
}

/** Finance menu › "Send last cycle's report now": email + Telegram. */
function sendMonthlyReport() {
  const r = makeReport_(false);
  const out = deliverReport_(r, { email: true, chatId: prop('OWNER_ID') });
  try { SpreadsheetApp.getActive().toast('Report ' + out.join(', ') + '.'); } catch (e) { console.log(out.join(', ')); }
  return out;
}

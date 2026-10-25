/**
 * AI Personal Finance Assistant — Phase 3: calculation engine
 * ------------------------------------------------------------
 * Add this as a second script file (Phase3.gs) next to Code.gs. Then run `upgradePhase3` once.
 * It rewrites ONLY formula areas (Summary, Budgets columns C–K, Commitments formula columns) and adds
 * new tabs. It never touches your Transactions, budget amounts, commitments you typed, or holdings.
 *
 * Every money figure is a spreadsheet formula. The script only (a) writes those formulas,
 * (b) freezes month-end snapshots by reading the Summary tab, and (c) lists items for review on the
 * Insights tab. Definitions are documented on the Metric_Definitions tab.
 *
 * Transactions columns must stay in their original order (A = Transaction_ID … R = Notes).
 */

// ---------- formula building helpers ----------
const TX = c => 'Transactions!$' + c + ':$' + c;
function sv_(key) { return 'INDEX(Settings!$B:$B,MATCH("' + key + '",Settings!$A:$A,0))'; }
/** SUMIFS over EGP transactions of one type between two date expressions (inclusive by default). */
function S_(type, from, to, extra, fromOp) {
  return 'SUMIFS(' + TX('E') + ',' + TX('D') + ',"' + type + '",' + TX('F') + ',"EGP",' +
    TX('B') + ',"' + (fromOp || '>=') + '"&' + from + ',' + TX('B') + ',"<="&' + to + (extra || '') + ')';
}
function net_(from, to, extra) { return '(' + S_('Expense', from, to, extra) + '-' + S_('Refund', from, to, extra) + ')'; }

// Summary layout: [key, label, formula ('' for section headers), note, number format]
// {key} placeholders are replaced with the cell holding that key's value.
const MONEY = '#,##0" EGP";-#,##0" EGP";"-"';
const PCTF = '0.0%;-0.0%;"-"';
const DATEF = 'yyyy-mm-dd';
function summaryLayout_() {
  const C0 = '{start}', C1 = '{end}', R = t => S_(t, '{recdate}', '{today}', '', '>');
  const cyc = k => 'EDATE({start},' + (-k) + ')';
  return [
    ['h_cycle', 'CYCLE', '', '', null],
    ['csd', 'Cycle start day', '=MIN(28,MAX(1,IFERROR(' + sv_('Cycle_Start_Day') + ',1)))', '1 = calendar month. Example: 25 = from the 25th to the 24th of next month (payday cycles).', '0'],
    ['rm', 'Cycle label month', '=IF(LEN(IFERROR(' + sv_('Report_Month') + ',"")&"")=0,IF(AND({csd}>1,DAY(TODAY())>={csd}),EDATE(TODAY(),1),TODAY()),IFERROR(' + sv_('Report_Month') + ',TODAY()))',
      'Settings > Report_Month blank = the current cycle. Enter any date in a month to view that cycle. A cycle starting on the 25th of September is labelled October.', 'mmmm yyyy'],
    ['start', 'Cycle start', '=IF({csd}=1,DATE(YEAR({rm}),MONTH({rm}),1),DATE(YEAR({rm}),MONTH({rm})-1,{csd}))', '', DATEF],
    ['end', 'Cycle end', '=EDATE({start},1)-1', '', DATEF],
    ['today', 'Today', '=TODAY()', '', DATEF],
    ['days', 'Days in cycle', '={end}-{start}+1', '', '0'],
    ['elapsed', 'Days elapsed', '=IF({today}<{start},0,MIN({today},{end})-{start}+1)', 'Equals days in cycle once the cycle is over; 0 for a future cycle.', '0'],
    ['buffer', 'Minimum cash buffer', '=IFERROR(' + sv_('Min_Cash_Buffer') + ',0)', 'From Settings.', MONEY],
    ['efm', 'Emergency fund months', '=IFERROR(' + sv_('Emergency_Fund_Months') + ',0)', 'From Settings.', '0'],
    ['h_inc', 'INCOME', '', '', null],
    ['salary', 'Salary received', '=' + S_('Income', C0, C1, ',' + TX('G') + ',"Salary"'), 'Income rows with Category = Salary.', MONEY],
    ['addinc', 'Additional income', '=' + S_('Income', C0, C1) + '-{salary}', 'All other Income rows.', MONEY],
    ['income', 'Total income', '={salary}+{addinc}', 'Excludes refunds, transfers, investment withdrawals and investment returns.', MONEY],
    ['h_sp', 'SPENDING', '', '', null],
    ['gross', 'Gross expenses', '=' + S_('Expense', C0, C1), '', MONEY],
    ['refunds', 'Refunds', '=' + S_('Refund', C0, C1), '', MONEY],
    ['consumption', 'Net consumption expenses', '={gross}-{refunds}', 'THE spending number used everywhere: expenses minus refunds.', MONEY],
    ['fixed', 'Fixed commitments paid', '=' + net_(C0, C1, ',' + TX('M') + ',"Yes"'), 'Net expenses with Recurring_Flag = Yes.', MONEY],
    ['variable', 'Variable expenses', '={consumption}-{fixed}', '', MONEY],
    ['debt', 'Debt payments', '=' + S_('Debt Payment', C0, C1), 'Not consumption, but a cash outflow.', MONEY],
    ['dailyavg', 'Daily average spending', '=IF({elapsed}=0,0,{consumption}/{elapsed})', 'Net consumption / days elapsed.', MONEY],
    ['due', 'Commitments still due this cycle', '=SUM(Commitments!$M$2:$M$101)', 'Active commitments for this cycle not yet fully paid.', MONEY],
    ['avgvar', 'Typical variable spending per cycle', '=(' + net_(cyc(3), '{start}-1') + '-' + net_(cyc(3), '{start}-1', ',' + TX('M') + ',"Yes"') + ')/{ncyc}', 'Average non-recurring spending of up to 3 prior cycles (0 until you have history).', MONEY],
    ['remvar', 'Expected remaining variable spending', '=IF({elapsed}=0,0,IF({avgvar}>0,{avgvar}*({days}-{elapsed})/{days},MAX(0,{variable}/{elapsed}*{days}-{variable})))', 'With history: your typical variable spending for the days left. Without history: current daily pace.', MONEY],
    ['projected', 'Projected cycle-end spending', '={fixed}+{due}+{variable}+{remvar}', 'Fixed paid + commitments still due + variable so far + expected remaining variable.', MONEY],
    ['h_sav', 'SAVING AND INVESTING', '', '', null],
    ['sav', 'Savings transfers', '=' + S_('Savings Transfer', C0, C1), '', MONEY],
    ['inv', 'Investment contributions', '=' + S_('Investment Contribution', C0, C1), 'Cash sent to Thndr. Purchases inside Thndr are not counted here.', MONEY],
    ['wd', 'Investment withdrawals', '=' + S_('Investment Withdrawal', C0, C1), '', MONEY],
    ['ret', 'Investment returns paid out', '=' + S_('Investment Return', C0, C1), 'Shown separately; not income.', MONEY],
    ['netsaved', 'Net saved and invested', '={sav}+{inv}-{wd}', '', MONEY],
    ['h_cf', 'CASH FLOW', '', '', null],
    ['acf', 'Available cash flow', '={income}-{consumption}-{debt}+{ret}', 'Income − net consumption − debt payments + investment returns.', MONEY],
    ['after', 'Cash flow after saving and investing', '={acf}-{netsaved}', 'What stayed in cash accounts this cycle.', MONEY],
    ['h_rate', 'RATES', '', '', null],
    ['srate', 'Savings rate', '=IF({income}=0,0,({income}-{consumption}-{debt})/{income})', '(Total income − net consumption − debt payments) / total income.', PCTF],
    ['irate', 'Saved and invested rate', '=IF({income}=0,0,{netsaved}/{income})', 'Net saved and invested / total income.', PCTF],
    ['h_bal', 'BALANCES (estimated from your last reconciliation)', '', '', null],
    ['recdate', 'Last reconciliation date', '=SUMPRODUCT(MAX((Accounts!$K$2:$K$100="Active")*Accounts!$I$2:$I$100))', 'Latest Reconciled_Date on Accounts. Update all balances on the same day for accurate estimates.', DATEF],
    ['cashrec', 'Cash at reconciliation', '=SUMIFS(Accounts!$H$2:$H$100,Accounts!$J$2:$J$100,"Yes",Accounts!$K$2:$K$100,"Active")', 'Accounts with Include_In_Cash = Yes.', MONEY],
    ['cashflow', 'Cash movement since then', '=' + R('Income') + '+' + R('Refund') + '+' + R('Investment Withdrawal') + '+' + R('Investment Return') + '-' + R('Expense') + '-' + R('Debt Payment') + '-' + R('Savings Transfer') + '-' + R('Investment Contribution'),
      'Transactions dated after the reconciliation date up to today. Internal transfers are ignored.', MONEY],
    ['cash', 'Estimated cash now', '={cashrec}+{cashflow}', '', MONEY],
    ['savbal', 'Savings balance', '=SUMIFS(Accounts!$H$2:$H$100,Accounts!$C$2:$C$100,"Savings",Accounts!$K$2:$K$100,"Active")+' + R('Savings Transfer'), 'Savings accounts at reconciliation + savings transfers since.', MONEY],
    ['portfolio', 'Portfolio value (Holdings)', '=SUM(Holdings!$H$2:$H$101)', 'Sum of Current_Market_Value. Record idle cash inside Thndr as a holding row.', MONEY],
    ['valdate', 'Portfolio valuation date', '=MAX(Holdings!$K$2:$K$101)', 'Latest Valuation_Date in Holdings.', DATEF],
    ['debts', 'Debts outstanding', '=MAX(0,SUMIFS(Accounts!$H$2:$H$100,Accounts!$C$2:$C$100,"Credit Card",Accounts!$K$2:$K$100,"Active")+SUMIFS(Accounts!$H$2:$H$100,Accounts!$C$2:$C$100,"Loan",Accounts!$K$2:$K$100,"Active")-' + R('Debt Payment') + ')',
      'Credit Card and Loan accounts (enter the amount owed as a positive number) − debt payments since.', MONEY],
    ['networth', 'Net worth', '={cash}+{savbal}+{portfolio}-{debts}', 'Cash + savings + portfolio − debts.', MONEY],
    ['h_av', 'WHAT YOU CAN SAVE OR INVEST NOW', '', '', null],
    ['surplus', 'Available surplus', '=MAX(0,{cash}-{due}-{remvar}-{buffer})', 'Estimated cash − commitments still due − expected remaining variable spending − minimum buffer.', MONEY],
    ['eftarget', 'Emergency fund target', '={efm}*IF({avg3}>0,{avg3},{projected})', 'Emergency_Fund_Months × average spending of prior cycles (this cycle\'s projection until history exists).', MONEY],
    ['efgap', 'Emergency fund gap', '=MAX(0,{eftarget}-{savbal})', 'Savings balance counts as the emergency fund.', MONEY],
    ['goalsneed', 'Monthly goal contributions needed', '=SUMIFS(Goals!$H$2:$H$51,Goals!$B$2:$B$51,"<>*mergency*",Goals!$B$2:$B$51,"<>*طوارئ*")', 'Required_Monthly_Contribution of all goals except the emergency fund (handled above).', MONEY],
    ['toef', '→ Suggested to emergency fund', '=MIN({surplus},{efgap})', 'Step 1: fill the emergency fund gap first.', MONEY],
    ['togoals', '→ Suggested to goals', '=MIN({surplus}-{toef},{goalsneed})', 'Step 2: cover this month\'s goal contributions.', MONEY],
    ['free', '→ Free to invest', '={surplus}-{toef}-{togoals}', 'Step 3: what remains is available for long-term investing.', MONEY],
    ['h_cmp', 'COMPARISONS', '', '', null],
    ['prev', 'Previous cycle net consumption', '=' + net_(cyc(1), '{start}-1'), '', MONEY],
    ['ncyc', 'Prior cycles with data (of last 3)', '=MAX(1,(COUNTIFS(' + TX('D') + ',"Expense",' + TX('B') + ',">="&' + cyc(1) + ',' + TX('B') + ',"<"&{start})>0)+(COUNTIFS(' + TX('D') + ',"Expense",' + TX('B') + ',">="&' + cyc(2) + ',' + TX('B') + ',"<"&' + cyc(1) + ')>0)+(COUNTIFS(' + TX('D') + ',"Expense",' + TX('B') + ',">="&' + cyc(3) + ',' + TX('B') + ',"<"&' + cyc(2) + ')>0))',
      'Averages divide only by cycles that actually have data, so a new tracker is not distorted by empty months.', '0'],
    ['avg3', 'Average of prior cycles (up to 3)', '=' + net_(cyc(3), '{start}-1') + '/{ncyc}', '', MONEY],
    ['mom', 'Change vs previous cycle (projected)', '=IF(OR({prev}=0,{elapsed}=0),0,{projected}/{prev}-1)', 'Compares this cycle\'s projected total with last cycle\'s actual, so an incomplete cycle is not unfairly low.', PCTF],
    ['budgetused', 'Budget used (total)', '=IFERROR(INDEX(Budgets!$E:$E,MATCH("TOTAL",Budgets!$A:$A,0)),0)', '', PCTF],
  ];
}

function summaryRowMap_() {
  const map = {};
  summaryLayout_().forEach((r, i) => { map[r[0]] = i + 2; });
  return map;
}
function resolve_(f, map) { return f.replace(/\{(\w+)\}/g, (m, k) => { if (!map[k]) throw new Error('Unknown key ' + k); return 'Summary!$B$' + map[k]; }); }
function resolveLocal_(f, map) { return f.replace(/\{(\w+)\}/g, (m, k) => { if (!map[k]) throw new Error('Unknown key ' + k); return '$B$' + map[k]; }); }

// ---------- upgrade ----------
function upgradePhase3() {
  const s = SpreadsheetApp.getActive();
  ensureSettings3_();
  fillMissingCurrency_();
  writeSummary_(s);
  writeBudgets_(s);
  writeCommitments_(s);
  ensureLists3_(s);
  ensureSnapshotsHeaders_(s);
  writeDefinitions_(s);
  if (!s.getSheetByName('Insights')) s.insertSheet('Insights');
  if (typeof ScriptApp !== 'undefined') {
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyJob').forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(0).nearMinute(30).create();
  }
  SpreadsheetApp.flush();
  refreshInsights();
  console.log('Phase 3 upgrade done.');
}

function ensureSettings3_() {
  const st = getSettings();
  const add = (k, v, d) => { if (st[k] === undefined) setSetting(k, v, d); };
  add('Cycle_Start_Day', 1, '1 = calendar months. Set to your payday (1-28) for payday-to-payday cycles.');
  add('Anomaly_Min_Amount', 500, 'Ignore unusual-spending flags below this amount (EGP), to avoid noise.');
  add('Min_Days_Before_Pace_Alerts', 7, 'Do not flag "on pace to exceed" before this many days of the cycle have passed.');
  add('Pace_Alert_Margin', 0.1, '"Likely over" only when the projection exceeds the budget by more than this share.');
  add('Recurring_Tolerance_Pct', 0.15, 'Charges within this % of each other in 3 consecutive cycles are listed as "looks recurring".');
  // Report_Month blank = current cycle (recommended).
  setSetting('Report_Month', '', 'Leave BLANK for the current cycle. Enter any date to view that cycle; the nightly snapshot restores it afterwards.');
}

function fillMissingCurrency_() {
  const sh = txSheet(); const last = sh.getLastRow(); if (last < 2) return;
  const map = headerMap(sh);
  const rng = sh.getRange(2, map.Currency + 1, last - 1, 1);
  const amt = sh.getRange(2, map.Amount + 1, last - 1, 1).getValues();
  const cur = rng.getValues();
  let changed = false;
  cur.forEach((c, i) => { if (!c[0] && amt[i][0] !== '') { c[0] = 'EGP'; changed = true; } });
  if (changed) rng.setValues(cur);
}

function writeSummary_(s) {
  const sh = s.getSheetByName('Summary') || s.insertSheet('Summary');
  const layout = summaryLayout_();
  const map = summaryRowMap_();
  sh.getRange(1, 1, Math.max(sh.getLastRow(), layout.length + 2), 3).clearContent();
  sh.getRange(1, 1).setValue('Cycle Summary (all formulas — do not type here)');
  layout.forEach((r, i) => {
    const row = i + 2;
    sh.getRange(row, 1).setValue(r[1]);
    sh.getRange(row, 3).setValue(r[3]);
    if (r[2]) {
      sh.getRange(row, 2).setFormula(resolveLocal_(r[2], map));
      if (r[4]) sh.getRange(row, 2).setNumberFormat(r[4]);
    }
  });
}

function writeBudgets_(s) {
  const sh = s.getSheetByName('Budgets');
  const m = summaryRowMap_();
  const Z = k => 'Summary!$B$' + m[k];
  const last = sh.getLastRow();
  const cats = sh.getRange(1, 1, last, 1).getValues().map(r => String(r[0]));
  let totalRow = cats.indexOf('TOTAL') + 1;
  if (totalRow < 2) { totalRow = last + 1; sh.getRange(totalRow, 1).setValue('TOTAL'); }
  sh.getRange(1, 1, 1, 11).setValues([['Category', 'Budgeted_Amount', 'Actual_Amount', 'Remaining_Budget', 'Percent_Used',
    'Projected_Cycle_End', 'Status', 'Previous_Cycle', 'Avg_Prior_Cycles', 'Change_vs_Previous', 'Flag']]);
  sh.getRange(2, 8, Math.max(1, sh.getLastRow() - 1), 4).clearContent();
  const start = Z('start'), end = Z('end');
  const cyc = k => 'EDATE(' + start + ',' + (-k) + ')';
  for (let r = 2; r < totalRow; r++) {
    const cat = ',' + TX('G') + ',$A' + r;
    const fixedCat = net_(start, end, cat + ',' + TX('M') + ',"Yes"');
    const avgVarCat = '((' + net_(cyc(3), start + '-1', cat) + '-' + net_(cyc(3), start + '-1', cat + ',' + TX('M') + ',"Yes"') + ')/' + Z('ncyc') + ')';
    const varCat = '(C' + r + '-' + fixedCat + ')';
    const margin = 'IFERROR(' + sv_('Pace_Alert_Margin') + ',0.1)';
    const f = [
      '=' + net_(start, end, cat),
      '=B' + r + '-C' + r,
      '=IF(B' + r + '=0,0,C' + r + '/B' + r + ')',
      '=C' + r + '+SUMIFS(Commitments!$M$2:$M$101,Commitments!$C$2:$C$101,$A' + r + ')+IF(' + Z('elapsed') + '=0,0,IF(' + avgVarCat + '>0,' + avgVarCat + '*(' + Z('days') + '-' + Z('elapsed') + ')/' + Z('days') + ',MAX(0,' + varCat + '/' + Z('elapsed') + '*' + Z('days') + '-' + varCat + ')))',
      '=IF(B' + r + '=0,IF(C' + r + '>0,"No budget","-"),IF(C' + r + '>B' + r + ',"Over",IF(AND(F' + r + '>B' + r + '*(1+' + margin + '),' + Z('elapsed') + '>=IFERROR(' + sv_('Min_Days_Before_Pace_Alerts') + ',7)),"Likely over",IF(AND(E' + r + '>=IFERROR(' + sv_('Budget_Warning_Pct') + ',0.8),F' + r + '>C' + r + '+0.5),"Warning","OK"))))',
      '=' + net_(cyc(1), start + '-1', cat),
      '=' + net_(cyc(3), start + '-1', cat) + '/' + Z('ncyc'),
      '=IF(H' + r + '=0,"",F' + r + '/H' + r + '-1)',
      '=IF(H' + r + '<=0,"",IF(AND(C' + r + '-H' + r + '>=IFERROR(' + sv_('Anomaly_Min_Amount') + ',500),C' + r + '/H' + r + '-1>=IFERROR(' + sv_('MoM_Increase_Alert_Pct') + ',0.25)),"Already "&TEXT(C' + r + '/H' + r + '-1,"0%")&" above last cycle\'s total",""))',
    ];
    sh.getRange(r, 3, 1, 9).setFormulas([f]);
  }
  const t = totalRow;
  sh.getRange(t, 2, 1, 10).setFormulas([[
    '=SUM(B2:B' + (t - 1) + ')', '=SUM(C2:C' + (t - 1) + ')', '=SUM(D2:D' + (t - 1) + ')', '=IF(B' + t + '=0,0,C' + t + '/B' + t + ')',
    '=SUM(F2:F' + (t - 1) + ')', '=IF(B' + t + '=0,"-",IF(C' + t + '>B' + t + ',"Over",IF(F' + t + '>B' + t + ',"Likely over","OK")))',
    '=SUM(H2:H' + (t - 1) + ')', '=SUM(I2:I' + (t - 1) + ')', '=IF(H' + t + '=0,"",F' + t + '/H' + t + '-1)', '=""']]);
  try {
    sh.getRange(2, 3, t - 1, 2).setNumberFormat(MONEY); sh.getRange(2, 6, t - 1, 1).setNumberFormat(MONEY);
    sh.getRange(2, 8, t - 1, 2).setNumberFormat(MONEY); sh.getRange(2, 5, t - 1, 1).setNumberFormat(PCTF); sh.getRange(2, 10, t - 1, 1).setNumberFormat(PCTF);
  } catch (e) { /* formatting is cosmetic */ }
}

function writeCommitments_(s) {
  const sh = s.getSheetByName('Commitments');
  const m = summaryRowMap_();
  const st = 'Summary!$B$' + m.start, en = 'Summary!$B$' + m.end;
  sh.getRange(1, 10).setValue('Payment_Status');
  sh.getRange(1, 12, 1, 2).setValues([['Paid_This_Cycle', 'Remaining_This_Cycle']]);
  sh.getRange(1, 15).setValue('Due_In_Cycle');
  const rowsF = [];
  for (let r = 2; r <= 101; r++) {
    const dd = 'IF(E' + r + '>31,DAY(E' + r + '),E' + r + ')'; // a full date typed in Due_Date → use its day
    const due = 'IF(' + dd + '>=DAY(' + st + '),DATE(YEAR(' + st + '),MONTH(' + st + '),MIN(' + dd + ',DAY(EOMONTH(' + st + ',0)))),DATE(YEAR(' + en + '),MONTH(' + en + '),MIN(' + dd + ',DAY(' + en + '))))';
    const monthsDiff = '((YEAR(O' + r + ')-YEAR(G' + r + '))*12+MONTH(O' + r + ')-MONTH(G' + r + '))';
    const active = 'AND(OR(I' + r + '="Active",I' + r + '=""),OR(G' + r + '="",G' + r + '<=' + en + '),OR(H' + r + '="",H' + r + '>=' + st + '),OR(F' + r + '="Monthly",F' + r + '="",G' + r + '="",MOD(' + monthsDiff + ',IF(F' + r + '="Quarterly",3,12))=0))';
    const paid = 'IF(A' + r + '="","",SUMIFS(' + TX('E') + ',' + TX('N') + ',A' + r + ',' + TX('D') + ',"<>Refund",' + TX('B') + ',">="&' + st + ',' + TX('B') + ',"<="&' + en + ')-SUMIFS(' + TX('E') + ',' + TX('N') + ',A' + r + ',' + TX('D') + ',"Refund",' + TX('B') + ',">="&' + st + ',' + TX('B') + ',"<="&' + en + '))';
    rowsF.push({
      J: '=IF(A' + r + '="","",IF(AND(I' + r + '<>"Active",I' + r + '<>""),"Inactive",IF(NOT(' + active + '),"Not this cycle",IF(L' + r + '>=D' + r + ',"Paid",IF(L' + r + '>0,"Partial",IF(O' + r + '<TODAY(),"Overdue","Expected"))))))',
      L: '=' + paid,
      M: '=IF(A' + r + '="","",IF(' + active + ',MAX(0,D' + r + '-L' + r + '),0))',
      O: '=IF(OR(A' + r + '="",E' + r + '=""),"",' + due + ')',
    });
  }
  sh.getRange(2, 10, 100, 1).setFormulas(rowsF.map(x => [x.J]));
  sh.getRange(2, 12, 100, 2).setFormulas(rowsF.map(x => [x.L, x.M]));
  sh.getRange(2, 15, 100, 1).setFormulas(rowsF.map(x => [x.O]));
  try { sh.getRange(2, 15, 100, 1).setNumberFormat(DATEF); sh.getRange(2, 12, 100, 2).setNumberFormat(MONEY); } catch (e) { }
}

function ensureLists3_(s) {
  const L = s.getSheetByName('Lists'); if (!L) return;
  const vals = L.getRange(2, 17, 10, 1).getValues().map(r => r[0]).filter(String);
  if (vals.indexOf('Loan') < 0) L.getRange(2 + vals.length, 17).setValue('Loan');
  try {
    const rule = SpreadsheetApp.newDataValidation().requireValueInRange(L.getRange('Q2:Q10'), true).setAllowInvalid(false).build();
    s.getSheetByName('Accounts').getRange('C2:C50').setDataValidation(rule);
  } catch (e) { /* validation is optional */ }
}

const SNAP_COLS = [['Month', 'rm'], ['Total_Income', 'income'], ['Salary', 'salary'], ['Additional_Income', 'addinc'],
  ['Net_Consumption', 'consumption'], ['Fixed_Commitments', 'fixed'], ['Variable_Expenses', 'variable'], ['Debt_Payments', 'debt'],
  ['Savings_Transfers', 'sav'], ['Investment_Contributions', 'inv'], ['Investment_Withdrawals', 'wd'], ['Savings_Rate', 'srate'],
  ['Saved_Invested_Rate', 'irate'], ['Portfolio_Value', 'portfolio'], ['Cash_Balance', 'cash'], ['Net_Worth', 'networth'],
  ['Snapshot_Created_At', null], ['Notes', null], ['Cycle_Start', 'start'], ['Cycle_End', 'end'], ['Investment_Returns', 'ret'],
  ['Refunds', 'refunds'], ['Savings_Balance', 'savbal'], ['Debts', 'debts']];

function ensureSnapshotsHeaders_(s) {
  const sh = s.getSheetByName('Monthly_Snapshots') || s.insertSheet('Monthly_Snapshots');
  const width = Math.max(1, sh.getLastColumn());
  const h = sh.getRange(1, 1, 1, width).getValues()[0].map(String);
  SNAP_COLS.forEach(c => { if (h.indexOf(c[0]) < 0) { h.push(c[0]); } });
  sh.getRange(1, 1, 1, h.length).setValues([h.map(x => x === '' ? null : x).filter(x => x !== null)]);
  // remove the v1 placeholder note in R2 if it is the only content of row 2
  const r2 = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
  if (r2.filter(String).length === 1 && String(r2.join('')).indexOf('Filled automatically') === 0) sh.getRange(2, 1, 1, r2.length).clearContent();
}

function writeDefinitions_(s) {
  const sh = s.getSheetByName('Metric_Definitions') || s.insertSheet('Metric_Definitions');
  sh.clearContents();
  const rowsD = [['Metric', 'Definition', 'Notes']].concat(summaryLayout_().filter(r => r[2]).map(r => [r[1], plain_(r[0]), r[3]]));
  sh.getRange(1, 1, rowsD.length, 3).setValues(rowsD);
}
function plain_(k) {
  const d = {
    csd: 'Cycle_Start_Day from Settings, limited to 1–28.', rm: 'Month the cycle is named after.',
    start: 'Day 1: first of the label month. Otherwise: Cycle_Start_Day of the month before the label month.', end: 'Day before the next cycle starts.',
    salary: 'Σ Income where Category = Salary, in the cycle.', addinc: 'Σ Income − Salary.', income: 'Salary + additional income.',
    gross: 'Σ Expense.', refunds: 'Σ Refund.', consumption: 'Gross expenses − refunds.', fixed: 'Net expenses with Recurring_Flag = Yes.',
    variable: 'Net consumption − fixed.', debt: 'Σ Debt Payment.', dailyavg: 'Net consumption ÷ days elapsed.', due: 'Σ Remaining_This_Cycle on Commitments.',
    projected: 'Fixed paid + still due + variable so far + expected remaining variable.',
    remvar: 'If prior cycles exist: typical variable spending × days left ÷ days in cycle. Otherwise: current daily pace for the days left.',
    avgvar: 'Prior cycles\' net consumption minus their recurring part, ÷ cycles with data.',
    sav: 'Σ Savings Transfer.', inv: 'Σ Investment Contribution.', wd: 'Σ Investment Withdrawal.', ret: 'Σ Investment Return.', netsaved: 'Savings transfers + contributions − withdrawals.',
    acf: 'Income − net consumption − debt payments + investment returns.', after: 'Available cash flow − net saved and invested.',
    srate: '(Income − net consumption − debt payments) ÷ income.', irate: 'Net saved and invested ÷ income.',
    recdate: 'Latest Reconciled_Date of active accounts.', cashrec: 'Σ Last_Reconciled_Balance where Include_In_Cash = Yes.',
    cashflow: '+Income +Refund +Inv. withdrawal +Inv. return −Expense −Debt −Savings transfer −Inv. contribution, after reconciliation date.',
    cash: 'Cash at reconciliation + movement since.', savbal: 'Savings accounts at reconciliation + savings transfers since.',
    portfolio: 'Σ Holdings Current_Market_Value.', valdate: 'Latest holding valuation date.', debts: 'Credit Card + Loan balances − debt payments since (min 0).',
    networth: 'Cash + savings + portfolio − debts.', surplus: 'Cash − still due − expected remaining variable − minimum buffer (min 0).',
    eftarget: 'Emergency_Fund_Months × average prior-cycle spending.', efgap: 'Target − savings balance (min 0).', goalsneed: 'Σ goal monthly contributions (excl. emergency fund).',
    toef: 'min(surplus, emergency gap).', togoals: 'min(surplus left, goals needed).', free: 'Surplus − emergency − goals.',
    prev: 'Net consumption of the previous cycle.', ncyc: 'How many of the last 3 cycles contain expenses (min 1).', avg3: 'Net consumption of the last 3 cycles ÷ cycles with data.',
    mom: 'Projected ÷ previous − 1.', buffer: 'Setting.', efm: 'Setting.', today: 'Today.', days: 'End − start + 1.', elapsed: 'Days from start to today, capped at cycle length.',
    budgetused: 'Total actual ÷ total budget.',
  };
  return d[k] || '';
}

// ---------- cycle helpers (same rule as the Summary formulas) ----------
function cycleStartDay_() { return Math.min(28, Math.max(1, Number(getSettings().Cycle_Start_Day) || 1)); }
function ymd_(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.toISOString().slice(0, 10); }
/** Cycle containing the Cairo date string `dayKey` (yyyy-MM-dd). Returns {start, end, label} as yyyy-MM-dd. */
function cycleFor_(dayKey, csd) {
  const [y, m, d] = dayKey.split('-').map(Number);
  let ly = y, lm = m; // label month
  if (csd > 1 && d >= csd) { lm = m + 1; if (lm > 12) { lm = 1; ly++; } }
  const start = csd === 1 ? ymd_(ly, lm, 1) : ymd_(ly, lm - 1, csd);
  const sd = new Date(start + 'T00:00:00Z'); sd.setUTCMonth(sd.getUTCMonth() + 1); sd.setUTCDate(sd.getUTCDate() - 1);
  return { start: start, end: sd.toISOString().slice(0, 10), label: ymd_(ly, lm, 1) };
}

// ---------- nightly job ----------
function dailyJob() {
  try { snapshotIfDue(); } catch (e) { console.error('snapshot: ' + e); }
  try { refreshInsights(); } catch (e) { console.error('insights: ' + e); }
}

/** Freezes the previous cycle once it has ended, using the Summary formulas themselves. */
function snapshotIfDue() {
  const csd = cycleStartDay_();
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const cur = cycleFor_(today, csd);
  const prevEnd = new Date(cur.start + 'T00:00:00Z'); prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prev = cycleFor_(prevEnd.toISOString().slice(0, 10), csd);
  return takeSnapshot_(prev);
}

function takeSnapshot_(cycle, force) {
  const s = SpreadsheetApp.getActive();
  const sh = s.getSheetByName('Monthly_Snapshots');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const iStart = head.indexOf('Cycle_Start');
  if (sh.getLastRow() >= 2 && iStart >= 0) {
    const existing = sh.getRange(2, iStart + 1, sh.getLastRow() - 1, 1).getValues().map(r => dateKey(r[0]));
    if (existing.indexOf(cycle.start) >= 0 && !force) return false;
  }
  const original = getSettings().Report_Month;
  const map = summaryRowMap_();
  const sum = s.getSheetByName('Summary');
  let vals;
  try {
    setSetting('Report_Month', Utilities.parseDate(cycle.label, TZ, 'yyyy-MM-dd'));
    SpreadsheetApp.flush();
    vals = sum.getRange(1, 2, summaryLayout_().length + 2, 1).getValues().map(r => r[0]);
  } finally {
    setSetting('Report_Month', original === undefined ? '' : original);
    SpreadsheetApp.flush();
  }
  if (dateKey(vals[map.start - 1]) !== cycle.start) throw new Error('Snapshot check failed: Summary did not switch to ' + cycle.start);
  const row = head.map(h => {
    const c = SNAP_COLS.find(x => x[0] === h);
    if (!c) return '';
    if (h === 'Snapshot_Created_At') return new Date();
    if (h === 'Notes') return 'Balances (cash, savings, portfolio, net worth) are as of the snapshot time.';
    if (h === 'Month') return cycle.label.slice(0, 7);
    return vals[map[c[1]] - 1];
  });
  sh.appendRow(row);
  return true;
}

/** Menu: snapshot the previous cycle even if one exists (adds a new row). */
function snapshotPreviousNow() {
  const csd = cycleStartDay_();
  const cur = cycleFor_(fmt(new Date(), 'yyyy-MM-dd'), csd);
  const pe = new Date(cur.start + 'T00:00:00Z'); pe.setUTCDate(pe.getUTCDate() - 1);
  takeSnapshot_(cycleFor_(pe.toISOString().slice(0, 10), csd), true);
}

// ---------- insights (items to review, never "errors") ----------
function refreshInsights() {
  const s = SpreadsheetApp.getActive();
  const st = getSettings();
  const csd = cycleStartDay_();
  const mult = Number(st.Unusual_Txn_Multiplier) || 3;
  const minAmt = Number(st.Anomaly_Min_Amount) || 500;
  const tol = Number(st.Recurring_Tolerance_Pct) || 0.15;
  const today = fmt(new Date(), 'yyyy-MM-dd');
  const cyc = cycleFor_(today, csd);
  const daysBack = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const { rows: data, map } = readTx();
  const tx = data.filter(r => r[map.Transaction_ID] !== '' || r[map.Amount] !== '').map(r => ({
    id: r[map.Transaction_ID], d: dateKey(r[map.Transaction_Date]), type: r[map.Transaction_Type], amt: Number(r[map.Amount]) || 0,
    cat: r[map.Category], desc: String(r[map.Description] || ''), rec: r[map.Recurring_Flag] === 'Yes', cur: r[map.Currency] || 'EGP',
  })).filter(t => t.cur === 'EGP');
  const out = [];
  const add = (type, sev, detail, amt, d, id) => out.push([new Date(), type, sev, detail, amt === '' ? '' : Math.round(amt), d || '', id || '']);

  // 1. Budgets (only when the Summary shows the current cycle)
  const sum = s.getSheetByName('Summary');
  const sm = summaryRowMap_();
  const sumStart = dateKey(sum.getRange(sm.start, 2).getValue());
  if (sumStart === cyc.start) {
    const B = s.getSheetByName('Budgets');
    const bv = B.getRange(2, 1, Math.max(1, B.getLastRow() - 1), 11).getValues();
    bv.forEach(r => {
      if (!r[0] || r[0] === 'TOTAL' || String(r[6])[0] === '#') return;
      if (r[6] === 'Over') add('Budget', 'High', r[0] + ': over budget (' + Math.round(r[2]) + ' of ' + Math.round(r[1]) + ')', r[2] - r[1]);
      else if (r[6] === 'Likely over') add('Budget', 'Medium', r[0] + ': on pace for ' + Math.round(r[5]) + ' vs budget ' + Math.round(r[1]), r[5] - r[1]);
      else if (r[6] === 'Warning') add('Budget', 'Info', r[0] + ': ' + Math.round(r[4] * 100) + '% of budget used', r[2]);
      if (r[10] && String(r[10])[0] !== '#') add('Trend', 'Medium', r[0] + ': ' + r[10], r[5] - r[7]);
    });
  } else add('Note', 'Info', 'Budget checks skipped: Settings > Report_Month is set to another cycle.', '');

  // 2. Unusual single expenses: > mult × the category's average over the 90 days before this cycle (needs ≥5 examples)
  const histFrom = daysBack(cyc.start, 90);
  const hist = {};
  const flagged = {};
  tx.filter(t => t.type === 'Expense' && t.d >= histFrom && t.d < cyc.start).forEach(t => { (hist[t.cat] = hist[t.cat] || []).push(t.amt); });
  tx.filter(t => t.type === 'Expense' && t.d >= cyc.start && t.d <= cyc.end).forEach(t => {
    const h = hist[t.cat];
    if (!h || h.length < 5 || t.amt < minAmt) return;
    const avg = h.reduce((a, b) => a + b, 0) / h.length;
    if (t.amt > mult * avg) { flagged[t.id] = 1; add('Unusual transaction', 'Info', t.cat + ' — ' + (t.desc || 'no description') + ': ' + Math.round(t.amt) + ' vs usual ' + Math.round(avg) + '. Fine if expected.', t.amt, t.d, t.id); }
  });
  // A purchase is "usual-sized" if the same category had ≥2 purchases within ±25% of it in the history window.
  const usualSized = t => (hist[t.cat] || []).filter(a => Math.abs(a - t.amt) <= 0.25 * t.amt).length >= 2;

  // 3. High-spending days: variable spending > mult × average daily variable spending of the prior 90 days (needs 30+ days of history)
  const firstDay = tx.length ? tx.map(t => t.d).sort()[0] : today;
  if (firstDay <= daysBack(cyc.start, 30)) {
    const varOf = (from, to) => tx.filter(t => !t.rec && t.d >= from && t.d <= to && (t.type === 'Expense' || t.type === 'Refund'))
      .reduce((a, t) => a + (t.type === 'Expense' ? t.amt : -t.amt), 0);
    const histDays = Math.max(1, Math.round((new Date(cyc.start) - new Date(firstDay > histFrom ? firstDay : histFrom)) / 86400000));
    const dailyAvg = varOf(histFrom, daysBack(cyc.start, 1)) / histDays;
    const byDay = {};
    tx.filter(t => !t.rec && t.d >= cyc.start && t.d <= today && (t.type === 'Expense' || t.type === 'Refund'))
      .filter(t => t.type === 'Refund' || (!flagged[t.id] && !usualSized(t)))
      .forEach(t => { byDay[t.d] = (byDay[t.d] || 0) + (t.type === 'Expense' ? t.amt : -t.amt); });
    Object.keys(byDay).forEach(d => {
      if (byDay[d] >= minAmt && byDay[d] > mult * dailyAvg) add('High-spending day', 'Info', d + ': ' + Math.round(byDay[d]) + ' vs usual ' + Math.round(dailyAvg) + ' per day.', byDay[d], d);
    });
  }

  // 4. Charges that look recurring but are not marked as commitments: same description & category in each of the last 3 cycles
  const cycles = [];
  let k = cyc.start;
  for (let i = 0; i < 3; i++) { const c = cycleFor_(daysBack(k, 1), csd); cycles.push(c); k = c.start; }
  const commitNames = (s.getSheetByName('Commitments').getRange(2, 2, 100, 1).getValues().map(r => norm(r[0])).filter(String));
  const groups = {};
  tx.filter(t => t.type === 'Expense' && !t.rec && t.desc).forEach(t => {
    const ci = cycles.findIndex(c => t.d >= c.start && t.d <= c.end);
    if (ci < 0) return;
    const key = norm(t.desc) + '|' + t.cat;
    (groups[key] = groups[key] || [[], [], []])[ci].push(t.amt);
  });
  Object.keys(groups).forEach(key => {
    const g = groups[key];
    if (g.some(x => x.length !== 1)) return;
    const amts = g.map(x => x[0]); const med = amts.slice().sort((a, b) => a - b)[1];
    if (amts.every(a => Math.abs(a - med) <= tol * med) && commitNames.every(n => key.indexOf(n) < 0)) {
      add('Looks recurring', 'Info', key.split('|')[0] + ' (' + key.split('|')[1] + ') ~' + Math.round(med) + ' every cycle. Add it to Commitments, or review whether you still need it.', med);
    }
  });

  // 5. Overdue commitments
  const C = s.getSheetByName('Commitments');
  C.getRange(2, 1, 100, 15).getValues().forEach(r => {
    if (r[0] && r[9] === 'Overdue') add('Commitment', 'High', r[1] + ' (' + Math.round(r[3]) + ') was due ' + dateKey(r[14]) + ' and is not recorded as paid.', r[3], dateKey(r[14]));
  });

  const sh = s.getSheetByName('Insights') || s.insertSheet('Insights');
  sh.clearContents();
  const headr = [['Generated_At', 'Type', 'Severity', 'Detail', 'Amount_EGP', 'Date', 'Transaction_ID']];
  sh.getRange(1, 1, 1, 7).setValues(headr);
  if (out.length) sh.getRange(2, 1, out.length, 7).setValues(out);
  else sh.getRange(2, 1, 1, 7).setValues([[new Date(), 'Note', 'Info', 'Nothing to review right now.', '', '', '']]);
  return out;
}

/**
 * AI Personal Finance Assistant — Phase 5: investments
 * ----------------------------------------------------
 * Add as a fourth script file (Phase5.gs). Then run Finance › Upgrade to Phase 5 once.
 *
 * What it does
 *   - Holdings get an Asset_Class column and USD conversion; a Portfolio tab (all formulas) shows value,
 *     gains, allocation vs your target, and how to split new money.
 *   - Allocation_Targets tab: target mix per risk profile. Defaults are STARTING POINTS you can edit.
 *   - /risk questionnaire sets Risk_Profile. No allocation is suggested until it is set.
 *   - /buy /sell /price /dividend /thndrcash keep Holdings and Investment_Transactions current.
 *   - Cash you send to Thndr via the bot ("حطيت 3000 في ثاندر") is added to a "Thndr Cash" holding,
 *     and a purchase moves it from Thndr Cash into the asset — so nothing is counted twice.
 * New money is split to move the portfolio TOWARD the target without selling anything.
 */

const ASSET_CLASSES = ['Cash-like', 'Fixed Income', 'Gold', 'Egypt Equity', 'Foreign Equity', 'Other'];
const PRODUCT_TO_CLASS = [
  ['Money Market Fund', 'Cash-like'], ['Cash', 'Cash-like'], ['Fixed Income Fund', 'Fixed Income'], ['T-Bill', 'Fixed Income'],
  ['Gold Fund', 'Gold'], ['Gold', 'Gold'], ['Stock', 'Egypt Equity'], ['Equity Fund', 'Egypt Equity'],
  ['US Stock', 'Foreign Equity'], ['Foreign Fund', 'Foreign Equity'], ['Real Estate', 'Other'], ['Other', 'Other'],
];
// Starting points only — edit them on the Allocation_Targets tab. Each column sums to 100%.
const DEFAULT_TARGETS = [
  // class,          Conservative, Moderate, Growth, what it means on Thndr
  ['Cash-like', 0.25, 0.15, 0.10, 'Money market fund (e.g. Thndr Clouds). Daily liquidity, low risk.'],
  ['Fixed Income', 0.40, 0.25, 0.10, 'Fixed income mutual funds / T-bill funds.'],
  ['Gold', 0.15, 0.15, 0.15, 'Gold funds or Thndr Gold. Hedge against EGP weakness and inflation.'],
  ['Egypt Equity', 0.15, 0.30, 0.45, 'EGX stocks or an equity fund. Higher growth, higher swings.'],
  ['Foreign Equity', 0.05, 0.15, 0.20, 'US stocks on Thndr. Growth + USD exposure.'],
  ['Other', 0, 0, 0, 'Real estate products etc. Set a target if you want them.'],
];
const PF_TABLE_START = 18; // first class row on the Portfolio tab
const THNDR_CASH = 'Thndr Cash';

// ---------- formulas ----------
function portfolioLayout_() {
  const T0 = PF_TABLE_START, T1 = PF_TABLE_START + ASSET_CLASSES.length - 1;
  const sm = summaryRowMap_();
  return [
    ['profile', 'Risk profile', '=IFERROR(INDEX(Settings!$B:$B,MATCH("Risk_Profile",Settings!$A:$A,0))&"","")', 'Set with /risk in the bot. Empty = no allocation suggestions.', null],
    ['newmoney', 'New money to invest (this cycle)', '=MAX(0,Summary!$B$' + sm.free + ')', 'From Summary › Free to invest (after emergency fund and goals).', MONEY],
    ['fx', 'USD → EGP rate', '=IFERROR(' + sv_('USD_EGP_Rate') + '*1,0)', 'Settings › USD_EGP_Rate. Needed for US stocks.', '0.00'],
    ['value', 'Portfolio value', '=SUM(Holdings!$H$2:$H$101)', 'Σ Current_Market_Value (USD holdings converted).', MONEY],
    ['cost', 'Cost basis', '=SUM(Holdings!$F$2:$F$101)', 'Σ Quantity × Avg_Acquisition_Cost (fees included in cost).', MONEY],
    ['unreal', 'Unrealized gain/loss', '={value}-{cost}', '', MONEY],
    ['unrealpct', 'Unrealized gain/loss %', '=IF({cost}=0,0,{unreal}/{cost})', '', PCTF],
    ['netcontrib', 'Net cash contributed (all time)', '=SUMIFS(' + TX('E') + ',' + TX('D') + ',"Investment Contribution",' + TX('F') + ',"EGP")-SUMIFS(' + TX('E') + ',' + TX('D') + ',"Investment Withdrawal",' + TX('F') + ',"EGP")',
      'Contributions − withdrawals on Transactions. Only meaningful if you recorded all past contributions.', MONEY],
    ['gainnet', 'Value minus net contributed', '={value}-{netcontrib}', 'Total gain including dividends kept in the portfolio.', MONEY],
    ['valdate', 'Oldest price date', '=IFERROR(SMALL(Holdings!$K$2:$K$101,1),0)', 'The stalest Valuation_Date. Update with /price.', DATEF],
    ['thndrcash', 'Uninvested cash in Thndr', '=SUMIFS(Holdings!$H$2:$H$101,Holdings!$A$2:$A$101,"' + THNDR_CASH + '")', '', MONEY],
    ['targetsum', 'Targets add up to', '=SUM($D$' + T0 + ':$D$' + T1 + ')', 'Must be 100% for the chosen profile.', PCTF],
    ['sumpos', 'Total underweight', '=SUMPRODUCT(($G$' + T0 + ':$G$' + T1 + '>0)*$G$' + T0 + ':$G$' + T1 + ')', 'Sum of positive gaps after adding new money.', MONEY],
  ];
}
function portfolioRowMap_() { const m = {}; portfolioLayout_().forEach((r, i) => { m[r[0]] = i + 2; }); return m; }

function writePortfolio_(s) {
  const sh = s.getSheetByName('Portfolio') || s.insertSheet('Portfolio');
  sh.clearContents();
  const layout = portfolioLayout_(), map = portfolioRowMap_();
  sh.getRange(1, 1).setValue('Portfolio (all formulas — do not type here)');
  layout.forEach((r, i) => {
    sh.getRange(i + 2, 1).setValue(r[1]); sh.getRange(i + 2, 3).setValue(r[3]);
    sh.getRange(i + 2, 2).setFormula(resolveLocal_(r[2], map));
    if (r[4]) { try { sh.getRange(i + 2, 2).setNumberFormat(r[4]); } catch (e) { } }
  });
  const H = PF_TABLE_START - 1, V = '$B$' + map.value, NM = '$B$' + map.newmoney, PR = '$B$' + map.profile, SP = '$B$' + map.sumpos;
  sh.getRange(H, 1, 1, 8).setValues([['Asset_Class', 'Current_Value', 'Current_%', 'Target_%', 'Drift', 'Target_Value_After_New_Money', 'Gap', 'Suggested_New_Money']]);
  ASSET_CLASSES.forEach((c, i) => {
    const r = PF_TABLE_START + i;
    sh.getRange(r, 1).setValue(c);
    sh.getRange(r, 2, 1, 7).setFormulas([[
      '=SUMIFS(Holdings!$H$2:$H$101,Holdings!$Q$2:$Q$101,$A' + r + ')',
      '=IF(' + V + '=0,0,B' + r + '/' + V + ')',
      '=IF(' + PR + '="",0,IFERROR(INDEX(Allocation_Targets!$B$2:$D$7,MATCH($A' + r + ',Allocation_Targets!$A$2:$A$7,0),MATCH(' + PR + ',Allocation_Targets!$B$1:$D$1,0)),0))',
      '=C' + r + '-D' + r,
      '=D' + r + '*(' + V + '+' + NM + ')',
      '=F' + r + '-B' + r,
      '=IF(' + SP + '<=0,0,' + NM + '*MAX(0,G' + r + ')/' + SP + ')',
    ]]);
  });
  const t = PF_TABLE_START + ASSET_CLASSES.length;
  sh.getRange(t, 1).setValue('TOTAL');
  sh.getRange(t, 2, 1, 7).setFormulas([['=SUM(B' + PF_TABLE_START + ':B' + (t - 1) + ')', '=SUM(C' + PF_TABLE_START + ':C' + (t - 1) + ')',
    '=SUM(D' + PF_TABLE_START + ':D' + (t - 1) + ')', '=""', '=SUM(F' + PF_TABLE_START + ':F' + (t - 1) + ')', '=SUM(G' + PF_TABLE_START + ':G' + (t - 1) + ')',
    '=SUM(H' + PF_TABLE_START + ':H' + (t - 1) + ')']]);
  try {
    sh.getRange(PF_TABLE_START, 2, ASSET_CLASSES.length + 1, 1).setNumberFormat(MONEY);
    sh.getRange(PF_TABLE_START, 3, ASSET_CLASSES.length + 1, 3).setNumberFormat(PCTF);
    sh.getRange(PF_TABLE_START, 6, ASSET_CLASSES.length + 1, 3).setNumberFormat(MONEY);
  } catch (e) { }
}

function upgradePhase5() {
  const s = SpreadsheetApp.getActive();
  const st = getSettings();
  const add = (k, v, d) => { if (st[k] === undefined) setSetting(k, v, d); };
  add('Risk_Profile', '', 'Set by /risk in the bot: Conservative, Moderate or Growth.');
  add('USD_EGP_Rate', '', 'For US stocks. Type the rate (e.g. 48.5) or put =GOOGLEFINANCE("CURRENCY:USDEGP") here.');
  add('Rebalance_Drift_Pct', 0.05, 'Flag an asset class when it is this far from its target share.');
  add('Sync_Thndr_Cash', 'ON', 'ON = cash you send to/withdraw from Thndr via the bot updates the "Thndr Cash" holding.');
  // Lists: product types and product → asset class map
  const L = s.getSheetByName('Lists');
  L.getRange(1, 12).setValue('Product_Type');
  L.getRange(2, 12, 15, 1).clearContent();
  L.getRange(2, 12, PRODUCT_TO_CLASS.length, 1).setValues(PRODUCT_TO_CLASS.map(p => [p[0]]));
  L.getRange(1, 19, 1, 2).setValues([['Product_Type', 'Asset_Class']]);
  L.getRange(2, 19, PRODUCT_TO_CLASS.length, 2).setValues(PRODUCT_TO_CLASS);
  // Holdings: Asset_Class column + USD conversion
  const Hs = s.getSheetByName('Holdings');
  Hs.getRange(1, 17).setValue('Asset_Class');
  const fx = 'IF($O{r}="USD",IFERROR(' + sv_('USD_EGP_Rate') + '*1,0),1)';
  const f = [];
  for (let r = 2; r <= 101; r++) {
    const X = fx.replace(/\{r\}/g, r);
    f.push(['=IF(A' + r + '="","",D' + r + '*E' + r + '*' + X + ')', '=IF(A' + r + '="","",D' + r + '*G' + r + '*' + X + ')',
      '=IF(A' + r + '="","",H' + r + '-F' + r + ')', '=IF(OR(A' + r + '="",F' + r + '=0),"",I' + r + '/F' + r + ')']);
  }
  Hs.getRange(2, 6, 100, 1).setFormulas(f.map(x => [x[0]]));
  Hs.getRange(2, 8, 100, 3).setFormulas(f.map(x => [x[1], x[2], x[3]]));
  const q = []; for (let r = 2; r <= 101; r++) q.push(['=IF(A' + r + '="","",IFERROR(VLOOKUP(B' + r + ',Lists!$S$2:$T$30,2,FALSE),"Other"))']);
  Hs.getRange(2, 17, 100, 1).setFormulas(q);
  try {
    const rule = SpreadsheetApp.newDataValidation().requireValueInRange(L.getRange('L2:L16'), true).build();
    Hs.getRange('B2:B101').setDataValidation(rule);
  } catch (e) { }
  ensureThndrCashRow_();
  // Allocation targets (never overwrite your edits)
  if (!s.getSheetByName('Allocation_Targets')) {
    const A = s.insertSheet('Allocation_Targets');
    A.getRange(1, 1, 1, 5).setValues([['Asset_Class', 'Conservative', 'Moderate', 'Growth', 'What it means on Thndr']]);
    A.getRange(2, 1, DEFAULT_TARGETS.length, 5).setValues(DEFAULT_TARGETS);
    A.getRange(9, 1).setValue('Starting points, not advice. Edit the percentages to your own plan; each column must total 100%.');
    try { A.getRange(2, 2, DEFAULT_TARGETS.length, 3).setNumberFormat('0%'); } catch (e) { }
  }
  writePortfolio_(s);
  try { tg('setMyCommands', { commands: botCommandList_() }); } catch (e) { }
  console.log('Phase 5 ready.');
}

function botCommandList_() {
  return [
    { command: 'dashboard', description: 'Open the dashboard' },
    { command: 'today', description: "Today's transactions" }, { command: 'month', description: 'This cycle so far' },
    { command: 'budget', description: 'Budget by category' }, { command: 'saving', description: 'What you can save or invest' },
    { command: 'investments', description: 'Portfolio and allocation' }, { command: 'invest', description: 'How to split new money' },
    { command: 'price', description: 'Update prices: /price COMI 92.5' }, { command: 'buy', description: '/buy COMI 100 85.5 [fee]' },
    { command: 'sell', description: '/sell COMI 50 95 [fee]' }, { command: 'risk', description: 'Risk profile questionnaire' },
    { command: 'commitments', description: 'Bills this cycle' }, { command: 'goals', description: 'Goal progress' },
    { command: 'undo', description: 'Remove the last saved entry' }, { command: 'export', description: 'CSV of this cycle' },
    { command: 'alerts', description: 'Alert settings' }, { command: 'help', description: 'How to use' }];
}

// ---------- Holdings helpers ----------
function holdingsSheet_() { return SpreadsheetApp.getActive().getSheetByName('Holdings'); }
function holdingsRows_() {
  const sh = holdingsSheet_();
  const v = sh.getRange(2, 1, 100, 17).getValues();
  return v.map((r, i) => ({ row: i + 2, name: r[0], type: r[1], ticker: r[2], qty: num_(r[3]), avg: num_(r[4]), price: num_(r[6]),
    value: num_(r[7]), valDate: r[10], fees: num_(r[11]), cur: r[14] || 'EGP', cls: r[16] })).filter(h => h.name !== '');
}
function findHolding_(ident) {
  const k = String(ident || '').trim().toLowerCase();
  return holdingsRows_().find(h => String(h.ticker).toLowerCase() === k) || holdingsRows_().find(h => String(h.name).toLowerCase() === k) || null;
}
function firstEmptyRow_(sh, from, to) {
  const v = sh.getRange(from, 1, to - from + 1, 1).getValues();
  for (let i = 0; i < v.length; i++) if (v[i][0] === '') return from + i;
  throw new Error('No empty row left (rows ' + from + '–' + to + ').');
}
function ensureThndrCashRow_() {
  if (findHolding_(THNDR_CASH)) return;
  const sh = holdingsSheet_();
  const r = firstEmptyRow_(sh, 2, 101);
  sh.getRange(r, 1, 1, 5).setValues([[THNDR_CASH, 'Cash', '', 0, 1]]);
  sh.getRange(r, 7).setValue(1);
  sh.getRange(r, 11, 1, 5).setValues([[new Date(), 0, 'Bot', 'Actual', 'EGP']]);
}
function setThndrCash_(amount) {
  ensureThndrCashRow_();
  const h = findHolding_(THNDR_CASH);
  holdingsSheet_().getRange(h.row, 4).setValue(Math.round(amount * 100) / 100);
  holdingsSheet_().getRange(h.row, 11).setValue(new Date());
}
function thndrCash_() { const h = findHolding_(THNDR_CASH); return h ? h.qty : 0; }

function logInv_(type, name, ticker, qty, price, gross, fees, related, note) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Investment_Transactions');
  const r = firstEmptyRow_(sh, 2, 1001);
  const id = 'INV-' + fmt(new Date(), 'yyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  sh.getRange(r, 1, 1, 9).setValues([[id, Utilities.parseDate(fmt(new Date(), 'yyyy-MM-dd'), TZ, 'yyyy-MM-dd'), type, name, ticker || '', qty === null ? '' : qty, price === null ? '' : price, gross, fees || 0]]);
  sh.getRange(r, 11, 1, 3).setValues([['EGP', related || '', note || '']]);
  return id;
}

/** Called by Code.gs after the bot saves transactions: mirror Thndr cash in/out. */
function onInvestmentCashSaved(items, ids) {
  if (String(getSettings().Sync_Thndr_Cash || 'ON').toUpperCase() === 'OFF') return;
  items.forEach((it, k) => {
    if (it.currency !== 'EGP') return;
    if (it.type === 'Investment Contribution') { setThndrCash_(thndrCash_() + it.amount); logInv_('Contribution', THNDR_CASH, '', null, null, it.amount, 0, ids[k], 'From bot'); }
    if (it.type === 'Investment Withdrawal') { setThndrCash_(Math.max(0, thndrCash_() - it.amount)); logInv_('Withdrawal', THNDR_CASH, '', null, null, it.amount, 0, ids[k], 'From bot'); }
  });
}
/** Called by Code.gs before transactions are deleted (/undo, /delete): reverse the Thndr cash mirror. */
function onTransactionsDeleted(rowObjs) {
  if (String(getSettings().Sync_Thndr_Cash || 'ON').toUpperCase() === 'OFF') return;
  const sh = SpreadsheetApp.getActive().getSheetByName('Investment_Transactions');
  rowObjs.forEach(o => {
    if (o.Transaction_Type !== 'Investment Contribution' && o.Transaction_Type !== 'Investment Withdrawal') return;
    const vals = sh.getRange(2, 12, 1000, 1).getValues();
    const i = vals.findIndex(v => String(v[0]) === String(o.Transaction_ID));
    if (i < 0) return; // not mirrored (manual entry) → nothing to reverse
    const a = num_(o.Amount);
    setThndrCash_(o.Transaction_Type === 'Investment Contribution' ? Math.max(0, thndrCash_() - a) : thndrCash_() + a);
    sh.getRange(i + 2, 1, 1, 9).clearContent(); sh.getRange(i + 2, 11, 1, 3).clearContent();
  });
}

// ---------- risk questionnaire ----------
const RISK_Q = [
  ['How long can this money stay invested?', ['Less than 3 years', '3–7 years', 'More than 7 years']],
  ['If your portfolio dropped 25% in a few months, you would…', ['Sell to stop losses', 'Wait it out', 'Invest more']],
  ['How stable is your income?', ['Unstable', 'Stable salary', 'Stable + emergency fund']],
  ['Investing experience?', ['None', 'Some funds or stocks', 'Several years']],
  ['Will you need part of this money within 3 years?', ['Yes, most of it', 'Some of it', 'No']],
];
function scoreRisk_(ans) {
  const score = ans.reduce((a, b) => a + b, 0);
  let p = score <= 3 ? 'Conservative' : score <= 6 ? 'Moderate' : 'Growth';
  if (ans[0] === 0 || ans[4] === 0) p = 'Conservative';            // short horizon caps risk
  else if (ans[1] === 0 && p === 'Growth') p = 'Moderate';          // would sell in a drop
  return { score: score, profile: p };
}
function askRisk_(chatId, msgId, ans) {
  const k = ans.length;
  if (k >= RISK_Q.length) {
    const r = scoreRisk_(ans);
    setSetting('Risk_Profile', r.profile);
    setSetting('Risk_Answers', ans.join(','), 'Answers to /risk (0-2 each).');
    setSetting('Risk_Assessed_At', new Date(), 'When /risk was last completed.');
    const why = (ans[0] === 0 || ans[4] === 0) ? '\nCapped at Conservative because the money may be needed within 3 years.' :
      (ans[1] === 0 && r.score > 6) ? '\nCapped at Moderate because you would sell during a big drop.' : '';
    return reply(chatId, msgId, '🧭 Your profile: ' + r.profile + ' (score ' + r.score + '/10).' + why +
      '\n\nTarget mix is on the Allocation_Targets tab — edit it any time. This is a simple self-assessment, not financial advice.\nNext: /investments or /invest');
  }
  const btn = RISK_Q[k][1].map((t, i) => [{ text: t, callback_data: 'rk|' + ans.concat([i]).join('') }]);
  return reply(chatId, msgId, 'Question ' + (k + 1) + '/' + RISK_Q.length + '\n' + RISK_Q[k][0], btn);
}

// ---------- allocation of new money (same rule as the Portfolio tab) ----------
/** classes: [{cls, value, target}] ; returns [{cls, amount}] that moves toward target without selling. */
function splitNewMoney_(classes, amount) {
  const total = classes.reduce((a, c) => a + c.value, 0);
  const gaps = classes.map(c => Math.max(0, c.target * (total + amount) - c.value));
  const sum = gaps.reduce((a, b) => a + b, 0);
  return classes.map((c, i) => ({ cls: c.cls, amount: sum <= 0 ? 0 : amount * gaps[i] / sum }));
}
function portfolioState_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Portfolio');
  const m = portfolioRowMap_();
  const col = sh.getRange(1, 2, PF_TABLE_START + ASSET_CLASSES.length, 1).getValues().map(r => r[0]);
  const v = {}; Object.keys(m).forEach(k => { v[k] = col[m[k] - 1]; });
  const t = sh.getRange(PF_TABLE_START, 1, ASSET_CLASSES.length, 8).getValues()
    .map(r => ({ cls: r[0], value: num_(r[1]), pct: num_(r[2]), target: num_(r[3]), drift: num_(r[4]), suggested: num_(r[7]) }));
  return { v: v, classes: t };
}

// ---------- commands ----------
function handleCommand5(chatId, cmd, arg) {
  switch (cmd) {
    case '/investments': send(chatId, investmentsText_()); return true;
    case '/invest': send(chatId, investText_(arg)); return true;
    case '/risk': askRisk_(chatId, null, []); return true;
    case '/price': priceCmd_(chatId, arg); return true;
    case '/buy': case '/sell': tradeCmd_(chatId, cmd.slice(1), arg); return true;
    case '/dividend': dividendCmd_(chatId, arg); return true;
    case '/thndrcash': {
      const a = parseFloat(String(arg).replace(/,/g, ''));
      if (!(a >= 0)) { send(chatId, 'Use: /thndrcash 12000 (your uninvested cash in Thndr now)'); return true; }
      const before = thndrCash_(); setThndrCash_(a); audit('THNDR_CASH_SET', THNDR_CASH, { qty: before }, { qty: a }, 'Telegram');
      send(chatId, '✅ Thndr Cash set to ' + money_(a) + ' EGP (was ' + money_(before) + ').'); return true;
    }
  }
  return false;
}

function investmentsText_() {
  const { v, classes } = portfolioState_();
  if (!num_(v.value)) return '📈 No holdings yet. Add them in the Holdings tab, or use /buy and /thndrcash.';
  const drift = Number(getSettings().Rebalance_Drift_Pct) || 0.05;
  const hasProfile = String(v.profile || '') !== '';
  const lines = classes.filter(c => c.value > 0 || c.target > 0).map(c => {
    const flag = hasProfile && Math.abs(c.drift) >= drift ? (c.drift > 0 ? ' ⬆️ over' : ' ⬇️ under') : '';
    return '• ' + c.cls + ': ' + money_(c.value) + ' (' + Math.round(c.pct * 100) + '%' + (hasProfile ? ' vs ' + Math.round(c.target * 100) + '%' : '') + ')' + flag;
  });
  const oldest = num_(v.valdate) ? dateKey(v.valdate) : '';
  const stale = oldest && (Date.now() - new Date(oldest + 'T00:00:00Z').getTime()) / 86400000 > 30;
  const usdMissing = holdingsRows_().some(h => h.cur === 'USD') && !num_(v.fx);
  return '📈 Portfolio\nValue: ' + money_(v.value) + ' EGP\nCost: ' + money_(v.cost) + ' · Unrealized: ' + (num_(v.unreal) >= 0 ? '+' : '') + money_(v.unreal) +
    ' (' + Math.round(num_(v.unrealpct) * 1000) / 10 + '%)' +
    (num_(v.netcontrib) > 0 ? '\nNet contributed: ' + money_(v.netcontrib) + ' · Value − contributed: ' + money_(v.gainnet) : '') +
    (num_(v.thndrcash) > 0 ? '\nUninvested in Thndr: ' + money_(v.thndrcash) : '') +
    '\n\nAllocation' + (hasProfile ? ' (target: ' + v.profile + ')' : '') + '\n' + lines.join('\n') +
    (hasProfile ? '' : '\n\n🧭 No risk profile yet — send /risk (5 quick questions) to get target allocations.') +
    (hasProfile && Math.abs(num_(v.targetsum) - 1) > 0.001 ? '\n⚠️ Targets for ' + v.profile + ' add up to ' + Math.round(num_(v.targetsum) * 100) + '%, not 100%. Fix the Allocation_Targets tab.' : '') +
    (stale ? '\n⚠️ Oldest price is from ' + oldest + '. Update with /price.' : '') +
    (usdMissing ? '\n⚠️ USD holdings are counted as 0 until you set Settings › USD_EGP_Rate.' : '');
}

function investText_(arg) {
  const { v, classes } = portfolioState_();
  if (String(v.profile || '') === '') return '🧭 Set your risk profile first: /risk';
  const typed = parseFloat(String(arg || '').replace(/,/g, ''));
  const amount = typed > 0 ? typed : num_(v.newmoney);
  if (!(amount > 0)) return '💤 Nothing free to invest this cycle (after bills, buffer, emergency fund and goals). See /saving. Or ask for a specific amount: /invest 5000';
  const split = splitNewMoney_(classes.map(c => ({ cls: c.cls, value: c.value, target: c.target })), amount).filter(x => x.amount >= 1);
  const hint = {}; DEFAULT_TARGETS.forEach(d => { hint[d[0]] = d[4].split('.')[0]; });
  const goalsSoon = sheetObjects_('Goals', 10).filter(g => g.Goal_ID && num_(g.Months_Remaining) <= 36 && num_(g.Progress_Pct) < 1);
  return '💡 Split of ' + money_(amount) + ' EGP (' + v.profile + ')' + (typed > 0 ? '' : ' — your free-to-invest amount this cycle') + '\n' +
    split.map(x => '• ' + x.cls + ': ' + money_(x.amount) + '\n   ' + (hint[x.cls] || '')).join('\n') +
    '\n\nThis moves your portfolio toward its target without selling anything.' +
    (goalsSoon.length ? '\nMoney for ' + goalsSoon.map(g => g.Goal_Name).join(', ') + ' (due within 3 years) should stay in cash-like or fixed income, not here.' : '') +
    '\nRules-based suggestion from your own targets, not financial advice.';
}

function priceCmd_(chatId, arg) {
  const parts = String(arg || '').split(/[,،\n]/).map(x => x.trim()).filter(Boolean);
  if (!parts.length) {
    const hs = holdingsRows_().filter(h => h.name !== THNDR_CASH);
    if (!hs.length) return send(chatId, 'No holdings yet.');
    return send(chatId, '🏷 Prices (update: /price COMI 92.5, AZG 15.3)\n' + hs.map(h => '• ' + (h.ticker || h.name) + ': ' + h.price + ' ' + h.cur +
      ' · ' + (isDate(h.valDate) ? dateKey(h.valDate) : 'no date')).join('\n'));
  }
  const done = [], bad = [];
  parts.forEach(pz => {
    const m = pz.match(/^(.+?)\s+([\d.]+)$/);
    const h = m && findHolding_(m[1]);
    if (!m || !h || !(parseFloat(m[2]) > 0)) { bad.push(pz); return; }
    const sh = holdingsSheet_(), p = parseFloat(m[2]);
    sh.getRange(h.row, 7).setValue(p);
    sh.getRange(h.row, 11).setValue(Utilities.parseDate(fmt(new Date(), 'yyyy-MM-dd'), TZ, 'yyyy-MM-dd'));
    sh.getRange(h.row, 13, 1, 2).setValues([['Telegram', 'Actual']]);
    audit('PRICE', h.ticker || h.name, { price: h.price }, { price: p }, 'Telegram');
    done.push((h.ticker || h.name) + ' ' + h.price + ' → ' + p + ' (' + (p >= h.price ? '+' : '') + money_((p - h.price) * h.qty) + ' EGP)');
  });
  send(chatId, (done.length ? '✅ Updated\n' + done.join('\n') : '') + (bad.length ? (done.length ? '\n\n' : '') + '⚠️ Not found or unclear: ' + bad.join(', ') + '\nUse the ticker or exact name from Holdings.' : ''));
}

function parseTrade_(arg) {
  const t = String(arg || '').trim().split(/\s+/);
  const nums = [];
  while (t.length && /^[\d.,]+$/.test(t[t.length - 1]) && nums.length < 3) nums.unshift(parseFloat(t.pop().replace(/,/g, '')));
  if (nums.length < 2 || !t.length) return null;
  return { ident: t.join(' '), qty: nums[0], price: nums[1], fee: nums[2] || 0 };
}

function tradeCmd_(chatId, kind, arg) {
  const tr = parseTrade_(arg);
  if (!tr || !(tr.qty > 0) || !(tr.price > 0)) return send(chatId, 'Use: /' + kind + ' COMI 100 85.5 [fee]\n(name or ticker, quantity, price per unit, optional total fee)');
  const h = findHolding_(tr.ident);
  if (kind === 'sell' && (!h || h.qty < tr.qty)) return send(chatId, '⚠️ You hold ' + (h ? h.qty : 0) + ' of ' + tr.ident + ' — cannot sell ' + tr.qty + '.');
  const looksTicker = /^[A-Za-z]{3,5}$/.test(tr.ident);
  const p = { id: shortId(), kind: kind, ident: h ? (h.ticker || h.name) : (looksTicker ? tr.ident.toUpperCase() : tr.ident), qty: tr.qty, price: tr.price, fee: tr.fee, isNew: !h, type: null };
  CacheService.getScriptCache().put('iv:' + p.id, JSON.stringify(p), 3600);
  if (p.isNew && !p.type) {
    const types = PRODUCT_TO_CLASS.map(x => x[0]).filter(x => x !== 'Cash');
    return send(chatId, '"' + tr.ident + '" is new. What is it?', rows(types.map((x, i) => ({ text: x, callback_data: 'iv|t|' + p.id + '|' + i })), 2));
  }
  confirmTrade_(chatId, null, p);
}
function confirmTrade_(chatId, msgId, p) {
  const gross = p.qty * p.price, cash = thndrCash_();
  const cashAfter = p.kind === 'buy' ? cash - gross - p.fee : cash + gross - p.fee;
  const h = findHolding_(p.ident);
  let msg = (p.kind === 'buy' ? '🛒 Buy ' : '💸 Sell ') + p.qty + ' ' + p.ident + ' @ ' + p.price + (p.fee ? ' + fee ' + p.fee : '') +
    '\nTotal: ' + money_(p.kind === 'buy' ? gross + p.fee : gross - p.fee) + ' EGP' + (p.isNew ? '\nNew holding (' + p.type + ')' : '') +
    '\nThndr Cash: ' + money_(cash) + ' → ' + money_(Math.max(0, cashAfter));
  if (p.kind === 'sell' && h) msg += '\nRealized gain: ' + money_(p.qty * (p.price - h.avg) - p.fee) + ' EGP';
  if (cashAfter < 0) msg += '\n⚠️ More than your recorded Thndr Cash — it will be set to 0. Fix with /thndrcash if needed.';
  return reply(chatId, msgId, msg, [[{ text: '✅ Save', callback_data: 'iv|ok|' + p.id }, { text: '❌ Cancel', callback_data: 'iv|x|' + p.id }]]);
}
function handleInvCallback(chatId, msgId, parts) {
  const cache = CacheService.getScriptCache();
  const c = cache.get('iv:' + parts[2]);
  if (!c) return edit(chatId, msgId, 'ℹ️ Already handled or expired.');
  const p = JSON.parse(c);
  if (parts[1] === 'x') { cache.remove('iv:' + p.id); return edit(chatId, msgId, '❌ Cancelled.'); }
  if (parts[1] === 't') {
    p.type = PRODUCT_TO_CLASS.map(x => x[0]).filter(x => x !== 'Cash')[Number(parts[3])];
    cache.put('iv:' + p.id, JSON.stringify(p), 3600);
    return confirmTrade_(chatId, msgId, p);
  }
  if (parts[1] === 'ok') { cache.remove('iv:' + p.id); return edit(chatId, msgId, applyTrade_(p)); }
}
function applyTrade_(p) {
  const sh = holdingsSheet_();
  const gross = p.qty * p.price;
  let h = findHolding_(p.ident);
  const today = Utilities.parseDate(fmt(new Date(), 'yyyy-MM-dd'), TZ, 'yyyy-MM-dd');
  if (!h) {
    const r = firstEmptyRow_(sh, 2, 101);
    const isTicker = /^[A-Z]{3,5}$/.test(p.ident);
    sh.getRange(r, 1, 1, 5).setValues([[p.ident, p.type || 'Other', isTicker ? p.ident : '', 0, 0]]);
    sh.getRange(r, 7).setValue(p.price);
    sh.getRange(r, 11, 1, 5).setValues([[today, 0, 'Telegram', 'Actual', p.type === 'US Stock' ? 'USD' : 'EGP']]);
    h = findHolding_(p.ident);
  }
  const before = { qty: h.qty, avg: h.avg };
  let newQty, newAvg, realized = 0;
  if (p.kind === 'buy') { newQty = h.qty + p.qty; newAvg = (h.qty * h.avg + gross + p.fee) / newQty; }
  else { newQty = h.qty - p.qty; newAvg = h.avg; realized = p.qty * (p.price - h.avg) - p.fee; }
  sh.getRange(h.row, 4, 1, 2).setValues([[newQty, Math.round(newAvg * 10000) / 10000]]);
  sh.getRange(h.row, 7).setValue(p.price);
  sh.getRange(h.row, 11).setValue(today);
  sh.getRange(h.row, 12).setValue(h.fees + p.fee);
  if (h.cur === 'EGP') setThndrCash_(Math.max(0, thndrCash_() + (p.kind === 'buy' ? -(gross + p.fee) : gross - p.fee)));
  const id = logInv_(p.kind === 'buy' ? 'Purchase' : 'Sale', h.name, h.ticker, p.qty, p.price, gross, p.fee, '',
    p.kind === 'sell' ? 'Realized gain: ' + Math.round(realized * 100) / 100 : '');
  audit(p.kind === 'buy' ? 'INV_BUY' : 'INV_SELL', id, before, { qty: newQty, avg: newAvg }, 'Telegram');
  return '✅ ' + (p.kind === 'buy' ? 'Bought ' : 'Sold ') + p.qty + ' ' + p.ident + '. Now holding ' + newQty +
    (p.kind === 'buy' ? ' (avg cost ' + Math.round(newAvg * 100) / 100 + ')' : ' · realized ' + (realized >= 0 ? '+' : '') + money_(realized) + ' EGP') +
    (h.cur === 'EGP' ? '\nThndr Cash: ' + money_(thndrCash_()) : '\n(USD holding: Thndr Cash not changed.)');
}

function dividendCmd_(chatId, arg) {
  const m = String(arg || '').trim().match(/^(.+?)\s+([\d.,]+)$/);
  const h = m && findHolding_(m[1]);
  if (!m || !h) return send(chatId, 'Use: /dividend COMI 350 (cash received inside Thndr). For dividends paid to your bank, just type "قبضت توزيعات 350".');
  const a = parseFloat(m[2].replace(/,/g, ''));
  setThndrCash_(thndrCash_() + a);
  logInv_('Dividend', h.name, h.ticker, null, null, a, 0, '', 'Kept in Thndr');
  send(chatId, '✅ Dividend ' + money_(a) + ' EGP from ' + (h.ticker || h.name) + ' added to Thndr Cash (' + money_(thndrCash_()) + ').');
}

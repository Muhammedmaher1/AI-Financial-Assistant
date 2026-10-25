const fs=require('fs'),vm=require('vm');
function cp_(d){const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});const o={};f.formatToParts(d).forEach(p=>o[p.type]=p.value);if(o.hour==='24')o.hour='00';return o;}
const Utilities={formatDate(d,tz,f){const p=cp_(d);return f.replace('yyyy',p.year).replace('yy',p.year.slice(2)).replace('MM',p.month).replace('dd',p.day).replace('HH',p.hour).replace('mm',p.minute).replace('ss',p.second);},
 parseDate(s){const [y,m,d]=s.split('-').map(Number);const g=new Date(Date.UTC(y,m-1,d));const p=cp_(g);return new Date(g.getTime()-(+p.hour)*3600000);}};
class Sheet{constructor(n,d){this.n=n;this.d=d||[];} getName(){return this.n;}
 getLastRow(){let l=0;this.d.forEach((r,i)=>{if(r&&r.some(x=>x!==''&&x!==undefined))l=i+1;});return l;}
 getLastColumn(){return Math.max(...this.d.map(r=>r?r.length:0),0);}
 getRange(r,c,nr,nc){const sh=this;nr=nr||1;nc=nc||1;return{getValues(){const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){const v=(sh.d[r-1+i]||[])[c-1+j];row.push(v===undefined?'':v);}o.push(row);}return o;},
  setValues(v){v.forEach((row,i)=>row.forEach((x,j)=>{while(sh.d.length<r+i)sh.d.push([]);sh.d[r-1+i][c-1+j]=x;}));return this;},setValue(x){return this.setValues([[x]]);},
  clearContent(){for(let i=0;i<nr;i++)for(let j=0;j<nc;j++){if(sh.d[r-1+i])sh.d[r-1+i][c-1+j]='';}return this;},setFontWeight(){return this;}};}
 appendRow(a){const l=this.getLastRow();while(this.d.length<l)this.d.push([]);this.d.splice(l,0,a.slice());} deleteRow(r){this.deleteCount=(this.deleteCount||0)+1;this.d.splice(r-1,1);}}
const HEAD=['Transaction_ID','Transaction_Date','Transaction_Time','Transaction_Type','Amount','Currency','Category','Subcategory','Description','Payment_Method','Account','Merchant','Recurring_Flag','Related_Transaction_ID','Source','Created_At','Updated_At','Notes'];
const sheets={Transactions:new Sheet('Transactions',[HEAD.slice()]),Settings:new Sheet('Settings',[['Setting','Value',''],['Confirmation_Mode','OFF','']]),Audit_Log:new Sheet('Audit_Log',[['a','b','c','d','e','f']])};
const SS={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet(n))};
const props={BOT_TOKEN:'x',OWNER_ID:'111'}; const cache={};
const tg=[]; global.AI_RESP=null; global.FILE_TEXT='';
const ctx={console,Utilities,SpreadsheetApp:{getActive:()=>SS},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v,deleteProperty:k=>delete props[k]})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]===undefined?null:cache[k],put:(k,v)=>cache[k]=v,remove:k=>delete cache[k],putAll:o=>Object.assign(cache,o),getAll:ks=>{const o={};ks.forEach(k=>{if(cache[k]!==undefined)o[k]=cache[k];});return o;},removeAll:ks=>ks.forEach(k=>delete cache[k])})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 UrlFetchApp:{fetch:(url,o)=>{
  if(url.includes('generativelanguage')){const r=global.AI_RESP||{code:500,body:'{}'};return{getResponseCode:()=>r.code,getContentText:()=>r.body};}
  if(url.includes('/file/bot'))return{getContentText:()=>global.FILE_TEXT,getResponseCode:()=>200};
  const m=url.split('/').pop();const p=JSON.parse(o.payload||'{}');tg.push({m,p});
  let res={ok:true,result:{message_id:5}}; if(m==='getFile')res.result={file_path:'docs/notes.txt'};
  return{getContentText:()=>JSON.stringify(res),getResponseCode:()=>200};}}};
vm.createContext(ctx);
vm.runInContext(['Code.gs','Phase3.gs','Phase4.gs','Phase5.gs','Phase6.gs','Phase7.gs','Import.gs'].map(f=>fs.readFileSync(require('path').join(__dirname,'../apps-script',f),'utf8')).join('\n')+
 ';this.api={leadingDate_,parseImport_,processUpdate,DEFAULT_RULES,norm};',ctx);
const api=ctx.api; const TODAY='2026-10-12';
let pass=0,total=0;const check=(n,c,x)=>{total++;if(c)pass++;console.log((c?'PASS ':'FAIL ')+n+(c||x===undefined?'':'  → '+x));};

// ---- date reader ----
const D=s=>{const r=api.leadingDate_(api.norm(s),TODAY);return r?r.date+(r.rest?' | '+r.rest:''):null;};
const cases=[['5/10','2026-10-05'],['15/10','2025-10-15'],['5/10/2026','2026-10-05'],['05-10-26','2026-10-05'],['2026-10-05','2026-10-05'],['٥/١٠','2026-10-05'],
 ['5 اكتوبر','2026-10-05'],['5 أكتوبر','2026-10-05'],['اكتوبر 5','2026-10-05'],['Oct 5','2026-10-05'],['5 October 2025','2025-10-05'],['5th Sep','2026-09-05'],
 ['السبت 4/10','2026-10-04'],['Sat, Oct 4','2026-10-04'],['يوم 3/10:','2026-10-03'],['5/10 350 بنزين','2026-10-05 | 350 بنزين'],['• 1/9 - lunch 150','2026-09-01 | lunch 150'],
 ['12.50 coffee',null],['350 بنزين',null],['31/2',null],['قهوة 5/10',null],['30 سبتمبر 2026','2026-09-30']];
cases.forEach(([i,o])=>check('date "'+i+'" → '+o,D(i)===o||(o&&D(i)&&D(i).startsWith(o)&&o.indexOf('|')<0&&D(i).indexOf('|')<0),D(i)));

// ---- whole-note parsing ----
const NOTE_A=`مصاريف أكتوبر
1/10
دفعت 350 بنزين و120 قهوة
600 مشتريات للبيت
2/10
اوبر 85
المجموع 1155
3/10
حاجات 300
قبضت المرتب 30000`;
let r=api.parseImport_(NOTE_A,api.DEFAULT_RULES,TODAY);
const sum=r.items.map(i=>[i.date,i.amount,i.type,i.category].join('/'));
check('header-style note: 6 entries with the right dates',JSON.stringify(sum)===JSON.stringify(['2026-10-01/350/Expense/Transportation','2026-10-01/120/Expense/Food and Drinks','2026-10-01/600/Expense/Household','2026-10-02/85/Expense/Transportation','2026-10-03/300/Expense/','2026-10-03/30000/Income/Salary'].map(x=>x.replace('/Expense/','/Expense/')).map((x,i)=>i===4?'2026-10-03/300/Expense/':x)),JSON.stringify(sum));
check('"المجموع" total line skipped, title line ignored (no amount), 3 date headers',r.skippedTotals.length===1&&r.noAmount.length===1&&r.dateHeaders===3);
check('unclear "حاجات 300" flagged as needing a category',r.items[4].missing.join()==='category');
check('original spelling kept in descriptions ("قهوة" not "قهوه")',r.items[1].description==='قهوة',r.items[1].description);
r=api.parseImport_('5/9 دفعت 200 صيدلية\n6/9 lunch 150\n7/9 جبت هدية 300',api.DEFAULT_RULES,TODAY);
check('inline-date note: dates and categories',r.items.map(i=>i.date+'/'+i.amount+'/'+i.category).join(',')==='2026-09-05/200/Health,2026-09-06/150/Food and Drinks,2026-09-07/300/Family and Gifts',r.items.map(i=>i.date+'/'+i.amount+'/'+i.category).join(','));
r=api.parseImport_('350 بنزين\n120 قهوة',api.DEFAULT_RULES,TODAY);
check('note without dates: entries kept with no date',r.items.length===2&&r.items.every(i=>i.date===null));

// ---- Telegram flow ----
let uid=1;
const say=(t,extra)=>api.processUpdate({update_id:uid++,message:Object.assign({chat:{id:111,type:'private'},from:{id:111},text:t},extra||{})});
const tap=d=>api.processUpdate({update_id:uid++,callback_query:{id:'q',from:{id:111},data:d,message:{chat:{id:111},message_id:5}}});
const msgs=()=>tg.filter(x=>x.m==='sendMessage'||x.m==='editMessageText'); const last=()=>msgs()[msgs().length-1].p;
const NOWK=Utilities.formatDate(new Date(),'','yyyy-MM-dd'), YDK=Utilities.formatDate(new Date(Date.now()-86400000),'','yyyy-MM-dd');
const btn=t=>(last().reply_markup.inline_keyboard||[]).flat().find(b=>b.text.includes(t));
const rows=()=>sheets.Transactions.d.slice(1).filter(x=>x&&x[0]);

// one manual entry already in the sheet for 1 Oct (120 coffee) → should be detected as duplicate
sheets.Transactions.d.push(['TX-OLD',Utilities.parseDate('2026-10-01'),'','Expense',120,'EGP','Food and Drinks','','قهوة','','','','No','','Manual',new Date(),'','']);
say('/import'); check('/import turns on import mode with Notes instructions',!!props.IMPORT_MODE&&last().text.includes('Select All'));
say(NOTE_A.split('\n').slice(0,5).join('\n')); check('first pasted chunk collected, not saved as a transaction',rows().length===1&&last().text.includes('5 lines so far'),last().text);
say(NOTE_A.split('\n').slice(5).join('\n')); check('second chunk appended (10 lines)',last().text.includes('10 lines so far'),last().text);
say('/done'); let t=last().text;
check('preview: 4 ready, 1 duplicate, 1 unclear, ignored title, skipped total, date range',t.includes('Ready to import: 4')&&t.includes('Already in your sheet, will be skipped: 1')&&t.includes('Not sure what these are (1)')&&t.includes('حاجات 300')&&t.includes('Skipped 1 total')&&t.includes('2026-10-01 → 2026-10-03'),t);
check('nothing saved before confirming',rows().length===1);
tap(btn('Import 4').callback_data);
check('Import → 4 new rows (duplicate and unclear skipped)',rows().length===5&&last().text.includes('Imported 4'),last().text);
const imp=rows().filter(x=>x[14]==='Import');
check('imported rows: dates, types, categories, Source=Import, note line kept',imp.map(x=>Utilities.formatDate(x[1],'','yyyy-MM-dd')+'/'+x[4]+'/'+x[6]).join(',')==='2026-10-01/350/Transportation,2026-10-01/600/Household,2026-10-02/85/Transportation,2026-10-03/30000/Salary'&&String(imp[0][17]).includes('دفعت 350 بنزين'),imp.map(x=>Utilities.formatDate(x[1],'','yyyy-MM-dd')+'/'+x[4]+'/'+x[6]).join(','));
check('import mode switched off afterwards',!props.IMPORT_MODE);
check('one IMPORT audit row (not one per transaction)',sheets.Audit_Log.d.filter(x=>x&&x[1]==='IMPORT').length===1);
tap('im|go'); check('second tap on Import cannot import twice',rows().length===5&&last().text.includes('expired or was already done'));
say('دفعت 50 قهوة'); check('after import, normal messages are transactions again',rows().length===6);
// same note again → everything recognised as already there
say('/import'); say(NOTE_A); say('/done'); t=last().text;
check('re-importing the same note: 5 already in sheet, 0 ready',t.includes('Already in your sheet, will be skipped: 5')&&t.includes('Ready to import: 0'),t);
tap('im|x'); check('cancel discards',!props.IMPORT_MODE&&last().text.includes('cancelled'));
// unclear as Other
say('/import'); say('4/10\nحاجات 300\nمش عارف 75'); say('/done');
tap(btn('unclear ones as Other').callback_data);
check('"Import all" saves unclear lines as Expense › Other, marked in notes',rows().slice(-2).every(x=>x[3]==='Expense'&&x[6]==='Other'&&String(x[17]).includes('unclear → Other')),JSON.stringify(rows().slice(-2).map(x=>x[6])));
// undated → choose date
say('/import'); say('ميكانيكي 400\nحلاق 80'); say('/done'); t=last().text;
check('undated entries: asks for a date with buttons',t.includes('No date found for 2')&&!!btn('Yesterday'),t);
tap(btn('Yesterday').callback_data); t=last().text;
check('after choosing Yesterday, 2 ready with assumed date',t.includes('Ready to import: 2')&&t.includes('use your chosen date '+YDK),t);
tap(btn('Import 2').callback_data);
check('saved with yesterday\'s date and [date assumed]',rows().slice(-2).every(x=>Utilities.formatDate(x[1],'','yyyy-MM-dd')===YDK&&String(x[17]).includes('date assumed')));
// /importdate
say('/import'); say('سينما 200'); say('/done'); say('/importdate 20/9');
check('/importdate 20/9 sets the date',last().text.includes('chosen date 2026-09-20'),last().text); tap('im|x');
// .txt file
global.FILE_TEXT='8/10\nبقالة 450\nكهربا 600\n';
say('/import'); say('',{document:{file_id:'F1',file_name:'notes.txt',mime_type:'text/plain',file_size:40}});
check('.txt file accepted',last().text.includes('3 lines so far'),last().text);
say('',{document:{file_id:'F2',file_name:'notes.pdf',mime_type:'application/pdf',file_size:4000}});
check('PDF politely refused',last().text.includes('.txt'));
say('/done'); tap(btn('Import 2').callback_data);
check('file import saved',rows().slice(-2).map(x=>x[6]).join()==='Household,Utilities');
// AI on unclear lines
props.GEMINI_API_KEY='k';
global.AI_RESP={code:200,body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({items:[{i:0,type:'Expense',category:'Household'},{i:1,type:'Expense',category:'Made Up'}]})}]}}]})};
say('/import'); say('9/10\nحاجات للمطبخ 220\nحاجة غريبة 90'); say('/done');
check('AI button offered for unclear lines',!!btn('Let AI sort'));
tap(btn('Let AI sort').callback_data); t=last().text;
check('AI sorted 1 (valid), left 1 unclear (invalid category rejected)',t.includes('Ready to import: 1')&&t.includes('Not sure what these are (1)'),t);
tap(btn('Import 1').callback_data);
check('AI-sorted row saved as Household, tagged [AI]',rows().at(-1)[6]==='Household'&&String(rows().at(-1)[17]).includes('[AI]'));
delete props.GEMINI_API_KEY;
// big import + undo (fast path)
let big='1/9\n'; for(let i=0;i<40;i++) big+=(100+i)+' قهوة\n';
say('/import'); say(big); say('/done'); tap(btn('Import 40').callback_data);
const before=rows().length;
say('/undo'); t=last().text;
check('/undo on a 40-row import lists only that import (10 + summary)',t.includes('…and 30 more (40 transactions')&&t.length<1500,t.length);
tap(btn('Delete').callback_data);
check('40 rows removed in one rewrite (no row-by-row deletes), others kept',rows().length===before-40&&!sheets.Transactions.deleteCount&&rows().some(x=>x[0]==='TX-OLD'));
check('40 DELETE audit rows written',sheets.Audit_Log.d.filter(x=>x&&x[1]==='DELETE').length>=40);
// transactions after the deleted block are intact (sheet order)
check('sheet has no gaps after bulk delete',sheets.Transactions.d.slice(1,rows().length+1).every(x=>x&&x[0]));
// commands still work while importing
say('/import'); say('/today'); check('commands still work in import mode',last().text.includes('Today')); say('/import cancel'); check('/import cancel',!props.IMPORT_MODE);
console.log(`\n${pass}/${total} passed`);


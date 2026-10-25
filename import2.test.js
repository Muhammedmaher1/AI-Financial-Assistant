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


let uid=1;
const say=(t,extra)=>api.processUpdate({update_id:uid++,message:Object.assign({chat:{id:111,type:'private'},from:{id:111},text:t},extra||{})});
const msgs=()=>tg.filter(x=>x.m==='sendMessage'||x.m==='editMessageText'); const last=()=>msgs()[msgs().length-1].p;
const tap=d=>api.processUpdate({update_id:uid++,callback_query:{id:'q',from:{id:111},data:d,message:{chat:{id:111},message_id:5}}});
const btn=t=>(last().reply_markup.inline_keyboard||[]).flat().find(b=>b.text.includes(t));
const rows=()=>sheets.Transactions.d.slice(1).filter(x=>x&&x[0]);
sheets.Category_Rules=new Sheet('Category_Rules',[['Keyword','Type','Category','Subcategory','Source','Added_At']].concat(api.DEFAULT_RULES.map(r=>r.concat(['Built-in','']))));
const NOTE=`Expenses
——————————————
25/8
Halan: 4500
Debit: 5750
Supermarket: 615
——————————————
26/8
Benzen: 900
Vape: 880
Home: 1500
Water: 15 gym
Carpets: 375
2ahwa: 45
Talabat: 320
Vodafone recharge: 200
Uber: 85
Pharmacy: 150
——————————————
27/8
Home: 1500
Debit: 2000
Spinneys 1,250
Car wash 150
7ala2 120`;
// parse check with the vocabulary the bot will really use (sheet rules + built-ins)
const r=api.parseImport_(NOTE,ctx.getRules(),'2026-10-12');
const cat=l=>{const it=r.items.find(i=>i.line===l);return it?it.amount+'/'+(it.category||'?'):'missing';};
const exp={'Supermarket: 615':'615/Household','Benzen: 900':'900/Transportation','Vape: 880':'880/Personal Care','Water: 15 gym':'15/Food and Drinks',
 'Carpets: 375':'375/Household','2ahwa: 45':'45/Food and Drinks','Talabat: 320':'320/Food and Drinks','Vodafone recharge: 200':'200/Utilities','Uber: 85':'85/Transportation',
 'Pharmacy: 150':'150/Health','Halan: 4500':'4500/Installments','Spinneys 1,250':'1250/Household','Car wash 150':'150/Transportation','7ala2 120':'120/Personal Care'};
Object.keys(exp).forEach(l=>check('"'+l+'" → '+exp[l],cat(l)===exp[l],cat(l)));
check('"2ahwa" is a word, not the amount 2 (one item of 45)',r.items.filter(i=>i.line==='2ahwa: 45').length===1);
check('only Home and Debit stay unclear (4 lines)',r.items.filter(i=>i.missing.length).map(i=>i.line).join('|')==='Debit: 5750|Home: 1500|Home: 1500|Debit: 2000',r.items.filter(i=>i.missing.length).map(i=>i.line).join('|'));
check('separators are not reported as ignored data',r.noAmount.join('|')==='Expenses'&&r.decor===3,JSON.stringify([r.noAmount,r.decor]));

// full flow with teaching
say('/import'); say(NOTE); say('/done'); let t=last().text;
check('preview: 14 ready, 4 unclear, "only 2 different words"',t.includes('Ready to import: 14')&&t.includes('Not sure what these are (4)')&&t.includes('only 2 different words'),t);
check('Teach button offered',!!btn('Teach me 2 words (fixes 4 lines)'));
tap(btn('Teach me').callback_data); t=last().text;
check('asks about one word at a time, with an example line',t.includes('Word 1 of 2')&&(t.includes('"Debit"')||t.includes('"Home"'))&&t.includes('Used in 2 lines'),t);
const firstWord=t.includes('"Debit"')?'Debit':'Home';
const answer={Debit:'Debt/loan payment',Home:'Family and Gifts'};
tap(btn(answer[firstWord]).callback_data); t=last().text;
const second=firstWord==='Debit'?'Home':'Debit';
check('moves on to the second word',t.includes('Word 2 of 2')&&t.includes('"'+second+'"'),t);
tap(btn(answer[second]).callback_data); t=last().text;
check('after teaching: all 18 ready, nothing unclear',t.includes('Ready to import: 18')&&!t.includes('Not sure'),t);
check('Debit now counted as Debt Payment (2 × = 7,750)',t.includes('Debt Payment: 2 (7,750 EGP)'),t);
check('answers saved permanently in Category_Rules',sheets.Category_Rules.d.some(x=>x[0]==='home'&&x[2]==='Family and Gifts'&&x[4]==='Learned')&&sheets.Category_Rules.d.some(x=>x[0]==='debit'&&x[1]==='Debt Payment'));
tap(btn('Import 18').callback_data);
check('18 rows imported with correct dates',rows().length===18&&rows().filter(x=>Utilities.formatDate(x[1],'','yyyy-MM-dd')==='2026-08-26').length===10,rows().length);
// learned words help everyday messages too
say('Home 1000'); check('normal message "Home 1000" now goes to Family and Gifts automatically',rows().at(-1)[6]==='Family and Gifts',rows().at(-1)[6]);
say('vape 300'); check('normal message "vape 300" → Personal Care',rows().at(-1)[6]==='Personal Care');
console.log(`\n${pass}/${total} passed`);

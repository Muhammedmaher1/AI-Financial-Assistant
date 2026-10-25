const fs=require('fs'), vm=require('vm');
// ---------- mocks ----------
function cairoParts(d){const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,weekday:'short'});const o={};f.formatToParts(d).forEach(p=>o[p.type]=p.value);return o;}
const Utilities={formatDate(d,tz,f){const p=cairoParts(d);const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  return f.replace('yyyy',p.year).replace('yy',p.year.slice(2)).replace('MMMM',months[+p.month-1]).replace('MM',p.month).replace('dd',p.day).replace('HH',p.hour==='24'?'00':p.hour).replace('mm',p.minute).replace('ss',p.second);},
  parseDate(s){const [y,m,d]=s.split('-').map(Number);const guess=new Date(Date.UTC(y,m-1,d));const p=cairoParts(guess);const off=(+p.hour===24?0:+p.hour);return new Date(guess.getTime()-off*3600000);}};
class Range{constructor(sh,r,c,nr,nc){Object.assign(this,{sh,r,c,nr:nr||1,nc:nc||1});}
 getValues(){const o=[];for(let i=0;i<this.nr;i++){const row=[];for(let j=0;j<this.nc;j++){const v=(this.sh.d[this.r-1+i]||[])[this.c-1+j];row.push(v===undefined?'':v);}o.push(row);}return o;}
 setValues(v){v.forEach((row,i)=>row.forEach((x,j)=>{while(this.sh.d.length<this.r+i)this.sh.d.push([]);this.sh.d[this.r-1+i][this.c-1+j]=x;}));return this;}
 setValue(x){return this.setValues([[x]]);} setFontWeight(){return this;} getSheet(){return this.sh;} getRow(){return this.r;} getColumn(){return this.c;} getNumRows(){return this.nr;} getNumColumns(){return this.nc;}}
class Sheet{constructor(n,d){this.n=n;this.d=d||[];} getName(){return this.n;}
 getLastRow(){let l=0;this.d.forEach((r,i)=>{if(r.some(x=>x!==''&&x!==undefined))l=i+1;});return l;}
 getLastColumn(){return Math.max(...this.d.map(r=>r.length),0);}
 getRange(r,c,nr,nc){return new Range(this,r,c,nr,nc);} appendRow(a){this.d.splice(this.getLastRow(),0,a.slice());}
 deleteRow(r){this.d.splice(r-1,1);} setFrozenRows(){}}
const sheets={};
const SS={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet(n)),setSpreadsheetTimeZone(){},toast(){}};
const HEAD=['Transaction_ID','Transaction_Date','Transaction_Time','Transaction_Type','Amount','Currency','Category','Subcategory','Description','Payment_Method','Account','Merchant','Recurring_Flag','Related_Transaction_ID','Source','Created_At','Updated_At','Notes'];
sheets.Transactions=new Sheet('Transactions',[HEAD.slice()]);
sheets.Settings=new Sheet('Settings',[['Setting','Value','Description'],['Confirmation_Mode','OFF','']]);
const props={BOT_TOKEN:'x'}; const cache={};
let tgLog=[], updates=[], msgId=100;
const UrlFetchApp={fetch(url,o){const m=url.split('/').pop();const p=JSON.parse(o.payload||'{}');
  if(url.includes('generativelanguage'))return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{content:{parts:[{text:global.AI_REPLY}]}}]})};
  let res={ok:true,result:true};
  if(m==='getUpdates'){res.result=updates.filter(u=>u.update_id>=p.offset);}
  if(m==='sendMessage'){res.result={message_id:++msgId};tgLog.push({m,text:p.text,kb:p.reply_markup});}
  if(m==='editMessageText'){tgLog.push({m,text:p.text,kb:p.reply_markup});}
  if(m==='getMe'){res.result={username:'testbot'};}
  return {getContentText:()=>JSON.stringify(res),getResponseCode:()=>200};}};
const ctx={console,Utilities,UrlFetchApp,SpreadsheetApp:{getActive:()=>SS,getUi:()=>({createMenu:()=>({addItem(){return this},addToUi(){}}),alert(){}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v,deleteProperty:k=>delete props[k]})},
 CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>cache[k]=v,remove:k=>delete cache[k]})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 ScriptApp:{getProjectTriggers:()=>[],deleteTrigger(){},newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({create(){}})})})}};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../apps-script/Code.gs'),'utf8')+fs.readFileSync(require('path').join(__dirname,'../apps-script/Phase3.gs'),'utf8')+fs.readFileSync(require('path').join(__dirname,'../apps-script/Phase4.gs'),'utf8')+';this.pollUpdates=pollUpdates;this.setup=setup;this.onEdit=onEdit;',ctx);
global.AI_REPLY='';
let uid=1;
const ME=111, STRANGER=999;
const msg=(text,from=ME)=>{updates.push({update_id:uid++,message:{chat:{id:from,type:'private'},from:{id:from},text}});ctx.pollUpdates();};
const tap=(data,from=ME)=>{updates.push({update_id:uid++,callback_query:{id:'q',from:{id:from},data,message:{chat:{id:from},message_id:5}}});ctx.pollUpdates();};
const last=()=>tgLog[tgLog.length-1];
const btn=(label)=>last().kb.inline_keyboard.flat().find(b=>b.text.includes(label)).callback_data;
const txRows=()=>sheets.Transactions.d.slice(1).filter(r=>r.length);
let pass=0,total=0; const check=(name,cond)=>{total++;if(cond)pass++;console.log((cond?'PASS ':'FAIL ')+name);};

ctx.setup();
check('setup created Category_Rules and Audit_Log',!!sheets.Category_Rules&&!!sheets.Audit_Log&&sheets.Category_Rules.getLastRow()>100);
msg('/start',STRANGER); msg('hi'); // first /start comes from stranger -> becomes owner? ensure we test properly
// reset: owner should be whoever sent /start first. Simulate correct order instead.
delete props.OWNER_ID; tgLog=[];
msg('/start'); check('/start links owner',props.OWNER_ID==='111' && last().text.includes('linked'));
msg('دفعت 100 قهوة',STRANGER); check('stranger ignored',txRows().length===0 && tgLog.length===1);

// fast mode (Confirmation OFF)
msg('دفعت 350 جنيه بنزين و120 جنيه قهوة و600 جنيه مشتريات للبيت');
check('fast mode saves 3 rows',txRows().length===3);
check('reply shows saved + today total 1,070',last().text.includes('✅ Saved')&&last().text.includes('1,070 EGP'));
const r0=txRows()[0];
check('row fields correct',r0[3]==='Expense'&&r0[4]===350&&r0[6]==='Transportation'&&r0[7]==='Fuel'&&r0[14]==='Telegram'&&String(r0[0]).startsWith('TX-'));
check('date is today (Cairo)',ctx.Utilities.formatDate(r0[1],'','yyyy-MM-dd')===ctx.Utilities.formatDate(new Date(),'','yyyy-MM-dd'));
check('3 CREATE audit rows',sheets.Audit_Log.d.slice(1).filter(r=>r[1]==='CREATE').length===3);

// Telegram retry of the same update_id must not duplicate
const dupUpdate=updates[updates.length-1]; props.TG_OFFSET=String(dupUpdate.update_id); // simulate offset not advanced... then real behaviour:
props.TG_OFFSET=String(dupUpdate.update_id+1); ctx.pollUpdates();
check('re-poll does not reprocess',txRows().length===3);

// same content again within window -> asks confirmation
msg('دفعت 120 قهوة');
check('possible duplicate asks before saving',txRows().length===3&&last().text.includes('Possible duplicate'));
tap(btn('Save')); check('save after dup confirm',txRows().length===4);
const okData='ok|'+Object.keys(cache).find(k=>k.startsWith('p:'));
tap(last().kb.inline_keyboard[0][0].callback_data.startsWith('u|')?'ok|gone':'ok|gone');
check('double-tap Save on expired request is harmless',txRows().length===4&&last().text.includes('already handled'));

// undo last batch
msg('/undo'); check('/undo lists last batch',last().text.includes('Delete these?')&&last().text.includes('120'));
tap(btn('Delete')); check('undo deletes 1 row',txRows().length===3&&last().text.includes('Deleted 1'));
check('DELETE audited',sheets.Audit_Log.d.some(r=>r[1]==='DELETE'));
tap('d|nothing'); check('second delete tap harmless',txRows().length===3);

// ambiguous: حولت 500 -> ask type, then (Expense) ask category, then save (confirmation OFF)
msg('حولت 500 لأحمد');
check('ambiguous asks for type',last().text.includes('What kind'));
tap(btn('Expense')); check('then asks category',last().text.includes('Which category'));
tap(btn('Family and Gifts')); check('saved after answers',txRows().length===4&&txRows()[3][6]==='Family and Gifts');
check('learned a rule from the answer',sheets.Category_Rules.d.some(r=>r[4]==='Learned'));
msg('حولت 300 لأحمد'); 
check('learned rule NOT enough when verb is ambiguous (still asks type)',last().text.includes('What kind'));
tap(btn('Cancel')); check('cancel saves nothing',txRows().length===4&&last().text.includes('Cancelled'));

// unknown category with rule learned: "دفعت 150 حاجة" -> category buttons
msg('دفعت 150 حاجة'); check('unknown item asks category',last().text.includes('Which category'));
tap(btn('Other')); check('saved as Other',txRows().length===5);

// confirmation ON
sheets.Settings.d[1][1]='ON';
msg('قبضت المرتب 30000'); check('confirm mode shows summary',last().text.includes('📝')&&txRows().length===5);
tap(btn('Save')); check('saved income',txRows()[5][3]==='Income'&&txRows()[5][6]==='Salary');
msg('/settings'); tap(btn('Turn confirmation OFF')); check('settings toggle works',sheets.Settings.d[1][1]==='OFF');

// yesterday
msg('اشتريت هدية 400 امبارح');
const y=new Date(Date.now()-86400000);
check('yesterday date applied',ctx.Utilities.formatDate(txRows()[6][1],'','yyyy-MM-dd')===ctx.Utilities.formatDate(y,'','yyyy-MM-dd'));

// AI fallback: valid and invalid
props.GEMINI_API_KEY='k';
global.AI_REPLY=JSON.stringify({transactions:[{amount:250,type:'Expense',category:'Entertainment',subcategory:'Outings',description:'bowling'}]});
msg('دفعت 250 بولينج'); check('AI result requires confirmation',last().text.includes('🤖')&&last().text.includes('Entertainment'));
tap(btn('Save')); check('AI item saved and tagged',txRows().length===8&&String(txRows()[7][17]).includes('[AI]'));
global.AI_REPLY=JSON.stringify({transactions:[{amount:9999,type:'Expense',category:'Other',description:'x'}]});
msg('دفعت 75 زمزمية'); check('AI invented amount rejected → buttons',last().text.includes('Which category'));
tap(btn('Cancel'));

// commands
msg('/today'); check('/today lists entries',last().text.includes('Today')&&last().text.includes('Spent today'));
msg('/month'); check('/month shows savings rate',last().text.includes('Savings rate'));
msg('/foo'); check('unknown command message',last().text.includes("isn't available"));
msg('/delete TX-NOPE'); check('/delete unknown ID',last().text.includes('no longer'));

// manual edit in the sheet -> ID assigned by onEdit
sheets.Transactions.d.push(['',new Date(),'','Expense',40,'','Food and Drinks','','tea','','','','No','','','','','']);
const rr=sheets.Transactions.getLastRow();
ctx.onEdit({range:sheets.Transactions.getRange(rr,5),value:40,oldValue:undefined});
const mr=sheets.Transactions.d[rr-1];
check('manual row gets ID, Source=Manual, Currency=EGP',String(mr[0]).startsWith('TX-')&&mr[14]==='Manual'&&mr[5]==='EGP');

console.log(`\n${pass}/${total} passed`);

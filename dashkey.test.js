const fs=require('fs'),vm=require('vm');
const props={BOT_TOKEN:'x',OWNER_ID:'111'}; const sent=[];
let served=null;
const HtmlService={createHtmlOutput:h=>{served={html:h,kind:'plain'};const o={setTitle:()=>o,addMetaTag:()=>o,setFaviconUrl:()=>o};return o;},
 createTemplateFromFile:f=>{const t={evaluate:()=>{served={kind:'template',file:f,key:t.key};const o={setTitle:()=>o,addMetaTag:()=>o,setFaviconUrl:()=>o};return o;}};return t;}};
const ctx={console,HtmlService,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})},
 UrlFetchApp:{fetch:(u,o)=>{sent.push(JSON.parse(o.payload));return{getContentText:()=>'{"ok":true}',getResponseCode:()=>200};}},
 SpreadsheetApp:{getActive:()=>{if(global.SHEET_FAIL)throw new Error('SHEET_READ');return{getSheetByName:()=>({getLastRow:()=>2,getRange:()=>({getValues:()=>[['Dashboard_URL','https://script.google.com/macros/s/ABC/exec','']]})})};}},
 ScriptApp:{getService:()=>({getUrl:()=>'https://script.google.com/macros/s/ABC/exec'})}};
vm.createContext(ctx);
vm.runInContext(['Code.gs','Phase3.gs','Phase4.gs','Phase5.gs','Phase6.gs'].map(f=>fs.readFileSync(require('path').join(__dirname,'../apps-script',f),'utf8')).join('\n')+
 ';getSettings=function(){return {Dashboard_URL:"https://script.google.com/macros/s/ABC/exec"}};this.api={doGet,getDashboardData,handleCommand6};',ctx);
let pass=0,total=0;const check=(n,c,x)=>{total++;if(c)pass++;console.log((c?'PASS ':'FAIL ')+n+(c||x===undefined?'':' → '+x));};
ctx.api.handleCommand6(111,'/dashboard','');
const link=sent[0].text.match(/https:\S+/)[0]; const key=link.split('k=')[1];
check('/dashboard sends link with a 40-char key',/\?k=[a-z0-9]{40}$/.test(link),link);
ctx.api.doGet({parameter:{}}); check('no key → "not valid" page, dashboard not served',served.kind==='plain'&&served.html.includes('not valid'));
ctx.api.doGet({parameter:{k:'wrong'}}); check('wrong key → "not valid" page',served.kind==='plain');
ctx.api.doGet({parameter:{k:key}}); check('right key → Dashboard served with key',served.kind==='template'&&served.file==='Dashboard'&&served.key===key);
let err=''; try{ctx.api.getDashboardData('wrong');}catch(e){err=e.message;} check('data call with wrong key refused',err.includes('not valid'),err);
err=''; global.SHEET_FAIL=true; try{ctx.api.getDashboardData(key);}catch(e){err=e.message;} check('data call with right key passes the check (reaches the sheet)',err==='SHEET_READ',err);
global.SHEET_FAIL=false; ctx.api.handleCommand6(111,'/dashboard','');
check('same key on repeat /dashboard',sent[1].text.includes(key));
ctx.api.handleCommand6(111,'/dashboard','new'); const key2=sent[2].text.match(/k=([a-z0-9]+)/)[1];
check('/dashboard new → different key + warning',key2!==key&&sent[2].text.includes('old link no longer works'));
ctx.api.doGet({parameter:{k:key}}); check('old key stops working after /dashboard new',served.kind==='plain');
ctx.api.doGet({parameter:{k:key2}}); check('new key works',served.kind==='template');
console.log(`\n${pass}/${total} passed`);

const fs=require('fs'),vm=require('vm');
function cp_(d){const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});const o={};f.formatToParts(d).forEach(p=>o[p.type]=p.value);if(o.hour==='24')o.hour='00';return o;}
const Utilities={formatDate(d,tz,f){const p=cp_(d);return f.replace('yyyy',p.year).replace('yy',p.year.slice(2)).replace('MM',p.month).replace('dd',p.day).replace('HH',p.hour).replace('mm',p.minute).replace('ss',p.second);},
 parseDate(s){const [y,m,d]=s.split('-').map(Number);const g=new Date(Date.UTC(y,m-1,d));const p=cp_(g);return new Date(g.getTime()-(+p.hour)*3600000);}};
const HEAD=['Transaction_ID','Transaction_Date','Transaction_Time','Transaction_Type','Amount','Currency','Category','Subcategory','Description','Payment_Method','Account','Merchant','Recurring_Flag','Related_Transaction_ID','Source','Created_At','Updated_At','Notes'];
const T=[HEAD];
let id=0; const add=(d,t,a,c,desc,cur)=>{const r=new Array(18).fill('');r[0]='TX'+(++id);r[1]=Utilities.parseDate(d);r[3]=t;r[4]=a;r[5]=cur||'EGP';r[6]=c;r[8]=desc;T.push(r);};
const day=(k,n)=>{const d=new Date(k+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
for(let k='2026-07-01';k<='2026-10-12';k=day(k,1)){ add(k,'Expense',50,'Food and Drinks','coffee'); }
['2026-07-01','2026-08-01','2026-09-01','2026-10-01'].forEach(k=>add(k,'Expense',8000,'Housing','rent'));
add('2026-10-05','Expense',900,'Shopping','shoes'); add('2026-10-06','Refund',300,'Shopping','shoes refund');
add('2026-10-07','Expense',100,'Food and Drinks','usd thing','USD'); add('2026-10-02','Income',5000,'Additional Income','bonus');
add('2026-10-03','Investment Contribution',3000,'Investments','thndr');
const sheet={getLastRow:()=>T.length,getLastColumn:()=>18,getRange:(r,c,nr,nc)=>({getValues:()=>T.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc))})};
const props={DASH_KEY:'K'.repeat(40)};
const ctx={console,Utilities,SpreadsheetApp:{getActive:()=>({getSheetByName:n=>n==='Transactions'?sheet:null})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null})}};
vm.createContext(ctx);
vm.runInContext(['Code.gs','Phase3.gs','Phase6.gs'].map(f=>fs.readFileSync(require('path').join(__dirname,f),'utf8')).join('\n')+';this.gs=getSpending;',ctx);
const K=props.DASH_KEY; const G=(a,b)=>JSON.parse(ctx.gs(K,a,b));
let pass=0,total=0;const check=(n,c,x)=>{total++;if(c)pass++;console.log((c?'PASS ':'FAIL ')+n+(c||x===undefined?'':'  → '+x));};
let X=G('2026-10-01','2026-10-12');
check('1–12 Oct: spent = 12×50 coffee + 8000 rent + 900 shoes − 300 refund = 9,200',X.total===9200,X.total);
check('USD expense excluded and reported',X.skipped===1);
check('income in period 5,000; investment contribution not counted as spending',X.income===5000&&!X.cats.some(c=>c.cat==='Investments'));
check('count 14 expenses, refunds 300, daily average 766.67',X.count===14&&X.refunds===300&&Math.abs(X.dailyAvg-9200/12)<0.01,X.count+' '+X.refunds);
check('previous 12 days = 19–30 Sep: 12×50 = 600, change +1433%',X.prevFrom==='2026-09-19'&&X.prevTo==='2026-09-30'&&X.prevTotal===600&&Math.abs(X.change-(9200/600-1))<1e-9,X.prevFrom+' '+X.prevTotal);
check('categories sorted: Housing 8000 (87%), Food 600, Shopping 600 net',X.cats[0].cat==='Housing'&&X.cats[0].amount===8000&&Math.round(X.cats[0].share*100)===87&&X.cats.find(c=>c.cat==='Shopping').amount===600);
check('daily chart: 12 buckets, 1 Oct = 8050',X.gran==='day'&&X.buckets.length===12&&X.buckets[0].amount===8050);
check('bucket sum = total',X.buckets.reduce((a,b)=>a+b.amount,0)===X.total);
check('largest expense first = rent',X.largest[0].a===8000&&X.largest.length<=8);
X=G('2026-07-01','2026-10-12');
check('104 days → 15 weekly bars, sums match',X.gran==='week'&&X.buckets.length===15&&X.buckets.reduce((a,b)=>a+b.amount,0)===X.total,X.gran+' '+X.buckets.length);
X=G('2026-01-01','2026-10-12');
check('This year → 10 monthly bars; August = 8000 rent + 31×50',X.gran==='month'&&X.buckets.length===10&&X.buckets[7].amount===8000+31*50&&X.buckets.reduce((a,b)=>a+b.amount,0)===X.total,X.gran+' '+X.buckets.length);
X=G('2026-08-15','2026-10-12');
check('59 days → weekly buckets that cover the range exactly',X.gran==='week'&&X.buckets[0].from==='2026-08-15'&&X.buckets.at(-1).to==='2026-10-12'&&X.buckets.reduce((a,b)=>a+b.amount,0)===X.total);
X=G('2026-10-12','2026-10-12'); check('single day works',X.days===1&&X.total===50);
X=G('2025-01-01','2025-01-31'); check('empty period → zeros, no comparison',X.total===0&&X.count===0&&X.change===null);
let e=''; try{ctx.gs(K,'2026-10-12','2026-10-01');}catch(x){e=x.message;} check('from after to → clear error',e.includes('valid date range'));
e=''; try{ctx.gs(K,'2020-01-01','2026-10-12');}catch(x){e=x.message;} check('over 3 years → refused',e.includes('3 years'));
e=''; try{ctx.gs('wrong','2026-10-01','2026-10-12');}catch(x){e=x.message;} check('wrong key → refused',e.includes('not valid'));
// save responses for the browser test
const R={}; [['2026-10-01','2026-10-12'],['2026-09-01','2026-09-30'],['2026-09-13','2026-10-12'],['2026-07-15','2026-10-12'],['2026-01-01','2026-10-12'],['2026-08-01','2026-08-31']].forEach(([a,b])=>R[a+'|'+b]=ctx.gs(K,a,b));

console.log(`\n${pass}/${total} passed`);

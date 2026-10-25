const fs=require('fs'), vm=require('vm');
const ctx={console}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'Code.gs'),'utf8')+';this.parseMessage=parseMessage;this.DEFAULT_RULES=DEFAULT_RULES;',ctx);
const P=t=>ctx.parseMessage(t,ctx.DEFAULT_RULES);
const cases=[
 ['دفعت 350 جنيه بنزين و120 جنيه قهوة و600 جنيه مشتريات للبيت',[[350,'Expense','Transportation','Fuel'],[120,'Expense','Food and Drinks','Coffee'],[600,'Expense','Household','Groceries']]],
 ['قبضت المرتب 30000',[[30000,'Income','Salary']]],
 ['حطيت فلوس في الاستثمار 3000',[[3000,'Investment Contribution','Investments']]],
 ['سحبت فلوس 2000',[[2000,'Internal Transfer','Transfers']]],
 ['دفعت قسط 3500',[[3500,'Expense','Installments']]],
 ['دفعت فاتورة الكهربا 450',[[450,'Expense','Utilities','Electricity']]],
 ['حولت 500',[[500,null,null]]],
 ['paid 200 for uber and 85 coffee',[[200,'Expense','Transportation'],[85,'Expense','Food and Drinks']]],
 ['بنزين 350 قهوة 120',[[350,'Expense','Transportation'],[120,'Expense','Food and Drinks']]],
 ['دفعت ٢ ألف إيجار',[[2000,'Expense','Housing','Rent']]],
 ['1.5k groceries',[[1500,'Expense','Household']]],
 ['رجعلي 300 من محل اللبس',[[300,'Refund','Shopping','Clothing']]],
 ['اشتريت هدية 400 امبارح',[[400,'Expense','Family and Gifts']]],
 ['سددت 1000 للقرض',[[1000,'Debt Payment','Debt']]],
 ['سحبت 5000 من ثاندر',[[5000,'Investment Withdrawal','Investments']]],
 ['دفعت 150 حاجة',[[150,'Expense',null]]],
 ['1,500 electricity',[[1500,'Expense','Utilities']]],
 ['حطيت 2000 في التوفير',[[2000,'Savings Transfer','Savings']]],
 ['دفعت 2 الف و500 ايجار',[[2500,'Expense','Housing']]],
 ['اوبر ٨٥',[[85,'Expense','Transportation']]],
 ['حولت 3000 لثاندر',[[3000,'Investment Contribution','Investments']]],
 ['دفعت 200 صيدلية و50 حلاق و1000 ايجار',[[200,'Expense','Health'],[50,'Expense','Personal Care'],[1000,'Expense','Housing']]],
 ['bought shoes 1200 with visa',[[1200,'Expense','Shopping']]],
 ['دفعت 300 دولار فندق',[[300,'Expense','Entertainment']]],
 ['قبضت بونص 5000',[[5000,'Income','Additional Income']]],
 ['دفعت 90 قهوة\n200 بنزين',[[90,'Expense','Food and Drinks'],[200,'Expense','Transportation']]],
];
let pass=0;
for(const [t,exp] of cases){
  const r=P(t); const got=r.items.map(i=>[i.amount,i.type,i.category,i.subcategory]);
  let ok=got.length===exp.length && exp.every((e,k)=>e.every((v,j)=>v===undefined||got[k][j]===v));
  if(ok)pass++;
  console.log((ok?'PASS':'FAIL'),JSON.stringify(t),'→',got.map((g,k)=>g.slice(0,3).join('/')+' "'+r.items[k].description+'"'+(r.items[k].missing.length?' missing:'+r.items[k].missing:'')).join(' | '),r.dateOffset?('date'+r.dateOffset):'',r.payment||'',r.currency!=='EGP'?r.currency:'');
}
console.log(pass+'/'+cases.length+' passed');

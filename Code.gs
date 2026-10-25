/**
 * AI Personal Finance Assistant — Phase 2: Telegram bot
 * ------------------------------------------------------
 * Paste this whole file into Extensions > Apps Script (bound to your finance Google Sheet).
 * One-time setup:
 *   1. Project Settings > Script Properties: add BOT_TOKEN (from @BotFather).
 *      Optional: GEMINI_API_KEY (from Google AI Studio). Leave it out to run rules-only.
 *   2. Run the function `setup` once and approve the permissions.
 *   3. Open your bot in Telegram and send /start. The first person to do so becomes the only allowed user.
 *
 * Design notes
 *   - Polling (a 1-minute trigger calling getUpdates) is used instead of a webhook, because Apps Script
 *     web apps answer Telegram with a 302 redirect, which makes Telegram retry and duplicate messages.
 *   - Duplicate protection: the Telegram offset is advanced BEFORE each update is processed (each update
 *     is handled at most once), pending confirmations are single-use, and near-identical entries saved
 *     within Duplicate_Window_Minutes require an explicit confirmation.
 *   - AI (Gemini) is only a fallback when the built-in rules can't resolve a message. AI-proposed amounts
 *     must appear in your message, and AI results always need your confirmation.
 */

// =====================================================================================
// CONSTANTS
// =====================================================================================
const TZ = 'Africa/Cairo';
const SH = { TX: 'Transactions', SETTINGS: 'Settings', RULES: 'Category_Rules', AUDIT: 'Audit_Log' };
const TX_HEADERS = ['Transaction_ID', 'Transaction_Date', 'Transaction_Time', 'Transaction_Type', 'Amount', 'Currency',
  'Category', 'Subcategory', 'Description', 'Payment_Method', 'Account', 'Merchant', 'Recurring_Flag',
  'Related_Transaction_ID', 'Source', 'Created_At', 'Updated_At', 'Notes'];
const TYPES = ['Income', 'Expense', 'Refund', 'Debt Payment', 'Savings Transfer', 'Investment Contribution',
  'Investment Withdrawal', 'Investment Return', 'Internal Transfer'];
const EXPENSE_CATEGORIES = ['Housing', 'Utilities', 'Transportation', 'Food and Drinks', 'Household', 'Health',
  'Personal Care', 'Shopping', 'Entertainment', 'Education', 'Family and Gifts', 'Charity', 'Installments',
  'Fees and Charges', 'Other'];
const INCOME_CATEGORIES = ['Salary', 'Additional Income'];
const TYPE_DEFAULT_CATEGORY = {
  'Income': ['Additional Income', 'Other Income'],
  'Savings Transfer': ['Savings', 'Savings Account'],
  'Investment Contribution': ['Investments', 'Thndr'],
  'Investment Withdrawal': ['Investments', 'Thndr'],
  'Investment Return': ['Investments', 'Thndr'],
  'Internal Transfer': ['Transfers', 'Between Own Accounts'],
  'Debt Payment': ['Debt', 'Loan'],
};
const DEFAULT_GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];

// Ordered: the first type whose phrase appears wins. More specific phrases come first.
const TYPE_PHRASES = [
  ['Investment Withdrawal', ['سحبت من ثاندر', 'سحبت من الاستثمار', 'withdrew from thndr', 'withdraw from thndr']],
  ['Investment Return', ['توزيعات', 'كوبون', 'ارباح الاستثمار', 'dividend', 'dividends']],
  ['Investment Contribution', ['في الاستثمار', 'للاستثمار', 'استثمار', 'ثاندر', 'thndr', 'invest', 'invested']],
  ['Savings Transfer', ['توفير', 'ادخار', 'التحويش', 'savings', 'saved']],
  ['Refund', ['رجعلي', 'رجعولي', 'استرجعت', 'استرداد', 'مرتجع', 'refund', 'refunded', 'returned']],
  ['Income', ['قبضت', 'مرتب', 'راتب', 'بونص', 'حافز', 'salary', 'received', 'got paid', 'bonus']],
  ['Debt Payment', ['سددت', 'سداد', 'قرض', 'loan', 'repaid', 'credit card payment']],
  ['Internal Transfer', ['سحبت فلوس', 'سحبت', 'atm', 'ماكينه', 'مكنه', 'withdrew cash', 'cash withdrawal']],
  ['Expense', ['دفعت', 'اشتريت', 'صرفت', 'جبت', 'فاتوره', 'قسط', 'paid', 'bought', 'spent', 'pay']],
];
const AMBIGUOUS_PHRASES = ['حولت', 'transferred', 'transfer', 'sent'];

// Keyword, Type ('' = decided by the verb), Category, Subcategory. Seeded into the Category_Rules tab.
const DEFAULT_RULES = [
  ['بنزين', '', 'Transportation', 'Fuel'], ['بنزينه', '', 'Transportation', 'Fuel'], ['سولار', '', 'Transportation', 'Fuel'],
  ['fuel', '', 'Transportation', 'Fuel'], ['petrol', '', 'Transportation', 'Fuel'], ['gasoline', '', 'Transportation', 'Fuel'],
  ['اوبر', '', 'Transportation', 'Ride-hailing'], ['uber', '', 'Transportation', 'Ride-hailing'], ['كريم', '', 'Transportation', 'Ride-hailing'],
  ['careem', '', 'Transportation', 'Ride-hailing'], ['ديدي', '', 'Transportation', 'Ride-hailing'], ['didi', '', 'Transportation', 'Ride-hailing'],
  ['اندرايفر', '', 'Transportation', 'Ride-hailing'], ['indrive', '', 'Transportation', 'Ride-hailing'], ['تاكسي', '', 'Transportation', 'Ride-hailing'],
  ['taxi', '', 'Transportation', 'Ride-hailing'], ['مترو', '', 'Transportation', 'Public Transport'], ['metro', '', 'Transportation', 'Public Transport'],
  ['ميكروباص', '', 'Transportation', 'Public Transport'], ['اتوبيس', '', 'Transportation', 'Public Transport'], ['bus', '', 'Transportation', 'Public Transport'],
  ['ميكانيكي', '', 'Transportation', 'Car Maintenance'], ['صيانه العربيه', '', 'Transportation', 'Car Maintenance'], ['غيار زيت', '', 'Transportation', 'Car Maintenance'],
  ['car service', '', 'Transportation', 'Car Maintenance'], ['جراج', '', 'Transportation', 'Parking'], ['ركنه', '', 'Transportation', 'Parking'], ['parking', '', 'Transportation', 'Parking'],
  ['قهوه', '', 'Food and Drinks', 'Coffee'], ['كافيه', '', 'Food and Drinks', 'Coffee'], ['ستاربكس', '', 'Food and Drinks', 'Coffee'],
  ['coffee', '', 'Food and Drinks', 'Coffee'], ['starbucks', '', 'Food and Drinks', 'Coffee'],
  ['مطعم', '', 'Food and Drinks', 'Restaurants'], ['غدا برا', '', 'Food and Drinks', 'Restaurants'], ['عشا برا', '', 'Food and Drinks', 'Restaurants'],
  ['restaurant', '', 'Food and Drinks', 'Restaurants'], ['lunch', '', 'Food and Drinks', 'Restaurants'], ['dinner', '', 'Food and Drinks', 'Restaurants'],
  ['طلبات', '', 'Food and Drinks', 'Delivery'], ['talabat', '', 'Food and Drinks', 'Delivery'], ['دليفري', '', 'Food and Drinks', 'Delivery'],
  ['delivery', '', 'Food and Drinks', 'Delivery'], ['اوردر', '', 'Food and Drinks', 'Delivery'], ['سناكس', '', 'Food and Drinks', 'Snacks'], ['snacks', '', 'Food and Drinks', 'Snacks'],
  ['مشتريات للبيت', '', 'Household', 'Groceries'], ['مشتريات البيت', '', 'Household', 'Groceries'], ['حاجات البيت', '', 'Household', 'Groceries'],
  ['طلبات البيت', '', 'Household', 'Groceries'], ['بقاله', '', 'Household', 'Groceries'], ['سوبر ماركت', '', 'Household', 'Groceries'],
  ['سوبرماركت', '', 'Household', 'Groceries'], ['خضار', '', 'Household', 'Groceries'], ['فاكهه', '', 'Household', 'Groceries'],
  ['لحمه', '', 'Household', 'Groceries'], ['فراخ', '', 'Household', 'Groceries'], ['عيش', '', 'Household', 'Groceries'],
  ['كارفور', '', 'Household', 'Groceries'], ['carrefour', '', 'Household', 'Groceries'], ['groceries', '', 'Household', 'Groceries'],
  ['grocery', '', 'Household', 'Groceries'], ['منظفات', '', 'Household', 'Cleaning Supplies'], ['cleaning', '', 'Household', 'Cleaning Supplies'],
  ['كهربا', '', 'Utilities', 'Electricity'], ['كهرباء', '', 'Utilities', 'Electricity'], ['electricity', '', 'Utilities', 'Electricity'],
  ['مياه', '', 'Utilities', 'Water'], ['water bill', '', 'Utilities', 'Water'], ['غاز', '', 'Utilities', 'Gas'], ['gas bill', '', 'Utilities', 'Gas'],
  ['انترنت', '', 'Utilities', 'Internet'], ['النت', '', 'Utilities', 'Internet'], ['راوتر', '', 'Utilities', 'Internet'],
  ['internet', '', 'Utilities', 'Internet'], ['wifi', '', 'Utilities', 'Internet'], ['كارت شحن', '', 'Utilities', 'Mobile'],
  ['رصيد', '', 'Utilities', 'Mobile'], ['باقه', '', 'Utilities', 'Mobile'], ['phone bill', '', 'Utilities', 'Mobile'], ['mobile bill', '', 'Utilities', 'Mobile'],
  ['ايجار', '', 'Housing', 'Rent'], ['rent', '', 'Housing', 'Rent'], ['سباك', '', 'Housing', 'Maintenance'], ['صيانه البيت', '', 'Housing', 'Maintenance'], ['plumber', '', 'Housing', 'Maintenance'],
  ['صيدليه', '', 'Health', 'Pharmacy'], ['دوا', '', 'Health', 'Pharmacy'], ['دواء', '', 'Health', 'Pharmacy'], ['علاج', '', 'Health', 'Pharmacy'],
  ['pharmacy', '', 'Health', 'Pharmacy'], ['medicine', '', 'Health', 'Pharmacy'], ['دكتور', '', 'Health', 'Doctor'], ['كشف', '', 'Health', 'Doctor'],
  ['doctor', '', 'Health', 'Doctor'], ['تحاليل', '', 'Health', 'Lab Tests'], ['حلاق', '', 'Personal Care', 'Haircut'], ['حلاقه', '', 'Personal Care', 'Haircut'],
  ['barber', '', 'Personal Care', 'Haircut'], ['haircut', '', 'Personal Care', 'Haircut'],
  ['لبس', '', 'Shopping', 'Clothing'], ['هدوم', '', 'Shopping', 'Clothing'], ['جزمه', '', 'Shopping', 'Clothing'], ['clothes', '', 'Shopping', 'Clothing'],
  ['shoes', '', 'Shopping', 'Clothing'], ['موبايل جديد', '', 'Shopping', 'Electronics'], ['لابتوب', '', 'Shopping', 'Electronics'],
  ['سماعه', '', 'Shopping', 'Electronics'], ['laptop', '', 'Shopping', 'Electronics'], ['headphones', '', 'Shopping', 'Electronics'],
  ['سينما', '', 'Entertainment', 'Outings'], ['خروجه', '', 'Entertainment', 'Outings'], ['cinema', '', 'Entertainment', 'Outings'],
  ['نتفليكس', '', 'Entertainment', 'Subscriptions'], ['netflix', '', 'Entertainment', 'Subscriptions'], ['spotify', '', 'Entertainment', 'Subscriptions'],
  ['شاهد', '', 'Entertainment', 'Subscriptions'], ['اشتراك', '', 'Entertainment', 'Subscriptions'], ['subscription', '', 'Entertainment', 'Subscriptions'],
  ['سفر', '', 'Entertainment', 'Travel'], ['رحله', '', 'Entertainment', 'Travel'], ['فندق', '', 'Entertainment', 'Travel'], ['travel', '', 'Entertainment', 'Travel'], ['hotel', '', 'Entertainment', 'Travel'],
  ['كورس', '', 'Education', 'Courses'], ['course', '', 'Education', 'Courses'], ['udemy', '', 'Education', 'Courses'],
  ['كتاب', '', 'Education', 'Books'], ['كتب', '', 'Education', 'Books'], ['book', '', 'Education', 'Books'],
  ['هديه', '', 'Family and Gifts', 'Gifts'], ['gift', '', 'Family and Gifts', 'Gifts'], ['مصروف البيت', '', 'Family and Gifts', 'Family Support'],
  ['زكاه', '', 'Charity', 'Zakat'], ['zakat', '', 'Charity', 'Zakat'], ['صدقه', '', 'Charity', 'Sadaqa'], ['تبرع', '', 'Charity', 'Sadaqa'], ['charity', '', 'Charity', 'Sadaqa'],
  ['قسط', '', 'Installments', 'Installment'], ['installment', '', 'Installments', 'Installment'],
  ['رسوم', '', 'Fees and Charges', 'Government Fees'], ['مصاريف بنكيه', '', 'Fees and Charges', 'Bank Fees'], ['bank fees', '', 'Fees and Charges', 'Bank Fees'], ['fees', '', 'Fees and Charges', 'Bank Fees'],
  ['مرتب', 'Income', 'Salary', 'Monthly Salary'], ['راتب', 'Income', 'Salary', 'Monthly Salary'], ['salary', 'Income', 'Salary', 'Monthly Salary'],
  ['بونص', 'Income', 'Additional Income', 'Bonus'], ['bonus', 'Income', 'Additional Income', 'Bonus'], ['حافز', 'Income', 'Additional Income', 'Bonus'],
  ['فريلانس', 'Income', 'Additional Income', 'Freelance'], ['freelance', 'Income', 'Additional Income', 'Freelance'],
  ['ثاندر', 'Investment Contribution', 'Investments', 'Thndr'], ['thndr', 'Investment Contribution', 'Investments', 'Thndr'],
  ['atm', 'Internal Transfer', 'Transfers', 'ATM Withdrawal'], ['ماكينه', 'Internal Transfer', 'Transfers', 'ATM Withdrawal'],
  ['سحبت فلوس', 'Internal Transfer', 'Transfers', 'ATM Withdrawal'],
  ['توفير', 'Savings Transfer', 'Savings', 'Savings Account'], ['شهاده', 'Savings Transfer', 'Savings', 'Certificate'], ['دهب', 'Savings Transfer', 'Savings', 'Gold'],
];

// English, Franco-Arabic and Egyptian brand names. Merged with your Category_Rules tab (your rows win).
const EXTRA_RULES = [
  ['benzen', '', 'Transportation', 'Fuel'], ['benzin', '', 'Transportation', 'Fuel'], ['banzeen', '', 'Transportation', 'Fuel'], ['banzin', '', 'Transportation', 'Fuel'],
  ['gas station', '', 'Transportation', 'Fuel'], ['wataniya', '', 'Transportation', 'Fuel'], ['chillout', '', 'Transportation', 'Fuel'], ['misr petroleum', '', 'Transportation', 'Fuel'],
  ['swvl', '', 'Transportation', 'Public Transport'], ['microbus', '', 'Transportation', 'Public Transport'], ['tuk tuk', '', 'Transportation', 'Public Transport'], ['toktok', '', 'Transportation', 'Public Transport'],
  ['train', '', 'Transportation', 'Public Transport'], ['mechanic', '', 'Transportation', 'Car Maintenance'], ['oil change', '', 'Transportation', 'Car Maintenance'], ['tires', '', 'Transportation', 'Car Maintenance'],
  ['car wash', '', 'Transportation', 'Car Maintenance'], ['ghaseel', '', 'Transportation', 'Car Maintenance'], ['garage', '', 'Transportation', 'Parking'], ['car', '', 'Transportation', 'Car Maintenance'],
  ['2ahwa', '', 'Food and Drinks', 'Coffee'], ['ahwa', '', 'Food and Drinks', 'Coffee'], ['cafe', '', 'Food and Drinks', 'Coffee'], ['costa', '', 'Food and Drinks', 'Coffee'],
  ['cilantro', '', 'Food and Drinks', 'Coffee'], ['dunkin', '', 'Food and Drinks', 'Coffee'], ['tea', '', 'Food and Drinks', 'Coffee'],
  ['food', '', 'Food and Drinks', 'Restaurants'], ['akl', '', 'Food and Drinks', 'Restaurants'], ['breakfast', '', 'Food and Drinks', 'Restaurants'], ['fetar', '', 'Food and Drinks', 'Restaurants'],
  ['foul', '', 'Food and Drinks', 'Restaurants'], ['koshary', '', 'Food and Drinks', 'Restaurants'], ['shawerma', '', 'Food and Drinks', 'Restaurants'], ['pizza', '', 'Food and Drinks', 'Restaurants'],
  ['burger', '', 'Food and Drinks', 'Restaurants'], ['mcdonalds', '', 'Food and Drinks', 'Restaurants'], ['kfc', '', 'Food and Drinks', 'Restaurants'], ['elmenus', '', 'Food and Drinks', 'Delivery'],
  ['sweets', '', 'Food and Drinks', 'Snacks'], ['dessert', '', 'Food and Drinks', 'Snacks'], ['chips', '', 'Food and Drinks', 'Snacks'], ['juice', '', 'Food and Drinks', 'Snacks'],
  ['water', '', 'Food and Drinks', 'Drinks'], ['drinks', '', 'Food and Drinks', 'Drinks'], ['soda', '', 'Food and Drinks', 'Drinks'],
  ['supermarket', '', 'Household', 'Groceries'], ['super market', '', 'Household', 'Groceries'], ['market', '', 'Household', 'Groceries'], ['hyper', '', 'Household', 'Groceries'],
  ['spinneys', '', 'Household', 'Groceries'], ['metro market', '', 'Household', 'Groceries'], ['kazyon', '', 'Household', 'Groceries'], ['seoudi', '', 'Household', 'Groceries'],
  ['oscar', '', 'Household', 'Groceries'], ['gomla', '', 'Household', 'Groceries'], ['khodar', '', 'Household', 'Groceries'], ['vegetables', '', 'Household', 'Groceries'],
  ['fruits', '', 'Household', 'Groceries'], ['fruit', '', 'Household', 'Groceries'], ['meat', '', 'Household', 'Groceries'], ['chicken', '', 'Household', 'Groceries'],
  ['bread', '', 'Household', 'Groceries'], ['eggs', '', 'Household', 'Groceries'], ['milk', '', 'Household', 'Groceries'], ['breadfast', '', 'Household', 'Groceries'],
  ['instashop', '', 'Household', 'Groceries'], ['rabbit', '', 'Household', 'Groceries'], ['detergent', '', 'Household', 'Cleaning Supplies'], ['tissues', '', 'Household', 'Cleaning Supplies'],
  ['carpet', '', 'Household', 'Home Items'], ['carpets', '', 'Household', 'Home Items'], ['kitchen', '', 'Household', 'Home Items'], ['home items', '', 'Household', 'Home Items'],
  ['laundry', '', 'Household', 'Cleaning Supplies'], ['makwagy', '', 'Household', 'Cleaning Supplies'], ['dry clean', '', 'Household', 'Cleaning Supplies'],
  ['electric', '', 'Utilities', 'Electricity'], ['kahraba', '', 'Utilities', 'Electricity'], ['water bill', '', 'Utilities', 'Water'], ['maya', '', 'Utilities', 'Water'],
  ['gas', '', 'Utilities', 'Gas'], ['ghaz', '', 'Utilities', 'Gas'], ['net', '', 'Utilities', 'Internet'], ['te data', '', 'Utilities', 'Internet'], ['we internet', '', 'Utilities', 'Internet'],
  ['vodafone', '', 'Utilities', 'Mobile'], ['etisalat', '', 'Utilities', 'Mobile'], ['recharge', '', 'Utilities', 'Mobile'],
  ['top up', '', 'Utilities', 'Mobile'], ['mobile', '', 'Utilities', 'Mobile'], ['phone bill', '', 'Utilities', 'Mobile'], ['landline', '', 'Utilities', 'Mobile'],
  ['egar', '', 'Housing', 'Rent'], ['maintenance', '', 'Housing', 'Maintenance'], ['sayana', '', 'Housing', 'Maintenance'], ['electrician', '', 'Housing', 'Maintenance'],
  ['painting', '', 'Housing', 'Maintenance'], ['furniture', '', 'Housing', 'Furniture'],
  ['agzakhana', '', 'Health', 'Pharmacy'], ['dawa', '', 'Health', 'Pharmacy'], ['medicines', '', 'Health', 'Pharmacy'], ['vitamins', '', 'Health', 'Pharmacy'],
  ['clinic', '', 'Health', 'Doctor'], ['hospital', '', 'Health', 'Doctor'], ['dentist', '', 'Health', 'Doctor'], ['dr', '', 'Health', 'Doctor'], ['lab', '', 'Health', 'Lab Tests'],
  ['analysis', '', 'Health', 'Lab Tests'], ['x ray', '', 'Health', 'Lab Tests'], ['glasses', '', 'Health', 'Doctor'], ['gym', '', 'Health', 'Gym'], ['fitness', '', 'Health', 'Gym'],
  ['7ala2', '', 'Personal Care', 'Haircut'], ['hala2', '', 'Personal Care', 'Haircut'], ['salon', '', 'Personal Care', 'Haircut'], ['perfume', '', 'Personal Care', 'Cosmetics'],
  ['skincare', '', 'Personal Care', 'Cosmetics'], ['cosmetics', '', 'Personal Care', 'Cosmetics'], ['vape', '', 'Personal Care', 'Smoking'], ['liquid', '', 'Personal Care', 'Smoking'],
  ['cigarettes', '', 'Personal Care', 'Smoking'], ['cigs', '', 'Personal Care', 'Smoking'], ['sagayer', '', 'Personal Care', 'Smoking'], ['shisha', '', 'Personal Care', 'Smoking'], ['tobacco', '', 'Personal Care', 'Smoking'],
  ['hdoom', '', 'Shopping', 'Clothing'], ['shirt', '', 'Shopping', 'Clothing'], ['tshirt', '', 'Shopping', 'Clothing'], ['t shirt', '', 'Shopping', 'Clothing'], ['jeans', '', 'Shopping', 'Clothing'],
  ['jacket', '', 'Shopping', 'Clothing'], ['pants', '', 'Shopping', 'Clothing'], ['sneakers', '', 'Shopping', 'Clothing'], ['shein', '', 'Shopping', 'Clothing'],
  ['amazon', '', 'Shopping', 'Accessories'], ['noon', '', 'Shopping', 'Accessories'], ['jumia', '', 'Shopping', 'Accessories'], ['mall', '', 'Shopping', 'Accessories'],
  ['electronics', '', 'Shopping', 'Electronics'], ['charger', '', 'Shopping', 'Electronics'], ['airpods', '', 'Shopping', 'Electronics'], ['cable', '', 'Shopping', 'Electronics'],
  ['shahid', '', 'Entertainment', 'Subscriptions'], ['osn', '', 'Entertainment', 'Subscriptions'], ['watch it', '', 'Entertainment', 'Subscriptions'], ['anghami', '', 'Entertainment', 'Subscriptions'],
  ['youtube', '', 'Entertainment', 'Subscriptions'], ['icloud', '', 'Entertainment', 'Subscriptions'], ['chatgpt', '', 'Entertainment', 'Subscriptions'], ['playstation', '', 'Entertainment', 'Outings'],
  ['games', '', 'Entertainment', 'Outings'], ['movie', '', 'Entertainment', 'Outings'], ['outing', '', 'Entertainment', 'Outings'], ['khroga', '', 'Entertainment', 'Outings'],
  ['trip', '', 'Entertainment', 'Travel'], ['flight', '', 'Entertainment', 'Travel'], ['sahel', '', 'Entertainment', 'Travel'], ['sokhna', '', 'Entertainment', 'Travel'],
  ['coursera', '', 'Education', 'Courses'], ['school', '', 'Education', 'Courses'], ['tuition', '', 'Education', 'Courses'], ['university', '', 'Education', 'Courses'], ['books', '', 'Education', 'Books'],
  ['hadya', '', 'Family and Gifts', 'Gifts'], ['gifts', '', 'Family and Gifts', 'Gifts'], ['birthday', '', 'Family and Gifts', 'Gifts'], ['wedding', '', 'Family and Gifts', 'Occasions'],
  ['eidia', '', 'Family and Gifts', 'Occasions'], ['family', '', 'Family and Gifts', 'Family Support'], ['mama', '', 'Family and Gifts', 'Family Support'], ['baba', '', 'Family and Gifts', 'Family Support'],
  ['sadaka', '', 'Charity', 'Sadaqa'], ['sada2a', '', 'Charity', 'Sadaqa'], ['donation', '', 'Charity', 'Sadaqa'], ['zakah', '', 'Charity', 'Zakat'],
  ['2est', '', 'Installments', 'Installment'], ['qest', '', 'Installments', 'Installment'], ['valu', '', 'Installments', 'Installment'], ['halan', '', 'Installments', 'Installment'],
  ['sympl', '', 'Installments', 'Installment'], ['souhoola', '', 'Installments', 'Installment'], ['aman', '', 'Installments', 'Installment'], ['forsa', '', 'Installments', 'Installment'],
  ['installments', '', 'Installments', 'Installment'],
  ['commission', '', 'Fees and Charges', 'Bank Fees'], ['fine', '', 'Fees and Charges', 'Government Fees'], ['mokhalfa', '', 'Fees and Charges', 'Government Fees'], ['tax', '', 'Fees and Charges', 'Government Fees'],
  ['mortab', 'Income', 'Salary', 'Monthly Salary'], ['ratb', 'Income', 'Salary', 'Monthly Salary'],
];

const VERB_TOKENS = ['دفعت', 'اشتريت', 'صرفت', 'جبت', 'قبضت', 'حولت', 'سحبت', 'حطيت', 'سددت', 'رجعلي', 'رجعولي', 'استرجعت',
  'paid', 'bought', 'spent', 'received', 'got', 'transferred', 'withdrew', 'put', 'pay', 'فلوس', 'money',
  'امبارح', 'امس', 'yesterday', 'النهارده', 'today', 'كاش', 'cash', 'انستاباي', 'instapay', 'فيزا', 'visa'];
const CURRENCY_TOKENS = ['جنيه', 'جنيها', 'جنيهات', 'ج', 'جم', 'egp', 'le', 'l.e', 'pounds', 'pound', 'دولار', 'usd', '$', 'يورو', 'eur', '€'];
const STOP_TOKENS = ['في', 'فى', 'على', 'علي', 'ب', 'من', 'ل', 'لل', 'for', 'on', 'at', 'the', 'a', 'an', 'of', 'to', 'و', 'and', 'بتاع', 'حق', 'عشان', 'with'];

// =====================================================================================
// TEXT NORMALIZATION & PARSING (pure functions — no Google services, unit-testable)
// =====================================================================================
function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
    .replace(/٫/g, '.').replace(/٬/g, ',')
    .replace(/[ \t]+/g, ' ').trim();
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** True if keyword (already normalized) occurs as a word in normalized text, allowing Arabic prefixes/suffixes. */
function phraseIn(text, kw) {
  if (!kw) return false;
  if (/^[\x00-\x7F]+$/.test(kw)) {
    return new RegExp('(^|[^a-z0-9])' + escapeRe(kw) + '(s|es)?(?=$|[^a-z0-9])').test(text);
  }
  return new RegExp('(^|[\\s\\d])(و|ب|ف|ل|وب|فب)?(ال|لل|بال|وال)?' + escapeRe(kw) + '(ه|ات|ين|ها|ي)?(?=$|[^\\u0600-\\u06FF])').test(text);
}

/** Convert Arabic digits, "2 الف", "1.5k", "2 الف و500", standalone "الف"/"الفين" into plain numbers. Keeps original letters. */
function preprocessAmounts(text) {
  let t = String(text || '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6F0))
    .replace(/٫/g, '.').replace(/٬/g, ',')
    .replace(/(\d)(egp|le|l\.e|pounds?|usd|eur)\b/gi, '$1 $2') // "50EGP" → "50 EGP"
    .replace(/\n/g, ' \n ').replace(/[ \t]+/g, ' ').trim();
  const NUM = /^([وب]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)$/;
  const toks = t.split(' ');
  const out = [];
  let lastMult = -1;
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    const n = norm(tok);
    const km = tok.match(/^([وب]?)(\d+(?:\.\d+)?)k$/i);
    if (km) { out.push(km[1] + String(parseFloat(km[2]) * 1000)); lastMult = out.length - 1; continue; }
    if (n === 'الفين' || n === 'والفين' || n === 'بالفين') { out.push((n[0] === 'و' ? 'و' : n[0] === 'ب' ? 'ب' : '') + '2000'); lastMult = out.length - 1; continue; }
    if (n === 'الف' || n === 'الاف' || n === 'k') {
      const prev = out.length ? out[out.length - 1].match(NUM) : null;
      if (prev) {
        out[out.length - 1] = prev[1] + String(parseFloat(prev[2].replace(/,/g, '')) * 1000);
      } else {
        out.push('1000');
      }
      lastMult = out.length - 1;
      continue;
    }
    // "2000 و500" right after a multiplier → 2500
    if (lastMult === out.length - 1 && lastMult >= 0) {
      let addTok = null, skip = 0;
      const m1 = tok.match(/^و(\d{1,3})$/);
      if (m1) { addTok = m1[1]; }
      else if (tok === 'و' && toks[i + 1] && /^\d{1,3}$/.test(toks[i + 1])) { addTok = toks[i + 1]; skip = 1; }
      if (addTok !== null && parseFloat(addTok) < 1000) {
        const base = out[lastMult].match(NUM);
        out[lastMult] = base[1] + String(parseFloat(base[2]) + parseFloat(addTok));
        i += skip; lastMult = -1;
        continue;
      }
    }
    lastMult = -1;
    out.push(tok);
  }
  return out.join(' ').replace(/ \n /g, '\n');
}

function extractAmounts(text) {
  const re = /(?<![A-Za-z])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![A-Za-z\d])/g; // digits glued to Latin letters are words (Franco "2ahwa"), not money
  const res = []; let m;
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[0].replace(/,/g, ''));
    if (v > 0) res.push({ value: v, start: m.index, end: m.index + m[0].length });
  }
  return res;
}

function stripAmounts(n) {
  return n.replace(/(?<![A-Za-z])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![A-Za-z\d])/g, ' ').replace(/\s+/g, ' ').trim();
}

function removeCurrencyWords(n) {
  return n.split(' ').filter(w => CURRENCY_TOKENS.indexOf(w) < 0).join(' ');
}

function detectType(segNorm) {
  const t = removeCurrencyWords(stripAmounts(segNorm));
  for (const [type, phrases] of TYPE_PHRASES) {
    for (const p of phrases) if (phraseIn(t, norm(p))) return type;
  }
  for (const p of AMBIGUOUS_PHRASES) if (phraseIn(t, norm(p))) return 'AMBIG';
  return null;
}

function matchRule(segNorm, rules) {
  const t = removeCurrencyWords(stripAmounts(segNorm));
  let best = null;
  rules.forEach((r, idx) => {
    const kw = norm(r[0]);
    if (kw && phraseIn(t, kw) && (!best || kw.length >= best.kwLen)) {
      best = { keyword: r[0], type: r[1] || '', category: r[2], subcategory: r[3] || '', kwLen: kw.length, idx: idx };
    }
  });
  return best;
}

function detectCurrency(n) {
  if (/(دولار|usd|\$)/.test(n)) return 'USD';
  if (/(يورو|eur|€)/.test(n)) return 'EUR';
  return 'EGP';
}

function detectPayment(n) {
  if (phraseIn(n, 'فودافون كاش') || phraseIn(n, 'vodafone cash') || phraseIn(n, 'محفظه') || phraseIn(n, 'wallet')) return 'Mobile Wallet';
  if (phraseIn(n, 'انستاباي') || phraseIn(n, 'انستا باي') || phraseIn(n, 'instapay')) return 'InstaPay';
  if (phraseIn(n, 'كريدت') || phraseIn(n, 'credit card') || phraseIn(n, 'credit')) return 'Credit Card';
  if (phraseIn(n, 'فيزا') || phraseIn(n, 'visa') || phraseIn(n, 'debit') || phraseIn(n, 'card')) return 'Debit Card';
  if (phraseIn(n, 'كاش') || phraseIn(n, 'cash')) return 'Cash';
  return '';
}

function detectDateOffset(n) {
  if (phraseIn(n, 'اول امبارح') || phraseIn(n, 'اول امس')) return -2;
  if (phraseIn(n, 'امبارح') || phraseIn(n, 'امس') || phraseIn(n, 'yesterday')) return -1;
  return 0;
}

function cleanDescription(seg) {
  const words = String(seg).replace(/[،,;:+]/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter(w => {
    const n = norm(w);
    const core = n.replace(/^[وب]/, '');
    if (/^\d/.test(core) || /^\d/.test(n)) return false;
    if (CURRENCY_TOKENS.indexOf(n) >= 0 || CURRENCY_TOKENS.indexOf(core) >= 0) return false;
    if (STOP_TOKENS.indexOf(n) >= 0 || VERB_TOKENS.indexOf(n) >= 0 || VERB_TOKENS.indexOf(core) >= 0) return false;
    if (n.length < 2) return false;
    return true;
  });
  return kept.join(' ').trim();
}

/** Split a message into one text segment per amount. */
function splitSegments(text) {
  const sep = /(\n+|،|;|,(?!\d{3}(?!\d))|\s+و(?=\s*\S)|\s+and\s+|\s*\+\s*)/i;
  const parts = text.split(sep);
  const has = s => extractAmounts(norm(s)).length > 0;
  const segs = [];
  let cur = parts[0] || '';
  for (let i = 1; i < parts.length; i += 2) {
    const s = parts[i] || '', piece = parts[i + 1] || '';
    if (has(cur) && has(piece)) { segs.push(cur); cur = piece; }
    else cur += s + piece;
  }
  segs.push(cur);
  // Second pass: a segment with several amounts and no separators ("بنزين 350 قهوة 120").
  const out = [];
  segs.forEach(seg => {
    const amts = extractAmounts(seg);
    if (amts.length <= 1) { out.push(seg); return; }
    const before = norm(seg.slice(0, amts[0].start));
    const keywordFirst = cleanDescription(before).length > 0;
    for (let k = 0; k < amts.length; k++) {
      if (keywordFirst) {
        const s = k === 0 ? 0 : amts[k - 1].end;
        const e = k === amts.length - 1 ? seg.length : amts[k].end;
        out.push(seg.slice(s, e));
      } else {
        const s = k === 0 ? 0 : amts[k].start;
        const e = k === amts.length - 1 ? seg.length : amts[k + 1].start;
        out.push(seg.slice(s, e));
      }
    }
  });
  return out.map(s => s.trim()).filter(Boolean);
}

/** Decide type/category for an item and list what is still missing. Mutates and returns the item. */
function finalizeItem(item) {
  const r = item.rule;
  if (!item.type) {
    if (item.explicitType && item.explicitType !== 'AMBIG') item.type = item.explicitType;
    else if (item.inheritedType && item.explicitType !== 'AMBIG') item.type = item.inheritedType;
    else if (r && r.type) item.type = r.type;
    else if (item.explicitType !== 'AMBIG' && r && EXPENSE_CATEGORIES.indexOf(r.category) >= 0) item.type = 'Expense';
  }
  if (item.type && !item.category) {
    if (item.type === 'Expense' || item.type === 'Refund') {
      if (r && EXPENSE_CATEGORIES.indexOf(r.category) >= 0) { item.category = r.category; item.subcategory = r.subcategory; }
    } else if (item.type === 'Income') {
      if (r && INCOME_CATEGORIES.indexOf(r.category) >= 0) { item.category = r.category; item.subcategory = r.subcategory; }
      else { item.category = TYPE_DEFAULT_CATEGORY.Income[0]; item.subcategory = TYPE_DEFAULT_CATEGORY.Income[1]; }
    } else {
      const d = TYPE_DEFAULT_CATEGORY[item.type];
      if (r && r.category === d[0]) { item.category = r.category; item.subcategory = r.subcategory; }
      else { item.category = d[0]; item.subcategory = d[1]; }
    }
  }
  item.missing = [];
  if (!(item.amount > 0)) item.missing.push('amount');
  if (!item.type) item.missing.push('type');
  else if (!item.category) item.missing.push('category');
  if (!item.description) item.description = item.subcategory || item.category || '';
  return item;
}

/** Parse a free-text message into candidate transactions. */
function parseMessage(text, rules) {
  const pre = preprocessAmounts(text);
  const fullNorm = norm(pre);
  const segments = splitSegments(pre);
  const currency = detectCurrency(fullNorm);
  const payment = detectPayment(fullNorm);
  const dateOffset = detectDateOffset(fullNorm);
  const items = [];
  let inherited = null;
  segments.forEach(seg => {
    const n = norm(seg);
    const amts = extractAmounts(n);
    if (!amts.length) return;
    const explicitType = detectType(n);
    const item = {
      amount: amts[0].value, currency: currency, explicitType: explicitType, inheritedType: inherited,
      rule: matchRule(n, rules), type: null, category: null, subcategory: '',
      description: cleanDescription(seg), segment: seg.trim(), source: 'rules', dup: false,
    };
    finalizeItem(item);
    if (explicitType && explicitType !== 'AMBIG') inherited = explicitType;
    items.push(item);
  });
  return { items: items, allAmounts: extractAmounts(fullNorm).map(a => a.value), currency, payment, dateOffset };
}

/** Validate an AI result against the original message. Returns items or null. */
function validateAiItems(aiTx, allowedAmounts, currency) {
  if (!Array.isArray(aiTx) || !aiTx.length) return null;
  const items = [];
  for (const t of aiTx) {
    const amt = Number(t.amount);
    if (!(amt > 0) || !allowedAmounts.some(a => Math.abs(a - amt) < 0.001)) return null; // AI must not invent amounts
    const type = TYPES.indexOf(t.type) >= 0 ? t.type : null;
    let category = null;
    if (type === 'Expense' || type === 'Refund') category = EXPENSE_CATEGORIES.indexOf(t.category) >= 0 ? t.category : null;
    else if (type === 'Income') category = INCOME_CATEGORIES.indexOf(t.category) >= 0 ? t.category : TYPE_DEFAULT_CATEGORY.Income[0];
    else if (type) category = TYPE_DEFAULT_CATEGORY[type][0];
    const item = {
      amount: amt, currency: currency, explicitType: null, inheritedType: null, rule: null, type: type,
      category: category, subcategory: category ? String(t.subcategory || '').slice(0, 40) : '',
      description: String(t.description || '').slice(0, 80), segment: '', source: 'ai', dup: false,
    };
    finalizeItem(item);
    items.push(item);
  }
  return items;
}

// =====================================================================================
// GOOGLE SERVICES HELPERS
// =====================================================================================
function prop(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
function ss() { return SpreadsheetApp.getActive(); }
function fmt(d, f) { return Utilities.formatDate(d, TZ, f); }

function getSettings() {
  const sh = ss().getSheetByName(SH.SETTINGS);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => { if (r[0]) map[String(r[0]).trim()] = r[1]; });
  return map;
}
function setSetting(key, value, description) {
  const sh = ss().getSheetByName(SH.SETTINGS);
  const last = sh.getLastRow();
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
  const i = keys.indexOf(key);
  if (i >= 0) sh.getRange(i + 2, 2).setValue(value);
  else sh.appendRow([key, value, description || '']);
}
function confirmModeOn() { return String(getSettings().Confirmation_Mode || 'ON').toUpperCase() !== 'OFF'; }

function getRules() {
  const cache = CacheService.getScriptCache();
  const c = cache.get('rules');
  if (c) return JSON.parse(c);
  const sh = ss().getSheetByName(SH.RULES);
  let rules = [];
  if (sh && sh.getLastRow() >= 2) {
    rules = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
      .filter(r => r[0] && r[2]).map(r => [String(r[0]), String(r[1] || ''), String(r[2]), String(r[3] || '')]);
  }
  const have = {}; rules.forEach(r => { have[norm(r[0])] = 1; });
  DEFAULT_RULES.concat(typeof EXTRA_RULES !== 'undefined' ? EXTRA_RULES : []).forEach(r => { if (!have[norm(r[0])]) { have[norm(r[0])] = 1; rules.unshift(r); } });
  // built-ins go first so your own (sheet) rules win ties
  try { cache.put('rules', JSON.stringify(rules), 600); } catch (e) { /* too large to cache: fine */ }
  return rules;
}
function learnRule(keyword, category, subcategory, type) {
  const sh = ss().getSheetByName(SH.RULES);
  if (!sh || !keyword || keyword.length > 30 || keyword.split(' ').length > 3) return;
  sh.appendRow([keyword, type || '', category, subcategory || '', 'Learned', new Date()]);
  CacheService.getScriptCache().remove('rules');
}

function txSheet() { return ss().getSheetByName(SH.TX); }
function headerMap(sh) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const m = {}; h.forEach((name, i) => { m[String(name).trim()] = i; }); return m;
}
function readTx() {
  const sh = txSheet();
  const last = sh.getLastRow();
  if (last < 2) return { rows: [], map: headerMap(sh) };
  return { rows: sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues(), map: headerMap(sh) };
}
function isDate(v) { return v && typeof v === 'object' && typeof v.getTime === 'function' && !isNaN(v.getTime()); }
function dateKey(v) { return isDate(v) ? fmt(v, 'yyyy-MM-dd') : String(v || '').slice(0, 10); }

function audit(action, id, before, after, source) {
  const sh = ss().getSheetByName(SH.AUDIT);
  if (!sh) return;
  sh.appendRow([new Date(), action, id || '', before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '', source || 'Bot']);
}

function newId(i) {
  return 'TX-' + fmt(new Date(), 'yyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase() + (i || 0);
}
function shortId() { return Math.random().toString(36).slice(2, 10); }

// =====================================================================================
// TELEGRAM
// =====================================================================================
function tg(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop('BOT_TOKEN') + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  let j; try { j = JSON.parse(res.getContentText()); } catch (e) { j = { ok: false, description: res.getContentText() }; }
  if (!j.ok) console.warn('Telegram ' + method + ' failed: ' + j.description);
  return j;
}
function send(chatId, text, buttons) {
  const p = { chat_id: chatId, text: text };
  if (buttons) p.reply_markup = { inline_keyboard: buttons };
  return tg('sendMessage', p);
}
function edit(chatId, messageId, text, buttons) {
  const p = { chat_id: chatId, message_id: messageId, text: text, reply_markup: { inline_keyboard: buttons || [] } };
  return tg('editMessageText', p);
}
function reply(chatId, editMsgId, text, buttons) {
  return editMsgId ? edit(chatId, editMsgId, text, buttons) : send(chatId, text, buttons);
}
function rows(btns, perRow) {
  const out = []; for (let i = 0; i < btns.length; i += perRow) out.push(btns.slice(i, i + perRow)); return out;
}

/** Time-driven trigger (every minute). Each update is handled at most once. */
function pollUpdates() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    let offset = Number(prop('TG_OFFSET') || 0);
    const r = tg('getUpdates', { offset: offset, timeout: 0, limit: 25, allowed_updates: ['message', 'callback_query'] });
    if (!r.ok) return;
    r.result.forEach(u => {
      setProp('TG_OFFSET', String(u.update_id + 1)); // advance first → no reprocessing on retries/crashes
      try { processUpdate(u); }
      catch (e) {
        console.error(e && e.stack || e);
        const chat = (u.message && u.message.chat.id) || (u.callback_query && u.callback_query.message.chat.id);
        if (chat && String(chat) === String(prop('OWNER_ID'))) send(chat, '⚠️ Something went wrong and nothing was saved. Please try again.\n(' + String(e).slice(0, 150) + ')');
      }
    });
  } finally { lock.releaseLock(); }
}

function processUpdate(u) {
  const owner = prop('OWNER_ID');
  if (u.callback_query) {
    const q = u.callback_query;
    if (String(q.from.id) !== String(owner)) return;
    tg('answerCallbackQuery', { callback_query_id: q.id });
    return handleCallback(q.message.chat.id, q.message.message_id, q.data || '');
  }
  const m = u.message;
  if (!m) return;
  const chatId = m.chat.id;
  const text = (m.text || '').trim();
  if (!owner) {
    if (text.indexOf('/start') === 0 && m.chat.type === 'private') {
      setProp('OWNER_ID', String(m.from.id));
      return send(chatId, '🔒 This bot is now linked to you only. Other people will be ignored.\n\n' + helpText());
    }
    return;
  }
  if (String(m.from.id) !== String(owner)) return; // ignore everyone else silently
  if (typeof importIntercept_ === 'function' && importIntercept_(chatId, m, text)) return; // collecting pasted notes
  if (m.voice || m.audio) {
    if (typeof handleVoice === 'function') return handleVoice(chatId, m);
    return send(chatId, '🎙 Voice messages are not installed yet. Please type it for now.');
  }
  if (!text) return send(chatId, 'Please send the transaction as text.');
  // A pasted web-app link = "save this as my dashboard address"
  if (/^https:\/\/script\.google\.com\/\S*\/exec\S*$/i.test(text)) {
    if (typeof handleCommand6 === 'function') return handleCommand6(chatId, '/dashboard', 'url ' + text);
    return send(chatId, 'The dashboard code (Phase6.gs) is not installed in your Apps Script project yet.');
  }
  if (text[0] === '/') return handleCommand(chatId, text);
  return handleText(chatId, text);
}

// =====================================================================================
// MESSAGE → TRANSACTIONS FLOW
// =====================================================================================
function handleText(chatId, text) {
  const parsed = parseMessage(text, getRules());
  if (!parsed.items.length) {
    return send(chatId, "I couldn't find an amount. Try: دفعت 350 بنزين و120 قهوة");
  }
  let items = parsed.items, aiNote = '';
  const unresolved = items.some(i => i.missing.length);
  if (unresolved && prop('GEMINI_API_KEY')) {
    const ai = geminiParse(text);
    if (ai.items) {
      const v = validateAiItems(ai.items, parsed.allAmounts, parsed.currency);
      if (v) items = v; else aiNote = '(AI suggestion rejected: it did not match the amounts in your message.)';
    } else if (ai.error) aiNote = '(AI unavailable: ' + ai.error + ')';
  }
  const p = {
    id: shortId(), chatId: chatId, text: text, items: items, payment: parsed.payment,
    dateOffset: parsed.dateOffset, usedAI: items.some(i => i.source === 'ai'), aiNote: aiNote,
  };
  if (typeof linkCommitments === 'function') linkCommitments(p);
  markDuplicates(p);
  advance(p, null);
}

function savePending(p) { CacheService.getScriptCache().put('p:' + p.id, JSON.stringify(p), 21600); }
function loadPending(id) { const c = CacheService.getScriptCache().get('p:' + id); return c ? JSON.parse(c) : null; }
function dropPending(id) { CacheService.getScriptCache().remove('p:' + id); }

function txDate(p) {
  const d = new Date(Date.now() + (p.dateOffset || 0) * 86400000);
  return fmt(d, 'yyyy-MM-dd');
}

function itemLine(i, k) {
  const cat = i.category ? i.category + (i.subcategory ? ' › ' + i.subcategory : '') : '❓ category';
  return (k + 1) + ') ' + fmtMoney(i.amount, i.currency) + ' · ' + (i.type || '❓ type') + ' · ' + cat + (i.description ? ' · ' + i.description : '') +
    (i.commitmentName ? ' ↔ ' + i.commitmentName : '');
}
function fmtMoney(n, cur) {
  const s = Math.round(n * 100) / 100;
  return s.toLocaleString('en-US') + ' ' + (cur || 'EGP');
}

/** Ask for the next missing field, ask for confirmation, or save. */
function advance(p, editMsgId) {
  const k = p.items.findIndex(i => i.missing.length);
  if (k >= 0) {
    const it = p.items[k];
    const field = it.missing[0];
    const head = (p.items.length > 1 ? 'Item ' + (k + 1) + ' of ' + p.items.length + ': ' : '') +
      fmtMoney(it.amount, it.currency) + (it.description ? ' — ' + it.description : '');
    savePending(p);
    if (field === 'type') {
      const b = TYPES.map((t, ti) => ({ text: t, callback_data: 't|' + p.id + '|' + k + '|' + ti }));
      return reply(p.chatId, editMsgId, head + '\nWhat kind of transaction is this?', rows(b, 2).concat([[{ text: '❌ Cancel', callback_data: 'x|' + p.id }]]));
    }
    const cats = p.items[k].type === 'Income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const b = cats.map((c, ci) => ({ text: c, callback_data: 'c|' + p.id + '|' + k + '|' + ci }));
    return reply(p.chatId, editMsgId, head + '\nWhich category?', rows(b, 3).concat([[{ text: '❌ Cancel', callback_data: 'x|' + p.id }]]));
  }
  const nonEgp = p.items.some(i => i.currency !== 'EGP');
  const needConfirm = confirmModeOn() || p.usedAI || p.items.some(i => i.dup) || nonEgp;
  if (!needConfirm) return commit(p, editMsgId);
  savePending(p);
  const dateStr = txDate(p);
  let msg = '📝 ' + (p.items.length === 1 ? '1 transaction' : p.items.length + ' transactions') + ' · ' + dateStr + '\n' +
    p.items.map(itemLine).join('\n');
  if (p.payment) msg += '\nPaid with: ' + p.payment;
  const dups = p.items.map((i, k) => i.dup ? '#' + (k + 1) : null).filter(Boolean);
  if (dups.length) msg += '\n⚠️ Possible duplicate: ' + dups.join(', ') + ' matches something saved in the last few minutes.';
  if (p.usedAI) msg += '\n🤖 Understood with AI — please check.';
  if (nonEgp) msg += '\n💱 Not in EGP — summaries count EGP only until currency conversion is added.';
  if (p.aiNote) msg += '\n' + p.aiNote;
  return reply(p.chatId, editMsgId, msg, [[
    { text: '✅ Save', callback_data: 'ok|' + p.id }, { text: '❌ Cancel', callback_data: 'x|' + p.id }]]);
}

function markDuplicates(p) {
  const win = Number(getSettings().Duplicate_Window_Minutes || 10) * 60000;
  const { rows: data, map } = readTx();
  const recent = data.slice(-300);
  const d = txDate(p);
  const now = Date.now();
  p.items.forEach(it => {
    it.dup = recent.some(r => {
      const created = r[map.Created_At];
      const age = isDate(created) ? now - created.getTime() : Infinity;
      return age <= win && dateKey(r[map.Transaction_Date]) === d && Number(r[map.Amount]) === it.amount &&
        (!it.type || r[map.Transaction_Type] === it.type);
    });
  });
}

function commit(p, editMsgId) {
  const sh = txSheet();
  const map = headerMap(sh);
  const width = sh.getLastColumn();
  const dateStr = txDate(p);
  const dateVal = Utilities.parseDate(dateStr, TZ, 'yyyy-MM-dd');
  const now = new Date();
  const timeStr = fmt(now, 'HH:mm');
  const ids = [];
  const out = p.items.map((it, k) => {
    const row = new Array(width).fill('');
    const id = newId(k); ids.push(id);
    const set = (col, v) => { if (map[col] !== undefined) row[map[col]] = v; };
    set('Transaction_ID', id); set('Transaction_Date', dateVal); set('Transaction_Time', timeStr);
    set('Transaction_Type', it.type); set('Amount', it.amount); set('Currency', it.currency);
    set('Category', it.category); set('Subcategory', it.subcategory || ''); set('Description', it.description || '');
    set('Payment_Method', p.payment || ''); set('Recurring_Flag', (it.recurring || it.category === 'Installments') ? 'Yes' : 'No');
    set('Related_Transaction_ID', it.related || '');
    set('Source', 'Telegram'); set('Created_At', now); set('Notes', 'Msg: ' + p.text.slice(0, 200) + (it.source === 'ai' ? ' [AI]' : ''));
    return row;
  });
  dropPending(p.id); // single use: a second tap on "Save" finds nothing
  sh.getRange(sh.getLastRow() + 1, 1, out.length, width).setValues(out);
  out.forEach((r, k) => audit('CREATE', ids[k], null, rowObj(r, map), 'Telegram'));
  if (typeof onInvestmentCashSaved === 'function') { try { onInvestmentCashSaved(p.items, ids); } catch (e) { console.error('Thndr sync: ' + e); } }
  const batchKey = shortId();
  CacheService.getScriptCache().put('b:' + batchKey, JSON.stringify(ids), 21600);
  setProp('LAST_BATCH', JSON.stringify({ ids: ids, at: now.getTime() }));
  const spent = todaySpent();
  const msg = '✅ Saved: ' + p.items.map(i => fmtMoney(i.amount, i.currency) + ' ' + (i.subcategory || i.category) + (i.commitmentName ? ' (' + i.commitmentName + ' ✔)' : '')).join(' · ') +
    (dateStr !== fmt(now, 'yyyy-MM-dd') ? '\n📅 Dated ' + dateStr : '') +
    '\nSpent today: ' + fmtMoney(spent, 'EGP');
  return reply(p.chatId, editMsgId, msg, [[{ text: '↩️ Undo', callback_data: 'u|' + batchKey }]]);
}

function rowObj(r, map) { const o = {}; Object.keys(map).forEach(k => { o[k] = r[map[k]]; }); return o; }

// =====================================================================================
// CALLBACK BUTTONS
// =====================================================================================
function handleCallback(chatId, msgId, data) {
  const parts = data.split('|');
  const kind = parts[0];
  if (kind === 'ok' || kind === 'x' || kind === 't' || kind === 'c') {
    const p = loadPending(parts[1]);
    if (!p) return edit(chatId, msgId, 'ℹ️ This request was already handled or has expired.');
    if (kind === 'x') { dropPending(p.id); return edit(chatId, msgId, '❌ Cancelled. Nothing was saved.'); }
    if (kind === 'ok') return commit(p, msgId);
    const k = Number(parts[2]), it = p.items[k];
    if (!it) return edit(chatId, msgId, 'ℹ️ Item not found.');
    if (kind === 't') { it.type = TYPES[Number(parts[3])]; it.category = null; it.explicitType = it.type; finalizeItem(it); }
    if (kind === 'c') {
      const cats = it.type === 'Income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
      it.category = cats[Number(parts[3])];
      it.subcategory = (it.rule && it.rule.category === it.category) ? it.rule.subcategory : '';
      finalizeItem(it);
      if (it.type === 'Expense' && it.description && it.source === 'rules') learnRule(it.description, it.category, it.subcategory);
    }
    return advance(p, msgId);
  }
  if (kind === 'u') {
    const c = CacheService.getScriptCache().get('b:' + parts[1]);
    const ids = c ? JSON.parse(c) : null;
    if (!ids) return edit(chatId, msgId, 'ℹ️ Undo expired. Use /undo or /delete <ID>.');
    return askDelete(chatId, msgId, ids);
  }
  if (kind === 'd') {
    const c = CacheService.getScriptCache().get('del:' + parts[1]);
    if (!c) return edit(chatId, msgId, 'ℹ️ Already handled or expired.');
    CacheService.getScriptCache().remove('del:' + parts[1]);
    const n = deleteIds(JSON.parse(c));
    return edit(chatId, msgId, n ? '🗑 Deleted ' + n + ' transaction(s). A copy is kept in Audit_Log.' : 'ℹ️ Nothing to delete (already removed?).');
  }
  if (kind === 'dn') { CacheService.getScriptCache().remove('del:' + parts[1]); return edit(chatId, msgId, 'Kept. Nothing was deleted.'); }
  if (kind === 'cp') return markCommitmentPaid(chatId, parts[1]);
  if (kind === 'iv') return handleInvCallback(chatId, msgId, parts);
  if (kind === 'rk') return askRisk_(chatId, msgId, String(parts[1] || '').split('').map(Number));
  if (kind === 'al') return handleAlertsCallback(chatId, msgId, parts[1]);
  for (const fn of extensionHandlers_('cb')) { if (fn(chatId, msgId, parts)) return; }
  if (kind === 's' && parts[1] === 'conf') {
    const next = confirmModeOn() ? 'OFF' : 'ON';
    setSetting('Confirmation_Mode', next);
    return edit(chatId, msgId, settingsText(), settingsButtons());
  }
}

function askDelete(chatId, msgId, ids) {
  const { rows: data, map } = readTx();
  const found = data.filter(r => ids.indexOf(String(r[map.Transaction_ID])) >= 0);
  if (!found.length) return reply(chatId, msgId, 'ℹ️ Those transactions are no longer in the sheet.');
  const key = shortId();
  CacheService.getScriptCache().put('del:' + key, JSON.stringify(ids), 3600);
  const lines = found.slice(0, 10).map(r => '• ' + fmtMoney(Number(r[map.Amount]), r[map.Currency]) + ' · ' + r[map.Transaction_Type] + ' · ' + r[map.Category] + ' (' + r[map.Transaction_ID] + ')');
  if (found.length > 10) {
    const total = found.reduce((a, r) => a + (Number(r[map.Amount]) || 0), 0);
    lines.push('…and ' + (found.length - 10) + ' more (' + found.length + ' transactions, ' + fmtMoney(total, 'EGP') + ' in total)');
  }
  return reply(chatId, msgId, 'Delete these?\n' + lines.join('\n'), [[
    { text: '🗑 Delete', callback_data: 'd|' + key }, { text: 'Keep', callback_data: 'dn|' + key }]]);
}

function deleteIds(ids) {
  const sh = txSheet();
  const { rows: data, map } = readTx();
  const targets = [];
  data.forEach((r, i) => { if (ids.indexOf(String(r[map.Transaction_ID])) >= 0) targets.push({ row: i + 2, r: r }); });
  if (typeof onTransactionsDeleted === 'function') { try { onTransactionsDeleted(targets.map(t => rowObj(t.r, map))); } catch (e) { console.error('Thndr sync: ' + e); } }
  if (targets.length > 20) {
    const kill = {}; targets.forEach(t => { kill[t.row] = 1; });
    const keep = data.filter((r, i) => !kill[i + 2]);
    const width = sh.getLastColumn();
    const aud = ss().getSheetByName(SH.AUDIT);
    if (aud) aud.getRange(aud.getLastRow() + 1, 1, targets.length, 6).setValues(targets.map(t => [new Date(), 'DELETE', t.r[map.Transaction_ID], JSON.stringify(rowObj(t.r, map)), '', 'Telegram']));
    if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
    sh.getRange(2 + keep.length, 1, data.length - keep.length, width).clearContent();
    return targets.length;
  }
  targets.sort((a, b) => b.row - a.row).forEach(t => {
    audit('DELETE', t.r[map.Transaction_ID], rowObj(t.r, map), null, 'Telegram');
    sh.deleteRow(t.row);
  });
  return targets.length;
}

// =====================================================================================
// COMMANDS
// =====================================================================================
function helpText() {
  return 'How to use me:\n' +
    '• Just type what happened, Arabic or English:\n  دفعت 350 بنزين و120 قهوة\n  قبضت المرتب 30000\n  حطيت 3000 في ثاندر\n  paid 85 uber yesterday\n' +
    '• Amounts like ٢ ألف, 1.5k, 1,500 work.\n\nCommands:\n' +
    '/dashboard — open your dashboard\n/today — today\'s transactions\n/month — this cycle so far\n/budget — budget by category\n/saving — what you can save or invest\n' +
    '/commitments — bills this cycle (tap to mark paid)\n/goals — goal progress\n/export — CSV of this cycle (/export all)\n' +
    '/investments — portfolio vs target\n/invest [amount] — how to split new money\n/risk — risk profile (5 questions)\n' +
    '/price COMI 92.5 — update prices\n/buy COMI 100 85.5 [fee] · /sell … · /dividend COMI 350\n/thndrcash 12000 — set uninvested Thndr cash\n' +
    '/undo — remove the last saved message\n/delete TX-… — remove one transaction\n/add <text> — same as typing\n' +
 '/import — bring in past expenses from your Notes\n' +
    '/report — last cycle\'s report as PDF (/report now for this cycle)\n/alerts — daily alert settings\n/settings — confirmation mode, AI status\n/help — this message';
}

/** Handlers provided by phase files (Phase4.gs … Phase9.gs). Missing phases are skipped. */
function extensionHandlers_(kind) {
  // Newest phase first, so a newer phase can replace an older placeholder reply.
  if (kind === 'cmd') return [
    typeof handleCommandImport === 'function' ? handleCommandImport : null,
    typeof handleCommand9 === 'function' ? handleCommand9 : null, typeof handleCommand8 === 'function' ? handleCommand8 : null,
    typeof handleCommand7 === 'function' ? handleCommand7 : null, typeof handleCommand6 === 'function' ? handleCommand6 : null,
    typeof handleCommand5 === 'function' ? handleCommand5 : null, typeof handleCommand4 === 'function' ? handleCommand4 : null,
  ].filter(Boolean);
  return [
    typeof handleCallbackImport === 'function' ? handleCallbackImport : null,
    typeof handleCallback7 === 'function' ? handleCallback7 : null, typeof handleCallback8 === 'function' ? handleCallback8 : null,
    typeof handleCallback9 === 'function' ? handleCallback9 : null,
  ].filter(Boolean);
}

function handleCommand(chatId, text) {
  let cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
  let arg = text.slice(text.split(/\s+/)[0].length).trim();
  if (['/dashboard_url', '/dashboardurl', '/setdashboard', '/set_dashboard'].indexOf(cmd) >= 0) { cmd = '/dashboard'; arg = 'url ' + arg; }
  switch (cmd) {
    case '/start': case '/help': return send(chatId, helpText());
    case '/add': return arg ? handleText(chatId, arg) : send(chatId, 'Send it like: /add دفعت 200 صيدلية');
    case '/today': return send(chatId, todayText());
    case '/month': return send(chatId, monthText());
    case '/undo': {
      const lb = JSON.parse(prop('LAST_BATCH') || 'null');
      if (!lb || !lb.ids.length) return send(chatId, 'Nothing to undo yet.');
      return askDelete(chatId, null, lb.ids);
    }
    case '/delete': {
      const id = arg.trim().toUpperCase();
      if (!/^TX-/.test(id)) return send(chatId, 'Use: /delete TX-… (the ID is shown in /today).');
      return askDelete(chatId, null, [id]);
    }
    case '/settings': return send(chatId, settingsText(), settingsButtons());
    case '/version': return send(chatId, versionText());
    default:
      // Phase files plug in here; a phase that isn't installed is simply skipped.
      for (const fn of extensionHandlers_('cmd')) { if (fn(chatId, cmd, arg)) return; }
      return send(chatId, 'That command isn\'t available yet. /help shows what works now.');
  }
}

/** Which parts of the system are installed (helps when a file was not updated). */
function versionText() {
  const has = n => { try { return typeof eval(n) === 'function'; } catch (e) { return false; } };
  const parts = [
    ['Core bot (Code.gs)', true, 'v7'],
    ['Phase 3 calculations', has('upgradePhase3'), ''],
    ['Phase 4 commands & alerts', has('upgradePhase4'), has('fixCommitments') ? '' : 'Code.gs is older than the commitments fix'],
    ['Phase 5 investments', has('upgradePhase5'), ''],
    ['Phase 6 dashboard', has('upgradePhase6'), has('cleanExecUrl_') ? 'latest' : 'OLD Phase6.gs — paste the newest one'],
    ['Phase 7 monthly report', has('upgradePhase7'), ''],
    ['Import from Notes', has('handleCommandImport'), ''],
    ['Phase 8 voice', has('upgradePhase8'), ''],
  ];
  return '🧩 Installed\n' + parts.map(p => (p[1] ? '✅ ' : '❌ ') + p[0] + (p[2] ? ' (' + p[2] + ')' : '')).join('\n');
}

function settingsText() {
  return '⚙️ Settings\nConfirmation mode: ' + (confirmModeOn() ? 'ON (I ask before saving)' : 'OFF (clear entries save instantly)') +
    '\nAI fallback: ' + (prop('GEMINI_API_KEY') ? 'enabled' : 'off (rules only)') +
    '\nOther settings live in the Settings tab of your sheet.';
}
function settingsButtons() { return [[{ text: confirmModeOn() ? 'Turn confirmation OFF' : 'Turn confirmation ON', callback_data: 's|conf' }]]; }

function todayRows() {
  const { rows: data, map } = readTx();
  const today = fmt(new Date(), 'yyyy-MM-dd');
  return { list: data.filter(r => dateKey(r[map.Transaction_Date]) === today), map: map };
}
function todaySpent() {
  const { list, map } = todayRows();
  return list.reduce((s, r) => {
    if (r[map.Currency] && r[map.Currency] !== 'EGP') return s;
    if (r[map.Transaction_Type] === 'Expense') return s + Number(r[map.Amount]);
    if (r[map.Transaction_Type] === 'Refund') return s - Number(r[map.Amount]);
    return s;
  }, 0);
}
function todayText() {
  const { list, map } = todayRows();
  if (!list.length) return 'No transactions today yet.';
  const lines = list.slice(-25).map(r => {
    const t = isDate(r[map.Transaction_Time]) ? fmt(r[map.Transaction_Time], 'HH:mm') : String(r[map.Transaction_Time] || '').slice(0, 5);
    return t + '  ' + fmtMoney(Number(r[map.Amount]), r[map.Currency]) + '  ' + (r[map.Subcategory] || r[map.Category]) +
      (r[map.Transaction_Type] !== 'Expense' ? ' [' + r[map.Transaction_Type] + ']' : '') + '\n      ' + r[map.Transaction_ID];
  });
  return '📅 Today\n' + lines.join('\n') + '\n\nSpent today (expenses − refunds): ' + fmtMoney(todaySpent(), 'EGP');
}

/** Cycle totals using the SAME definitions as the Summary tab (EGP only). from/to are yyyy-MM-dd. */
function cycleTotals(from, to) {
  const { rows: data, map } = readTx();
  const t = { income: 0, salary: 0, expense: 0, refund: 0, debt: 0, savings: 0, invest: 0, withdraw: 0, ret: 0, fixed: 0, cats: {}, skipped: 0 };
  data.forEach(r => {
    const d = dateKey(r[map.Transaction_Date]);
    if (!d || d < from || d > to) return;
    if (r[map.Currency] !== 'EGP') { if (r[map.Amount] !== '') t.skipped++; return; }
    const a = Number(r[map.Amount]) || 0, ty = r[map.Transaction_Type], c = r[map.Category], rec = r[map.Recurring_Flag] === 'Yes';
    if (ty === 'Income') { t.income += a; if (c === 'Salary') t.salary += a; }
    else if (ty === 'Expense') { t.expense += a; t.cats[c] = (t.cats[c] || 0) + a; if (rec) t.fixed += a; }
    else if (ty === 'Refund') { t.refund += a; t.cats[c] = (t.cats[c] || 0) - a; if (rec) t.fixed -= a; }
    else if (ty === 'Debt Payment') t.debt += a;
    else if (ty === 'Savings Transfer') t.savings += a;
    else if (ty === 'Investment Contribution') t.invest += a;
    else if (ty === 'Investment Withdrawal') t.withdraw += a;
    else if (ty === 'Investment Return') t.ret += a;
  });
  t.consumption = t.expense - t.refund;
  t.variable = t.consumption - t.fixed;
  t.savedInvested = t.savings + t.invest - t.withdraw;
  t.savingsRate = t.income ? (t.income - t.consumption - t.debt) / t.income : null;
  return t;
}
function monthText() {
  const c = cycleFor_(fmt(new Date(), 'yyyy-MM-dd'), cycleStartDay_());
  const t = cycleTotals(c.start, c.end);
  const top = Object.keys(t.cats).map(k => [k, t.cats[k]]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return '📊 Cycle ' + c.start + ' → ' + c.end + '\n' +
    'Income: ' + fmtMoney(t.income) + '\n' +
    'Spending (net of refunds): ' + fmtMoney(t.consumption) + '\n' +
    (t.debt ? 'Debt payments: ' + fmtMoney(t.debt) + '\n' : '') +
    'Saved + invested: ' + fmtMoney(t.savedInvested) + '\n' +
    'Savings rate: ' + (t.savingsRate === null ? 'n/a (no income recorded this cycle)' : Math.round(t.savingsRate * 1000) / 10 + '%') +
    (top.length ? '\n\nTop categories:\n' + top.map(x => '• ' + x[0] + ': ' + fmtMoney(x[1])).join('\n') : '') +
    (t.skipped ? '\n\n(' + t.skipped + ' non-EGP transaction(s) not included)' : '');
}

// =====================================================================================
// GEMINI (optional fallback)
// =====================================================================================
function geminiParse(text) {
  const key = prop('GEMINI_API_KEY');
  if (!key) return { error: 'no key' };
  const configured = String(getSettings().Gemini_Model || '').trim();
  const models = configured ? [configured].concat(DEFAULT_GEMINI_MODELS.filter(m => m !== configured)) : DEFAULT_GEMINI_MODELS;
  const prompt =
    'Extract personal-finance transactions from this Egyptian Arabic or English message. Return ONLY JSON: ' +
    '{"transactions":[{"amount":number,"type":string,"category":string,"subcategory":string,"description":string}]}.\n' +
    'Rules: one entry per amount mentioned; copy amounts exactly as written (convert "2 الف" to 2000); never invent amounts.\n' +
    'type must be one of: ' + TYPES.join(', ') + '. Use "Unknown" if unclear.\n' +
    'For Expense/Refund, category must be one of: ' + EXPENSE_CATEGORIES.join(', ') + '. For Income: Salary or Additional Income.\n' +
    'description: 1-4 words in English.\nMessage: ' + text;
  for (const model of models) {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
    });
    const code = res.getResponseCode();
    if (code === 404) continue;                       // model retired → try the next one
    if (code === 429) return { error: 'free quota reached, try later' };
    if (code !== 200) return { error: 'HTTP ' + code };
    try {
      const j = JSON.parse(res.getContentText());
      const txt = j.candidates[0].content.parts.map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
      return { items: JSON.parse(txt).transactions, model: model };
    } catch (e) { return { error: 'unreadable AI reply' }; }
  }
  return { error: 'no available model' };
}

// =====================================================================================
// SHEET-SIDE: manual entry support, setup, menu
// =====================================================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Finance')
    .addItem('Fill missing transaction IDs', 'fillMissingIds')
    .addItem('Fix commitments (IDs, status, due day)', 'fixCommitmentsMenu')
    .addItem('Bot status', 'botStatus')
    .addSeparator()
    .addItem('Upgrade to Phase 3 (run once)', 'upgradePhase3')
    .addItem('Refresh insights now', 'refreshInsights')
    .addItem('Snapshot previous cycle now', 'snapshotPreviousNow')
    .addSeparator()
    .addItem('Upgrade to Phase 4 (run once)', 'upgradePhase4')
    .addItem('Send alert check now', 'alertsJobNow')
    .addSeparator()
    .addItem('Upgrade to Phase 5 (run once)', 'upgradePhase5')
    .addItem('Upgrade to Phase 6 (run once)', 'upgradePhase6')
    .addItem('Upgrade to Phase 7 (run once)', 'upgradePhase7')
    .addItem('Send last cycle\'s report now', 'sendMonthlyReport')
    .addSeparator()
    .addItem('Run the newest phase upgrade', 'upgradeLatest')
    .addToUi();
}

/** Simple trigger: gives manually typed rows an ID and timestamps, and logs single-cell edits. */
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() === 'Commitments' && e.range.getRow() >= 2) return fixCommitments(sh);
  if (sh.getName() !== SH.TX || e.range.getRow() < 2) return;
  const map = headerMap(sh);
  const width = sh.getLastColumn();
  const r0 = e.range.getRow(), n = e.range.getNumRows();
  const block = sh.getRange(r0, 1, n, width).getValues();
  let changed = false;
  block.forEach((row, i) => {
    const hasData = row[map.Transaction_Date] !== '' && row[map.Amount] !== '';
    if (!row[map.Transaction_ID] && hasData) {
      row[map.Transaction_ID] = 'TX-' + Utilities.formatDate(new Date(), TZ, 'yyMMdd-HHmmss') + '-M' + (r0 + i);
      if (!row[map.Created_At]) row[map.Created_At] = new Date();
      if (!row[map.Source]) row[map.Source] = 'Manual';
      if (!row[map.Currency]) row[map.Currency] = 'EGP';
      changed = true;
    } else if (row[map.Transaction_ID] && e.range.getColumn() - 1 !== map.Updated_At) {
      row[map.Updated_At] = new Date(); changed = true;
    }
  });
  if (changed) sh.getRange(r0, 1, n, width).setValues(block);
  if (n === 1 && e.range.getNumColumns() === 1 && block[0][map.Transaction_ID] && e.oldValue !== undefined) {
    const col = Object.keys(map).find(k => map[k] === e.range.getColumn() - 1);
    audit('EDIT', block[0][map.Transaction_ID], { [col]: e.oldValue }, { [col]: e.value }, 'Manual');
  }
}

/** Gives every commitment that has a Name an ID (CMT-###), Active status and Monthly frequency if missing,
 *  and converts a full date typed in Due_Date into its day of the month. */
function fixCommitments(sh) {
  sh = sh || ss().getSheetByName('Commitments');
  const last = sh.getLastRow(); if (last < 2) return 0;
  const vals = sh.getRange(2, 1, last - 1, 9).getValues();
  let maxN = 0;
  vals.forEach(r => { const m = String(r[0]).match(/^CMT-(\d+)$/i); if (m) maxN = Math.max(maxN, Number(m[1])); });
  let changed = 0;
  vals.forEach(r => {
    if (!r[1]) return;
    if (!r[0]) { r[0] = 'CMT-' + String(++maxN).padStart(3, '0'); changed++; }
    if (!r[8]) { r[8] = 'Active'; changed++; }
    if (!r[5]) { r[5] = 'Monthly'; changed++; }
    if (isDate(r[4])) { r[4] = Number(fmt(r[4], 'd')); changed++; }
  });
  if (changed) sh.getRange(2, 1, vals.length, 9).setValues(vals);
  return changed;
}
function fixCommitmentsMenu() { const n = fixCommitments(); SpreadsheetApp.getActive().toast(n ? 'Commitments fixed.' : 'Commitments already complete.'); }

function fillMissingIds() {
  const sh = txSheet(); const map = headerMap(sh); const last = sh.getLastRow();
  if (last < 2) return;
  const data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  let n = 0;
  data.forEach((row, i) => {
    if (!row[map.Transaction_ID] && row[map.Transaction_Date] !== '' && row[map.Amount] !== '') {
      row[map.Transaction_ID] = 'TX-' + fmt(new Date(), 'yyMMdd-HHmmss') + '-M' + (i + 2);
      if (!row[map.Created_At]) row[map.Created_At] = new Date();
      if (!row[map.Source]) row[map.Source] = 'Manual';
      if (!row[map.Currency]) row[map.Currency] = 'EGP';
      n++;
    }
  });
  if (n) sh.getRange(2, 1, data.length, data[0].length).setValues(data);
  SpreadsheetApp.getActive().toast(n + ' IDs filled.');
}

/** Run once. Safe to run again. */
function setup() {
  if (!prop('BOT_TOKEN')) throw new Error('Add BOT_TOKEN in Project Settings > Script Properties first.');
  const s = ss();
  s.setSpreadsheetTimeZone(TZ);
  let rules = s.getSheetByName(SH.RULES);
  if (!rules) {
    rules = s.insertSheet(SH.RULES);
    rules.getRange(1, 1, 1, 6).setValues([['Keyword', 'Type', 'Category', 'Subcategory', 'Source', 'Added_At']]).setFontWeight('bold');
    rules.getRange(2, 1, DEFAULT_RULES.length, 6).setValues(DEFAULT_RULES.map(r => r.concat(['Built-in', new Date()])));
    rules.setFrozenRows(1);
  }
  let aud = s.getSheetByName(SH.AUDIT);
  if (!aud) {
    aud = s.insertSheet(SH.AUDIT);
    aud.getRange(1, 1, 1, 6).setValues([['Logged_At', 'Action', 'Transaction_ID', 'Before', 'After', 'Source']]).setFontWeight('bold');
    aud.setFrozenRows(1);
  }
  const st = getSettings();
  if (st.Duplicate_Window_Minutes === undefined) setSetting('Duplicate_Window_Minutes', 10, 'Same amount + type + date saved within this many minutes asks for confirmation.');
  if (st.Gemini_Model === undefined) setSetting('Gemini_Model', DEFAULT_GEMINI_MODELS[0], 'Free-tier Gemini model used as AI fallback. If it is retired, the bot tries newer Flash-Lite names automatically.');
  if (st.Confirmation_Mode === undefined) setSetting('Confirmation_Mode', 'ON', 'ON = bot asks before saving.');
  CacheService.getScriptCache().remove('rules');
  tg('deleteWebhook', { drop_pending_updates: false });
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'pollUpdates').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pollUpdates').timeBased().everyMinutes(1).create();
  const me = tg('getMe', {});
  console.log(me.ok ? 'Setup done. Open @' + me.result.username + ' in Telegram and send /start.' : 'Setup done, but the BOT_TOKEN looks wrong.');
}

function botStatus() {
  const me = tg('getMe', {});
  const trig = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'pollUpdates');
  const msg = 'Bot: ' + (me.ok ? '@' + me.result.username : 'token problem') + '\nPolling trigger: ' + (trig ? 'on' : 'OFF — run setup') +
    '\nOwner linked: ' + (prop('OWNER_ID') ? 'yes' : 'no — send /start') + '\nAI fallback: ' + (prop('GEMINI_API_KEY') ? 'on' : 'off');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

/** Emergency: unlink the owner (then send /start again from your account). */
function resetOwner() { PropertiesService.getScriptProperties().deleteProperty('OWNER_ID'); }

/** Menu: runs the upgrade of the newest phase file installed (so a new phase needs no Code.gs change). */
function upgradeLatest() {
  const ups = [typeof upgradePhase9 === 'function' ? [9, upgradePhase9] : null, typeof upgradePhase8 === 'function' ? [8, upgradePhase8] : null,
    typeof upgradePhase7 === 'function' ? [7, upgradePhase7] : null, typeof upgradePhase6 === 'function' ? [6, upgradePhase6] : null].filter(Boolean);
  if (!ups.length) return;
  ups[0][1]();
  try { SpreadsheetApp.getActive().toast('Phase ' + ups[0][0] + ' upgrade done.'); } catch (e) { }
}

/** Menu helper: run the alert check immediately. */
function alertsJobNow() { if (!alertsJob(true)) SpreadsheetApp.getActive().toast('Nothing new to report.'); }

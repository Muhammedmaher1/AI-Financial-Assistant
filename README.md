# EGP Finance Assistant

A personal finance assistant that runs entirely on free tools: a private **Telegram bot** records your spending in Arabic or English, a **Google Sheet** is the database, **Google Apps Script** does the work, and a private **mobile dashboard** shows where your money goes. Built for Egypt (EGP, Cairo time, Egyptian Arabic, Thndr).

No server, no paid database, no subscription. Optional AI (Gemini free tier) only helps with wording; every money calculation is a spreadsheet formula.

## What it does

- **Record by chat:** `دفعت 350 بنزين و120 قهوة` becomes two categorized transactions. Understands Egyptian Arabic, English and Franco-Arabic (`2ahwa`, `benzen`), amounts like `٢ ألف`, `1.5k`, `1,500`, and "امبارح".
- **No double counting:** separate types for expenses, income, refunds, savings transfers, investment contributions/withdrawals, debt payments and transfers between your own accounts.
- **Budgets and cycles:** calendar months or payday-to-payday cycles, projections based on your typical spending, warnings only when something actually changes.
- **Bills:** recurring commitments, due dates, overdue alerts, one-tap "mark paid", automatic linking when you type a payment.
- **Saving capacity:** cash after bills, expected spending and a buffer, then emergency fund first, goals second, "free to invest" third.
- **Investments:** holdings and Thndr cash kept in sync from Telegram (`/buy`, `/sell`, `/price`), allocation against a target mix chosen with a short risk questionnaire.
- **Daily alerts** in Telegram (only when something is new) and a **monthly PDF report** by email with optional AI commentary whose numbers are checked against your data.
- **Dashboard** for iPhone: cycle "runway" chart, budgets, bills, investments, goals, and an **Explore** view for any date range.
- **Import** past expenses by pasting notes from your phone; the bot asks once per unknown word and remembers it.

## How it fits together

```
iPhone ─► Telegram bot ─► Apps Script (polls every minute)
                              │  rules first, AI only as a fallback
                              ▼
                        Google Sheet (database + all formulas)
                              │
          ┌───────────────────┼────────────────────┐
          ▼                   ▼                    ▼
   Telegram commands    Mobile dashboard     Monthly PDF email
   and daily alerts     (web app, private)   (Gmail)
```

## Files

| Path | What it is |
|---|---|
| `apps-script/Code.gs` | Core bot: message parsing, saving, undo, settings, menu |
| `apps-script/Phase3.gs` | Calculation engine: Summary, Budgets, Commitments formulas, snapshots, insights |
| `apps-script/Phase4.gs` | Commands (`/budget`, `/saving`, `/commitments`, `/goals`, `/export`) and daily alerts |
| `apps-script/Phase5.gs` | Investments: portfolio, risk profile, allocation, Thndr cash sync |
| `apps-script/Phase6.gs` + `Dashboard.html` | Private mobile dashboard and the Explore date filter |
| `apps-script/Phase7.gs` | Monthly PDF report, email, checked AI commentary |
| `apps-script/Import.gs` | Bulk import of past expenses from pasted notes |
| `apps-script/appsscript.json` | Optional manifest (sets the Cairo time zone) |
| `sheet-template/Finance_Database_template.xlsx` | Starting spreadsheet with clearly labelled example rows |
| `tests/` | Automated checks that run with plain Node.js |

## Setup

You need a Google account and Telegram. Setup is easiest on a computer.

1. **Create the sheet.** Upload `sheet-template/Finance_Database_template.xlsx` to Google Drive, open it, and choose **File › Save as Google Sheets**. Delete every row marked EXAMPLE.
2. **Create the bot.** In Telegram, message **@BotFather**, send `/newbot`, and copy the token.
3. **Add the code.** In the sheet, open **Extensions › Apps Script**. Replace `Code.gs` with this repo's `Code.gs`, then add each of the other `.gs` files as a new **Script** with the same name, and `Dashboard.html` as a new **HTML** file named `Dashboard`.
4. **Add your secrets** in **Project Settings › Script Properties** (never in the code):
   - `BOT_TOKEN`: your BotFather token
   - `GEMINI_API_KEY`: optional, from Google AI Studio
5. **Set the time zone** in **Project Settings** to `(GMT+02:00) Cairo`.
6. **Run `setup`** from the editor once and approve the permissions. Then send `/start` to your bot: the first account to do so becomes the only one the bot will listen to.
7. **Install the rest.** Reload the sheet and run, in order, **Finance › Upgrade to Phase 3, 4, 5, 6, 7**.
8. **Dashboard.** **Deploy › New deployment › Web app**, Execute as **Me**, Who has access **Anyone**. Paste the `/exec` URL to the bot; it replies with your private link. The link contains a 40-character secret key; `/dashboard new` replaces it if it ever leaks.
9. **Check** with `/version`: every part should show ✅.

After changing code later, publish it with **Deploy › Manage deployments › ✏️ › New version** (the dashboard link stays the same).

## Everyday commands

| Command | Use |
|---|---|
| *(just type)* | `دفعت 200 صيدلية`, `قبضت المرتب 30000`, `paid 85 uber yesterday` |
| `/today`, `/month` | Today's entries, this cycle so far |
| `/budget`, `/saving` | Budget status, what you can save or invest |
| `/commitments`, `/goals` | Bills this cycle (tap to mark paid), goal progress |
| `/investments`, `/invest 5000` | Portfolio vs target, how to split new money |
| `/price COMI 92.5`, `/buy`, `/sell`, `/dividend`, `/thndrcash` | Keep holdings current |
| `/risk` | Five-question risk profile |
| `/report`, `/report current`, `/report email` | PDF report |
| `/import` then `/done` | Bring in past expenses from your notes |
| `/dashboard`, `/export`, `/undo`, `/alerts`, `/settings`, `/version`, `/help` | Everything else |

## Privacy and security

- Your data stays in **your own Google account**. Nothing is sent to a third-party server.
- Secrets live in Apps Script **Script Properties**, never in the sheet or the code. This repository contains no tokens, keys, IDs or personal data.
- The bot answers only the Telegram account that sent the first `/start`.
- AI is optional. When enabled it receives single short messages or summarized totals, never your full ledger, and AI-proposed amounts are rejected unless they appear in your own text. Note that Google may use free-tier Gemini inputs to improve its products.
- The dashboard works without Google sign-in through a secret link; treat it like a password.

## Running the tests

```
npm test        # or: node tests/run-all.js
```

The tests use mocked Google and Telegram services and run with Node.js 18+, no installs needed. They cover message parsing, the full bot flow, imports, the dashboard key and the Explore calculations. A few scenarios use fixed dates from October 2026 and assume the computer clock is close to that year. The spreadsheet-formula tests used during development (which recalculate the sheet with LibreOffice) are not included.

## Known limits

- **Thndr** has no public API: holdings and prices are updated with bot commands or by hand. Google's price function does not reliably cover EGX stocks or fund prices.
- **Free tiers change.** Gemini models and quotas have changed before; the bot works without AI if needed.
- The bot checks Telegram once a minute, so replies can take up to a minute (this avoids a duplicate-message problem with Apps Script webhooks).
- Voice messages are not supported yet.
- Amounts in currencies other than EGP are stored but left out of totals.

## Disclaimer

This is a personal budgeting tool, not financial advice. Allocation suggestions come from targets you set yourself.

## License

No license has been chosen yet. Until one is added, others may view the code but not reuse it. Add a `LICENSE` file (for example MIT) if you want people to be able to use it.

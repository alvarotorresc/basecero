<div align="center">

<img src="app/img/logo.svg" alt="" width="72">

# BaseCero

**Your money, from zero.**

Personal finance that lives entirely on your device, with no accounts and no cloud.<br>
For anyone who tracks their spending by hand and wants to stay the owner of their data.

[Español](README.md) · **English**

<a href="https://basecero.alvarotc.com/app/"><img src="https://img.shields.io/badge/Open%20the%20app-basecero.alvarotc.com-4FD99A?style=for-the-badge&labelColor=121214" alt="Open the app"></a>

[Project website](https://basecero.alvarotc.com/en/) · [Install](#installation)

<a href="https://github.com/alvarotorresc/basecero/releases/latest"><img src="https://img.shields.io/github/v/release/alvarotorresc/basecero?display_name=tag&label=version" alt="Latest version"></a>
<a href="https://github.com/alvarotorresc/basecero/actions/workflows/ci.yml"><img src="https://github.com/alvarotorresc/basecero/actions/workflows/ci.yml/badge.svg" alt="Test status"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>

</div>

![The home, transactions and net worth screens of BaseCero](.github/readme/hero.png)

## What it is

BaseCero orders your money into payday-to-payday periods and tells you, at any moment, what is
actually left. It is for anyone who tracks their spending by hand, wants to see where the month
went, and would rather their accounts didn't live on somebody else's server. It opens in your
browser, installs like an app, and works offline.

**No accounts · no server · no cloud · no telemetry.**

## What it does

- **Your month starts the day you get paid.** Payday-to-payday periods, not the 1st to the 30th.
  Close one and you see what you spent, what you saved, and your savings rate for the stretch.
- **Logging, fast.** One screen, with the phone keypad for the amount. Five kinds of entry:
  expense, income, transfer, refund and adjustment.
- **Spending by category.** One screen with all your categories, sorted by what you have spent so
  far, each one expanding into its breakdown by subcategory. You set a limit only where it helps,
  and change or remove it right there. The home screen tells you whether you are above or below the
  pace of the plan.
- **Categories that are yours.** You start with 41 across two levels and change the name,
  colour, icon and order. The ones you don't need get archived without touching your history.
- **Shared expenses, both ways.** You log who paid and which share is yours. If the other person
  paid, the expense counts as yours but doesn’t touch your accounts until you settle up;
  “Settle up” shows both debts, the net figure, and closes them in one go. Expenses are the ones
  that get split: income belongs to whoever earns it.
- **Recurring entries and forecasting.** Rules for the rent, subscriptions or your salary. With
  them the home screen works out what is still committed and what is really available.
- **Net worth.** Your net worth today and how it moved, current and savings accounts, debts with
  their instalment and how many are left, and savings goals.
- **Import your bank statement.** N26 CSVs are recognised on their own; for any other bank an
  assistant asks once what each column is. It reconciles what you already logged and skips
  duplicates.
- **In Spanish and in English,** with the currency and the number and date formats you pick.

## What it looks like

| Home | Transactions | Net worth | Spending by category |
| :--: | :----------: | :-------: | :----: |
| <img src=".github/readme/app-inicio.webp" alt="Home screen showing what's available in the period" width="190"> | <img src=".github/readme/app-movimientos.webp" alt="Transactions grouped by day" width="190"> | <img src=".github/readme/app-patrimonio.webp" alt="Net worth, accounts and goals" width="190"> | <img src=".github/readme/app-presupuesto.webp" alt="Spending by category, with a bar and a limit per category" width="190"> |

_The screenshots show the Spanish build; the app is fully translated._

## Installation

There is no store and nothing to download: your browser keeps BaseCero as an application, with
its own icon and full screen. Open
**[basecero.alvarotc.com/app/](https://basecero.alvarotc.com/app/)** and:

| Platform | How |
| --- | --- |
| **Android / Chrome** | Menu (⋮) → "Add to Home screen", or the browser's own install prompt. |
| **iPhone / Safari** | Share button → "Add to Home Screen". It has to be Safari: iOS doesn't allow installing web apps from other browsers. |
| **Desktop / Chrome, Edge** | The install icon in the address bar, or menu → "Install BaseCero…". |

Once installed it works offline, and to uninstall it you just delete the icon.

## Your data, in your hands

- **No accounts and no server.** No sign-up, no login, no backend. Nothing to leak, because
  there is nothing on the other side.
- **No telemetry, no analytics, no cookies.** The app measures nothing and reports to nobody, so
  there is no banner to consent to either.
- **No third-party requests.** Everything it needs travels inside the repository: it works with
  the network unplugged. The only way out is the link to the feedback form, which opens outside
  the app and carries only what you type into it.
- **Your data never leaves the device.** It lives in a local database in the browser and only
  moves if you export it.
- **And if you leave, you take it with you.** You export an `.xlsx` spreadsheet you can open in
  LibreOffice or Google Sheets, and password-encrypted backups to keep wherever you want.

One honest caveat: what is encrypted are the backups, not the local database. That one lives in
the browser's private storage and is protected by the device itself, so whoever holds your
unlocked phone holds your accounts. And since you keep the keys, there is no "forgot my
password": make backups.

<details>
<summary><b>Technical details</b></summary>

### How it's built

Vanilla JS. No framework, no bundler and no `node_modules`: the code you read is the code that
runs in the browser.

- **Data** — SQLite compiled to WebAssembly, in a Web Worker over OPFS (the origin's private
  storage). If the browser doesn't support it, the app says so and starts in memory.
- **Offline** — a service worker with an explicit precache of the whole shell, including
  SQLite's `.wasm` and the typeface.

### Export and import

- **`.xlsx`** — the full data contract: accounts, categories, periods, transactions, recurring
  rules, goals and budgets. It can be re-imported to replace the data, and a round-trip test
  checks that exporting and re-importing leaves it intact, relationships included.
- **`.bce`** — a backup encrypted with AES-256-GCM and a key derived with PBKDF2-HMAC-SHA256 at
  600,000 iterations, with a 10-character minimum password. It is stored nowhere: if you forget
  it, the backup is unrecoverable.
- **`.json`** — a quick emergency dump from Settings.

### Tests and development

More than 450 tests with Node's native runner, no dependencies. The pure logic — forecasting,
charts, formatting, CSV parsing, backup crypto, the `.xlsx` contract — lives apart from the
database and the DOM precisely so it can be tested that way.
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs them on every push to `main` and
every PR.

```sh
python3 -m http.server 8000 -d app      # the landing on :8000, the app on :8000/app/
node --test tests/app/*.test.mjs        # the tests
```

> Use the glob, not `node --test tests/app`: the directory form is broken in Node 22.22.

### Layout

- [`app/`](app/) — the published root of the site: ES/EN landing, legal pages and static files.
- [`app/app/`](app/app/) — the whole PWA, with `js/screens/` (one screen per file), `js/i18n/`
  (es/en) and `vendor/`.
- [`tests/app/`](tests/app/) — the suite, one file per logic module.

### Known limitations

- **A transfer imported from a CSV can end up duplicated.** The statement carries the transfer’s
  charge as one more line, so it comes in as an uncategorised expense on top of the transfer entry
  you already had. It is not reconciled automatically: delete the duplicate by hand.
- **Income is not split with the other person.** The period’s percentage applies to shared
  expenses; income belongs, in full, to whoever earns it.

### History

BaseCero started life as a Google Sheets spreadsheet with a Python generator and an Apps Script
script. The app replaced all three, and neither program is in the repository any more: all that
survives from those days is the data contract — the same one the `.xlsx` exports and imports today
— and the pure import logic in [`app/app/vendor/pure.js`](app/app/vendor/pure.js), still written in
the Apps Script dialect it was born in.

</details>

## License

MIT — see [`LICENSE`](LICENSE). It bundles third-party software in
[`app/app/vendor/`](app/app/vendor/); the full notices are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md):

- [SheetJS](https://sheetjs.com/) (`xlsx.full.min.js`) — Apache-2.0.
- [SQLite WASM](https://sqlite.org/wasm) — SQLite is public domain; the Emscripten glue code is
  MIT / University of Illinois-NCSA.
- [Outfit](https://fonts.google.com/specimen/Outfit) — SIL Open Font License 1.1.

## Author

Made by [Álvaro Torres](https://github.com/alvarotorresc).

---

<div align="center">

[Website](https://basecero.alvarotc.com/en/) · [Open the app](https://basecero.alvarotc.com/app/) · [License](LICENSE) · [Report a problem](https://tally.so/r/PdJa6B)

</div>

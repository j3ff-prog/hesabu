# Hesabu: how to run it on your computer

## What to install (once)

1. **Node.js (LTS version)**: https://nodejs.org. Click the big "LTS" button, install, accept the defaults.
2. **VS Code**: https://code.visualstudio.com. This is where you read and edit the code.

That's all you need today. Git, GitHub and the others come later.

## Run the app

1. Unzip `hesabu.zip` somewhere easy, for example `Documents\hesabu`.
2. Open VS Code, then **File > Open Folder**, and choose the `hesabu` folder.
3. Open the built-in terminal: **Terminal > New Terminal**.
4. Type this and press Enter (first time only, takes 1 to 2 minutes):

       npm install

5. Then start the app:

       npm run dev

6. Hold Ctrl and click the link it shows (usually `http://localhost:5173`). The app opens in your browser.
   Press **F12**, click the phone icon at the top of the panel that opens, and the page shrinks to phone size.

To stop the app, click the terminal and press Ctrl + C.

## Where your data lives (important)

Right now all shop data is saved **inside the browser on the device you use**. There is no cloud yet.
- It works with no internet.
- Clearing browser data or switching phones **erases it**.
- The owner can't yet see sales from another phone.

**Back up regularly.** Tap your initial (top right) > **Shop settings** > **Download backup**. The file can be restored on the same phone or a new one.

Cloud sync is the next stage of the plan. Until then: staff sign in on the shop phone, and the admin panel (part 3) shows you totals only.

## What is new in this version

- **Ribbon** across the top: logo, shop name, "Saved on this phone / Offline" status, New sale, Data, and your menu.
- **Reports** tab: *Today* and *Dashboard* (charts for sales, profit, credit, stock, busiest hours, spending).
- **Expenses** tab of its own. Choose **New stock**, pick the products and the stock count goes up and the buying price updates. Removing that expense takes the stock back off.
- **Buyer's name** on every sale: optional for cash and M-Pesa, required for credit.
- **Data** (ribbon): download sales, stock, who owes you, credit payments and expenses as CSV (opens in Excel). Upload many products at once from a CSV (download the template first). Excel files: use File > Save As > CSV.
- **Team** (menu > Team): set your PIN, then add people by phone number. Roles: Owner, Manager, Attendant. Attendants cannot see buying prices, profit, expenses or the dashboard. The login details can be sent on WhatsApp.
- **Admin panel** at the address ending `#/admin` (see part 3).

### About staff, PINs and honesty
PINs and roles protect the app on the shop phone from casual snooping. They are not bank-grade: someone who knows how to use browser developer tools on the same phone could get around them. Staff using their **own phones** need the online sync stage, because each phone currently keeps its own data. Keep your recovery code safe (shown once when you set your PIN).

## Part 3: the admin panel (see all shops)

This needs a free Cloudflare account. About 15 minutes, once.

1. In a terminal, go into the `worker` folder: `cd worker` then `npm install`.
2. `npx wrangler login`
3. `npx wrangler d1 create hesabu`. Copy the `database_id` it prints into `worker/wrangler.toml`.
4. `npm run db:init`
5. `npx wrangler secret put ADMIN_KEY` and type a long password (at least 8 characters, use 16+). This is your admin password.
6. `npm run deploy`. It prints an address like `https://hesabu-registry.YOURNAME.workers.dev`.
7. Back in the main folder, create a file called `.env.production` containing one line:

       VITE_API_URL=https://hesabu-registry.YOURNAME.workers.dev

8. `npm run build`, then put the new `dist` on your host.

Now every shop that opens Hesabu while online appears in the admin panel. Open `your-app-address/#/admin`, enter the admin key. You can search shops, see last use and 30-day totals, message the owner on WhatsApp, mark a shop Trial / Paying / Suspended, set a "paid until" date (it suspends automatically when the date passes) and add a message the shop sees. Suspended shops can still view and download their data but cannot record new sales.

Limits to know: you see totals only (names, owner number, counts), never individual sales. Suspension is enforced on the phone, so a technical person could work around it; it is a nudge to pay, not a lock. Payments are tracked by you by hand for now.

## What the files are

| File or folder | What it does |
|---|---|
| `src/App.tsx` | Page layout, tabs, sign-in gate, which panels open |
| `src/Ribbon.tsx` | The top bar and the menu |
| `src/Sell.tsx` | Sell screen and "Review sale" (buyer name) |
| `src/Stock.tsx` | Stock list and add/edit product |
| `src/Credit.tsx`, `src/creditLogic.ts` | Who owes you, payments, reminders |
| `src/Expenses.tsx`, `src/ExpenseSheet.tsx` | Expenses and the "New stock" purchase flow |
| `src/Reports.tsx`, `src/Today.tsx` | Reports tab and the day summary |
| `src/Dashboard.tsx`, `src/Charts.tsx`, `src/analytics.ts` | Dashboard charts and the maths behind them |
| `src/DataSheet.tsx`, `src/csv.ts` | CSV download and bulk stock upload |
| `src/Team.tsx`, `src/SignIn.tsx`, `src/Auth.tsx`, `src/auth.ts`, `src/rights.ts` | Staff, PINs, roles and what each role can do |
| `src/Admin.tsx`, `src/cloud.ts` | Admin panel and the shop's check-in to the registry |
| `src/DayTools.tsx` | Close the day (cash count) |
| `src/Settings.tsx` | Shop name, owner's number, backup and restore |
| `src/db.ts` | The database on the device |
| `src/styles.css` | All colours, sizes and fonts |
| `worker/` | The registry that powers the admin panel (part 3) |
| `public/` | The app icons |
| `vite.config.ts`, `package.json` | Build setup and tool list |

You can ignore `node_modules` and `dist`.

## Make a build

    npm run build

This checks the code for mistakes and creates the finished app in the `dist` folder.

## Putting it on a real phone

Installing the app on a phone and using it offline needs a secure (https) link, so it must be put online first. A free host such as Cloudflare Pages does this. That is the next step, and we'll do it together.

# Tallyfy setup (Supabase version)

## 0. Moving from the old test version (once)
SQL Editor > run `supabase/cleanup-test-data.sql`. This deletes the old test account and shop. Then clear the site data on your phone (or sign out), open the app and make a new account. After that, do step 4 again to make yourself admin.

## 1. Database (Supabase > SQL Editor)
Run each file as a NEW query, in this order. Skip any you already ran:
1. `0001_init.sql` (done)
2. `0002_push_sale.sql`
3. `0003_split_pay.sql`
To run one: open the file in Notepad, copy everything, paste into the SQL Editor, press Run. It should say "Success".

## 2. Staff function (so owners can add staff and you can reset PINs)
No computer tools needed:
1. Supabase > Edge Functions > "Deploy a new function" > "Via Editor".
2. Name it exactly `add-staff`.
3. Delete the sample code, paste everything from `supabase/functions/add-staff/index.ts`, press Deploy.
Do it again with the new file every time it changes.

## 3. Put the app online
Copy these files over your project (replace `src`, `supabase`, `package.json`, `package-lock.json`, add `.npmrc`), delete `src/cloud.ts` and the `worker` folder if present, then:
```
git add . && git commit -m "Supabase" && git push
```
Cloudflare rebuilds by itself. No environment variables are needed (the project address and public key are built in).

## 4. You as Tallyfy admin
Sign up in the app with your own number once. Then SQL Editor:
```
insert into platform_admins (user_id)
select id from auth.users where email = '2547XXXXXXXX@tallify.app';
```
(use your number, 2547... format). Open `https://YOUR-SITE/#/admin` and sign in.

## 5. Your mother
She opens the site on her phone, taps "Make an account", names the shop (choose "Food and drinks I make"), and installs it (browser menu > Add to Home screen). In Menu > Team she adds you as Manager with your number.

## 6. Notifications and support chat
1. SQL Editor: run `supabase/migrations/0006_push_support.sql`.
2. On your computer, in any folder, run `npx web-push generate-vapid-keys`. It prints a Public Key and a Private Key.
3. Supabase > Edge Functions > Secrets: add `VAPID_PUBLIC_KEY` (the public one) and `VAPID_PRIVATE_KEY` (the private one). Never paste the private key anywhere else.
4. Edge Functions > Deploy a new function > Via Editor. Name it `notify`, paste `supabase/functions/notify/index.ts`, switch "Verify JWT" OFF, Deploy.
5. Push the app (the service worker file `public/push-sw.js` is included).
6. In the app: Menu > Notifications > Turn notifications on. As admin, open `#/admin` > Support messages > turn notifications on to hear when a shop writes to you.

## Tests
`node tests/fakeserver.mjs` and build with `VITE_FAKE_CLOUD=http://localhost:8799` to run the two-phone test.

## Not done yet
Paystack automatic billing. Until then use the admin page to set a shop to Paying and a "paid until" date.

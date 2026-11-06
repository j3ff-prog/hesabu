# Hesabu setup (Supabase version)

## 1. Database (once)
Supabase dashboard > SQL Editor. Run these in order, each as a new query:
1. `supabase/migrations/0001_init.sql` (you already did this)
2. `supabase/migrations/0002_push_sale.sql`

Authentication > Providers > Email: "Confirm email" must be OFF (done).

## 2. Staff function (lets the owner add staff)
Needs the Supabase CLI on your computer:
```
npm i -g supabase
supabase login
supabase link --project-ref rkvjhveblhiprvyttxus
supabase functions deploy add-staff
```
The service key is provided to the function by Supabase itself. Never paste it anywhere.

## 3. Put the app online
Copy these files over your project (replace `src`, `supabase`, `package.json`, `package-lock.json`, add `.npmrc`), delete `src/cloud.ts` and the `worker` folder if present, then:
```
git add . && git commit -m "Supabase" && git push
```
Cloudflare rebuilds by itself. No environment variables are needed (the project address and public key are built in).

## 4. You as Hesabu admin
Sign up in the app with your own number once. Then SQL Editor:
```
insert into platform_admins (user_id)
select id from auth.users where email = '2547XXXXXXXX@hesabu.app';
```
(use your number, 2547... format). Open `https://YOUR-SITE/#/admin` and sign in.

## 5. Your mother
She opens the site on her phone, taps "Make an account", names the shop (choose "Food and drinks I make"), and installs it (browser menu > Add to Home screen). In Menu > Team she adds you as Manager with your number.

## Tests
`node tests/fakeserver.mjs` and build with `VITE_FAKE_CLOUD=http://localhost:8799` to run the two-phone test.

## Not done yet
Paystack automatic billing. Until then use the admin page to set a shop to Paying and a "paid until" date.

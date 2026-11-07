-- Run ONCE in the Supabase SQL Editor after switching to the Tallify version.
-- It removes the test shop and test accounts made under the old name, so you can sign up fresh.
delete from public.billing_payments;
delete from public.shops;            -- also removes their members, products, sales and so on
delete from public.platform_admins;
delete from auth.users where email like '%@hesabu.app';

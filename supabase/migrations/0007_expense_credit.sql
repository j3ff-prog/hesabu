-- Run after 0006. Lets an expense be bought on credit and paid off later, and lets an expense cover a week, month or year.

-- 1. Expenses: pay later, who is owed, when it is due, and how long it lasts.
alter table public.expenses drop constraint if exists expenses_method_check;
alter table public.expenses add constraint expenses_method_check check (method in ('cash', 'mpesa', 'credit'));
alter table public.expenses add column if not exists period text not null default 'day';
alter table public.expenses drop constraint if exists expenses_period_check;
alter table public.expenses add constraint expenses_period_check check (period in ('day', 'week', 'month', 'year'));
alter table public.expenses add column if not exists supplier text not null default '';
alter table public.expenses add column if not exists due_at timestamptz;

-- 2. Money paid towards a bill that was bought on credit.
create table if not exists public.expense_payments (
  id uuid primary key,
  shop_id uuid not null references public.shops on delete cascade,
  expense_id uuid not null references public.expenses on delete cascade,
  amount numeric not null check (amount > 0),
  method text not null check (method in ('cash', 'mpesa')),
  created_at timestamptz not null,
  by_user uuid not null,
  by_name text not null default '',
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index if not exists expense_payments_pull on public.expense_payments (shop_id, updated_at);
create index if not exists expense_payments_expense on public.expense_payments (expense_id);

drop trigger if exists touch on public.expense_payments;
create trigger touch before insert or update on public.expense_payments for each row execute function public.touch();

alter table public.expense_payments enable row level security;
drop policy if exists expense_payments_read on public.expense_payments;
drop policy if exists expense_payments_insert on public.expense_payments;
drop policy if exists expense_payments_undo on public.expense_payments;
-- Owners and managers only, like expenses.
create policy expense_payments_read on public.expense_payments for select to authenticated using (public.sees_money(shop_id));
create policy expense_payments_insert on public.expense_payments for insert to authenticated
  with check (public.sees_money(shop_id) and public.shop_writable(shop_id) and by_user = auth.uid());
create policy expense_payments_undo on public.expense_payments for update to authenticated
  using (public.sees_money(shop_id) and public.shop_writable(shop_id))
  with check (public.sees_money(shop_id));

revoke all on public.expense_payments from anon, authenticated;
grant select on public.expense_payments to authenticated;
grant insert on public.expense_payments to authenticated;
grant update (deleted_at) on public.expense_payments to authenticated;

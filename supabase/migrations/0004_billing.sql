-- Run after 0003. Records Paystack payments and extends a shop's subscription. Only the webhook (service role) can use it.
create table if not exists public.billing_payments (
  reference text primary key,
  shop_id uuid references public.shops on delete set null,
  phone text not null default '',
  amount numeric not null, -- KES
  months int not null default 0,
  paid_at timestamptz not null default now(),
  matched boolean not null default false,
  raw jsonb
);
alter table public.billing_payments enable row level security; -- no policies: nobody but the service role can read or write

create or replace function public.record_payment(p_ref text, p_phone text, p_amount numeric, p_raw jsonb)
returns table (matched boolean, paid_until timestamptz, shop_name text)
language plpgsql security definer set search_path = public as $$
declare sid uuid; n int; base timestamptz; s shops;
begin
  if exists (select 1 from billing_payments where reference = p_ref) then
    select true, sh.paid_until, sh.name into matched, paid_until, shop_name
      from billing_payments b left join shops sh on sh.id = b.shop_id where b.reference = p_ref;
    return next; return; -- already handled (Paystack may send the same event twice)
  end if;

  n := floor(p_amount / 500);
  select m.shop_id into sid from members m
    where m.phone = p_phone and m.role = 'owner' and m.active
    order by m.created_at limit 1;

  if sid is null or n < 1 then
    insert into billing_payments (reference, phone, amount, months, matched, raw) values (p_ref, p_phone, p_amount, 0, false, p_raw);
    matched := false; paid_until := null; shop_name := null; return next; return;
  end if;

  select * into s from shops where id = sid for update;
  base := greatest(now(), coalesce(s.paid_until, now()), case when s.status = 'trial' then s.trial_ends_at else now() end);
  update shops set status = 'active', plan = 'Monthly 500', paid_until = base + (n * interval '30 days') where id = sid;
  insert into billing_payments (reference, shop_id, phone, amount, months, matched, raw) values (p_ref, sid, p_phone, p_amount, n, true, p_raw);
  select true, sh.paid_until, sh.name into matched, paid_until, shop_name from shops sh where sh.id = sid;
  return next;
end $$;
revoke execute on function public.record_payment(text, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.record_payment(text, text, numeric, jsonb) to service_role;

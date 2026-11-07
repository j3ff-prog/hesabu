-- Run after 0002. Adds split payments and credit due dates, and fixes the owner's login number.
alter table public.sales add column if not exists cash_amt numeric;
alter table public.sales add column if not exists mpesa_amt numeric;
alter table public.sales add column if not exists credit_amt numeric;
alter table public.sales add column if not exists due_at timestamptz;

create or replace function public.push_sale(p_sale jsonb, p_lines jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare l jsonb;
begin
  insert into sales (id, shop_id, created_at, method, customer, total, by_user, by_name, cash_amt, mpesa_amt, credit_amt, due_at)
  values (
    (p_sale->>'id')::uuid, (p_sale->>'shop_id')::uuid, (p_sale->>'created_at')::timestamptz,
    p_sale->>'method', nullif(p_sale->>'customer', ''), (p_sale->>'total')::numeric,
    (p_sale->>'by_user')::uuid, coalesce(p_sale->>'by_name', ''),
    (p_sale->>'cash_amt')::numeric, (p_sale->>'mpesa_amt')::numeric, (p_sale->>'credit_amt')::numeric,
    (p_sale->>'due_at')::timestamptz
  ) on conflict (id) do nothing;

  for l in select * from jsonb_array_elements(p_lines) loop
    insert into sale_lines (id, sale_id, shop_id, product_id, name, qty, price, service)
    values (
      (l->>'id')::uuid, (p_sale->>'id')::uuid, (p_sale->>'shop_id')::uuid, nullif(l->>'product_id', '')::uuid,
      l->>'name', (l->>'qty')::numeric, (l->>'price')::numeric, coalesce((l->>'service')::boolean, false)
    ) on conflict (id) do nothing;
  end loop;
end $$;

-- The member row of the owner must carry the LOGIN number (the WhatsApp number can differ).
create or replace function public.create_shop(p_name text, p_owner_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; login text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select split_part(email, '@', 1) into login from auth.users where id = auth.uid();
  insert into shops (name, owner_phone, created_by) values (trim(p_name), coalesce(p_phone, ''), auth.uid()) returning id into sid;
  insert into members (shop_id, user_id, role, name, phone) values (sid, auth.uid(), 'owner', trim(p_owner_name), coalesce(login, ''));
  return sid;
end $$;

update public.members m set phone = split_part(u.email, '@', 1)
  from auth.users u where u.id = m.user_id and m.role = 'owner';

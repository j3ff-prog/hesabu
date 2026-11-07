-- Tallify database. Run once in the Supabase SQL editor (or with the Supabase CLI).
-- Every table is protected by row level security: a person can only touch the shops they belong to,
-- and what they can do depends on their role. Attendants cannot read buying prices or expenses AT ALL.

-- ---------- Tables ----------

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  owner_phone text not null default '',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  -- subscription: every shop starts with a 30 day free trial
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended')),
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  paid_until timestamptz,
  plan text not null default '',
  admin_note text not null default '',
  message text not null default ''
);

create table public.members (
  shop_id uuid not null references public.shops on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'manager', 'attendant')),
  name text not null,
  phone text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id),
  unique (shop_id, phone)
);
create index members_user on public.members (user_id);

create table public.platform_admins (user_id uuid primary key);

-- Synced tables all carry: id (made on the device), shop_id, updated_at (set by the server), deleted_at (soft delete).

create table public.products (
  id uuid primary key,
  shop_id uuid not null references public.shops on delete cascade,
  name text not null,
  price numeric not null check (price >= 0),
  kind text not null default 'goods' check (kind in ('goods', 'service')),
  stock numeric not null default 0,
  low_at numeric not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index products_pull on public.products (shop_id, updated_at);

-- Buying prices live apart so attendants can be locked out of them.
create table public.product_costs (
  product_id uuid primary key references public.products on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  cost numeric not null default 0 check (cost >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
create index product_costs_pull on public.product_costs (shop_id, updated_at);

create table public.sales (
  id uuid primary key,
  shop_id uuid not null references public.shops on delete cascade,
  created_at timestamptz not null,
  method text not null check (method in ('cash', 'mpesa', 'credit')),
  customer text,
  total numeric not null check (total >= 0),
  voided_at timestamptz,
  by_user uuid not null,
  by_name text not null default '',
  updated_at timestamptz not null default clock_timestamp()
);
create index sales_pull on public.sales (shop_id, updated_at);
create index sales_day on public.sales (shop_id, created_at);

create table public.sale_lines (
  id uuid primary key,
  sale_id uuid not null references public.sales on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  product_id uuid,
  name text not null,
  qty numeric not null check (qty > 0),
  price numeric not null check (price >= 0),
  service boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
create index sale_lines_pull on public.sale_lines (shop_id, updated_at);

-- Filled in by the server when a line is saved, from the product's current buying price.
create table public.sale_line_costs (
  line_id uuid primary key references public.sale_lines on delete cascade,
  shop_id uuid not null references public.shops on delete cascade,
  cost numeric not null default 0,
  updated_at timestamptz not null default clock_timestamp()
);
create index sale_line_costs_pull on public.sale_line_costs (shop_id, updated_at);

create table public.customers (
  shop_id uuid not null references public.shops on delete cascade,
  key text not null,
  name text not null,
  phone text,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (shop_id, key)
);

create table public.payments (
  id uuid primary key,
  shop_id uuid not null references public.shops on delete cascade,
  customer_key text not null,
  customer text not null,
  amount numeric not null check (amount > 0),
  method text not null check (method in ('cash', 'mpesa')),
  created_at timestamptz not null,
  by_user uuid not null,
  by_name text not null default '',
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index payments_pull on public.payments (shop_id, updated_at);

create table public.expenses (
  id uuid primary key,
  shop_id uuid not null references public.shops on delete cascade,
  amount numeric not null check (amount > 0),
  note text not null default '',
  category text not null default 'Other',
  method text not null check (method in ('cash', 'mpesa')),
  items jsonb, -- new stock bought: [{"productId": "...", "qty": 10, "cost": 150}]
  created_at timestamptz not null,
  by_user uuid not null,
  by_name text not null default '',
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index expenses_pull on public.expenses (shop_id, updated_at);

create table public.closings (
  shop_id uuid not null references public.shops on delete cascade,
  day text not null,
  started numeric not null,
  expected numeric not null,
  counted numeric not null,
  diff numeric not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (shop_id, day)
);

-- ---------- Who is allowed to do what ----------

create function public.is_member(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where shop_id = s and user_id = auth.uid() and active)
$$;

create function public.member_role(s uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from members where shop_id = s and user_id = auth.uid() and active
$$;

-- Owners and managers: buying prices, expenses, closing the day.
create function public.sees_money(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(s) in ('owner', 'manager'), false)
$$;

-- False once a trial or subscription has ended: the shop can read and download but not record anything new.
create function public.shop_writable(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select status <> 'suspended'
       and now() <= coalesce(case status when 'trial' then trial_ends_at when 'active' then paid_until end, 'infinity'::timestamptz)
    from shops where id = s), false)
$$;

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- Server sets the update time, so devices can ask "what changed since I last looked?" without trusting their own clocks.
create function public.touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['products','product_costs','sales','sale_lines','sale_line_costs','customers','payments','expenses','closings'] loop
    execute format('create trigger touch before insert or update on public.%I for each row execute function public.touch()', t);
  end loop;
end $$;

-- ---------- Stock and costs are kept by the server, so two phones selling the same item never overwrite each other ----------

create function public.on_line_added() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.service and new.product_id is not null then
    update products set stock = stock - new.qty where id = new.product_id and shop_id = new.shop_id;
    insert into sale_line_costs (line_id, shop_id, cost)
      select new.id, new.shop_id, coalesce((select cost from product_costs where product_id = new.product_id), 0)
      on conflict do nothing;
  end if;
  return new;
end $$;
create trigger line_added after insert on public.sale_lines for each row execute function public.on_line_added();

create function public.on_sale_voided() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.voided_at is null and new.voided_at is not null then
    update products p set stock = p.stock + l.qty
      from sale_lines l
     where l.sale_id = new.id and not l.service and p.id = l.product_id and p.shop_id = new.shop_id;
  end if;
  return new;
end $$;
create trigger sale_voided after update on public.sales for each row execute function public.on_sale_voided();

create function public.on_expense_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare i jsonb; sign int; items jsonb;
begin
  if tg_op = 'INSERT' and new.deleted_at is null then sign := 1; items := new.items;
  elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then sign := -1; items := new.items;
  else return new; end if;
  if new.category = 'New stock' and items is not null then
    for i in select * from jsonb_array_elements(items) loop
      update products set stock = stock + sign * (i->>'qty')::numeric
       where id = (i->>'productId')::uuid and shop_id = new.shop_id and kind = 'goods';
      if sign = 1 and coalesce((i->>'cost')::numeric, 0) > 0 then
        insert into product_costs (product_id, shop_id, cost)
          select p.id, p.shop_id, (i->>'cost')::numeric from products p
           where p.id = (i->>'productId')::uuid and p.shop_id = new.shop_id
        on conflict (product_id) do update set cost = excluded.cost;
      end if;
    end loop;
  end if;
  return new;
end $$;
create trigger expense_stock after insert or update on public.expenses for each row execute function public.on_expense_stock();

-- ---------- Row level security ----------

alter table public.shops enable row level security;
alter table public.members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_line_costs enable row level security;
alter table public.customers enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.closings enable row level security;

-- shops: members read; only owners change the name and phone (subscription fields are changed by the admin functions only)
create policy shops_read on public.shops for select to authenticated using (public.is_member(id));
create policy shops_rename on public.shops for update to authenticated
  using (public.member_role(id) = 'owner') with check (public.member_role(id) = 'owner');
revoke update on public.shops from authenticated;
grant update (name, owner_phone) on public.shops to authenticated;

-- members: everyone in the shop sees the team; changes go through functions / the invite function
create policy members_read on public.members for select to authenticated using (public.is_member(shop_id));

-- products
create policy products_read on public.products for select to authenticated using (public.is_member(shop_id));
create policy products_write on public.products for insert to authenticated
  with check (public.sees_money(shop_id) and public.shop_writable(shop_id));
create policy products_update on public.products for update to authenticated
  using (public.sees_money(shop_id) and public.shop_writable(shop_id))
  with check (public.sees_money(shop_id) and public.shop_writable(shop_id));

-- buying prices: owners and managers only
create policy costs_read on public.product_costs for select to authenticated using (public.sees_money(shop_id));
create policy costs_insert on public.product_costs for insert to authenticated
  with check (public.sees_money(shop_id) and public.shop_writable(shop_id));
create policy costs_update on public.product_costs for update to authenticated
  using (public.sees_money(shop_id) and public.shop_writable(shop_id))
  with check (public.sees_money(shop_id) and public.shop_writable(shop_id));

-- sales: everyone records their own; owners and managers can cancel
create policy sales_read on public.sales for select to authenticated using (public.is_member(shop_id));
create policy sales_insert on public.sales for insert to authenticated
  with check (public.is_member(shop_id) and public.shop_writable(shop_id) and by_user = auth.uid());
create policy sales_void on public.sales for update to authenticated
  using (public.sees_money(shop_id) and public.shop_writable(shop_id))
  with check (public.sees_money(shop_id) and public.shop_writable(shop_id));

create policy lines_read on public.sale_lines for select to authenticated using (public.is_member(shop_id));
create policy lines_insert on public.sale_lines for insert to authenticated
  with check (
    public.is_member(shop_id) and public.shop_writable(shop_id)
    and exists (select 1 from public.sales s where s.id = sale_id and s.shop_id = shop_id and s.by_user = auth.uid())
  );

create policy line_costs_read on public.sale_line_costs for select to authenticated using (public.sees_money(shop_id));

-- customers
create policy customers_read on public.customers for select to authenticated using (public.is_member(shop_id));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.is_member(shop_id) and public.shop_writable(shop_id));
create policy customers_update on public.customers for update to authenticated
  using (public.is_member(shop_id) and public.shop_writable(shop_id))
  with check (public.is_member(shop_id) and public.shop_writable(shop_id));

-- credit payments: anyone records; the person who recorded it, or an owner/manager, can undo it
create policy payments_read on public.payments for select to authenticated using (public.is_member(shop_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.is_member(shop_id) and public.shop_writable(shop_id) and by_user = auth.uid());
create policy payments_undo on public.payments for update to authenticated
  using ((by_user = auth.uid() or public.sees_money(shop_id)) and public.shop_writable(shop_id) and public.is_member(shop_id))
  with check (public.is_member(shop_id));

-- expenses and closing the day: owners and managers only
create policy expenses_read on public.expenses for select to authenticated using (public.sees_money(shop_id));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.sees_money(shop_id) and public.shop_writable(shop_id) and by_user = auth.uid());
create policy expenses_update on public.expenses for update to authenticated
  using (public.sees_money(shop_id) and public.shop_writable(shop_id))
  with check (public.sees_money(shop_id));

create policy closings_read on public.closings for select to authenticated using (public.sees_money(shop_id));
create policy closings_insert on public.closings for insert to authenticated
  with check (public.sees_money(shop_id) and public.shop_writable(shop_id));
create policy closings_update on public.closings for update to authenticated
  using (public.sees_money(shop_id) and public.shop_writable(shop_id))
  with check (public.sees_money(shop_id));

-- ---------- Functions the app calls ----------

-- Make a new shop with the caller as its owner. The 30 day trial starts now.
create function public.create_shop(p_name text, p_owner_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into shops (name, owner_phone, created_by) values (trim(p_name), coalesce(p_phone, ''), auth.uid()) returning id into sid;
  insert into members (shop_id, user_id, role, name, phone) values (sid, auth.uid(), 'owner', trim(p_owner_name), coalesce(p_phone, ''));
  return sid;
end $$;

-- Owner changes a person's role or switches them off. (Adding people goes through the add-staff Edge Function.)
create function public.set_member(p_shop uuid, p_user uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.member_role(p_shop) <> 'owner' then raise exception 'only the owner can do this'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change yourself'; end if;
  if p_role not in ('manager', 'attendant') then raise exception 'bad role'; end if;
  update members set role = p_role, active = p_active where shop_id = p_shop and user_id = p_user and role <> 'owner';
end $$;

-- Tallify admin only: every shop with usage totals (no individual sales).
create function public.admin_shops() returns table (
  id uuid, name text, owner_phone text, created_at timestamptz, status text, trial_ends_at timestamptz,
  paid_until timestamptz, plan text, admin_note text, message text,
  staff bigint, products bigint, sales30 bigint, revenue30 numeric, last_sale timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed'; end if;
  return query
    select s.id, s.name, s.owner_phone, s.created_at, s.status, s.trial_ends_at, s.paid_until, s.plan, s.admin_note, s.message,
      (select count(*) from members m where m.shop_id = s.id and m.active),
      (select count(*) from products p where p.shop_id = s.id and p.deleted_at is null),
      (select count(*) from sales x where x.shop_id = s.id and x.voided_at is null and x.created_at > now() - interval '30 days'),
      (select coalesce(sum(x.total), 0) from sales x where x.shop_id = s.id and x.voided_at is null and x.created_at > now() - interval '30 days'),
      (select max(x.created_at) from sales x where x.shop_id = s.id and x.voided_at is null)
    from shops s order by s.created_at desc;
end $$;

create function public.admin_set_shop(p_shop uuid, p_status text, p_plan text, p_paid_until timestamptz, p_note text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('trial', 'active', 'suspended') then raise exception 'bad status'; end if;
  update shops set status = p_status, plan = coalesce(p_plan, ''), paid_until = p_paid_until,
    admin_note = coalesce(p_note, ''), message = coalesce(p_message, '') where id = p_shop;
end $$;

-- The app reads the shop's state (read-only or not) for the banner.
create function public.shop_state(p_shop uuid) returns table (writable boolean, status text, until timestamptz, message text)
language sql stable security definer set search_path = public as $$
  select public.shop_writable(s.id), s.status,
         case s.status when 'trial' then s.trial_ends_at when 'active' then s.paid_until end, s.message
    from shops s where s.id = p_shop and public.is_member(s.id)
$$;

-- ---------- Lock down who can call what ----------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant select on public.shops, public.members, public.products, public.product_costs, public.sales, public.sale_lines,
  public.sale_line_costs, public.customers, public.payments, public.expenses, public.closings to authenticated;
grant insert, update on public.products, public.product_costs, public.sales, public.customers, public.payments,
  public.expenses, public.closings to authenticated;
grant insert on public.sale_lines to authenticated;
grant update (name, owner_phone) on public.shops to authenticated;
grant update (voided_at) on public.sales to authenticated;
grant update (deleted_at) on public.payments to authenticated;
grant update (deleted_at) on public.expenses to authenticated;
grant execute on function public.create_shop(text, text, text), public.set_member(uuid, uuid, text, boolean),
  public.admin_shops(), public.admin_set_shop(uuid, text, text, timestamptz, text, text), public.shop_state(uuid),
  public.is_member(uuid), public.member_role(uuid), public.sees_money(uuid), public.shop_writable(uuid) to authenticated;

-- Used only by the add-staff Edge Function (service role): find an existing login by phone number.
create function public.user_by_phone(p_phone text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where email = p_phone || '@tallify.app'
$$;
revoke execute on function public.user_by_phone(text) from public, anon, authenticated;
grant execute on function public.user_by_phone(text) to service_role;

-- Run after 0005. Adds push notifications and the support chat.

-- Policies below ask whether the caller is the Tallyfy admin.
grant execute on function public.is_platform_admin() to authenticated;

-- ---------- Phones that want notifications ----------
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  shop_id uuid references public.shops on delete cascade, -- null for the Tallyfy admin's own phone
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy push_own_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
create policy push_own_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid() and ((shop_id is null and public.is_platform_admin()) or (shop_id is not null and public.is_member(shop_id))));
create policy push_own_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Support chat ----------
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  from_admin boolean not null default false,
  sender text not null default '',
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
create index if not exists support_messages_shop on public.support_messages (shop_id, created_at);
alter table public.support_messages enable row level security;

-- Owners and managers see their shop's chat and write to it. The Tallyfy admin sees and answers all.
create policy support_read on public.support_messages for select to authenticated
  using (public.is_platform_admin() or public.sees_money(shop_id));
create policy support_write_member on public.support_messages for insert to authenticated
  with check (from_admin = false and user_id = auth.uid() and public.sees_money(shop_id));
create policy support_write_admin on public.support_messages for insert to authenticated
  with check (from_admin = true and user_id = auth.uid() and public.is_platform_admin());

alter table public.sales add column if not exists notified_at timestamptz;

-- ---------- Tell the notify function when something happens ----------
-- A failure here must never stop a sale or a message from being saved, so every error is swallowed.
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then null;
end $$;

create or replace function public.ping_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url := 'https://rkvjhveblhiprvyttxus.supabase.co/functions/v1/notify',
      body := jsonb_build_object('type', tg_argv[0], 'id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists notify_sale on public.sales;
create trigger notify_sale after insert on public.sales for each row execute function public.ping_notify('sale');
drop trigger if exists notify_support on public.support_messages;
create trigger notify_support after insert on public.support_messages for each row execute function public.ping_notify('support');

-- Run after 0007. Lets the owner choose what each person can do, and remove people from the team.

-- 1. Each person can have their own list of rights. Empty (null) means "the usual rights for their role".
alter table public.members add column if not exists perms text[];

-- 2. Does the signed-in person have this right in this shop? Owners always do.
create or replace function public.has_perm(s uuid, p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when role = 'owner' then true
      when perms is not null then p = any(perms)
      when role = 'manager' then p = any(array['sell','voidSale','viewStock','editStock','seeCost','credit','expenses','addExpense','today','dashboard','export','importStock'])
      else p = any(array['sell','viewStock','credit'])
    end
    from members where shop_id = s and user_id = auth.uid() and active
  ), false)
$$;
grant execute on function public.has_perm(uuid, text) to authenticated;

-- 3. The database now checks the specific right instead of "owner or manager".
drop policy if exists products_write on public.products;
drop policy if exists products_update on public.products;
create policy products_write on public.products for insert to authenticated
  with check (public.has_perm(shop_id, 'editStock') and public.shop_writable(shop_id));
create policy products_update on public.products for update to authenticated
  using (public.has_perm(shop_id, 'editStock') and public.shop_writable(shop_id))
  with check (public.has_perm(shop_id, 'editStock') and public.shop_writable(shop_id));

drop policy if exists costs_read on public.product_costs;
drop policy if exists costs_insert on public.product_costs;
drop policy if exists costs_update on public.product_costs;
create policy costs_read on public.product_costs for select to authenticated using (public.has_perm(shop_id, 'seeCost'));
create policy costs_insert on public.product_costs for insert to authenticated
  with check (public.has_perm(shop_id, 'seeCost') and public.has_perm(shop_id, 'editStock') and public.shop_writable(shop_id));
create policy costs_update on public.product_costs for update to authenticated
  using (public.has_perm(shop_id, 'seeCost') and public.has_perm(shop_id, 'editStock') and public.shop_writable(shop_id))
  with check (public.has_perm(shop_id, 'seeCost') and public.has_perm(shop_id, 'editStock') and public.shop_writable(shop_id));

drop policy if exists sales_void on public.sales;
create policy sales_void on public.sales for update to authenticated
  using (public.has_perm(shop_id, 'voidSale') and public.shop_writable(shop_id))
  with check (public.has_perm(shop_id, 'voidSale') and public.shop_writable(shop_id));

drop policy if exists line_costs_read on public.sale_line_costs;
create policy line_costs_read on public.sale_line_costs for select to authenticated using (public.has_perm(shop_id, 'seeCost'));

drop policy if exists payments_undo on public.payments;
create policy payments_undo on public.payments for update to authenticated
  using ((by_user = auth.uid() or public.has_perm(shop_id, 'voidSale')) and public.shop_writable(shop_id) and public.is_member(shop_id))
  with check (public.is_member(shop_id));

drop policy if exists expenses_read on public.expenses;
drop policy if exists expenses_insert on public.expenses;
drop policy if exists expenses_update on public.expenses;
create policy expenses_read on public.expenses for select to authenticated using (public.has_perm(shop_id, 'expenses'));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.has_perm(shop_id, 'addExpense') and public.shop_writable(shop_id) and by_user = auth.uid());
create policy expenses_update on public.expenses for update to authenticated
  using (public.has_perm(shop_id, 'addExpense') and public.shop_writable(shop_id))
  with check (public.has_perm(shop_id, 'addExpense'));

drop policy if exists expense_payments_read on public.expense_payments;
drop policy if exists expense_payments_insert on public.expense_payments;
drop policy if exists expense_payments_undo on public.expense_payments;
create policy expense_payments_read on public.expense_payments for select to authenticated using (public.has_perm(shop_id, 'expenses'));
create policy expense_payments_insert on public.expense_payments for insert to authenticated
  with check (public.has_perm(shop_id, 'addExpense') and public.shop_writable(shop_id) and by_user = auth.uid());
create policy expense_payments_undo on public.expense_payments for update to authenticated
  using (public.has_perm(shop_id, 'addExpense') and public.shop_writable(shop_id))
  with check (public.has_perm(shop_id, 'addExpense'));

drop policy if exists closings_read on public.closings;
drop policy if exists closings_insert on public.closings;
drop policy if exists closings_update on public.closings;
create policy closings_read on public.closings for select to authenticated using (public.has_perm(shop_id, 'today'));
create policy closings_insert on public.closings for insert to authenticated
  with check (public.has_perm(shop_id, 'today') and public.shop_writable(shop_id));
create policy closings_update on public.closings for update to authenticated
  using (public.has_perm(shop_id, 'today') and public.shop_writable(shop_id))
  with check (public.has_perm(shop_id, 'today'));

-- 4. Owner changes a person's role, rights, or switches them off.
drop function if exists public.set_member(uuid, uuid, text, boolean);
create or replace function public.set_member(p_shop uuid, p_user uuid, p_role text, p_active boolean, p_perms text[] default null) returns void
language plpgsql security definer set search_path = public as $$
declare clean text[];
begin
  if public.member_role(p_shop) <> 'owner' then raise exception 'only the owner can do this'; end if;
  if p_user = auth.uid() then raise exception 'you cannot change yourself'; end if;
  if p_role not in ('manager', 'attendant') then raise exception 'bad role'; end if;
  -- Only these rights can be handed out. Settings and managing the team stay with the owner.
  if p_perms is not null then
    select coalesce(array_agg(x), '{}') into clean
    from unnest(p_perms) x
    where x = any(array['sell','voidSale','viewStock','editStock','seeCost','credit','expenses','addExpense','today','dashboard','export','importStock']);
  end if;
  update members set role = p_role, active = p_active, perms = clean where shop_id = p_shop and user_id = p_user and role <> 'owner';
end $$;
revoke execute on function public.set_member(uuid, uuid, text, boolean, text[]) from public, anon;
grant execute on function public.set_member(uuid, uuid, text, boolean, text[]) to authenticated;

-- 5. Owner removes a person from the team for good. Their past sales stay in the records with their name on them.
create or replace function public.remove_member(p_shop uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.member_role(p_shop) <> 'owner' then raise exception 'only the owner can do this'; end if;
  if p_user = auth.uid() then raise exception 'you cannot remove yourself'; end if;
  delete from push_subscriptions where shop_id = p_shop and user_id = p_user;
  delete from members where shop_id = p_shop and user_id = p_user and role <> 'owner';
end $$;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

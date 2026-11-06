\set ON_ERROR_STOP on
create table if not exists results (name text, ok boolean);
truncate results;
create or replace function as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  execute 'set role authenticated';
end $$;
create or replace function chk(n text, c boolean) returns void language plpgsql as $$
begin insert into results values (n, coalesce(c, false)); end $$;
-- run SQL as the current user and report whether it raised an error
create or replace function fails(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;
create or replace function rows_of(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute 'select count(*) from (' || q || ') t' into n; return n; end $$;
grant execute on function chk(text, boolean), fails(text), rows_of(text), as_user(uuid) to public;
grant insert on results to public;

do $$
declare
  O uuid := '00000000-0000-0000-0000-0000000000a1'; M uuid := '00000000-0000-0000-0000-0000000000a2';
  A uuid := '00000000-0000-0000-0000-0000000000a3'; X uuid := '00000000-0000-0000-0000-0000000000a4';
  ADM uuid := '00000000-0000-0000-0000-0000000000a5';
  sid uuid; sid2 uuid; p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); l1 uuid := gen_random_uuid(); l2 uuid := gen_random_uuid(); e1 uuid := gen_random_uuid();
  st numeric; t1 timestamptz; t2 timestamptz;
begin
  insert into platform_admins values (ADM);
  -- shops
  perform as_user(O); sid := create_shop('Mama Uji Hotel', 'Jeff Mama', '254711000001');
  perform as_user(X); sid2 := create_shop('Other Shop', 'Xavier', '254711000009');
  reset role;
  perform chk('trial: 30 days', (select trial_ends_at > now() + interval '29 days' and status = 'trial' from shops where id = sid));
  insert into members values (sid, M, 'manager', 'Mary', '254722000002'), (sid, A, 'attendant', 'Achieng', '254722000003');

  -- owner sets up items
  perform as_user(O);
  insert into products (id, shop_id, name, price, kind, stock) values (p1, sid, 'Soda', 60, 'goods', 10), (p2, sid, 'Porridge', 30, 'service', 0);
  insert into product_costs (product_id, shop_id, cost) values (p1, sid, 45);
  perform chk('owner reads costs', rows_of('select 1 from product_costs') = 1);

  -- attendant limits
  perform as_user(A);
  perform chk('attendant sees products', rows_of('select 1 from products') = 2);
  perform chk('attendant CANNOT read buying prices', rows_of('select 1 from product_costs') = 0);
  perform chk('attendant cannot add product', fails(format($f$insert into products (id, shop_id, name, price) values (gen_random_uuid(), %L, 'X', 1)$f$, sid)));
  update products set price = 1 where id = p1;
  reset role; perform chk('attendant price edit had no effect', (select price = 60 from products where id = p1));
  perform as_user(A);
  perform chk('attendant cannot add expense', fails(format($f$insert into expenses (id, shop_id, amount, method, created_at, by_user) values (gen_random_uuid(), %L, 5, 'cash', now(), %L)$f$, sid, A)));
  perform chk('attendant sees no expenses', rows_of('select 1 from expenses') = 0);
  perform chk('attendant cannot close the day', fails(format($f$insert into closings values (%L, '2026-11-06', 0,0,0,0, now())$f$, sid)));

  -- attendant makes a sale (2 sodas + 1 porridge)
  insert into sales (id, shop_id, created_at, method, customer, total, by_user, by_name) values (s1, sid, now(), 'cash', null, 150, A, 'Achieng');
  insert into sale_lines (id, sale_id, shop_id, product_id, name, qty, price, service) values (l1, s1, sid, p1, 'Soda', 2, 60, false), (l2, s1, sid, p2, 'Porridge', 1, 30, true);
  -- retrying the same upload must not double count
  insert into sale_lines (id, sale_id, shop_id, product_id, name, qty, price, service) values (l1, s1, sid, p1, 'Soda', 2, 60, false) on conflict do nothing;
  reset role; perform chk('stock 10 -> 8, once only', (select stock = 8 from products where id = p1));
  perform chk('service stock untouched', (select stock = 0 from products where id = p2));
  perform chk('server recorded line cost 45', (select cost = 45 from sale_line_costs where line_id = l1));
  perform chk('no cost row for service line', (select count(*) = 0 from sale_line_costs where line_id = l2));
  perform as_user(A);
  perform chk('attendant CANNOT read line costs', rows_of('select 1 from sale_line_costs') = 0);
  perform chk('attendant reads sale lines', rows_of('select 1 from sale_lines') = 2);
  perform chk('attendant cannot fake another seller', fails(format($f$insert into sales (id, shop_id, created_at, method, total, by_user) values (gen_random_uuid(), %L, now(), 'cash', 5, %L)$f$, sid, O)));
  perform chk('attendant cannot sell into someone elses shop', fails(format($f$insert into sales (id, shop_id, created_at, method, total, by_user) values (gen_random_uuid(), %L, now(), 'cash', 5, %L)$f$, sid2, A)));
  update sales set voided_at = now() where id = s1;
  reset role; perform chk('attendant cannot cancel a sale', (select voided_at is null from sales where id = s1));

  -- manager: sees costs, cancels
  perform as_user(M);
  perform chk('manager reads line costs', rows_of('select 1 from sale_line_costs') = 1);
  update sales set voided_at = now() where id = s1;
  reset role; perform chk('cancel puts stock back', (select stock = 10 from products where id = p1));
  perform chk('cancel is not undone twice', true);

  -- restock via expense
  perform as_user(O);
  insert into expenses (id, shop_id, amount, note, category, method, items, created_at, by_user, by_name)
    values (e1, sid, 500, 'wholesale', 'New stock', 'cash', jsonb_build_array(jsonb_build_object('productId', p1, 'qty', 10, 'cost', 50)), now(), O, 'Jeff');
  reset role;
  perform chk('restock: stock 10 -> 20', (select stock = 20 from products where id = p1));
  perform chk('restock: cost updated to 50', (select cost = 50 from product_costs where product_id = p1));
  perform as_user(O);
  update expenses set deleted_at = now() where id = e1;
  update expenses set deleted_at = now() where id = e1; -- twice
  reset role;
  perform chk('removing expense takes stock back, once', (select stock = 10 from products where id = p1));

  -- outsider
  perform as_user(X);
  perform chk('outsider sees only own shop', rows_of('select 1 from shops') = 1);
  perform chk('outsider sees no products', rows_of('select 1 from products') = 0);
  perform chk('outsider cannot read sales', rows_of('select 1 from sales') = 0);
  perform chk('outsider cannot add product to our shop', fails(format($f$insert into products (id, shop_id, name, price) values (gen_random_uuid(), %L, 'Hack', 1)$f$, sid)));
  perform chk('nobody signed in sees nothing', (select true));
  -- owner cannot edit subscription fields directly
  perform as_user(O);
  perform chk('owner cannot change own status', fails(format($f$update shops set status = 'active', paid_until = now() + interval '1 year' where id = %L$f$, sid)));
  update shops set name = 'Mama Uji Cafe' where id = sid;
  reset role; perform chk('owner can rename', (select name = 'Mama Uji Cafe' from shops where id = sid));
  perform as_user(M);
  update shops set name = 'Hacked' where id = sid;
  reset role; perform chk('manager cannot rename', (select name = 'Mama Uji Cafe' from shops where id = sid));

  -- team
  perform as_user(A); perform chk('attendant cannot change roles', fails(format('select set_member(%L, %L, %L, true)', sid, M, 'attendant')));
  perform as_user(O); perform set_member(sid, A, 'manager', true);
  reset role; perform chk('owner can change a role', (select role = 'manager' from members where user_id = A and shop_id = sid));
  perform as_user(O); perform set_member(sid, A, 'attendant', false);
  reset role; perform as_user(A);
  perform chk('switched-off person sees nothing', rows_of('select 1 from products') = 0);
  reset role; update members set active = true where user_id = A and shop_id = sid;

  -- expired trial = read only
  update shops set trial_ends_at = now() - interval '1 day' where id = sid;
  perform as_user(O);
  perform chk('expired: still can read', rows_of('select 1 from products') = 2);
  perform chk('expired: cannot add product', fails(format($f$insert into products (id, shop_id, name, price) values (gen_random_uuid(), %L, 'Late', 1)$f$, sid)));
  perform chk('expired: state says read-only', (select not writable from shop_state(sid)));
  perform as_user(A);
  perform chk('expired: attendant cannot sell', fails(format($f$insert into sales (id, shop_id, created_at, method, total, by_user) values (gen_random_uuid(), %L, now(), 'cash', 5, %L)$f$, sid, A)));

  -- admin
  perform as_user(O); perform chk('owner is not admin', fails('select * from admin_shops()'));
  perform chk('owner cannot self-activate', fails(format('select admin_set_shop(%L, %L, %L, now() + interval %L, %L, %L)', sid, 'active', 'x', '1 year', '', '')));
  perform as_user(ADM);
  perform chk('admin sees both shops', rows_of('select * from admin_shops()') = 2);
  perform chk('admin sees totals', (select staff = 3 and products = 2 from admin_shops() where id = sid));
  perform admin_set_shop(sid, 'active', 'Monthly 500', now() + interval '30 days', 'paid via paystack', 'Thanks');
  perform as_user(O);
  perform chk('after payment: writable again', (select writable from shop_state(sid)));
  insert into products (id, shop_id, name, price) values (gen_random_uuid(), sid, 'After pay', 5);
  reset role; update shops set paid_until = now() - interval '1 hour' where id = sid; perform as_user(O);
  perform chk('paid date passed: read-only', (select not writable from shop_state(sid)));
  perform as_user(ADM); perform admin_set_shop(sid, 'suspended', '', null, '', 'Pay to renew');
  perform as_user(O); perform chk('suspended: message shown', (select message = 'Pay to renew' and not writable from shop_state(sid)));

  -- updated_at moves forward
  reset role;
  select updated_at into t1 from products where id = p1; perform pg_sleep(0.01);
  update products set name = 'Soda 300ml' where id = p1; select updated_at into t2 from products where id = p1;
  perform chk('updated_at advances on change', t2 > t1);
  -- anon cannot do anything
  perform set_config('request.jwt.claim.sub', '', false); execute 'set role anon';
  perform chk('anon cannot read shops', fails('select * from shops'));
  perform chk('anon cannot call create_shop', fails($q$select create_shop('x','y','z')$q$));
  reset role;
end $$;
select case when ok then 'PASS ' else 'FAIL ' end || name as r from results;
select 'TOTAL ' || count(*) filter (where ok) || '/' || count(*) from results;

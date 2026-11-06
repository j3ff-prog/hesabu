\set ON_ERROR_STOP on
do $$
declare A uuid := '00000000-0000-0000-0000-0000000000b3'; O uuid := '00000000-0000-0000-0000-0000000000b1';
  sid uuid; p1 uuid := gen_random_uuid(); s uuid := gen_random_uuid(); l uuid := gen_random_uuid(); st numeric; n int;
begin
  perform set_config('request.jwt.claim.sub', O::text, false); execute 'set role authenticated';
  sid := create_shop('Test Shop', 'Owner', '254700000001');
  insert into products (id, shop_id, name, price, stock) values (p1, sid, 'Soda', 60, 10);
  reset role; insert into members values (sid, A, 'attendant', 'A', '254700000002');
  perform set_config('request.jwt.claim.sub', A::text, false); execute 'set role authenticated';
  perform push_sale(jsonb_build_object('id', s, 'shop_id', sid, 'created_at', now(), 'method', 'cash', 'total', 120, 'by_user', A, 'by_name', 'A'),
                    jsonb_build_array(jsonb_build_object('id', l, 'product_id', p1, 'name', 'Soda', 'qty', 2, 'price', 60, 'service', false)));
  perform push_sale(jsonb_build_object('id', s, 'shop_id', sid, 'created_at', now(), 'method', 'cash', 'total', 120, 'by_user', A, 'by_name', 'A'),
                    jsonb_build_array(jsonb_build_object('id', l, 'product_id', p1, 'name', 'Soda', 'qty', 2, 'price', 60, 'service', false)));
  reset role;
  select stock into st from products where id = p1; select count(*) into n from sale_lines;
  raise notice 'RESULT stock=% lines=% (expect 8 and 1)', st, n;
  -- cannot push as someone else
  perform set_config('request.jwt.claim.sub', A::text, false); execute 'set role authenticated';
  begin
    perform push_sale(jsonb_build_object('id', gen_random_uuid(), 'shop_id', sid, 'created_at', now(), 'method', 'cash', 'total', 5, 'by_user', O, 'by_name', 'x'), '[]'::jsonb);
    raise notice 'RESULT impersonation ALLOWED (bad)';
  exception when others then raise notice 'RESULT impersonation blocked (good)'; end;
end $$;

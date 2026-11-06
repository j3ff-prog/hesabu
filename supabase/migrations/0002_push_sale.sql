-- Uploads a sale and all its lines in ONE transaction, so another phone never sees a sale without its lines.
-- Runs as the caller, so every row level security rule still applies. Safe to retry: duplicates are ignored.
create function public.push_sale(p_sale jsonb, p_lines jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare l jsonb;
begin
  insert into sales (id, shop_id, created_at, method, customer, total, by_user, by_name)
  values (
    (p_sale->>'id')::uuid, (p_sale->>'shop_id')::uuid, (p_sale->>'created_at')::timestamptz,
    p_sale->>'method', nullif(p_sale->>'customer', ''), (p_sale->>'total')::numeric,
    (p_sale->>'by_user')::uuid, coalesce(p_sale->>'by_name', '')
  ) on conflict (id) do nothing;

  for l in select * from jsonb_array_elements(p_lines) loop
    insert into sale_lines (id, sale_id, shop_id, product_id, name, qty, price, service)
    values (
      (l->>'id')::uuid, (p_sale->>'id')::uuid, (p_sale->>'shop_id')::uuid, nullif(l->>'product_id', '')::uuid,
      l->>'name', (l->>'qty')::numeric, (l->>'price')::numeric, coalesce((l->>'service')::boolean, false)
    ) on conflict (id) do nothing;
  end loop;
end $$;
revoke execute on function public.push_sale(jsonb, jsonb) from public, anon;
grant execute on function public.push_sale(jsonb, jsonb) to authenticated;

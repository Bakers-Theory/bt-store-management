-- ============================================================================
-- BT Store Management — customers
-- A customer is identified by phone. Bills link to a customer via customer_id.
-- Spend & visit totals are computed from ACTIVE bills on read (no cached
-- columns → no drift; cancellations drop out automatically).
-- ============================================================================

-- ─── Customers table ─────────────────────────────────────────────────────────
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null unique,          -- identity (10-digit)
  name       text not null default '',
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists customers_updated on public.customers;
create trigger customers_updated before update on public.customers
  for each row execute function public.set_updated_at();

-- ─── Link bills → customers ──────────────────────────────────────────────────
alter table public.bills
  add column if not exists customer_id uuid
    references public.customers(id) on delete set null;
create index if not exists bills_customer_id_idx on public.bills (customer_id);

-- ─── RLS: read for sales/inventory; no client writes (RPC only) ──────────────
alter table public.customers enable row level security;
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select
  using (public.has_perm('sales') or public.has_perm('inventory'));

-- ─── Directory + analytics read RPC ──────────────────────────────────────────
create or replace function public.customers_with_stats()
returns table (
  id            uuid,
  phone         text,
  name          text,
  first_seen    timestamptz,
  visit_count   bigint,
  total_spend   numeric,
  last_purchase timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.phone, c.name, c.first_seen,
         count(b.id) filter (where b.status = 'active')            as visit_count,
         coalesce(sum(b.total) filter (where b.status = 'active'), 0) as total_spend,
         max(b.created_at) filter (where b.status = 'active')      as last_purchase
  from public.customers c
  left join public.bills b on b.customer_id = c.id
  where public.has_perm('sales') or public.has_perm('inventory')
  group by c.id
$$;

grant execute on function public.customers_with_stats() to authenticated;

-- ─── Rebuild generate_bill: require phone, upsert customer, link bill ────────
-- Based verbatim on the 0008 version; only the customer upsert + customer_id and
-- the empty-phone guard are new. Signature unchanged → no re-grant needed.
create or replace function public.generate_bill(customer jsonb, lines jsonb)
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
        v_disc numeric; v_taxable numeric; v_customer uuid;
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  if coalesce(customer->>'phone','') = '' then raise exception 'phone required'; end if;

  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;

  -- Upsert the customer by phone. Keep the latest non-empty name.
  insert into public.customers (phone, name)
    values (customer->>'phone', coalesce(customer->>'name',''))
    on conflict (phone) do update
      set name = case when excluded.name <> '' then excluded.name
                      else public.customers.name end,
          last_seen = now()
    returning id into v_customer;

  v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
  v_taxable := v_sub - (v_sub * v_disc / 100);
  v_tax := v_taxable * v_rate / 100;
  insert into public.bills (customer_name, customer_phone, customer_id,
                            subtotal, tax, total, tax_rate, payment_method,
                            discount_percent, created_by)
    values (coalesce(customer->>'name',''), customer->>'phone', v_customer,
            v_sub, v_tax, v_taxable + v_tax, v_rate,
            case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
            v_disc, auth.uid())
    returning * into v_bill;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price);
    update public.items set qty = greatest(0, qty - v_qty) where id = it.id;
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;

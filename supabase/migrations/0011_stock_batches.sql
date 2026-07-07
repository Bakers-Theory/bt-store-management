-- ============================================================================
-- BT Store Management — Product Life (per-batch expiry tracking)
-- stock_batches becomes the source of truth for on-hand qty; items.qty is a
-- maintained mirror (SUM of batch qty). FIFO = soonest expiry first, NULLs last.
-- Depends on 0010 (optional customer phone) for the generate_bill body.
-- ============================================================================

-- ─── Schema ──────────────────────────────────────────────────────────────────
create table if not exists public.stock_batches (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  qty         numeric not null,
  expiry_date date,                         -- NULL = never expires
  created_at  timestamptz not null default now()
);
create index if not exists stock_batches_item_idx
  on public.stock_batches (item_id, expiry_date);

alter table public.items
  add column if not exists tracks_expiry boolean not null default true;

alter table public.store_settings
  add column if not exists expiring_soon_days integer not null default 3;

-- ─── Backfill: existing stock becomes one non-expiring batch per item ────────
insert into public.stock_batches (item_id, qty, expiry_date)
  select i.id, i.qty, null
  from public.items i
  where i.qty > 0
    and not exists (select 1 from public.stock_batches sb where sb.item_id = i.id);

-- ─── RLS: read for sales/inventory/analytics; writes via RPC only ────────────
alter table public.stock_batches enable row level security;
drop policy if exists stock_batches_read on public.stock_batches;
create policy stock_batches_read on public.stock_batches for select
  using (public.has_perm('inventory') or public.has_perm('sales') or public.has_perm('analytics'));

-- ─── Internal helpers (invoker; only called from SECURITY DEFINER RPCs) ──────
-- Add p_qty to the item's batch for p_expiry (merge same date; NULL merges into
-- the single non-expiring batch). Forces NULL when the item doesn't track expiry.
create or replace function public.add_batch(p_item uuid, p_qty numeric, p_expiry date)
returns void language plpgsql set search_path = public as $$
declare v_tracks boolean;
begin
  select tracks_expiry into v_tracks from public.items where id = p_item;
  if not coalesce(v_tracks, true) then p_expiry := null; end if;

  if p_expiry is null then
    update public.stock_batches set qty = qty + p_qty
      where item_id = p_item and expiry_date is null;
  else
    update public.stock_batches set qty = qty + p_qty
      where item_id = p_item and expiry_date = p_expiry;
  end if;
  if not found then
    insert into public.stock_batches (item_id, qty, expiry_date)
      values (p_item, p_qty, p_expiry);
  end if;

  update public.items set qty =
    coalesce((select sum(qty) from public.stock_batches where item_id = p_item), 0)
    where id = p_item;
end $$;

-- Consume p_qty across the item's batches FIFO. Never goes negative (clamps to
-- 0), so billing (warn-but-allow) can overdraw without error.
create or replace function public.consume_fifo(p_item uuid, p_qty numeric)
returns void language plpgsql set search_path = public as $$
declare b public.stock_batches; remaining numeric := p_qty; take numeric;
begin
  for b in
    select * from public.stock_batches
    where item_id = p_item and qty > 0
    order by expiry_date asc nulls last, created_at asc
    for update
  loop
    exit when remaining <= 0;
    take := least(b.qty, remaining);
    update public.stock_batches set qty = qty - take where id = b.id;
    remaining := remaining - take;
  end loop;
  delete from public.stock_batches where item_id = p_item and qty <= 0;
  update public.items set qty =
    coalesce((select sum(qty) from public.stock_batches where item_id = p_item), 0)
    where id = p_item;
end $$;

-- ─── create_item: now takes tracksExpiry + (initial) expiryDate ──────────────
create or replace function public.create_item(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dup public.items; v_id uuid;
        v_qty numeric := coalesce((p->>'qty')::numeric, 0);
        v_tracks boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_expiry date := nullif(p->>'expiryDate','')::date;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  select * into v_dup from public.items where name_key = lower(trim(p->>'name'));
  if found then
    if v_qty > 0 then
      perform public.add_batch(v_dup.id, v_qty, v_expiry);
      insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
        values ('in', auth.uid(), v_dup.id, v_dup.name, v_qty,
                'Added via New Item form (existing item)');
    end if;
    return jsonb_build_object('kind','merged','name',v_dup.name,'qty',v_qty,'unit',v_dup.unit);
  end if;
  insert into public.items (name, emoji, category, unit, price, cost_price, qty, tracks_expiry)
    values (p->>'name', coalesce(p->>'emoji','📦'), p->>'category', p->>'unit',
            coalesce((p->>'price')::numeric,0), coalesce((p->>'costPrice')::numeric,0),
            0, v_tracks)
    returning id into v_id;
  if v_qty > 0 then
    perform public.add_batch(v_id, v_qty, v_expiry);
    insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
      values ('in', auth.uid(), v_id, p->>'name', v_qty, 'Initial stock');
  end if;
  return jsonb_build_object('kind','added','id',v_id);
end $$;

-- ─── update_item: edits fields + tracks_expiry; NEVER writes qty ─────────────
-- Turning tracks_expiry off collapses all batches into one non-expiring batch.
create or replace function public.update_item(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_tracks_old boolean;
        v_tracks_new boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_sum numeric;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  select tracks_expiry into v_tracks_old from public.items where id = p_id;
  if not found then raise exception 'item not found'; end if;
  update public.items set
    name = p->>'name', emoji = coalesce(p->>'emoji','📦'), category = p->>'category',
    unit = p->>'unit', price = coalesce((p->>'price')::numeric,0),
    cost_price = coalesce((p->>'costPrice')::numeric,0), tracks_expiry = v_tracks_new
  where id = p_id;
  if v_tracks_old and not v_tracks_new then
    select coalesce(sum(qty),0) into v_sum from public.stock_batches where item_id = p_id;
    delete from public.stock_batches where item_id = p_id;
    if v_sum > 0 then
      insert into public.stock_batches (item_id, qty, expiry_date) values (p_id, v_sum, null);
    end if;
  end if;
end $$;

-- ─── stock_in: new p_expiry param (drop old 4-arg overload) ──────────────────
drop function if exists public.stock_in(uuid, numeric, text, text);
create or replace function public.stock_in(p_item uuid, p_qty numeric, p_supplier text, p_notes text, p_expiry date)
returns void language plpgsql security definer set search_path = public as $$
declare v public.items;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select * into v from public.items where id = p_item;
  if not found then raise exception 'item not found'; end if;
  perform public.add_batch(p_item, p_qty, p_expiry);
  insert into public.activity_log (type, actor, item_id, item_name, qty, supplier, notes)
    values ('in', auth.uid(), p_item, v.name, p_qty, p_supplier, p_notes);
end $$;

-- ─── stock_out: FIFO consume ─────────────────────────────────────────────────
create or replace function public.stock_out(p_item uuid, p_qty numeric, p_reason text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.items;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select * into v from public.items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if p_qty > v.qty then raise exception 'only % available', v.qty; end if;
  perform public.consume_fifo(p_item, p_qty);
  insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes)
    values ('out', auth.uid(), p_item, v.name, p_qty, p_reason, p_notes);
end $$;

-- ─── write_off_batch: delete one batch (e.g. expired), log an 'out' ──────────
create or replace function public.write_off_batch(p_batch_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b public.stock_batches; v_name text;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  select * into b from public.stock_batches where id = p_batch_id for update;
  if not found then raise exception 'batch not found'; end if;
  select name into v_name from public.items where id = b.item_id;
  delete from public.stock_batches where id = p_batch_id;
  update public.items set qty =
    coalesce((select sum(qty) from public.stock_batches where item_id = b.item_id), 0)
    where id = b.item_id;
  insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes)
    values ('out', auth.uid(), b.item_id, v_name, b.qty, 'Write-off',
            case when b.expiry_date is null then 'Batch write-off'
                 else 'Batch expiring ' || b.expiry_date::text end);
end $$;

-- ─── generate_bill: FIFO consume per line (based on the 0010 optional-phone body)
create or replace function public.generate_bill(customer jsonb, lines jsonb)
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
        v_disc numeric; v_taxable numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;

  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;

  if v_phone <> '' then
    insert into public.customers (phone, name)
      values (v_phone, coalesce(customer->>'name',''))
      on conflict (phone) do update
        set name = case when excluded.name <> '' then excluded.name
                        else public.customers.name end,
            last_seen = now()
      returning id into v_customer;
  end if;

  v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
  v_taxable := v_sub - (v_sub * v_disc / 100);
  v_tax := v_taxable * v_rate / 100;
  insert into public.bills (customer_name, customer_phone, customer_id,
                            subtotal, tax, total, tax_rate, payment_method,
                            discount_percent, created_by)
    values (coalesce(customer->>'name',''), v_phone, v_customer,
            v_sub, v_tax, v_taxable + v_tax, v_rate,
            case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
            v_disc, auth.uid())
    returning * into v_bill;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price);
    perform public.consume_fifo(it.id, v_qty);
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;

-- ─── save_settings: include expiring_soon_days ───────────────────────────────
create or replace function public.save_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  update public.store_settings set
    name = coalesce(nullif(p->>'name',''), 'My Bakery'),
    tagline = coalesce(p->>'tagline',''),
    address = coalesce(p->>'address',''),
    phone = coalesce(p->>'phone',''),
    gst = coalesce(p->>'gst',''),
    currency = coalesce(nullif(p->>'currency',''),'₹'),
    tax_rate = coalesce((p->>'taxRate')::numeric,0),
    low_stock_alert = coalesce((p->>'lowStockAlert')::numeric,5),
    expiring_soon_days = coalesce((p->>'expiringSoonDays')::integer,3)
  where id = 1;
end $$;

-- ─── clear_all_data: also clear batches (explicit; FK would cascade anyway) ───
create or replace function public.clear_all_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  delete from public.bills;          -- cascades bill_items
  delete from public.stock_batches;
  delete from public.items;
  delete from public.activity_log;
  alter sequence bill_no_seq restart with 1001;
end $$;

-- ─── items_v: expose tracks_expiry + earliest_expiry ─────────────────────────
create or replace view public.items_v as
  select
    id, name, emoji, category, unit, price,
    case when public.has_perm('inventory') or public.has_perm('analytics')
         then cost_price else null end as cost_price,
    -- New columns are APPENDED after the original ones: CREATE OR REPLACE VIEW
    -- can only add columns at the end, not reorder existing ones. The client
    -- reads via `select *` and maps by name, so column order is irrelevant.
    qty, created_at, updated_at,
    tracks_expiry,
    (select min(sb.expiry_date) from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as earliest_expiry
  from public.items;
grant select on public.items_v to authenticated;

-- ─── Grants (new signatures) ─────────────────────────────────────────────────
grant execute on function
  public.stock_in(uuid, numeric, text, text, date),
  public.write_off_batch(uuid)
to authenticated;

-- ─── Rebuild cancel_bill / delete_bill to restore stock as batches ───────────
-- These pre-existing RPCs restored stock via `update items set qty`, which now
-- bypasses stock_batches. Restore returned stock as a non-expiring batch so the
-- items.qty mirror stays correct (original consumed batches are unrecoverable).
create or replace function public.cancel_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills; li public.bill_items;
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status = 'cancelled' then raise exception 'already cancelled'; end if;
  for li in select * from public.bill_items where bill_id = p_id loop
    if li.item_id is not null then
      perform public.add_batch(li.item_id, li.qty, null);
    end if;
  end loop;
  update public.bills set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
    where id = p_id;
  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('cancel', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Cancelled by ' || p_by);
end $$;

create or replace function public.delete_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills; li public.bill_items;
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status <> 'cancelled' then
    for li in select * from public.bill_items where bill_id = p_id loop
      if li.item_id is not null then
        perform public.add_batch(li.item_id, li.qty, null);
      end if;
    end loop;
  end if;
  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('delete', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Deleted by ' || p_by);
  delete from public.bills where id = p_id;   -- cascades bill_items
end $$;

-- Internal helpers: only callable from the SECURITY DEFINER RPCs above.
revoke execute on function public.add_batch(uuid, numeric, date), public.consume_fifo(uuid, numeric) from public;

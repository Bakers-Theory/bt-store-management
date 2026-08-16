-- ============================================================================
-- BT Store Management — selling a pack by the piece
--
-- Some stock arrives in a pack of 100 and is bought in as ONE pack, but the
-- customer wants three of them. Until now `unit` was a bare label with no
-- arithmetic behind it, so "1 box" and "1 pencil" were the same number and
-- there was no honest way to record the sale.
--
--   1. THE BATCH LEDGER KEEPS COUNTING PACKS. `stock_batches.qty` and
--      `stock_movement.qty` mean exactly what they meant before this migration,
--      so every existing purchase, return, expiry, alert and report is
--      untouched. A pack is still the unit of buying, of expiry and of value.
--   2. LOOSE PIECES ARE A SEPARATE COUNTER, `loose_qty`. Packs and pieces are
--      tracked side by side rather than folded into one fractional number: a
--      shelf holding "2 packs and 40 loose" is a fact about the shelf, and a
--      pack quantity of 2.4 would not be.
--   3. A PACK OPENS ITSELF. Selling a piece when `loose_qty` has run out
--      consumes one whole pack from the batches (FIFO, fresh only, exactly as a
--      sale always has) and credits `pack_size` pieces to `loose_qty`. The
--      cashier does nothing; the arithmetic is the same either way, and a
--      counter that stops to ask permission is a counter that sells the wrong
--      thing instead.
--   4. LOOSE PIECES DO NOT TRACK EXPIRY. `loose_qty` is one number per item,
--      not a batch, so an opened piece no longer carries the date it came in
--      with. This is a deliberate trade for a single counter over a parallel
--      batch table; loose stock turns over fast, and the packs it comes from
--      are still dated.
--   5. THE PIECE PRICE IS DERIVED, NEVER STORED. `round(price / pack_size, 2)`.
--      A second price field would be a second thing to keep in step with the
--      first, and it would drift. The rounding is real and is accepted: a ₹100
--      pack of 3 sells as three ₹33.33 pieces and yields ₹99.99, not ₹100.
--   6. `sell_mode` IS SNAPSHOTTED ON THE LINE. `bill_items` and
--      `bill_consumable` store which way the line was sold and what the pack
--      size was at the time, so a reprint is a statement about that sale and
--      not about today's master record — the rule `name`/`unit`/`price` already
--      follow.
--   7. OPENING A CONSUMABLE PACK IS A LEDGER ENTRY, type `open`. The ledger is
--      the only account of consumable stock (0062 note 1) and it stays truthful:
--      the pack left the shelf and can be seen leaving. `qty_signed` needs no
--      change — its `else` branch already signs an unknown type negative.
--   8. A RETURN GOES BACK THE WAY IT LEFT. A cancelled piece line credits
--      `loose_qty`; it does not try to reassemble a pack, because three pieces
--      out of a hundred do not make one.
--
-- Applies on top of 0072.
-- ============================================================================

-- ─── The two columns, on both masters (notes 1 and 2) ───────────────────────
-- Null pack_size is "not sold in packs", which is every existing row: nothing
-- about the current catalogue changes until someone ticks the box.
alter table public.items
  add column if not exists pack_size numeric,
  add column if not exists loose_qty numeric not null default 0;

alter table public.items drop constraint if exists items_pack_size_check;
alter table public.items add constraint items_pack_size_check
  check (pack_size is null or pack_size > 1);
alter table public.items drop constraint if exists items_loose_qty_check;
alter table public.items add constraint items_loose_qty_check
  check (loose_qty >= 0);
-- Loose pieces with no pack to have come out of would be stock nothing can
-- price, sell or put back.
alter table public.items drop constraint if exists items_loose_needs_pack;
alter table public.items add constraint items_loose_needs_pack
  check (loose_qty = 0 or pack_size is not null);

alter table public.consumable
  add column if not exists pack_size numeric(12,3),
  add column if not exists loose_qty numeric(12,3) not null default 0;

alter table public.consumable drop constraint if exists consumable_pack_size_check;
alter table public.consumable add constraint consumable_pack_size_check
  check (pack_size is null or pack_size > 1);
alter table public.consumable drop constraint if exists consumable_loose_qty_check;
alter table public.consumable add constraint consumable_loose_qty_check
  check (loose_qty >= 0);
alter table public.consumable drop constraint if exists consumable_loose_needs_pack;
alter table public.consumable add constraint consumable_loose_needs_pack
  check (loose_qty = 0 or pack_size is not null);

-- ─── The snapshot on the stored lines (note 6) ──────────────────────────────
-- 'pack' is the right default for every legacy row: before this migration every
-- line was sold in the item's own unit, which is what 'pack' means here.
alter table public.bill_items
  add column if not exists sell_mode text not null default 'pack',
  add column if not exists pack_size numeric;
alter table public.bill_items drop constraint if exists bill_items_sell_mode_check;
alter table public.bill_items add constraint bill_items_sell_mode_check
  check (sell_mode in ('pack','piece'));
-- A piece line that does not say how big the pack was cannot be read back.
alter table public.bill_items drop constraint if exists bill_items_piece_has_pack;
alter table public.bill_items add constraint bill_items_piece_has_pack
  check (sell_mode = 'pack' or pack_size is not null);

alter table public.bill_consumable
  add column if not exists sell_mode text not null default 'pack',
  add column if not exists pack_size numeric(12,3),
  -- Note 8: the marker that says this line's stock has already gone back.
  -- return_bill_consumables used to key idempotency off the existence of a
  -- matching `return` movement, which a PIECE line never writes.
  add column if not exists returned_at timestamptz;
alter table public.bill_consumable drop constraint if exists bill_consumable_sell_mode_check;
alter table public.bill_consumable add constraint bill_consumable_sell_mode_check
  check (sell_mode in ('pack','piece'));
alter table public.bill_consumable drop constraint if exists bill_consumable_piece_has_pack;
alter table public.bill_consumable add constraint bill_consumable_piece_has_pack
  check (sell_mode = 'pack' or pack_size is not null);

-- ─── stock_movement gains `open` (note 7) ──────────────────────────────────
-- The generated `qty_signed` column is NOT touched: its `else -abs(qty)` branch
-- already covers a type it has never seen, and altering a stored generated
-- column would mean dropping and rewriting the whole ledger.
alter table public.stock_movement drop constraint if exists stock_movement_movement_type_check;
alter table public.stock_movement add constraint stock_movement_movement_type_check
  check (movement_type in ('purchase','issue','return','open',
                           'adjustment','wastage','expired','damaged'));

-- ─── consume_pieces: the product side of note 3 ────────────────────────────
-- Takes p_qty PIECES off an item, opening as many whole packs as it takes. The
-- pack consumption goes through consume_fresh_fifo unchanged, so a shortage
-- raises there with its usual message and aborts the surrounding transaction —
-- there is no second, weaker stock check to drift from the first.
create or replace function public.consume_pieces(p_item uuid, p_qty numeric, p_tz text)
returns void language plpgsql set search_path = public as $$
declare it public.items; v_packs numeric := 0;
begin
  select * into it from public.items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if it.pack_size is null then
    raise exception '% is not sold in packs, so it has no pieces', it.name;
  end if;
  if p_qty <= 0 then raise exception 'a quantity has to be more than zero'; end if;

  if it.loose_qty < p_qty then
    v_packs := ceil((p_qty - it.loose_qty) / it.pack_size);
    perform public.consume_fresh_fifo(p_item, v_packs, p_tz);
  end if;

  update public.items
    set loose_qty = loose_qty + v_packs * it.pack_size - p_qty
    where id = p_item;
end $$;
revoke execute on function public.consume_pieces(uuid, numeric, text) from public;

-- ─── consume_consumable_pieces: the same rule, on the ledger (notes 3, 7) ───
-- Returns the id of the `open` movement it wrote, or null when the loose count
-- already covered the request. bill_consumable.stock_movement_id takes that
-- straight, which is why the null is returned rather than swallowed.
create or replace function public.consume_consumable_pieces(
  p_consumable uuid, p_qty numeric, p_on_date date, p_why text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.consumable; v_packs numeric; v_before numeric; v_id uuid;
begin
  select * into c from public.consumable where id = p_consumable for update;
  if not found or c.deleted_at is not null then raise exception 'item not found'; end if;
  if c.pack_size is null then
    raise exception '% is not sold in packs, so it has no pieces', c.name;
  end if;
  if p_qty <= 0 then raise exception 'a quantity has to be more than zero'; end if;

  if c.loose_qty >= p_qty then
    update public.consumable set loose_qty = loose_qty - p_qty where id = p_consumable;
    return null;
  end if;

  v_packs := ceil((p_qty - c.loose_qty) / c.pack_size);

  -- Computed under the row lock taken above, exactly as 0063 note 2 does, so
  -- two concurrent counters cannot both open the last pack.
  select coalesce(sum(qty_signed), 0) into v_before
    from public.stock_movement where consumable_id = p_consumable;
  if v_before - v_packs < 0 then
    raise exception 'there is only % % of % on hand, and % more would have to be opened',
      trim(to_char(v_before, 'FM9999990.999')), c.unit, c.name,
      trim(to_char(v_packs, 'FM9999990.999'));
  end if;

  insert into public.stock_movement (
    consumable_id, movement_type, qty, on_date, reason, remarks, created_by)
  values (
    p_consumable, 'open', v_packs, p_on_date, '', p_why, auth.uid())
  returning id into v_id;

  update public.consumable
    set loose_qty = loose_qty + v_packs * c.pack_size - p_qty
    where id = p_consumable;

  return v_id;
end $$;
revoke execute on function
  public.consume_consumable_pieces(uuid, numeric, date, text) from public;

-- ─── piece_price: note 5, in one place ─────────────────────────────────────
-- Both the server's pricing pass and the client's cart preview have to agree to
-- the paisa, so the rule lives here and is mirrored once in src/lib/pack.ts.
create or replace function public.piece_price(p_price numeric, p_pack numeric)
returns numeric language sql immutable as $$
  select case when coalesce(p_pack, 0) > 0
              then round(coalesce(p_price, 0) / p_pack, 2)
              else coalesce(p_price, 0) end
$$;
grant execute on function public.piece_price(numeric, numeric) to authenticated;

-- ─── items_v: the two columns, APPENDED ────────────────────────────────────
-- Reproduced from 0068; `create or replace view` permits new trailing columns
-- but not an insertion in the middle.
create or replace view public.items_v as
  select
    id, name, emoji, category, unit, price,
    case when public.has_perm('items.cost') or public.has_perm('dashboard.profit')
         then cost_price else null end as cost_price,
    qty, created_at, updated_at,
    tracks_expiry,
    (select min(sb.expiry_date) from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as earliest_expiry,
    (select coalesce(
              jsonb_agg(
                jsonb_build_object('qty', sb.qty, 'expiryDate', sb.expiry_date)
                order by sb.expiry_date asc nulls last, sb.created_at asc),
              '[]'::jsonb)
       from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as batches,
    image_url,
    hsn, gst_rate,
    pack_size, loose_qty                             -- ADDED (0073)
  from public.items;
grant select on public.items_v to authenticated;

-- ─── consumable_v: the same two, APPENDED ──────────────────────────────────
-- Reproduced from 0068 verbatim otherwise. `current_stock` still means PACKS
-- (note 1), so every alert, recommendation and value figure below is unchanged;
-- the loose count is reported alongside it rather than folded into it.
create or replace view public.consumable_v as
select
  c.id, c.code, c.name, c.category, c.unit,
  c.bill_mode,
  c.vendor_id,
  coalesce(v.name, '') as vendor_name,
  c.min_stock, c.max_stock, c.reorder_level, c.reorder_qty,
  c.cost_per_unit,
  c.expiry_date, c.storage_location, c.notes,

  coalesce(l.current_stock, 0) as current_stock,
  l.last_purchase_date,
  l.last_purchase_cost,
  l.last_movement_date,

  case
    when coalesce(l.current_stock, 0) <= 0 then 'out'
    when coalesce(l.current_stock, 0) < c.min_stock then 'low'
    when c.reorder_level is not null
         and coalesce(l.current_stock, 0) <= c.reorder_level then 'reorder'
    else 'ok'
  end as stock_status,

  case
    when coalesce(l.current_stock, 0) >= c.min_stock
         and (c.reorder_level is null
              or coalesce(l.current_stock, 0) > c.reorder_level) then 0
    when c.reorder_qty is not null then c.reorder_qty
    when c.max_stock is not null then greatest(c.max_stock - coalesce(l.current_stock, 0), 0)
    else greatest(c.min_stock - coalesce(l.current_stock, 0), 0)
  end as recommended_qty,

  (c.expiry_date - public.store_today()) as expiry_days_left,

  round(coalesce(l.current_stock, 0)
        * coalesce(l.last_purchase_cost, c.cost_per_unit, 0), 2) as stock_value,

  c.created_at,
  coalesce(cb.name, '') as created_by_name,
  c.updated_at,
  coalesce(ub.name, '') as updated_by_name,

  c.hsn, c.gst_rate,
  c.pack_size, c.loose_qty                           -- ADDED (0073)
from public.consumable c
left join public.suppliers v on v.id = c.vendor_id
left join public.profiles cb on cb.id = c.created_by
left join public.profiles ub on ub.id = c.updated_by
left join lateral (
  select
    sum(m.qty_signed) as current_stock,
    max(m.on_date) as last_movement_date,
    max(m.on_date) filter (where m.movement_type = 'purchase') as last_purchase_date,
    (array_agg(m.unit_cost order by m.on_date desc, m.created_at desc)
       filter (where m.movement_type = 'purchase' and m.unit_cost is not null))[1]
      as last_purchase_cost
  from public.stock_movement m
  where m.consumable_id = c.id
) l on true
where c.deleted_at is null
  and public.has_perm('consumables.view');
grant select on public.consumable_v to authenticated;

-- ─── create_item / update_item: accept packSize ────────────────────────────
-- Reproduced from 0071 and 0068 with the ADDED lines.
create or replace function public.create_item(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dup public.items; v_id uuid;
        v_qty numeric := coalesce((p->>'qty')::numeric, 0);
        v_tracks boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_expiry date := nullif(p->>'expiryDate','')::date;
        v_row public.items_v;
        v_supplier uuid := nullif(p->>'supplierId','')::uuid;
        v_sup_status text;
        v_pack numeric := nullif(p->>'packSize','')::numeric;       -- ADDED (0073)
begin
  if not public.has_perm('items.create') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();

  -- ADDED (0073): said in words, so the form shows a sentence rather than a
  -- constraint name. A pack of one is just the item.
  if v_pack is not null and v_pack <= 1 then
    raise exception 'a pack has to hold more than one piece';
  end if;

  if v_supplier is not null then
    if not public.has_perm('suppliers.edit') then
      v_supplier := null;
    else
      select status into v_sup_status from public.suppliers where id = v_supplier;
      if not found then raise exception 'supplier not found'; end if;
      if v_sup_status <> 'active' then
        raise exception 'reactivate this supplier before adding products to them';
      end if;
    end if;
  end if;

  select * into v_dup from public.items where name_key = lower(trim(p->>'name'));
  if found then
    if v_qty > 0 then
      perform public.add_batch(v_dup.id, v_qty, v_expiry, v_supplier, null::uuid);
      insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
        values ('in', auth.uid(), v_dup.id, v_dup.name, v_qty,
                'Added via New Item form (existing item)');
    end if;
    select * into v_row from public.items_v where id = v_dup.id;
    return jsonb_build_object('kind','merged','name',v_dup.name,'qty',v_qty,'unit',v_dup.unit,
                               'item',to_jsonb(v_row));
  end if;
  insert into public.items (name, emoji, category, unit, price, cost_price, qty,
                            tracks_expiry, image_url,
                            hsn, gst_rate,
                            pack_size)                              -- ADDED (0073)
    values (p->>'name', coalesce(p->>'emoji','📦'), p->>'category', p->>'unit',
            coalesce((p->>'price')::numeric,0), coalesce((p->>'costPrice')::numeric,0),
            0, v_tracks, nullif(p->>'imageUrl',''),
            btrim(coalesce(p->>'hsn','')),
            coalesce((p->>'gstRate')::numeric, 0),
            v_pack)                                                 -- ADDED (0073)
    returning id into v_id;
  if v_qty > 0 then
    perform public.add_batch(v_id, v_qty, v_expiry, v_supplier, null::uuid);
    insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
      values ('in', auth.uid(), v_id, p->>'name', v_qty, 'Initial stock');
  end if;
  select * into v_row from public.items_v where id = v_id;
  return jsonb_build_object('kind','added','id',v_id,'item',to_jsonb(v_row));
end $$;

create or replace function public.update_item(p_id uuid, p jsonb)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v_old public.items;
        v_tracks_new boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_sum numeric; v_row public.items_v;
        v_pack numeric := nullif(p->>'packSize','')::numeric;       -- ADDED (0073)
begin
  if not public.has_perm('items.edit') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  select * into v_old from public.items where id = p_id for update;
  if not found then raise exception 'item not found'; end if;

  -- ADDED (0073). Turning pack mode off while loose pieces are still on the
  -- shelf would strand them: nothing would be able to price them, sell them or
  -- put them back. Sell them out or write them off first.
  if v_pack is not null and v_pack <= 1 then
    raise exception 'a pack has to hold more than one piece';
  end if;
  if v_pack is null and v_old.loose_qty > 0 then
    raise exception
      'there are still % loose pieces of %, so it cannot stop being sold in packs',
      trim(to_char(v_old.loose_qty, 'FM9999990.999')), v_old.name;
  end if;

  update public.items set
    name = p->>'name', emoji = coalesce(p->>'emoji','📦'), category = p->>'category',
    unit = p->>'unit', price = coalesce((p->>'price')::numeric,0),
    cost_price = case when public.has_perm('items.cost')
                      then coalesce((p->>'costPrice')::numeric, 0)
                      else cost_price end,
    tracks_expiry = v_tracks_new,
    image_url = nullif(p->>'imageUrl',''),
    hsn = btrim(coalesce(p->>'hsn', hsn)),
    gst_rate = coalesce((p->>'gstRate')::numeric, gst_rate),
    pack_size = v_pack                                              -- ADDED (0073)
  where id = p_id;
  if v_old.tracks_expiry and not v_tracks_new then
    select coalesce(sum(qty),0) into v_sum from public.stock_batches where item_id = p_id;
    delete from public.stock_batches where item_id = p_id;
    if v_sum > 0 then
      insert into public.stock_batches (item_id, qty, expiry_date) values (p_id, v_sum, null);
    end if;
  end if;
  select * into v_row from public.items_v where id = p_id;
  return v_row;
end $$;

-- ─── save_consumable: accept packSize ──────────────────────────────────────
-- Reproduced from 0068 with one ADDED local and two ADDED validations. The pack
-- size is deliberately NOT frozen the way `unit` is: changing it reinterprets
-- nothing, because the ledger counts packs and loose_qty counts pieces. It only
-- changes how many pieces the NEXT pack opens into.
create or replace function public.save_consumable(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_old public.consumable;
  v_name text := btrim(coalesce(p->>'name',''));
  v_cat text := btrim(coalesce(p->>'category',''));
  v_unit text := btrim(coalesce(p->>'unit',''));
  v_vendor uuid := nullif(p->>'vendorId','')::uuid;
  v_min numeric := round(coalesce((p->>'minStock')::numeric, 0), 3);
  v_max numeric := round(nullif(p->>'maxStock','')::numeric, 3);
  v_reorder numeric := round(nullif(p->>'reorderLevel','')::numeric, 3);
  v_rqty numeric := round(nullif(p->>'reorderQty','')::numeric, 3);
  v_cost numeric := round(nullif(p->>'costPerUnit','')::numeric, 2);
  v_expiry date := nullif(p->>'expiryDate','')::date;
  v_bill_mode text := coalesce(nullif(p->>'billMode',''), 'none');
  v_hsn text := btrim(coalesce(p->>'hsn',''));
  v_gst numeric := coalesce((p->>'gstRate')::numeric, 0);
  v_pack numeric := round(nullif(p->>'packSize','')::numeric, 3);   -- ADDED (0073)
begin
  if v_id is null then
    if not public.has_perm('consumables.create') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('consumables.edit') then raise exception 'forbidden'; end if;
  end if;

  if v_name = '' then raise exception 'this item needs a name'; end if;
  if not exists (select 1 from public.store_lists
                  where kind = 'consumable_category' and value = v_cat) then
    raise exception 'pick a category from the list';
  end if;
  if not exists (select 1 from public.store_lists where kind = 'unit' and value = v_unit) then
    raise exception 'pick a unit from the list';
  end if;
  if v_min < 0 then raise exception 'a minimum cannot be negative'; end if;
  if v_cost is not null and v_cost < 0 then
    raise exception 'a cost cannot be negative';
  end if;

  if v_bill_mode not in ('none','charge','absorb') then
    raise exception 'unknown billing mode "%"', v_bill_mode;
  end if;
  if v_bill_mode = 'charge' and coalesce(v_cost, 0) <= 0 then
    raise exception 'set a cost per unit before charging this item on a bill';
  end if;

  if v_gst < 0 or v_gst > 28 then
    raise exception 'a GST rate has to be between 0 and 28';
  end if;

  -- ADDED (0073)
  if v_pack is not null and v_pack <= 1 then
    raise exception 'a pack has to hold more than one piece';
  end if;

  if v_vendor is not null
     and not exists (select 1 from public.suppliers where id = v_vendor) then
    raise exception 'that vendor no longer exists';
  end if;

  if exists (select 1 from public.consumable
              where name = v_name and unit = v_unit
                and deleted_at is null
                and (v_id is null or id <> v_id)) then
    raise exception '"% (%)" already exists', v_name, v_unit;
  end if;

  if v_id is not null then
    select * into v_old from public.consumable where id = v_id for update;
    if not found or v_old.deleted_at is not null then
      raise exception 'item not found';
    end if;
    if v_old.unit <> v_unit
       and exists (select 1 from public.stock_movement where consumable_id = v_id) then
      raise exception
        'this item already has stock movements in %, so its unit cannot change',
        v_old.unit;
    end if;
    -- ADDED (0073): the same stranding guard update_item carries.
    if v_pack is null and v_old.loose_qty > 0 then
      raise exception
        'there are still % loose pieces of %, so it cannot stop being sold in packs',
        trim(to_char(v_old.loose_qty, 'FM9999990.999')), v_old.name;
    end if;

    update public.consumable set
      name = v_name, category = v_cat, unit = v_unit, vendor_id = v_vendor,
      min_stock = v_min, max_stock = v_max, reorder_level = v_reorder,
      reorder_qty = v_rqty, cost_per_unit = v_cost,
      expiry_date = v_expiry,
      bill_mode = v_bill_mode,
      hsn = v_hsn, gst_rate = v_gst,
      pack_size = v_pack,                                           -- ADDED (0073)
      storage_location = btrim(coalesce(p->>'storageLocation','')),
      notes = btrim(coalesce(p->>'notes','')),
      updated_by = auth.uid()
    where id = v_id;

    insert into public.activity_log (type, actor, item_name, notes)
      values ('consumable', auth.uid(), v_name, 'Edited item ' || v_old.code);

    return v_id;
  end if;

  insert into public.consumable (
    name, category, unit, vendor_id,
    min_stock, max_stock, reorder_level, reorder_qty, cost_per_unit,
    expiry_date, bill_mode,
    hsn, gst_rate,
    pack_size,                                                      -- ADDED (0073)
    storage_location, notes, created_by, updated_by)
  values (
    v_name, v_cat, v_unit, v_vendor,
    v_min, v_max, v_reorder, v_rqty, v_cost,
    v_expiry, v_bill_mode,
    v_hsn, v_gst,
    v_pack,                                                         -- ADDED (0073)
    btrim(coalesce(p->>'storageLocation','')),
    btrim(coalesce(p->>'notes','')), auth.uid(), auth.uid())
  returning id into v_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('consumable', auth.uid(), v_name,
            'Added item ' || (select code from public.consumable where id = v_id)
            || ' (' || v_cat || ')');

  return v_id;
end $$;
grant execute on function public.save_consumable(jsonb) to authenticated;

-- ─── billable_consumables: the picker needs the pack figures ───────────────
-- Reproduced from 0068 with one ADDED line. Without pack_size the cart cannot
-- offer the toggle, and without loose_qty it cannot cap a piece quantity.
create or replace function public.billable_consumables()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb)
  from (
    select
      c.id, c.code, c.name, c.unit, c.bill_mode,
      c.hsn, c.gst_rate,
      c.pack_size, c.loose_qty,                             -- ADDED (0073)
      coalesce(c.cost_per_unit, 0) as cost_per_unit,
      coalesce((select sum(m.qty_signed) from public.stock_movement m
                 where m.consumable_id = c.id), 0) as current_stock
    from public.consumable c
    where c.deleted_at is null
      and c.bill_mode <> 'none'
      and (public.has_perm('bill.create') or public.has_perm('consumables.view'))
  ) t
$$;
grant execute on function public.billable_consumables() to authenticated;

-- ─── record_stock_movement: an issue or a return may be in pieces ──────────
-- Reproduced from 0066 with the ADDED `sellMode` branch. Only `issue` and
-- `return` accept it: a purchase arrives in packs, and an adjustment or a
-- write-off is a statement about the packs on the shelf. Anything else asking
-- for pieces is a mistake worth saying out loud rather than reinterpreting.
create or replace function public.record_stock_movement(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.consumable;
  v_item uuid := nullif(p->>'consumableId','')::uuid;
  v_type text := coalesce(p->>'movementType','');
  v_qty numeric := round(coalesce((p->>'qty')::numeric, 0), 3);
  v_on date := coalesce(nullif(p->>'onDate','')::date, public.store_today());
  v_cost numeric := round(nullif(p->>'unitCost','')::numeric, 2);
  v_vendor uuid := nullif(p->>'vendorId','')::uuid;
  v_to uuid := nullif(p->>'issuedTo','')::uuid;
  v_reason text := btrim(coalesce(p->>'reason',''));
  v_signed numeric;
  v_before numeric;
  v_id uuid;
  v_link jsonb := case when jsonb_typeof(p->'expense') = 'object'
                       then p->'expense' end;
  v_expense uuid;
  v_mode text := case when p->>'sellMode' = 'piece' then 'piece' else 'pack' end; -- ADDED (0073)
  v_stock numeric;                                                  -- ADDED (0073)
begin
  if v_type not in ('purchase','issue','return',
                    'adjustment','wastage','expired','damaged') then
    raise exception 'unknown movement type "%"', v_type;
  end if;

  if v_type in ('purchase','issue','return') then
    if not public.has_perm('consumables.issue') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('consumables.adjust') then raise exception 'forbidden'; end if;
  end if;

  select * into c from public.consumable where id = v_item for update;
  if not found or c.deleted_at is not null then raise exception 'item not found'; end if;

  if v_type = 'adjustment' then
    if v_qty = 0 then raise exception 'an adjustment of zero changes nothing'; end if;
  elsif v_qty <= 0 then
    raise exception 'a quantity has to be more than zero';
  end if;

  if v_on > public.store_today() then
    raise exception 'a stock movement cannot be dated in the future';
  end if;

  if v_type in ('adjustment','wastage','expired','damaged') and v_reason = '' then
    raise exception 'say why this stock is being written off';
  end if;

  if v_cost is not null and v_type <> 'purchase' then
    raise exception 'a unit cost belongs on a purchase';
  end if;
  if v_vendor is not null
     and not exists (select 1 from public.suppliers where id = v_vendor) then
    raise exception 'that vendor no longer exists';
  end if;
  if v_to is not null
     and not exists (select 1 from public.profiles where id = v_to) then
    raise exception 'that employee no longer exists';
  end if;

  if v_link is not null then
    if v_type <> 'purchase' then
      raise exception
        'only a purchase is money out — issuing or writing off stock does not move cash';
    end if;
    if v_cost is null then
      raise exception 'enter the cost per % so the spend can be recorded', c.unit;
    end if;
  end if;

  -- ─── ADDED (0073): the piece path ────────────────────────────────────────
  -- It writes no `issue`/`return` row of its own. The pieces came out of packs
  -- the ledger has already accounted for — an issue on top of that `open` would
  -- take the stock twice.
  if v_mode = 'piece' then
    if c.pack_size is null then
      raise exception '% is not sold in packs, so it has no pieces', c.name;
    end if;
    if v_type not in ('issue','return') then
      raise exception 'only an issue or a return can be recorded in pieces';
    end if;
    if v_type = 'issue' then
      v_id := public.consume_consumable_pieces(v_item, v_qty, v_on,
                coalesce(nullif(btrim(coalesce(p->>'remarks','')), ''),
                         'Opened to issue ' || trim(to_char(v_qty, 'FM9999990.999'))
                           || ' pieces'));
    else
      update public.consumable set loose_qty = loose_qty + v_qty where id = v_item;
    end if;

    insert into public.activity_log (type, actor, item_name, qty, reason, notes, total)
      values ('consumable', auth.uid(), c.name, v_qty, nullif(v_reason, ''),
              initcap(v_type) || ' of ' || trim(to_char(v_qty, 'FM9999990.999'))
                || ' pieces — ' || c.code, null);

    select coalesce(sum(qty_signed), 0) into v_stock
      from public.stock_movement where consumable_id = v_item;
    return jsonb_build_object('movementId', v_id, 'currentStock', v_stock,
                              'expenseId', null);
  end if;

  v_signed := case v_type
                when 'purchase'   then abs(v_qty)
                when 'return'     then abs(v_qty)
                when 'adjustment' then v_qty
                else -abs(v_qty)
              end;

  select coalesce(sum(qty_signed), 0) into v_before
    from public.stock_movement where consumable_id = v_item;

  if v_before + v_signed < 0 then
    raise exception 'there is only % % on hand, so % cannot go out',
      trim(to_char(v_before, 'FM9999990.999')), c.unit,
      trim(to_char(abs(v_signed), 'FM9999990.999'));
  end if;

  insert into public.stock_movement (
    consumable_id, movement_type, qty, on_date, unit_cost,
    vendor_id, issued_to, reason, remarks, created_by)
  values (
    v_item, v_type, v_qty, v_on, v_cost,
    coalesce(v_vendor, case when v_type = 'purchase' then c.vendor_id end),
    v_to, v_reason, btrim(coalesce(p->>'remarks','')), auth.uid())
  returning id into v_id;

  insert into public.activity_log (type, actor, item_name, qty, reason, notes, total)
    values ('consumable', auth.uid(), c.name, v_qty,
            nullif(v_reason, ''),
            initcap(v_type) || ' of ' || trim(to_char(abs(v_qty), 'FM9999990.999'))
              || ' ' || c.unit || ' — ' || c.code,
            case when v_cost is not null then round(v_cost * abs(v_qty), 2) end);

  if v_link is not null then
    v_expense := public.record_linked_expense(
      v_link || jsonb_build_object(
        'amount', round(v_cost * abs(v_qty), 2),
        'sourceType', 'consumable_purchase',
        'sourceId', v_id,
        'note', 'Purchase of ' || trim(to_char(abs(v_qty), 'FM9999990.999'))
                || ' ' || c.unit || ' — ' || c.name));
  end if;

  select coalesce(sum(qty_signed), 0) into v_stock
    from public.stock_movement where consumable_id = v_item;

  return jsonb_build_object('movementId', v_id, 'currentStock', v_stock,
                            'expenseId', v_expense);
end $$;
grant execute on function public.record_stock_movement(jsonb) to authenticated;

-- ─── issue_consumable_for_bill: a piece line opens its own pack ────────────
-- Reproduced from 0067 with the ADDED mode argument. The old four-argument
-- signature is dropped so nothing can keep calling it and silently issue packs
-- where the cart meant pieces.
drop function if exists public.issue_consumable_for_bill(uuid, numeric, date, bigint);

create or replace function public.issue_consumable_for_bill(
  p_consumable_id uuid,
  p_qty           numeric,
  p_on_date       date,
  p_bill_no       bigint,
  p_sell_mode     text default 'pack'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.consumable; v_before numeric; v_id uuid; v_qty numeric;
begin
  v_qty := round(coalesce(p_qty, 0), 3);
  if v_qty <= 0 then raise exception 'a quantity has to be more than zero'; end if;

  select * into c from public.consumable where id = p_consumable_id for update;
  if not found or c.deleted_at is not null then
    raise exception 'that consumable no longer exists';
  end if;
  if c.bill_mode = 'none' then
    raise exception '"%" is not available at billing', c.name;
  end if;

  -- ADDED (0073). consume_consumable_pieces takes the same row lock and runs
  -- the same negative-stock check, so the guarantee is identical.
  if p_sell_mode = 'piece' then
    if c.pack_size is null then
      raise exception '% is not sold in packs, so it has no pieces', c.name;
    end if;
    return public.consume_consumable_pieces(
      p_consumable_id, v_qty, p_on_date, 'Opened on bill #' || p_bill_no);
  end if;

  select coalesce(sum(qty_signed), 0) into v_before
    from public.stock_movement where consumable_id = p_consumable_id;

  if v_before - v_qty < 0 then
    raise exception 'there is only % % of % on hand',
      trim(to_char(v_before, 'FM9999990.999')), c.unit, c.name;
  end if;

  insert into public.stock_movement (
    consumable_id, movement_type, qty, on_date, reason, remarks, created_by)
  values (
    p_consumable_id, 'issue', v_qty, p_on_date, '',
    'Issued on bill #' || p_bill_no, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function
  public.issue_consumable_for_bill(uuid, numeric, date, bigint, text) from public;

-- ─── bill_payload: carry the mode onto the receipt ─────────────────────────
-- Reproduced from 0067 with two ADDED keys per line. Without them a reprinted
-- piece line would show the pack's unit against the piece's price.
create or replace function public.bill_payload(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bill', to_jsonb(b) - 'client_ref' || jsonb_build_object('biller_name', p.name),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bi.id, 'bill_id', bi.bill_id, 'item_id', bi.item_id,
               'name', bi.name, 'emoji', bi.emoji, 'image_url', bi.image_url,
               'unit', bi.unit, 'qty', bi.qty, 'price', bi.price,
               'sell_mode', bi.sell_mode, 'pack_size', bi.pack_size   -- ADDED (0073)
             ) order by bi.line_no nulls last, bi.name)
      from public.bill_items bi where bi.bill_id = b.id), '[]'::jsonb),
    'consumables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', bc.id, 'consumable_id', bc.consumable_id,
               'name', bc.name, 'unit', bc.unit, 'qty', bc.qty,
               'unit_cost', bc.unit_cost, 'charged', bc.charged,
               'sell_mode', bc.sell_mode, 'pack_size', bc.pack_size   -- ADDED (0073)
             ) order by bc.line_no)
      from public.bill_consumable bc where bc.bill_id = b.id), '[]'::jsonb)
  )
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where b.id = p_id
$$;

-- ─── generate_bill: price and consume by the piece ─────────────────────────
-- Reproduced from 0070 with the blocks marked ADDED (0073). Every other line —
-- the permission checks, the replay guard, the locks, the occasion discount,
-- the redemption, the pro-rata allocation, the GST split, the shortfall and the
-- cash postings — is 0070 verbatim.
create or replace function public.generate_bill(
  customer jsonb, lines jsonb, p_tz text default 'UTC',
  p_client_ref uuid default null, p_consumables jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sub numeric := 0; v_tax numeric := 0; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric; v_no int := 0;
        v_type text; v_disc numeric := 0; v_amt numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
        v_existing uuid;
        v_recv numeric; v_short numeric := 0; v_snote text := ''; v_note text;
        cn jsonb; cc public.consumable; v_cqty numeric; v_cno int := 0;
        v_charged boolean; v_ccost numeric;
        v_csub numeric := 0; v_absorbed numeric := 0; v_mv uuid;
        v_on date;
        v_inv_type text; v_store public.store_settings;
        v_gstin text; v_pos text; v_inter boolean := false;
        v_incl boolean; v_fy text; v_inv_no text;
        v_taxable numeric := 0; v_cgst numeric := 0; v_sgst numeric := 0;
        v_igst numeric := 0; v_missing text;
        v_amounts numeric[] := '{}'; v_rates numeric[] := '{}';
        v_shares numeric[] := '{}';
        v_n int; v_i int; v_alloc numeric := 0; v_last int := 0;
        v_net numeric; v_ltax numeric; v_ltaxable numeric;
        v_lcgst numeric; v_lsgst numeric; v_ligst numeric;
        v_loy_on boolean := false; v_occ text;
        v_pts_req integer := 0; v_pts_bal integer := 0;
        v_manual numeric := 0; v_occ_amt numeric := 0; v_red_amt numeric := 0;
        v_pts_red integer := 0; v_pts_earn integer := 0;
        v_over numeric; v_cut numeric;
        v_dob date; v_anniv date; v_today date; v_feb28 boolean := false;
        v_prior_dob date; v_prior_anniv date;
        -- ADDED (0073)
        v_mode text; v_price numeric; v_cmode text; v_cunit text;
begin
  if not public.has_perm('bill.create') then raise exception 'forbidden'; end if;
  if coalesce((customer->>'discount')::numeric, 0) > 0
     and not public.has_perm('bill.discount') then
    raise exception 'not allowed to apply a discount';
  end if;

  if coalesce((customer->>'redeemPoints')::integer, 0) > 0
     and not public.has_perm('loyalty.redeem') then
    raise exception 'not allowed to redeem points';
  end if;

  if p_client_ref is not null then
    select id into v_existing from public.bills where client_ref = p_client_ref;
    if found then return public.bill_payload(v_existing); end if;
  end if;

  select * into v_store from public.store_settings where id = 1;
  if not v_store.is_open then
    raise exception 'Store is closed — new bills cannot be created';
  end if;

  v_on := (now() at time zone p_tz)::date;
  perform public.assert_cash_day_open(v_on);

  v_inv_type := case when customer->>'invoiceType' = 'gst' then 'gst' else 'non_gst' end;
  v_incl := coalesce(v_store.prices_include_gst, true);

  if v_inv_type = 'gst' then
    if coalesce(btrim(v_store.gst), '') = '' then
      raise exception 'add the store GSTIN in Settings before raising a GST invoice';
    end if;
    if coalesce(btrim(v_store.gst_state_code), '') = '' then
      raise exception 'add the store state code in Settings before raising a GST invoice';
    end if;
    v_gstin := upper(btrim(coalesce(customer->>'gstin','')));
    if v_gstin <> '' and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then
      raise exception 'that GSTIN does not look right';
    end if;
    v_pos := coalesce(nullif(btrim(coalesce(customer->>'placeOfSupply','')), ''),
                      nullif(left(v_gstin, 2), ''),
                      v_store.gst_state_code);
    v_inter := v_pos <> v_store.gst_state_code;
  else
    v_gstin := '';
    v_pos := '';
    v_inter := false;
  end if;

  -- ─── pass 1: price and validate every line before the bill row exists ─────
  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    if v_inv_type = 'gst' and coalesce(btrim(it.hsn),'') = '' then
      v_missing := coalesce(v_missing || ', ', '') || it.name;
    end if;

    -- ADDED (0073): note 5. The mode decides the price, and a piece line on an
    -- item with no pack size is rejected here rather than priced as a pack.
    v_mode := case when ln->>'sellMode' = 'piece' then 'piece' else 'pack' end;
    if v_mode = 'piece' and it.pack_size is null then
      raise exception '% is not sold in packs, so it cannot be billed by the piece', it.name;
    end if;
    v_price := case when v_mode = 'piece'
                    then public.piece_price(it.price, it.pack_size)
                    else it.price end;

    v_sub := v_sub + round(v_qty * v_price, 2);
    v_amounts := v_amounts || round(v_qty * v_price, 2);
    v_rates := v_rates || case when v_inv_type = 'gst' then it.gst_rate else 0 end;
  end loop;

  for cn in select * from jsonb_array_elements(p_consumables) loop
    v_cqty := round(coalesce((cn->>'qty')::numeric, 0), 3);
    v_charged := coalesce((cn->>'charged')::boolean, false);
    select * into cc from public.consumable
      where id = (cn->>'consumableId')::uuid for update;
    if not found or cc.deleted_at is not null then
      raise exception 'that consumable no longer exists';
    end if;
    if cc.bill_mode = 'none' then
      raise exception '"%" is not available at billing', cc.name;
    end if;
    if v_cqty <= 0 then raise exception 'a quantity has to be more than zero'; end if;

    -- ADDED (0073): the same rule as an item line, on the consumable's cost.
    v_cmode := case when cn->>'sellMode' = 'piece' then 'piece' else 'pack' end;
    if v_cmode = 'piece' and cc.pack_size is null then
      raise exception '% is not sold in packs, so it cannot be billed by the piece', cc.name;
    end if;
    v_ccost := case when v_cmode = 'piece'
                    then public.piece_price(coalesce(cc.cost_per_unit, 0), cc.pack_size)
                    else coalesce(cc.cost_per_unit, 0) end;

    if v_charged and v_ccost <= 0 then
      raise exception 'set a cost per unit on % before charging it on a bill', cc.name;
    end if;
    if v_charged and v_inv_type = 'gst' and coalesce(btrim(cc.hsn),'') = '' then
      v_missing := coalesce(v_missing || ', ', '') || cc.name;
    end if;

    if v_charged then
      v_csub := v_csub + round(v_cqty * v_ccost, 2);
      v_amounts := v_amounts || round(v_cqty * v_ccost, 2);
      v_rates := v_rates || case when v_inv_type = 'gst' then cc.gst_rate else 0 end;
    else
      v_absorbed := v_absorbed + v_cqty * v_ccost;
    end if;
  end loop;

  if v_missing is not null then
    raise exception 'set an HSN code on these before raising a GST invoice: %', v_missing;
  end if;

  v_sub := round(v_sub + v_csub, 2);
  v_absorbed := round(v_absorbed, 2);

  if v_phone <> '' then
    select c.dob, c.anniversary into v_prior_dob, v_prior_anniv
      from public.customers c where c.phone = v_phone for update;

    v_dob := nullif(btrim(coalesce(customer->>'dob','')), '')::date;
    v_anniv := nullif(btrim(coalesce(customer->>'anniversary','')), '')::date;
    insert into public.customers (phone, name, dob, anniversary)
      values (v_phone, coalesce(customer->>'name',''), v_dob, v_anniv)
      on conflict (phone) do update
        set name = case when excluded.name <> '' then excluded.name
                        else public.customers.name end,
            dob = coalesce(public.customers.dob, excluded.dob),
            anniversary = coalesce(public.customers.anniversary, excluded.anniversary),
            last_seen = now()
      returning id, points_balance
      into v_customer, v_pts_bal;
  end if;

  v_loy_on := coalesce(v_store.loyalty_enabled, false) and v_customer is not null;
  if v_loy_on then
    v_today := v_on;
    v_feb28 := extract(month from v_today) = 2
               and extract(day from v_today) = 28
               and not public.is_leap_year(extract(year from v_today)::int);
    if v_prior_dob is not null
       and ((extract(month from v_prior_dob) = extract(month from v_today)
             and extract(day from v_prior_dob) = extract(day from v_today))
            or (v_feb28 and extract(month from v_prior_dob) = 2
                and extract(day from v_prior_dob) = 29)) then
      v_occ := 'birthday';
    elsif v_prior_anniv is not null
       and ((extract(month from v_prior_anniv) = extract(month from v_today)
             and extract(day from v_prior_anniv) = extract(day from v_today))
            or (v_feb28 and extract(month from v_prior_anniv) = 2
                and extract(day from v_prior_anniv) = 29)) then
      v_occ := 'anniversary';
    end if;
  end if;

  v_type := case when customer->>'discountType' = 'flat' then 'flat' else 'percent' end;
  if v_type = 'flat' then
    v_manual := greatest(0, round(coalesce((customer->>'discount')::numeric, 0), 2));
  else
    v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
    v_manual := round(v_sub * v_disc / 100, 2);
  end if;

  if v_loy_on and v_occ is not null then
    v_occ_amt := least(
      round(v_sub * least(100, greatest(0, v_store.occasion_discount_percent)) / 100, 2),
      v_store.occasion_discount_cap);
  end if;

  if v_loy_on then
    v_pts_req := greatest(0, coalesce((customer->>'redeemPoints')::integer, 0));
    if v_pts_req > 0 then
      if v_pts_req > v_pts_bal then
        raise exception 'that customer only has % points', v_pts_bal;
      end if;
      if v_pts_req < v_store.min_redeem_points then
        raise exception 'at least % points are needed to redeem', v_store.min_redeem_points;
      end if;
      v_red_amt := round(v_pts_req::numeric / v_store.points_per_rupee, 2);
    end if;
  elsif coalesce((customer->>'redeemPoints')::integer, 0) > 0 then
    raise exception 'the loyalty programme is not available on this bill';
  end if;

  v_over := round(v_manual + v_occ_amt + v_red_amt - v_sub, 2);
  if v_over > 0 then
    v_cut := least(v_red_amt, v_over);
    v_red_amt := round(v_red_amt - v_cut, 2); v_over := round(v_over - v_cut, 2);
    v_cut := least(v_occ_amt, v_over);
    v_occ_amt := round(v_occ_amt - v_cut, 2); v_over := round(v_over - v_cut, 2);
    v_cut := least(v_manual, v_over);
    v_manual := round(v_manual - v_cut, 2);
  end if;
  if v_occ_amt = 0 then v_occ := null; end if;
  v_pts_red := round(v_red_amt * v_store.points_per_rupee)::integer;

  v_amt := round(v_manual + v_occ_amt + v_red_amt, 2);

  v_n := coalesce(array_length(v_amounts, 1), 0);
  for v_i in 1 .. v_n loop
    v_shares := v_shares || 0::numeric;
  end loop;
  if v_sub > 0 and v_amt > 0 then
    for v_i in 1 .. v_n loop
      if v_amounts[v_i] > 0 then
        v_last := v_i;
        v_shares[v_i] := round(v_amt * v_amounts[v_i] / v_sub, 2);
        v_alloc := round(v_alloc + v_shares[v_i], 2);
      end if;
    end loop;
    if v_last > 0 and v_alloc <> v_amt then
      v_shares[v_last] := round(v_shares[v_last] + (v_amt - v_alloc), 2);
    end if;
  end if;

  for v_i in 1 .. v_n loop
    v_net := round(v_amounts[v_i] - v_shares[v_i], 2);
    if v_incl then
      v_ltaxable := round(v_net / (1 + v_rates[v_i] / 100), 2);
      v_ltax := round(v_net - v_ltaxable, 2);
    else
      v_ltaxable := v_net;
      v_ltax := round(v_ltaxable * v_rates[v_i] / 100, 2);
    end if;
    if v_inter then
      v_ligst := v_ltax; v_lcgst := 0; v_lsgst := 0;
    else
      v_lsgst := round(floor(v_ltax * 100 / 2) / 100, 2);
      v_lcgst := round(v_ltax - v_lsgst, 2);
      v_ligst := 0;
    end if;
    v_taxable := round(v_taxable + v_ltaxable, 2);
    v_cgst := round(v_cgst + v_lcgst, 2);
    v_sgst := round(v_sgst + v_lsgst, 2);
    v_igst := round(v_igst + v_ligst, 2);
  end loop;
  v_tax := round(v_cgst + v_sgst + v_igst, 2);

  v_fy := public.financial_year(v_on);
  v_inv_no := public.next_invoice_no(v_inv_type, v_fy);

  begin
    insert into public.bills (customer_name, customer_phone, customer_id,
                              subtotal, tax, total, tax_rate, payment_method,
                              discount_percent, discount_type, discount_amount,
                              created_by, client_ref,
                              invoice_type, invoice_no, customer_gstin,
                              place_of_supply, is_interstate,
                              taxable_value, cgst, sgst, igst,
                              occasion_kind, occasion_discount,
                              points_redeemed, points_redeem_value)
      values (coalesce(customer->>'name',''), v_phone, v_customer,
              v_sub, v_tax, round(v_taxable + v_tax, 2), 0,
              case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
              v_disc, v_type, v_amt, auth.uid(), p_client_ref,
              v_inv_type, v_inv_no, v_gstin, v_pos, v_inter,
              v_taxable, v_cgst, v_sgst, v_igst,
              v_occ, v_occ_amt, v_pts_red, v_red_amt)
      returning * into v_bill;
  exception when unique_violation then
    if p_client_ref is null then raise; end if;
    select id into v_existing from public.bills where client_ref = p_client_ref;
    return public.bill_payload(v_existing);
  end;

  -- ─── pass 2: store each line with its own share of the tax ────────────────
  for ln in select * from jsonb_array_elements(lines) loop
    v_no := v_no + 1;
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    -- ADDED (0073): re-derived, never carried across the two passes, so the
    -- stored line and the priced line cannot disagree.
    v_mode := case when ln->>'sellMode' = 'piece' then 'piece' else 'pack' end;
    v_net := round(v_amounts[v_no] - v_shares[v_no], 2);
    if v_incl then
      v_ltaxable := round(v_net / (1 + v_rates[v_no] / 100), 2);
      v_ltax := round(v_net - v_ltaxable, 2);
    else
      v_ltaxable := v_net;
      v_ltax := round(v_ltaxable * v_rates[v_no] / 100, 2);
    end if;
    if v_inter then
      v_ligst := v_ltax; v_lcgst := 0; v_lsgst := 0;
    else
      v_lsgst := round(floor(v_ltax * 100 / 2) / 100, 2);
      v_lcgst := round(v_ltax - v_lsgst, 2);
      v_ligst := 0;
    end if;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty,
                                   price, cost_price, image_url, line_no,
                                   hsn, gst_rate, taxable_value, cgst, sgst, igst,
                                   sell_mode, pack_size)              -- ADDED (0073)
      values (v_bill.id, it.id, it.name, it.emoji,
              -- Note 6: a piece line prints "pcs", not the pack's own label.
              case when v_mode = 'piece' then 'pcs' else it.unit end,
              v_qty,
              case when v_mode = 'piece'
                   then public.piece_price(it.price, it.pack_size)
                   else it.price end,
              -- The cost follows the same split, so margin on a piece line is
              -- the margin on the pack it came out of.
              case when v_mode = 'piece'
                   then public.piece_price(it.cost_price, it.pack_size)
                   else it.cost_price end,
              it.image_url, v_no,
              case when v_inv_type = 'gst' then it.hsn else '' end,
              v_rates[v_no], v_ltaxable, v_lcgst, v_lsgst, v_ligst,
              v_mode, case when v_mode = 'piece' then it.pack_size end);
    -- ADDED (0073): note 3. The pack opens itself on the way out.
    if v_mode = 'piece' then
      perform public.consume_pieces(it.id, v_qty, p_tz);
    else
      perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
    end if;
  end loop;

  for cn in select * from jsonb_array_elements(p_consumables) loop
    v_cno := v_cno + 1;
    v_cqty := round(coalesce((cn->>'qty')::numeric, 0), 3);
    v_charged := coalesce((cn->>'charged')::boolean, false);
    select * into cc from public.consumable where id = (cn->>'consumableId')::uuid;
    -- ADDED (0073)
    v_cmode := case when cn->>'sellMode' = 'piece' then 'piece' else 'pack' end;
    v_cunit := case when v_cmode = 'piece' then 'pcs' else cc.unit end;
    v_ccost := case when v_cmode = 'piece'
                    then public.piece_price(coalesce(cc.cost_per_unit, 0), cc.pack_size)
                    else coalesce(cc.cost_per_unit, 0) end;
    v_mv := public.issue_consumable_for_bill(cc.id, v_cqty, v_on, v_bill.bill_no, v_cmode);

    if v_charged then
      v_no := v_no + 1;
      v_net := round(v_amounts[v_no] - v_shares[v_no], 2);
      if v_incl then
        v_ltaxable := round(v_net / (1 + v_rates[v_no] / 100), 2);
        v_ltax := round(v_net - v_ltaxable, 2);
      else
        v_ltaxable := v_net;
        v_ltax := round(v_ltaxable * v_rates[v_no] / 100, 2);
      end if;
      if v_inter then
        v_ligst := v_ltax; v_lcgst := 0; v_lsgst := 0;
      else
        v_lsgst := round(floor(v_ltax * 100 / 2) / 100, 2);
        v_lcgst := round(v_ltax - v_lsgst, 2);
        v_ligst := 0;
      end if;
    else
      v_ltaxable := 0; v_lcgst := 0; v_lsgst := 0; v_ligst := 0;
    end if;

    insert into public.bill_consumable (
      bill_id, consumable_id, stock_movement_id, name, unit, qty,
      unit_cost, charged, line_no,
      hsn, gst_rate, taxable_value, cgst, sgst, igst,
      sell_mode, pack_size)                                          -- ADDED (0073)
    values (
      v_bill.id, cc.id, v_mv, cc.name, v_cunit, v_cqty,
      v_ccost, v_charged, v_cno,
      case when v_inv_type = 'gst' and v_charged then cc.hsn else '' end,
      case when v_inv_type = 'gst' and v_charged then cc.gst_rate else 0 end,
      v_ltaxable, v_lcgst, v_lsgst, v_ligst,
      v_cmode, case when v_cmode = 'piece' then cc.pack_size end);
  end loop;

  v_recv  := coalesce(nullif(customer->>'received', '')::numeric, v_bill.total);
  v_short := least(v_bill.total, greatest(0, round(v_bill.total - v_recv, 2)));
  if v_short > 0 then
    v_snote := left(btrim(coalesce(customer->>'shortfallNote', '')), 200);
    update public.bills set shortfall = v_short, shortfall_note = v_snote
      where id = v_bill.id
      returning * into v_bill;
  end if;

  if v_loy_on then
    if v_pts_red > 0 then
      perform public.append_loyalty(v_customer, v_bill.id, 'redeem', -v_pts_red,
        'redeemed on bill #' || v_bill.bill_no);
    end if;
    if coalesce(v_store.points_amount_unit, 0) > 0 then
      v_pts_earn := floor(v_bill.total / v_store.points_amount_unit)::integer
                    * v_store.points_per_amount;
    end if;
    if v_pts_earn > 0 then
      perform public.append_loyalty(v_customer, v_bill.id, 'earn', v_pts_earn,
        'earned on bill #' || v_bill.bill_no);
      update public.bills set points_earned = v_pts_earn where id = v_bill.id
        returning * into v_bill;
    end if;
  end if;

  if v_bill.total > 0 then
    perform public.post_cash(
      v_on, 'in', v_bill.total, v_bill.payment_method,
      public.system_category('Sales'), 'bill', v_bill.id,
      '', '', null, null);
  end if;

  if v_absorbed > 0 then
    perform public.post_cash(
      v_on, 'out', v_absorbed, v_bill.payment_method,
      public.system_category('Consumables Used'), 'bill', v_bill.id,
      'Consumables used on bill #' || v_bill.bill_no, '', null, null);
  end if;

  if v_short > 0 then
    v_note := 'Short payment on bill #' || v_bill.bill_no
              || case when v_snote <> '' then ' — ' || v_snote else '' end;
    perform public.post_cash(
      v_on, 'out', v_short, v_bill.payment_method,
      public.system_category('Payment Shortfall'), 'bill', v_bill.id,
      v_note, '', null, null);
  end if;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ' order by line_no) from public.bill_items
              where bill_id = v_bill.id),
            v_bill.total);
  return public.bill_payload(v_bill.id);
end $$;
grant execute on function
  public.generate_bill(jsonb, jsonb, text, uuid, jsonb) to authenticated;

-- ─── delete_consumable: loose pieces are stock too ─────────────────────────
-- Reproduced from 0063 with one ADDED check. Without it an item could be
-- removed while pieces from an opened pack were still on the shelf, and their
-- value would vanish with nothing to explain it — the exact hole the pack check
-- below exists to close.
create or replace function public.delete_consumable(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.consumable; v_stock numeric;
begin
  if not public.has_perm('consumables.delete') then raise exception 'forbidden'; end if;

  select * into c from public.consumable where id = p_id for update;
  if not found or c.deleted_at is not null then raise exception 'item not found'; end if;

  select coalesce(sum(qty_signed), 0) into v_stock
    from public.stock_movement where consumable_id = p_id;
  if v_stock <> 0 then
    raise exception
      'there is still % % on hand — write it off before removing the item',
      trim(to_char(v_stock, 'FM9999990.999')), c.unit;
  end if;

  -- ADDED (0073)
  if c.loose_qty <> 0 then
    raise exception
      'there are still % loose pieces on hand — write them off before removing the item',
      trim(to_char(c.loose_qty, 'FM9999990.999'));
  end if;

  update public.consumable
     set deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid()
   where id = p_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('consumable', auth.uid(), c.name, 'Removed item ' || c.code);
end $$;

-- ─── restock_bill_items: note 8, for products ──────────────────────────────
-- Pulled out of cancel_bill and delete_bill, which held the same loop twice and
-- now have a third case to get right in both.
create or replace function public.restock_bill_items(p_bill_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare li public.bill_items;
begin
  for li in select * from public.bill_items where bill_id = p_bill_id loop
    if li.item_id is null then continue; end if;
    if li.sell_mode = 'piece' then
      -- Three pieces out of a hundred do not make a pack, so they go back as
      -- what they are. update_item refuses to turn pack mode off while any are
      -- outstanding, but a bill whose pieces were all sold could still have had
      -- the mode cleared underneath it — say so plainly rather than let the
      -- items_loose_needs_pack constraint fail with its own name.
      if not exists (select 1 from public.items
                      where id = li.item_id and pack_size is not null) then
        raise exception
          '% is no longer sold in packs, so its pieces cannot go back — turn packs on again first',
          li.name;
      end if;
      update public.items set loose_qty = loose_qty + li.qty where id = li.item_id;
    else
      perform public.add_batch(li.item_id, li.qty, null);
    end if;
  end loop;
end $$;
revoke execute on function public.restock_bill_items(uuid) from public;

-- ─── return_bill_consumables: pieces come back to the loose count ──────────
-- Reproduced from 0067. Idempotency now keys off `returned_at` on the line
-- rather than the existence of a matching `return` movement: a piece line
-- writes no movement, so the old marker would let it return twice. The old
-- check is kept as well, so a line already returned before this migration is
-- still recognised.
create or replace function public.return_bill_consumables(p_bill_id uuid, p_why text)
returns int language plpgsql security definer set search_path = public as $$
declare bc public.bill_consumable; v_no bigint; v_n int := 0;
begin
  select bill_no into v_no from public.bills where id = p_bill_id;

  for bc in select * from public.bill_consumable where bill_id = p_bill_id
             order by line_no loop
    if bc.consumable_id is null then continue; end if;
    if bc.returned_at is not null then continue; end if;
    if exists (select 1 from public.stock_movement m
                where m.consumable_id = bc.consumable_id
                  and m.movement_type = 'return'
                  and m.remarks = 'Returned from bill #' || v_no || ' line ' || bc.line_no)
    then continue; end if;

    if bc.sell_mode = 'piece' then
      -- The same guard restock_bill_items carries, for the same reason.
      if not exists (select 1 from public.consumable
                      where id = bc.consumable_id and pack_size is not null) then
        raise exception
          '% is no longer sold in packs, so its pieces cannot go back — turn packs on again first',
          bc.name;
      end if;
      update public.consumable set loose_qty = loose_qty + bc.qty
        where id = bc.consumable_id;
    else
      insert into public.stock_movement (
        consumable_id, movement_type, qty, on_date, reason, remarks, created_by)
      values (
        bc.consumable_id, 'return', bc.qty, public.store_today(), '',
        'Returned from bill #' || v_no || ' line ' || bc.line_no, auth.uid());
    end if;

    update public.bill_consumable set returned_at = now() where id = bc.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;
revoke execute on function public.return_bill_consumables(uuid, text) from public;

-- ─── cancel_bill / delete_bill: through the shared restock ─────────────────
-- Reproduced from 0070 and 0067 with the inline batch loop replaced by
-- restock_bill_items. Nothing else changes.
create or replace function public.cancel_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills;
begin
  if not public.has_perm('bill.cancel') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status = 'cancelled' then raise exception 'already cancelled'; end if;

  perform public.restock_bill_items(p_id);                       -- CHANGED (0073)
  perform public.return_bill_consumables(p_id, 'cancelled by ' || p_by);

  if v.customer_id is not null then
    if coalesce(v.points_earned, 0) > 0 then
      perform public.append_loyalty(v.customer_id, p_id, 'reversal',
        -v.points_earned, 'bill #' || v.bill_no || ' cancelled');
    end if;
    if coalesce(v.points_redeemed, 0) > 0 then
      perform public.append_loyalty(v.customer_id, p_id, 'reversal',
        v.points_redeemed, 'bill #' || v.bill_no || ' cancelled');
    end if;
  end if;

  update public.bills set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
    where id = p_id;

  perform public.reverse_cash('bill', p_id, 'cancelled by ' || p_by);

  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('cancel', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Cancelled by ' || p_by);
end $$;

create or replace function public.delete_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills;
begin
  if not public.has_perm('bill.delete') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status <> 'cancelled' then
    perform public.restock_bill_items(p_id);                     -- CHANGED (0073)
    perform public.return_bill_consumables(p_id, 'deleted by ' || p_by);
  end if;

  perform public.reverse_cash('bill', p_id, 'deleted by ' || p_by);

  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('delete', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Deleted by ' || p_by);
  delete from public.bills where id = p_id;   -- cascades bill_items
end $$;

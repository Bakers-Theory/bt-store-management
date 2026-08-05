-- ============================================================================
-- BT Store Management — consumable operations (#91 §3)
--
--   1. THE LEDGER IS THE ONLY WAY STOCK MOVES. There is no set-stock RPC and no
--      current_stock column to set (0062 note 1). record_stock_movement is the
--      single writer, which is what makes AC-2 true by construction.
--   2. NEGATIVE STOCK IS BLOCKED, NOT FLAGGED. §3.4's last bullet asks for a
--      block, so the check runs INSIDE the transaction, after `select … for
--      update` on the item row — two concurrent issues of the last 5 kg cannot
--      both pass.
--   3. TWO KEYS, SPLIT BY WHAT THE MOVEMENT MEANS. Receiving, issuing and
--      returning stock is daily work (`consumables.issue`). Adjustment, wastage,
--      expiry and damage write off value that will never be accounted for, so
--      they need `consumables.adjust` — the same distinction the item catalogue
--      draws between `stock.out` and `stock.expiry`.
--   4. A CORRECTION IS A NEW ENTRY. §3.3: movements are never deleted or edited
--      (0062's triggers enforce it), so a mistake is offset by an Adjustment
--      carrying its reason.
--   5. NOTHING HERE MOVES MONEY (0062 note 4). A purchase movement records what
--      arrived and what it cost per unit; the payment is an expense or a purchase
--      invoice.
--
-- Applies on top of 0062.
-- ============================================================================

-- ─── save_consumable: create or edit the item master ────────────────────────
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
begin
  if v_id is null then
    if not public.has_perm('consumables.create') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('consumables.edit') then raise exception 'forbidden'; end if;
  end if;

  if v_name = '' then raise exception 'this item needs a name'; end if;
  if not exists (select 1 from public.store_lists
                  where kind = 'consumable_category' and value = v_cat) then
    raise exception 'choose a category';
  end if;
  -- Units are the shared list (0062 note 5), so an unknown one is a typo.
  if not exists (select 1 from public.store_lists
                  where kind = 'unit' and value = v_unit) then
    raise exception 'choose a unit';
  end if;
  if v_min < 0 then raise exception 'a minimum stock cannot be negative'; end if;
  if v_max is not null and v_max < v_min then
    raise exception 'the maximum stock cannot be below the minimum';
  end if;
  if v_reorder is not null and v_max is not null and v_reorder > v_max then
    raise exception 'the reorder level cannot be above the maximum stock';
  end if;
  if v_rqty is not null and v_rqty <= 0 then
    raise exception 'a reorder quantity has to be more than zero';
  end if;
  if v_cost is not null and v_cost < 0 then
    raise exception 'a cost cannot be negative';
  end if;
  if v_vendor is not null
     and not exists (select 1 from public.suppliers where id = v_vendor) then
    raise exception 'that vendor no longer exists';
  end if;

  -- The unique constraint is (name, unit); say so in words rather than letting
  -- the index speak.
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
    -- Changing the unit under a ledger would silently reinterpret every past
    -- movement: 5 kg becoming 5 litres. Retire the item and open a new one.
    if v_old.unit <> v_unit
       and exists (select 1 from public.stock_movement where consumable_id = v_id) then
      raise exception
        'this item already has stock movements in %, so its unit cannot change',
        v_old.unit;
    end if;

    update public.consumable set
      name = v_name, category = v_cat, unit = v_unit, vendor_id = v_vendor,
      min_stock = v_min, max_stock = v_max, reorder_level = v_reorder,
      reorder_qty = v_rqty, cost_per_unit = v_cost,
      expiry_date = v_expiry,
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
    expiry_date, storage_location, notes, created_by, updated_by)
  values (
    v_name, v_cat, v_unit, v_vendor,
    v_min, v_max, v_reorder, v_rqty, v_cost,
    v_expiry, btrim(coalesce(p->>'storageLocation','')),
    btrim(coalesce(p->>'notes','')), auth.uid(), auth.uid())
  returning id into v_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('consumable', auth.uid(), v_name,
            'Added item ' || (select code from public.consumable where id = v_id)
            || ' (' || v_cat || ')');

  return v_id;
end $$;

-- ─── delete: soft, and only once the shelf is empty ─────────────────────────
create or replace function public.delete_consumable(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.consumable; v_stock numeric;
begin
  if not public.has_perm('consumables.delete') then raise exception 'forbidden'; end if;

  select * into c from public.consumable where id = p_id for update;
  if not found or c.deleted_at is not null then raise exception 'item not found'; end if;

  select coalesce(sum(qty_signed), 0) into v_stock
    from public.stock_movement where consumable_id = p_id;
  -- Removing an item that still has stock would make the value on hand vanish
  -- without a movement to explain it. Write it off first (note 4).
  if v_stock <> 0 then
    raise exception
      'there is still % % on hand — write it off before removing the item',
      trim(to_char(v_stock, 'FM9999990.999')), c.unit;
  end if;

  update public.consumable
     set deleted_at = now(), deleted_by = auth.uid(), updated_by = auth.uid()
   where id = p_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('consumable', auth.uid(), c.name, 'Removed item ' || c.code);
end $$;

-- ─── record_stock_movement: the only way stock moves (notes 1, 2, 3) ────────
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
begin
  if v_type not in ('purchase','issue','return',
                    'adjustment','wastage','expired','damaged') then
    raise exception 'unknown movement type "%"', v_type;
  end if;

  -- Note 3: which key applies is a property of the movement type.
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
  -- Backdating is deliberately allowed: the first thing an operator does with a
  -- new item is enter the stock that was already on the shelf.

  -- §3.3: these four write off value, so they have to say why.
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

  -- Mirrors the generated column in 0062 — direction comes from the type.
  v_signed := case v_type
                when 'purchase'   then abs(v_qty)
                when 'return'     then abs(v_qty)
                when 'adjustment' then v_qty
                else -abs(v_qty)
              end;

  -- Note 2: computed under the row lock taken above, so the check holds under
  -- concurrency.
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

  return jsonb_build_object(
    'movementId', v_id,
    'currentStock', v_before + v_signed);
end $$;

-- ─── Bulk stock update (§7) ─────────────────────────────────────────────────
-- One transaction, one permission check per movement, all-or-nothing: a bulk
-- issue that would take one item negative fails the whole batch rather than
-- leaving half of it applied.
create or replace function public.record_stock_movements(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p) <> 'array' then
    raise exception 'expected a list of movements';
  end if;
  if jsonb_array_length(p) = 0 then
    raise exception 'nothing to record';
  end if;

  for v_row in select * from jsonb_array_elements(p) loop
    v_out := v_out || jsonb_build_array(public.record_stock_movement(v_row));
  end loop;

  return v_out;
end $$;

-- ─── Dashboard widgets (§4.1) ───────────────────────────────────────────────
-- `p_days` is the expiry horizon; the consumption and purchase figures are
-- month-to-date on the store's calendar, matching the cashbook's convention.
create or replace function public.consumable_stats(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with scope as (select * from public.consumable_v),
  month_moves as (
    select m.*
    from public.stock_movement m
    join scope s on s.id = m.consumable_id
    where m.on_date >= date_trunc('month', public.store_today())::date
  )
  select jsonb_build_object(
    'totalItems',   (select count(*) from scope),
    'lowStock',     (select count(*) from scope where stock_status = 'low'),
    'outOfStock',   (select count(*) from scope where stock_status = 'out'),
    'atReorder',    (select count(*) from scope where stock_status = 'reorder'),
    'expiringSoon', (select count(*) from scope
                      where expiry_days_left between 0 and p_days
                        and current_stock > 0),
    'expired',      (select count(*) from scope
                      where expiry_days_left < 0 and current_stock > 0),
    'stockValue',   (select coalesce(sum(stock_value), 0) from scope),
    -- Consumption is outward movement only, so a purchase never cancels it out.
    'monthConsumptionQty',
      (select coalesce(sum(-qty_signed), 0) from month_moves where qty_signed < 0),
    'monthWastageQty',
      (select coalesce(sum(-qty_signed), 0) from month_moves
        where movement_type in ('wastage','expired','damaged')),
    'monthPurchaseQty',
      (select coalesce(sum(qty_signed), 0) from month_moves
        where movement_type = 'purchase'),
    'monthPurchaseCost',
      (select coalesce(sum(round(coalesce(unit_cost, 0) * qty, 2)), 0)
         from month_moves where movement_type = 'purchase'),
    'recommendations',
      (select count(*) from scope where recommended_qty > 0),
    'alerts',
      (select count(*) from public.consumable_alert_v),
    -- §4.1's "Most Used Items", month to date.
    'mostUsed',
      (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select s.name, s.unit, sum(-m.qty_signed) as qty
        from month_moves m
        join scope s on s.id = m.consumable_id
        where m.qty_signed < 0
        group by s.name, s.unit
        order by qty desc
        limit 5
      ) t)
  )
$$;

grant execute on function public.save_consumable(jsonb) to authenticated;
grant execute on function public.delete_consumable(uuid) to authenticated;
grant execute on function public.record_stock_movement(jsonb) to authenticated;
grant execute on function public.record_stock_movements(jsonb) to authenticated;
grant execute on function public.consumable_stats(int) to authenticated;

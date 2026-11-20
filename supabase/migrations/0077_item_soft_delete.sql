-- ============================================================================
-- BT Store Management — deleting an item that has purchase history
--
-- delete_item did a hard DELETE, and purchase_invoice_line.item_id /
-- purchase_return_line.item_id reference items with no ON DELETE rule — so any
-- item ever bought on a purchase invoice (CSV imports included) could not be
-- deleted at all (#108).
--
-- Such an item is now SOFT-deleted: `deleted_at` is set, it drops out of
-- items_v (so out of Stock, New Bill and every picker) and out of the supplier
-- product list, while the purchase and bill history that names it stays intact.
-- An item nothing references is still deleted outright, as before.
--
-- Names stay unique among LIVE items only, the pattern consumables already use
-- (0062), so a deleted item's name can be reused for a new one.
-- ============================================================================

alter table public.items add column if not exists deleted_at timestamptz;

alter table public.items drop constraint if exists items_name_key_key;
create unique index if not exists items_name_key_live
  on public.items (name_key) where deleted_at is null;

-- ─── items_v: hide deleted items ───────────────────────────────────────────
-- Reproduced from 0073; only the WHERE is ADDED (0077).
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
    pack_size, loose_qty
  from public.items
  where deleted_at is null;                          -- ADDED (0077)
grant select on public.items_v to authenticated;

-- ─── supplier_products_v: hide deleted items ───────────────────────────────
-- Reproduced from 0036; only the deleted_at condition is ADDED (0077).
create or replace view public.supplier_products_v as
  select
    si.supplier_id,
    si.item_id,
    i.name              as item_name,
    i.emoji,
    i.image_url,
    i.category,
    i.unit,
    i.qty               as current_qty,
    (select min(sb.expiry_date) from public.stock_batches sb
       where sb.item_id = i.id and sb.qty > 0) as earliest_expiry,
    null::numeric       as last_unit_cost,
    null::date          as last_purchase_date,
    si.created_at
  from public.supplier_items si
  join public.items i on i.id = si.item_id
  where public.has_perm('suppliers.view')
    and i.deleted_at is null;                        -- ADDED (0077)
grant select on public.supplier_products_v to authenticated;

-- ─── delete_item: soft-delete when history references the item ─────────────
-- Reproduced from 0028 with the referenced-item branch ADDED (0077).
create or replace function public.delete_item(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('items.delete') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  if exists (select 1 from public.purchase_invoice_line where item_id = p_id)
     or exists (select 1 from public.purchase_return_line where item_id = p_id) then
    update public.items set deleted_at = now()
      where id = p_id and deleted_at is null;
  else
    delete from public.items where id = p_id;
  end if;
  if not found then raise exception 'item not found'; end if;
end $$;

-- ─── create_item: only a LIVE item counts as a duplicate ───────────────────
-- Reproduced from 0073 with the duplicate lookup's deleted_at filter ADDED
-- (0077) — otherwise new stock would merge into a deleted item and vanish.
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

  select * into v_dup from public.items where name_key = lower(trim(p->>'name'))
    and deleted_at is null;                                          -- ADDED (0077)
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

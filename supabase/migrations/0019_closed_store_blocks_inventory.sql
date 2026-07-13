-- ============================================================================
-- BT Store Management — a closed store blocks inventory changes
-- Mirrors the billing guard (0017): while the store is closed, no inventory
-- mutation may run. Enforced by adding assert_store_open() to each inventory
-- RPC after its permission check. Bill cancel/delete stock restoration is
-- intentionally NOT gated here — only the direct inventory RPCs are.
-- Bodies are reproduced from 0016 (0001 for delete_item) with one line added.
-- ============================================================================

-- ─── Guard helper (invoker; only called from the SECURITY DEFINER RPCs) ─────
-- The Owner may manage stock regardless of store status; only non-owners are
-- blocked while the store is closed.
create or replace function public.assert_store_open()
returns void language plpgsql set search_path = public as $$
begin
  if public.is_owner() then return; end if;
  if not (select is_open from public.store_settings where id = 1) then
    raise exception 'Store is closed — inventory changes are disabled';
  end if;
end $$;
revoke execute on function public.assert_store_open() from public;

-- ─── create_item ────────────────────────────────────────────────────────────
create or replace function public.create_item(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dup public.items; v_id uuid;
        v_qty numeric := coalesce((p->>'qty')::numeric, 0);
        v_tracks boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_expiry date := nullif(p->>'expiryDate','')::date;
        v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  select * into v_dup from public.items where name_key = lower(trim(p->>'name'));
  if found then
    if v_qty > 0 then
      perform public.add_batch(v_dup.id, v_qty, v_expiry);
      insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
        values ('in', auth.uid(), v_dup.id, v_dup.name, v_qty,
                'Added via New Item form (existing item)');
    end if;
    select * into v_row from public.items_v where id = v_dup.id;
    return jsonb_build_object('kind','merged','name',v_dup.name,'qty',v_qty,'unit',v_dup.unit,
                               'item',to_jsonb(v_row));
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
  select * into v_row from public.items_v where id = v_id;
  return jsonb_build_object('kind','added','id',v_id,'item',to_jsonb(v_row));
end $$;

-- ─── update_item ────────────────────────────────────────────────────────────
create or replace function public.update_item(p_id uuid, p jsonb)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v_tracks_old boolean;
        v_tracks_new boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_sum numeric; v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
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
  select * into v_row from public.items_v where id = p_id;
  return v_row;
end $$;

-- ─── delete_item ────────────────────────────────────────────────────────────
create or replace function public.delete_item(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  delete from public.items where id = p_id;
end $$;

-- ─── stock_in ───────────────────────────────────────────────────────────────
create or replace function public.stock_in(p_item uuid, p_qty numeric, p_supplier text, p_notes text, p_expiry date)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v public.items; v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select * into v from public.items where id = p_item;
  if not found then raise exception 'item not found'; end if;
  perform public.add_batch(p_item, p_qty, p_expiry);
  insert into public.activity_log (type, actor, item_id, item_name, qty, supplier, notes)
    values ('in', auth.uid(), p_item, v.name, p_qty, p_supplier, p_notes);
  select * into v_row from public.items_v where id = p_item;
  return v_row;
end $$;

-- ─── stock_out ──────────────────────────────────────────────────────────────
create or replace function public.stock_out(p_item uuid, p_qty numeric, p_reason text, p_notes text)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v public.items; v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select * into v from public.items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if p_qty > v.qty then raise exception 'only % available', v.qty; end if;
  perform public.consume_fifo(p_item, p_qty);
  insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes)
    values ('out', auth.uid(), p_item, v.name, p_qty, p_reason, p_notes);
  select * into v_row from public.items_v where id = p_item;
  return v_row;
end $$;

-- ─── write_off_batch ────────────────────────────────────────────────────────
create or replace function public.write_off_batch(p_batch_id uuid)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare b public.stock_batches; v_name text; v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
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
  select * into v_row from public.items_v where id = b.item_id;
  return v_row;
end $$;

-- ─── update_batch_expiry ────────────────────────────────────────────────────
create or replace function public.update_batch_expiry(p_batch_id uuid, p_expiry date)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v_item_id uuid; v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();
  if p_expiry is null then raise exception 'expiry date required'; end if;
  update public.stock_batches set expiry_date = p_expiry where id = p_batch_id
    returning item_id into v_item_id;
  if not found then raise exception 'batch not found'; end if;
  select * into v_row from public.items_v where id = v_item_id;
  return v_row;
end $$;

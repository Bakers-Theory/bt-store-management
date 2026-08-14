-- ============================================================================
-- BT Store Management — attribute a new product's opening stock to its supplier
--
-- THE PROBLEM. `create_item` records its opening batch through the three-argument
-- `add_batch` wrapper (0040:68), which stamps a NULL source. That was right while
-- the only way to add a product was the Stock page, where nobody has said whose
-- stock it is. It stopped being right once products could be added from a
-- supplier's own Products tab: the product is linked to that supplier, its
-- opening 5 pcs plainly came from them, and the batch still read "Unknown
-- source" — the one wording 0040 reserved for stock whose origin was never
-- recorded. Here it WAS recorded; the RPC just had nowhere to put it.
--
-- THE FIX. `create_item` accepts an optional `supplierId` and passes it to the
-- five-argument `add_batch`, so the opening batch carries the same provenance a
-- purchase invoice would give it. Absent or blank, every existing caller behaves
-- exactly as before — an unattributed batch, which is what stock added from the
-- Stock page is.
--
-- Notes
--   1. GATED ON suppliers.edit, not items.create. Naming whose delivery a batch
--      was is a claim about a supplier's record, and it is the same permission
--      `link_supplier_item` (0036:68) demands to make the very association this
--      accompanies. Someone who may create items but not touch suppliers gets
--      the pre-existing behaviour rather than an error, because the attribution
--      is an addition to their request, not the substance of it.
--   2. THE SUPPLIER MUST EXIST AND BE ACTIVE — the same two checks, in the same
--      order, that link_supplier_item makes. Without them a caller could stamp
--      an id belonging to a retired supplier, or attach opening stock to a
--      record the linking half of the same operation would then refuse.
--   3. Applied to the MERGED branch too. A name that already exists adds to that
--      item's stock instead, and that arriving stock has the same origin — there
--      is no reading under which the new rows are attributable and the merged
--      ones are not.
--   4. Reproduced verbatim from 0068 apart from the additions marked below, per
--      the convention those `-- ADDED` comments established.
-- ============================================================================

create or replace function public.create_item(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dup public.items; v_id uuid;
        v_qty numeric := coalesce((p->>'qty')::numeric, 0);
        v_tracks boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_expiry date := nullif(p->>'expiryDate','')::date;
        v_row public.items_v;
        v_supplier uuid := nullif(p->>'supplierId','')::uuid;      -- ADDED (0071)
        v_sup_status text;                                          -- ADDED (0071)
begin
  if not public.has_perm('items.create') then raise exception 'forbidden'; end if;
  perform public.assert_store_open();

  -- ADDED (0071). Note 1: without suppliers.edit the attribution is dropped and
  -- the row is recorded unattributed, exactly as it was before this migration.
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
      perform public.add_batch(v_dup.id, v_qty, v_expiry,
                               v_supplier, null::uuid);             -- ADDED (0071)
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
                            hsn, gst_rate)                          -- ADDED (0068)
    values (p->>'name', coalesce(p->>'emoji','📦'), p->>'category', p->>'unit',
            coalesce((p->>'price')::numeric,0), coalesce((p->>'costPrice')::numeric,0),
            0, v_tracks, nullif(p->>'imageUrl',''),
            btrim(coalesce(p->>'hsn','')),                          -- ADDED (0068)
            coalesce((p->>'gstRate')::numeric, 0))                  -- ADDED (0068)
    returning id into v_id;
  if v_qty > 0 then
    perform public.add_batch(v_id, v_qty, v_expiry,
                             v_supplier, null::uuid);               -- ADDED (0071)
    insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
      values ('in', auth.uid(), v_id, p->>'name', v_qty, 'Initial stock');
  end if;
  select * into v_row from public.items_v where id = v_id;
  return jsonb_build_object('kind','added','id',v_id,'item',to_jsonb(v_row));
end $$;

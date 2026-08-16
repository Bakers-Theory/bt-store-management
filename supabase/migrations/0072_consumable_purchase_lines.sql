-- ============================================================================
-- BT Store Management — a purchase invoice may buy consumables
--
-- Until now a delivery of consumables was only a stock movement. It arrived on
-- the shelf, but it was not a document: it did not appear on the supplier's
-- Transactions tab, it did not count towards what they are owed, and there was
-- nothing to pay. Buying 20 packing-box cartons from a supplier is a purchase in
-- exactly the sense 0037 means, so it becomes one.
--
--   1. A LINE BUYS A PRODUCT OR A CONSUMABLE, NEVER BOTH AND NEVER NEITHER.
--      `item_id` becomes nullable and `consumable_id` joins it, bound by a XOR
--      CHECK. One invoice can carry both kinds — a delivery is a delivery.
--   2. POSTING IS STILL WHAT CREATES STOCK (0037 note 1), through each side's
--      own machinery: `add_batch` for a product, `record_stock_movement` for a
--      consumable. There is no second path and no reconciliation job. The
--      consumable's stock therefore comes from the ledger, as 0062 requires —
--      the invoice is what caused the entry, not a parallel record of it.
--   3. NO LINKED EXPENSE IS FILED. 0066 made a consumable purchase file an
--      expense so the spend was not typed twice. An invoice IS the payable, and
--      it is settled with a supplier payment (0038); filing an expense as well
--      would count the same money out twice. The Stock movement screen, where
--      there is no invoice, keeps its expense block unchanged.
--   4. `consumable.cost_per_unit` IS NOT TOUCHED, unlike `items.cost_price`.
--      They are not the same field: cost_price is what the product cost, while
--      cost_per_unit is what a CHARGED consumable is billed at (0067). Moving it
--      because a delivery was dearer would silently reprice customers. What the
--      last delivery cost is already `consumable_v.last_purchase_cost`.
--   5. CANCELLING REVERSES THE LEDGER, IT DOES NOT ERASE IT. The stock ledger is
--      append-only, so a cancelled consumable line is undone by an adjustment
--      out (or a wastage, when the stock is being written off) carrying the
--      cancellation reason. Same rule as products: only while the stock is still
--      on hand, otherwise the instrument is a return.
--   6. A CONSUMABLE LINE CANNOT BE RETURNED YET. `purchase_return_line` is built
--      around `items`, and a credit note that moves consumable stock back out is
--      its own piece of work. A trigger refuses it with that sentence rather
--      than letting a NOT NULL violation explain it.
--
-- Applies on top of 0043 (the current cancel), 0039 (returns) and 0066.
-- ============================================================================

-- ─── Note 1: the line's two possible subjects ───────────────────────────────
alter table public.purchase_invoice_line
  alter column item_id drop not null;

alter table public.purchase_invoice_line
  add column if not exists consumable_id uuid references public.consumable(id);

alter table public.purchase_invoice_line
  drop constraint if exists line_buys_one_thing;
alter table public.purchase_invoice_line
  add constraint line_buys_one_thing
  check ((item_id is not null) <> (consumable_id is not null));

create index if not exists purchase_invoice_line_consumable_idx
  on public.purchase_invoice_line (consumable_id);

-- ─── Read surface ───────────────────────────────────────────────────────────
-- `item_name`, `unit` and `emoji` describe whichever side the line bought, so
-- every existing reader keeps working without knowing this migration happened.
-- `consumable_id` is appended last so `create or replace` is legal.
create or replace view public.purchase_invoice_line_v as
  select
    l.id, l.invoice_id, l.item_id, l.qty, l.expiry,
    coalesce(i.name, c.name)   as item_name,
    coalesce(i.emoji, '📦')    as emoji,
    coalesce(i.unit, c.unit)   as unit,
    coalesce((
      select sum(rl.qty) from public.purchase_return_line rl
      join public.purchase_return r on r.id = rl.return_id
      where rl.invoice_line_id = l.id and r.status = 'posted'
    ), 0)::numeric as returned_qty,
    case when public.has_perm('suppliers.financial') then l.unit_cost  end as unit_cost,
    case when public.has_perm('suppliers.financial') then l.gst_rate   end as gst_rate,
    case when public.has_perm('suppliers.financial') then l.line_total end as line_total,
    l.consumable_id
  from public.purchase_invoice_line l
  left join public.items i on i.id = l.item_id
  left join public.consumable c on c.id = l.consumable_id
  where public.has_perm('suppliers.view');
grant select on public.purchase_invoice_line_v to authenticated;

-- ─── Note 6: returns stay products-only, and say so ─────────────────────────
create or replace function public.return_line_is_a_product()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.purchase_invoice_line l
             where l.id = new.invoice_line_id and l.consumable_id is not null) then
    raise exception
      'a consumable line cannot be returned — cancel the invoice, or write the stock off in Consumables';
  end if;
  return new;
end $$;

drop trigger if exists return_line_is_a_product on public.purchase_return_line;
create trigger return_line_is_a_product
  before insert on public.purchase_return_line
  for each row execute function public.return_line_is_a_product();

-- ─── Save: a line may name a consumable instead of an item ──────────────────
-- Restated in full (plpgsql has no way to patch a body); unchanged from 0037
-- apart from the line insert.
create or replace function public.save_purchase_invoice(p jsonb)
returns public.purchase_invoice_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_invoice_v;
  v_id uuid := nullif(p->>'id','')::uuid;
  v_supplier uuid := (p->>'supplierId')::uuid;
  v_type text; v_status text; v_no text; v_ref text; ln jsonb;
  v_item uuid; v_cons uuid;
begin
  if not public.has_perm('purchases.create') then raise exception 'forbidden'; end if;
  -- The return row is read back through purchase_invoice_v, which is gated on
  -- suppliers.view. Without it the write would succeed and then hand back NULL.
  if not public.has_perm('suppliers.view') then
    raise exception 'recording a purchase also needs the "view suppliers" permission';
  end if;

  select supplier_type, status into v_type, v_status
    from public.suppliers where id = v_supplier;
  if v_type is null then raise exception 'supplier not found'; end if;
  if v_status <> 'active' then
    raise exception 'that supplier is inactive — reactivate them first';
  end if;

  if (p->>'purchaseDate')::date > current_date then
    raise exception 'a purchase date cannot be in the future';
  end if;

  v_no := nullif(btrim(coalesce(p->>'invoiceNo','')), '');
  if v_type = 'in_house' then v_no := null; end if;

  if v_id is null then
    if v_type = 'in_house' then
      v_ref := 'IH-' || lpad(nextval('inhouse_ref_seq')::text, 4, '0');
    end if;
    insert into public.purchase_invoice (
      supplier_id, supplier_type, invoice_no, internal_ref, purchase_date, notes, created_by
    ) values (
      v_supplier, v_type, v_no, v_ref, (p->>'purchaseDate')::date,
      btrim(coalesce(p->>'notes','')), auth.uid()
    ) returning id into v_id;
  else
    select status into v_status from public.purchase_invoice where id = v_id for update;
    if not found then raise exception 'invoice not found'; end if;
    if v_status <> 'draft' then
      raise exception 'a % invoice cannot be edited', v_status;
    end if;
    update public.purchase_invoice
      set invoice_no = v_no,
          purchase_date = (p->>'purchaseDate')::date,
          notes = btrim(coalesce(p->>'notes',''))
      where id = v_id;
    delete from public.purchase_invoice_line where invoice_id = v_id;
  end if;

  for ln in select * from jsonb_array_elements(p->'lines') loop
    v_item := nullif(ln->>'itemId','')::uuid;
    v_cons := nullif(ln->>'consumableId','')::uuid;
    -- The CHECK would catch this, but not in words anyone can act on.
    if (v_item is null) = (v_cons is null) then
      raise exception 'every line has to buy exactly one product or one consumable';
    end if;

    insert into public.purchase_invoice_line (
      invoice_id, item_id, consumable_id, qty, unit_cost, gst_rate, line_total, expiry
    ) values (
      v_id,
      v_item,
      v_cons,
      (ln->>'qty')::numeric,
      round((ln->>'unitCost')::numeric, 2),
      -- Any rate sent for an in-house line is discarded here rather than
      -- rejected: the form should not have sent one, and the header's
      -- gst_amount stays NULL either way.
      case when v_type = 'in_house' then 0 else coalesce((ln->>'gstRate')::numeric, 0) end,
      round((ln->>'qty')::numeric * (ln->>'unitCost')::numeric, 2),
      -- A consumable's expiry lives on the record, not on a batch (0062), so a
      -- date sent for one is dropped rather than stored where nothing reads it.
      case when v_cons is null then nullif(ln->>'expiry','')::date end
    );
  end loop;

  perform public.recalc_purchase_invoice(v_id);

  select * into v_row from public.purchase_invoice_v where id = v_id;
  return v_row;
end $$;
grant execute on function public.save_purchase_invoice(jsonb) to authenticated;

-- ─── Post: each side's stock arrives through its own machinery (note 2) ─────
create or replace function public.post_purchase_invoice(p_id uuid)
returns public.purchase_invoice_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_invoice_v; v_inv public.purchase_invoice;
  v_supplier text; l public.purchase_invoice_line; v_lines int; v_cons int;
begin
  if not public.has_perm('purchases.create') then raise exception 'forbidden'; end if;
  if not public.has_perm('suppliers.view') then
    raise exception 'posting a purchase also needs the "view suppliers" permission';
  end if;

  select * into v_inv from public.purchase_invoice where id = p_id for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_inv.status <> 'draft' then
    raise exception 'this invoice has already been %', v_inv.status;
  end if;

  select count(*), count(consumable_id) into v_lines, v_cons
    from public.purchase_invoice_line where invoice_id = p_id;
  if v_lines = 0 then raise exception 'add at least one product before posting'; end if;

  -- record_stock_movement would raise a bare "forbidden" from three frames down.
  if v_cons > 0 and not public.has_perm('consumables.issue') then
    raise exception
      'this invoice brings in consumable stock, which needs the "receive, issue & return stock" permission';
  end if;

  select name into v_supplier from public.suppliers where id = v_inv.supplier_id;

  -- Recomputed immediately before posting, not trusted from the draft: the
  -- stored totals are what every aggregate will read from here on.
  perform public.recalc_purchase_invoice(p_id);

  for l in select * from public.purchase_invoice_line where invoice_id = p_id loop
    if l.item_id is not null then
      -- The existing batch/FIFO machinery, carrying the source. add_batch forces
      -- a NULL expiry for items that don't track it, so a stray date is harmless.
      perform public.add_batch(l.item_id, l.qty, l.expiry, v_inv.supplier_id, p_id);
      -- FR-10's purchase price and the profit figures both read items.cost_price,
      -- so the latest posted cost becomes the current cost.
      update public.items set cost_price = l.unit_cost where id = l.item_id;
      -- Posting also asserts the association, so a product bought from a supplier
      -- appears on their Products tab without a second manual step (TC-7).
      insert into public.supplier_items (supplier_id, item_id)
        values (v_inv.supplier_id, l.item_id)
        on conflict (supplier_id, item_id) do nothing;
    else
      -- Note 2: the ledger is how consumable stock exists, so the invoice files
      -- a purchase movement rather than inventing a second store of truth. No
      -- `expense` block — note 3.
      perform public.record_stock_movement(jsonb_build_object(
        'consumableId', l.consumable_id,
        'movementType', 'purchase',
        'qty',          l.qty,
        'onDate',       v_inv.purchase_date,
        'unitCost',     l.unit_cost,
        'vendorId',     v_inv.supplier_id,
        'remarks',      'Invoice ' || coalesce(v_inv.invoice_no, v_inv.internal_ref)
      ));
      -- The association, same as supplier_items above: a consumable bought from
      -- this supplier lists them as its vendor, unless it already names one.
      update public.consumable
        set vendor_id = v_inv.supplier_id
        where id = l.consumable_id and vendor_id is null;
    end if;
  end loop;

  update public.purchase_invoice
    set status = 'posted', posted_at = now() where id = p_id;

  select * into v_inv from public.purchase_invoice where id = p_id;
  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase', auth.uid(), v_supplier, v_inv.total,
            'Posted ' || case when v_inv.supplier_type = 'in_house'
                              then 'in-house receipt ' || v_inv.internal_ref
                              else 'invoice ' || v_inv.invoice_no end
            || ' from ' || v_supplier || ' — ' || v_lines::text || ' line(s), '
            || v_inv.total::text);

  select * into v_row from public.purchase_invoice_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.post_purchase_invoice(uuid) to authenticated;

-- ─── Cancel: reverse the ledger rather than erase it (note 5) ───────────────
create or replace function public.cancel_purchase_invoice(
  p_id uuid, p_reason text, p_write_off boolean default false
)
returns public.purchase_invoice_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_invoice_v; v_inv public.purchase_invoice;
  v_supplier text; l public.purchase_invoice_line; v_have numeric;
  v_item text; v_wrote boolean := false; v_cons int;
begin
  if not public.has_perm('purchases.create') then raise exception 'forbidden'; end if;
  if not public.has_perm('suppliers.view') then
    raise exception 'cancelling a purchase also needs the "view suppliers" permission';
  end if;
  if btrim(coalesce(p_reason,'')) = '' then
    raise exception 'give a reason when cancelling an invoice';
  end if;

  select * into v_inv from public.purchase_invoice where id = p_id for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_inv.status = 'cancelled' then raise exception 'this invoice is already cancelled'; end if;

  select name into v_supplier from public.suppliers where id = v_inv.supplier_id;

  if v_inv.status = 'posted' then
    -- Writing stock off is a wastage decision, so it carries the key that owns
    -- write-offs elsewhere (write_off_batch / stock_out).
    if p_write_off and not public.has_perm('stock.expiry') then
      raise exception 'writing the stock off needs the "manage expiry & write-offs" permission';
    end if;

    select count(consumable_id) into v_cons
      from public.purchase_invoice_line where invoice_id = p_id;
    -- Both reversals below are adjustments to the consumable ledger, which is
    -- its own key (0063 note 3).
    if v_cons > 0 and not public.has_perm('consumables.adjust') then
      raise exception
        'reversing the consumable stock on this invoice needs the "adjust, wastage & expiry" permission';
    end if;

    if exists (select 1 from public.supplier_payment where invoice_id = p_id) then
      raise exception 'a payment is recorded against this invoice — raise a return instead';
    end if;
    if exists (select 1 from public.purchase_return
               where invoice_id = p_id and status = 'posted') then
      raise exception 'a return has been raised against this invoice — it cannot be cancelled';
    end if;

    -- Every line's stock must still be there. Checked for ALL lines before any
    -- is removed, so a cancellation is all-or-nothing.
    for l in select * from public.purchase_invoice_line where invoice_id = p_id loop
      if l.item_id is not null then
        select qty into v_have from public.items where id = l.item_id for update;
      else
        perform 1 from public.consumable where id = l.consumable_id for update;
        select coalesce(sum(qty_signed), 0) into v_have
          from public.stock_movement where consumable_id = l.consumable_id;
      end if;
      if coalesce(v_have, 0) < l.qty then
        raise exception
          'only % of the % received on this invoice is still in stock — raise a return instead',
          coalesce(v_have, 0), l.qty;
      end if;
    end loop;

    for l in select * from public.purchase_invoice_line where invoice_id = p_id loop
      if l.item_id is not null then
        perform public.consume_fifo(l.item_id, l.qty);

        if p_write_off then
          select name into v_item from public.items where id = l.item_id;
          insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes)
            values ('out', auth.uid(), l.item_id, v_item, l.qty, 'Write-off',
                    'Cancelled ' || coalesce(v_inv.invoice_no, v_inv.internal_ref)
                    || ' from ' || v_supplier || ': ' || btrim(p_reason));
          v_wrote := true;
        end if;
      else
        -- Note 5: append the opposite entry. A write-off says the stock was
        -- kept and lost; a plain cancellation says the delivery never happened.
        perform public.record_stock_movement(jsonb_build_object(
          'consumableId', l.consumable_id,
          'movementType', case when p_write_off then 'wastage' else 'adjustment' end,
          'qty',          case when p_write_off then l.qty else -l.qty end,
          -- Dated today, not on the invoice: the reversal is a thing that is
          -- happening now, and backdating it would move stock in a period the
          -- reports have already been read for.
          'onDate',       public.store_today(),
          'reason',       case when p_write_off then 'Write-off' else 'Purchase cancelled' end,
          'remarks',      'Cancelled ' || coalesce(v_inv.invoice_no, v_inv.internal_ref)
                          || ': ' || btrim(p_reason)
        ));
        if p_write_off then v_wrote := true; end if;
      end if;
    end loop;
  end if;

  update public.purchase_invoice
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = btrim(p_reason)
    where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase', auth.uid(), v_supplier, v_inv.total,
            'Cancelled ' || coalesce(v_inv.invoice_no, v_inv.internal_ref)
            || ' from ' || v_supplier || ': ' || btrim(p_reason)
            || case
                 when v_wrote then ' (stock written off)'
                 when v_inv.status = 'posted' then ' (stock reversed)'
                 else '' end);

  select * into v_row from public.purchase_invoice_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.cancel_purchase_invoice(uuid, text, boolean) to authenticated;

-- ============================================================================
-- BT Store Management — batch provenance (which supplier a batch came from)
--
-- THE PROBLEM. `add_batch` (0011:41) MERGES on arrival: incoming stock is added
-- to the existing row with the same expiry date, and everything with a NULL
-- expiry collapses into a single row per item. So a stock_batches row was never
-- one delivery — it could hold stock from several suppliers at once, and for an
-- item that doesn't track expiry there was only ever ONE row holding everything
-- ever received. "Which supplier is this batch from?" had no answer to give.
--
-- THE FIX. Stamp the source on the batch and make it part of the merge key, so
-- a row is one supplier's stock from one invoice at one expiry date. Two
-- suppliers delivering the same product with the same expiry now produce two
-- rows rather than one blended one.
--
-- WHAT IS NOT ATTRIBUTED. Rows that already exist, and anything added through
-- the `stock_in` form (found stock, corrections) or a bill cancellation, carry a
-- NULL source and read as "Unknown source" in the UI. That is the honest
-- answer: the information was never recorded, and guessing it from the latest
-- invoice would invent provenance the same way auto-matching legacy supplier
-- names would (see scripts/list-legacy-suppliers.sql).
-- ============================================================================

alter table public.stock_batches
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists invoice_id  uuid references public.purchase_invoice(id) on delete set null;

create index if not exists stock_batches_supplier_idx
  on public.stock_batches (supplier_id);

-- ─── add_batch, now source-aware ────────────────────────────────────────────
-- The merge key is (item, expiry, supplier, invoice), all NULL-safe. Merging on
-- the invoice too, not just the supplier, means every row stays traceable to a
-- single invoice — two deliveries from one supplier on two invoices are two
-- rows, and no row ever has to pick between two invoice ids.
create or replace function public.add_batch(
  p_item uuid, p_qty numeric, p_expiry date, p_supplier uuid, p_invoice uuid
)
returns void language plpgsql set search_path = public as $$
declare v_tracks boolean;
begin
  select tracks_expiry into v_tracks from public.items where id = p_item;
  if not coalesce(v_tracks, true) then p_expiry := null; end if;

  update public.stock_batches set qty = qty + p_qty
    where item_id = p_item
      and expiry_date is not distinct from p_expiry
      and supplier_id is not distinct from p_supplier
      and invoice_id  is not distinct from p_invoice;
  if not found then
    insert into public.stock_batches (item_id, qty, expiry_date, supplier_id, invoice_id)
      values (p_item, p_qty, p_expiry, p_supplier, p_invoice);
  end if;

  update public.items set qty =
    coalesce((select sum(qty) from public.stock_batches where item_id = p_item), 0)
    where id = p_item;
end $$;
-- Internal helper: reachable only from the SECURITY DEFINER RPCs that call it.
-- Postgres grants EXECUTE to PUBLIC by default, so this must be revoked, not
-- merely left un-granted (the precedent is advance_balance_of, 0032:169).
revoke execute on function public.add_batch(uuid, numeric, date, uuid, uuid) from public;

-- The original three-argument form becomes a thin wrapper, so every existing
-- caller (stock_in, create_item, update_item, cancel_bill, delete_bill) keeps
-- working untouched and records an unattributed batch — which is exactly what
-- those paths are: stock that arrived without an invoice behind it.
create or replace function public.add_batch(p_item uuid, p_qty numeric, p_expiry date)
returns void language plpgsql set search_path = public as $$
begin
  perform public.add_batch(p_item, p_qty, p_expiry, null::uuid, null::uuid);
end $$;

-- ─── Read surface ───────────────────────────────────────────────────────────
-- Mirrors the stock_batches RLS policy (0011:35) so the same people who can
-- read batches can read this. The supplier NAME is additionally gated on
-- suppliers.view: a storekeeper without it still sees the batch and its expiry,
-- just not whose delivery it was. supplier_id is emitted regardless so the UI
-- can tell "no source recorded" apart from "source withheld from you".
create or replace view public.stock_batches_v as
  select
    sb.id, sb.item_id, sb.qty, sb.expiry_date, sb.created_at,
    sb.supplier_id, sb.invoice_id,
    case when public.has_perm('suppliers.view') then s.name end as supplier_name,
    case when public.has_perm('suppliers.view') then s.code end as supplier_code,
    case when public.has_perm('suppliers.view')
         then coalesce(pi.invoice_no, pi.internal_ref) end as source_ref
  from public.stock_batches sb
  left join public.suppliers s on s.id = sb.supplier_id
  left join public.purchase_invoice pi on pi.id = sb.invoice_id
  where public.has_perm('inventory')
     or public.has_perm('sales')
     or public.has_perm('analytics');
grant select on public.stock_batches_v to authenticated;

-- ─── post_purchase_invoice: stamp the source ────────────────────────────────
-- Reproduced from 0037 with one line changed: the add_batch call now passes the
-- supplier and the invoice. Everything else is identical.
create or replace function public.post_purchase_invoice(p_id uuid)
returns public.purchase_invoice_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_invoice_v; v_inv public.purchase_invoice;
  v_supplier text; l public.purchase_invoice_line; v_lines int;
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

  select count(*) into v_lines from public.purchase_invoice_line where invoice_id = p_id;
  if v_lines = 0 then raise exception 'add at least one product before posting'; end if;

  select name into v_supplier from public.suppliers where id = v_inv.supplier_id;

  -- Recomputed immediately before posting, not trusted from the draft: the
  -- stored totals are what every aggregate will read from here on.
  perform public.recalc_purchase_invoice(p_id);

  for l in select * from public.purchase_invoice_line where invoice_id = p_id loop
    -- The existing batch/FIFO machinery, now carrying the source. add_batch
    -- forces a NULL expiry for items that don't track it, so a stray date is
    -- harmless.
    perform public.add_batch(l.item_id, l.qty, l.expiry, v_inv.supplier_id, p_id);
    -- FR-10's purchase price and the profit figures both read items.cost_price,
    -- so the latest posted cost becomes the current cost.
    update public.items set cost_price = l.unit_cost where id = l.item_id;
    -- Posting also asserts the association, so a product bought from a supplier
    -- appears on their Products tab without a second manual step (TC-7).
    insert into public.supplier_items (supplier_id, item_id)
      values (v_inv.supplier_id, l.item_id)
      on conflict (supplier_id, item_id) do nothing;
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

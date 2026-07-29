-- ============================================================================
-- BT Store Management — purchase invoices (Phase 3a of the supplier module)
--
--   1. POSTING AN INVOICE IS WHAT CREATES STOCK. Each posted line inserts a
--      stock_batches row through the existing add_batch/FIFO machinery and
--      updates items.cost_price. There is one source of truth for "what arrived
--      and what it cost", so NFR-1 reconciliation is structural rather than a
--      job that can drift. The existing stock_in RPC survives for NON-PURCHASE
--      adjustments only (found stock, corrections).
--   2. ONLY `posted` COUNTS. A draft is a work in progress and a cancelled
--      invoice is a mistake withdrawn; neither touches stock or any aggregate.
--   3. NO GST FOR IN-HOUSE IS A DATABASE GUARANTEE. A CHECK cannot read
--      another table, so supplier_type is denormalised onto this table and
--      bound back by the composite FK below. Plain CHECKs then do the work.
--   4. MONEY IS COLUMN-REVOKED, not merely hidden by the UI — the same
--      mechanism items.cost_price uses (0001:178).
-- ============================================================================

-- In-house RECEIPTS are numbered here. Suppliers themselves are numbered by
-- supplier_code_seq in 0035; the two sequences count different things.
create sequence if not exists inhouse_ref_seq start 1;

-- ─── Header ─────────────────────────────────────────────────────────────────
create table if not exists public.purchase_invoice (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references public.suppliers(id),
  -- Denormalised so the CHECKs below can see it. Kept honest by the composite
  -- FK, which makes an inconsistent pair unrepresentable rather than merely
  -- unlikely.
  supplier_type text not null check (supplier_type in ('external','in_house')),
  invoice_no    text,
  internal_ref  text unique,
  purchase_date date not null,
  subtotal      numeric(12,2) not null default 0,
  gst_amount    numeric(12,2),
  total         numeric(12,2) not null default 0,
  status        text not null default 'draft'
                  check (status in ('draft','posted','cancelled')),
  notes         text not null default '',
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  posted_at     timestamptz,
  cancelled_at  timestamptz,

  constraint purchase_invoice_supplier_type_fk
    foreign key (supplier_id, supplier_type)
    references public.suppliers (id, supplier_type),

  -- FR-25 is the not-null above. These are the type rules.
  constraint external_has_invoice_no
    check (supplier_type <> 'external' or btrim(coalesce(invoice_no,'')) <> ''),
  constraint in_house_has_no_invoice_no
    check (supplier_type <> 'in_house' or invoice_no is null),
  constraint in_house_has_no_gst
    check (supplier_type <> 'in_house' or gst_amount is null),
  constraint in_house_has_internal_ref
    check (supplier_type <> 'in_house' or internal_ref is not null),
  constraint external_has_no_internal_ref
    check (supplier_type <> 'external' or internal_ref is null),

  constraint invoice_total_is_the_sum
    check (total = subtotal + coalesce(gst_amount, 0)),
  constraint invoice_amounts_non_negative
    check (subtotal >= 0 and coalesce(gst_amount, 0) >= 0 and total >= 0),
  constraint posted_has_posted_at
    check (status <> 'posted' or posted_at is not null)
);

-- One supplier cannot send the same invoice number twice. Partial, because
-- in-house rows all have a NULL invoice_no and NULLs are not equal in SQL —
-- a plain unique constraint would let a duplicate external number slip past
-- only if the number were NULL, which the CHECK above already forbids, but the
-- partial index states the intent exactly.
create unique index if not exists purchase_invoice_supplier_no_key
  on public.purchase_invoice (supplier_id, invoice_no)
  where invoice_no is not null;

create index if not exists purchase_invoice_supplier_idx
  on public.purchase_invoice (supplier_id, purchase_date desc);
create index if not exists purchase_invoice_status_idx
  on public.purchase_invoice (status, purchase_date desc);

drop trigger if exists purchase_invoice_updated_at on public.purchase_invoice;
create trigger purchase_invoice_updated_at before update on public.purchase_invoice
  for each row execute function public.set_updated_at();

-- ─── Lines ──────────────────────────────────────────────────────────────────
create table if not exists public.purchase_invoice_line (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.purchase_invoice(id) on delete cascade,
  item_id    uuid not null references public.items(id),
  qty        numeric(12,3) not null check (qty > 0),
  unit_cost  numeric(12,2) not null check (unit_cost >= 0),
  gst_rate   numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate <= 100),
  line_total numeric(12,2) not null,
  expiry     date,
  constraint line_total_is_the_product
    check (line_total = round(qty * unit_cost, 2))
);

create index if not exists purchase_invoice_line_invoice_idx
  on public.purchase_invoice_line (invoice_id);
create index if not exists purchase_invoice_line_item_idx
  on public.purchase_invoice_line (item_id);

-- ─── Column privacy: `suppliers.financial` gates the money ──────────────────
-- Nobody reads an amount directly from the client; the views below decide.
revoke select (subtotal, gst_amount, total)
  on public.purchase_invoice from authenticated, anon;
revoke select (unit_cost, gst_rate, line_total)
  on public.purchase_invoice_line from authenticated, anon;

-- ─── RLS: reads need suppliers.view; writes only through the RPCs below ─────
alter table public.purchase_invoice enable row level security;
drop policy if exists purchase_invoice_read on public.purchase_invoice;
create policy purchase_invoice_read on public.purchase_invoice for select
  using (public.has_perm('suppliers.view'));

alter table public.purchase_invoice_line enable row level security;
drop policy if exists purchase_invoice_line_read on public.purchase_invoice_line;
create policy purchase_invoice_line_read on public.purchase_invoice_line for select
  using (public.has_perm('suppliers.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
-- A storekeeper logging a delivery sees WHAT arrived without seeing what it
-- cost: the money columns come back NULL unless the caller holds
-- `suppliers.financial`. Same shape as items_v's cost_price (0011:284).
create or replace view public.purchase_invoice_v as
  select
    pi.id, pi.supplier_id, pi.supplier_type, pi.invoice_no, pi.internal_ref,
    pi.purchase_date, pi.status, pi.notes, pi.created_at, pi.updated_at,
    pi.posted_at, pi.cancelled_at,
    s.name as supplier_name,
    s.code as supplier_code,
    cb.name as created_by_name,
    case when public.has_perm('suppliers.financial') then pi.subtotal   end as subtotal,
    case when public.has_perm('suppliers.financial') then pi.gst_amount end as gst_amount,
    case when public.has_perm('suppliers.financial') then pi.total      end as total
  from public.purchase_invoice pi
  join public.suppliers s on s.id = pi.supplier_id
  left join public.profiles cb on cb.id = pi.created_by
  where public.has_perm('suppliers.view');
grant select on public.purchase_invoice_v to authenticated;

-- `returned_qty` is derived so the return form can cap a new credit note
-- without a second query. It reads 0 until 0039 creates the return tables; that
-- migration recreates this view against the real ones.
create or replace view public.purchase_invoice_line_v as
  select
    l.id, l.invoice_id, l.item_id, l.qty, l.expiry,
    i.name as item_name, i.emoji, i.unit,
    0::numeric as returned_qty,
    case when public.has_perm('suppliers.financial') then l.unit_cost  end as unit_cost,
    case when public.has_perm('suppliers.financial') then l.gst_rate   end as gst_rate,
    case when public.has_perm('suppliers.financial') then l.line_total end as line_total
  from public.purchase_invoice_line l
  join public.items i on i.id = l.item_id
  where public.has_perm('suppliers.view');
grant select on public.purchase_invoice_line_v to authenticated;

-- ─── Internal: recompute a draft's totals from its own lines ────────────────
-- Called after every line write so the header can never disagree with the
-- lines. The client's arithmetic in lib/purchase.ts is for display only; THIS
-- is the figure that gets stored.
create or replace function public.recalc_purchase_invoice(p_id uuid)
returns void language plpgsql set search_path = public as $$
declare v_type text; v_sub numeric; v_gst numeric;
begin
  select supplier_type into v_type from public.purchase_invoice where id = p_id;

  select coalesce(round(sum(line_total), 2), 0),
         coalesce(round(sum(round(line_total * gst_rate / 100, 2)), 2), 0)
    into v_sub, v_gst
  from public.purchase_invoice_line where invoice_id = p_id;

  -- NULL, not 0, for in-house: the CHECK refuses a non-null gst_amount there,
  -- and "no GST applies" is a different fact from "GST came to nothing".
  if v_type = 'in_house' then v_gst := null; end if;

  update public.purchase_invoice
    set subtotal = v_sub,
        gst_amount = v_gst,
        total = v_sub + coalesce(v_gst, 0)
  where id = p_id;
end $$;
revoke execute on function public.recalc_purchase_invoice(uuid) from public;

-- ─── Save (create or replace a DRAFT) ───────────────────────────────────────
-- Lines are replaced wholesale rather than diffed: an invoice is entered as a
-- unit, and a partial line update has no meaning to the person typing it.
-- A posted invoice is immutable — cancel it and enter a new one.
create or replace function public.save_purchase_invoice(p jsonb)
returns public.purchase_invoice_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_invoice_v;
  v_id uuid := nullif(p->>'id','')::uuid;
  v_supplier uuid := (p->>'supplierId')::uuid;
  v_type text; v_status text; v_no text; v_ref text; ln jsonb;
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
    insert into public.purchase_invoice_line (
      invoice_id, item_id, qty, unit_cost, gst_rate, line_total, expiry
    ) values (
      v_id,
      (ln->>'itemId')::uuid,
      (ln->>'qty')::numeric,
      round((ln->>'unitCost')::numeric, 2),
      -- Any rate sent for an in-house line is discarded here rather than
      -- rejected: the form should not have sent one, and the header's
      -- gst_amount stays NULL either way.
      case when v_type = 'in_house' then 0 else coalesce((ln->>'gstRate')::numeric, 0) end,
      round((ln->>'qty')::numeric * (ln->>'unitCost')::numeric, 2),
      nullif(ln->>'expiry','')::date
    );
  end loop;

  perform public.recalc_purchase_invoice(v_id);

  select * into v_row from public.purchase_invoice_v where id = v_id;
  return v_row;
end $$;
grant execute on function public.save_purchase_invoice(jsonb) to authenticated;

-- ─── Post: the moment stock exists ──────────────────────────────────────────
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
    -- The existing batch/FIFO machinery, unchanged. add_batch forces a NULL
    -- expiry for items that don't track it, so a stray date is harmless.
    perform public.add_batch(l.item_id, l.qty, l.expiry);
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

-- ─── Cancel ─────────────────────────────────────────────────────────────────
-- A draft cancels freely. A POSTED invoice can only be withdrawn while nothing
-- else references it — no payment against it, no return raised from it — and
-- only if the stock it created is still on hand. Otherwise the correct
-- instrument is a purchase return (0039), which is a credit note and leaves
-- both sides of the story on the record.
--
-- items.cost_price is deliberately NOT rolled back: the previous cost is not
-- recoverable, and inventing one would be worse than leaving the last known
-- figure in place. The next posted purchase corrects it.
create or replace function public.cancel_purchase_invoice(p_id uuid, p_reason text)
returns public.purchase_invoice_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_invoice_v; v_inv public.purchase_invoice;
  v_supplier text; l public.purchase_invoice_line; v_have numeric;
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
    -- Guarded by to_regclass so 0037 stands alone; once 0039 exists these
    -- checks become live.
    if to_regclass('public.supplier_payment') is not null then
      if exists (select 1 from public.supplier_payment where invoice_id = p_id) then
        raise exception 'a payment is recorded against this invoice — raise a return instead';
      end if;
    end if;
    if to_regclass('public.purchase_return') is not null then
      if exists (select 1 from public.purchase_return
                 where invoice_id = p_id and status = 'posted') then
        raise exception 'a return has been raised against this invoice — it cannot be cancelled';
      end if;
    end if;

    -- Every line's stock must still be there. Checked for ALL lines before any
    -- is removed, so a cancellation is all-or-nothing.
    for l in select * from public.purchase_invoice_line where invoice_id = p_id loop
      select qty into v_have from public.items where id = l.item_id for update;
      if coalesce(v_have, 0) < l.qty then
        raise exception
          'only % of the % received on this invoice is still in stock — raise a return instead',
          coalesce(v_have, 0), l.qty;
      end if;
    end loop;

    for l in select * from public.purchase_invoice_line where invoice_id = p_id loop
      perform public.consume_fifo(l.item_id, l.qty);
    end loop;
  end if;

  update public.purchase_invoice
    set status = 'cancelled', cancelled_at = now() where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase', auth.uid(), v_supplier, v_inv.total,
            'Cancelled ' || coalesce(v_inv.invoice_no, v_inv.internal_ref)
            || ' from ' || v_supplier || ': ' || btrim(p_reason)
            || case when v_inv.status = 'posted' then ' (stock reversed)' else '' end);

  select * into v_row from public.purchase_invoice_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.cancel_purchase_invoice(uuid, text) to authenticated;

-- ─── supplier_products_v, now with real derived costs (FR-10) ───────────────
-- Reproduced from 0036 with the two NULL placeholders replaced by a lateral
-- lookup of the latest POSTED line for this exact (supplier, item) pair. A
-- draft or cancelled invoice must never move a purchase price.
--
-- Cost is gated on `suppliers.financial`: a storekeeper sees which products a
-- supplier supplies and when they last arrived, but not what they cost.
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
    case when public.has_perm('suppliers.financial') then last.unit_cost end as last_unit_cost,
    last.purchase_date  as last_purchase_date,
    si.created_at
  from public.supplier_items si
  join public.items i on i.id = si.item_id
  left join lateral (
    select l.unit_cost, pi.purchase_date
    from public.purchase_invoice_line l
    join public.purchase_invoice pi on pi.id = l.invoice_id
    where pi.supplier_id = si.supplier_id
      and l.item_id = si.item_id
      and pi.status = 'posted'
    order by pi.purchase_date desc, pi.posted_at desc
    limit 1
  ) last on true
  where public.has_perm('suppliers.view');
grant select on public.supplier_products_v to authenticated;

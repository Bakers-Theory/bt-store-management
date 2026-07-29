-- ============================================================================
-- BT Store Management — supplier ↔ product association (Phase 2)
--
-- The join table carries NO price and NO date columns, deliberately. FR-10's
-- "Purchase Price" and "Last Purchase Date" are derived from posted invoice
-- lines in supplier_products_v, so a stale value is unrepresentable — there is
-- no column to drift out of step with the ledger (NFR-1).
--
-- Many-to-many by construction: one product may have several suppliers and one
-- supplier several products (FR-9, AC-6). The unique key is the pair.
--
-- Until 0037 lands there are no invoice lines, so last_unit_cost and
-- last_purchase_date read NULL. They begin filling in with no schema change.
-- ============================================================================

create table if not exists public.supplier_items (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  item_id     uuid not null references public.items(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (supplier_id, item_id)
);

create index if not exists supplier_items_item_idx on public.supplier_items (item_id);

-- ─── RLS: reads need suppliers.view; writes only through the RPCs below ─────
alter table public.supplier_items enable row level security;
drop policy if exists supplier_items_read on public.supplier_items;
create policy supplier_items_read on public.supplier_items for select
  using (public.has_perm('suppliers.view'));

-- ─── FR-10, entirely derived ────────────────────────────────────────────────
-- `unit_cost` and `purchase_date` come from the most recent POSTED invoice line
-- for this exact (supplier, item) pair. A draft or cancelled invoice must not
-- move a purchase price, so the lateral join filters on status.
--
-- purchase_invoice_line does not exist yet, so the two derived columns are typed
-- NULL literals here and this view is valid on its own. 0037 ends with a
-- `create or replace` of this same view against the real tables — column order
-- and names are identical, so only the two literals change.
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
  where public.has_perm('suppliers.view');
grant select on public.supplier_products_v to authenticated;

-- ─── Link ───────────────────────────────────────────────────────────────────
-- Rides on `suppliers.edit`: associating a product is editing the supplier
-- record, not a purchasing decision.
create or replace function public.link_supplier_item(p_supplier uuid, p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_supplier text; v_status text; v_item text;
begin
  if not public.has_perm('suppliers.edit') then raise exception 'forbidden'; end if;

  select name, status into v_supplier, v_status
    from public.suppliers where id = p_supplier;
  if not found then raise exception 'supplier not found'; end if;
  -- An inactive supplier is retired. Adding new products to one is almost
  -- always a mistake made on the wrong record.
  if v_status <> 'active' then
    raise exception 'reactivate % before adding products to them', v_supplier;
  end if;

  select name into v_item from public.items where id = p_item;
  if not found then raise exception 'item not found'; end if;

  insert into public.supplier_items (supplier_id, item_id)
    values (p_supplier, p_item)
    on conflict (supplier_id, item_id) do nothing;
  -- Nothing inserted means it was already linked: no change, so no log entry.
  if not found then return; end if;

  insert into public.activity_log (type, actor, item_id, item_name, notes)
    values ('supplier', auth.uid(), p_item, v_item,
            'Linked ' || v_item || ' to supplier ' || v_supplier);
end $$;
grant execute on function public.link_supplier_item(uuid, uuid) to authenticated;

-- ─── Unlink ─────────────────────────────────────────────────────────────────
-- Removing an association removes NO history: past invoice lines keep their
-- item reference, so the Transactions tab and every report are unaffected.
create or replace function public.unlink_supplier_item(p_supplier uuid, p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_supplier text; v_item text;
begin
  if not public.has_perm('suppliers.edit') then raise exception 'forbidden'; end if;

  select s.name, i.name into v_supplier, v_item
  from public.suppliers s, public.items i
  where s.id = p_supplier and i.id = p_item;
  if not found then raise exception 'supplier or item not found'; end if;

  delete from public.supplier_items
    where supplier_id = p_supplier and item_id = p_item;
  if not found then return; end if;

  insert into public.activity_log (type, actor, item_id, item_name, notes)
    values ('supplier', auth.uid(), p_item, v_item,
            'Unlinked ' || v_item || ' from supplier ' || v_supplier
            || ' — past purchases are unaffected');
end $$;
grant execute on function public.unlink_supplier_item(uuid, uuid) to authenticated;

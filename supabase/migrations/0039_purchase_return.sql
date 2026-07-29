-- ============================================================================
-- BT Store Management — purchase returns and the account summary (Phase 3c)
--
--   1. A RETURN IS A CREDIT NOTE. It always references a POSTED invoice and its
--      lines, so every credit can be traced to what was bought. Posting it
--      removes the stock and issues supplier credit — which is simply a term in
--      supplier_summary_v, not a stored balance.
--   2. THE CAP IS A TRIGGER, NOT A CHECK. "purchased minus already returned" is
--      a cross-row aggregate and a CHECK cannot see other rows. The trigger is
--      the guarantee; post_purchase_return re-checks so the error message is
--      readable rather than a constraint name.
--   3. NO RETURNS FROM IN-HOUSE. There is nobody to credit. In-house stock
--      leaving inventory uses the existing write-off path (write_off_batch).
--   4. supplier_summary_v IS THE WHOLE OF FR-16, computed live. Every external
--      aggregate filters on supplier_type = 'external', so an in-house receipt
--      can never inflate payables; in_house_value is reported on its own line.
-- ============================================================================

create table if not exists public.purchase_return (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references public.suppliers(id),
  supplier_type text not null check (supplier_type in ('external','in_house')),
  invoice_id    uuid not null references public.purchase_invoice(id),
  return_date   date not null,
  total         numeric(12,2) not null default 0,
  status        text not null default 'draft'
                  check (status in ('draft','posted','cancelled')),
  reason        text not null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  posted_at     timestamptz,

  constraint purchase_return_supplier_type_fk
    foreign key (supplier_id, supplier_type)
    references public.suppliers (id, supplier_type),

  -- Nobody to credit, so no return. Rejected outright, per the spec.
  constraint no_return_from_in_house
    check (supplier_type = 'external'),
  constraint return_total_non_negative check (total >= 0),
  constraint return_needs_reason check (btrim(reason) <> ''),
  constraint posted_return_has_posted_at
    check (status <> 'posted' or posted_at is not null)
);

create index if not exists purchase_return_supplier_idx
  on public.purchase_return (supplier_id, return_date desc);
create index if not exists purchase_return_invoice_idx
  on public.purchase_return (invoice_id);

create table if not exists public.purchase_return_line (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references public.purchase_return(id) on delete cascade,
  invoice_line_id uuid not null references public.purchase_invoice_line(id),
  item_id         uuid not null references public.items(id),
  qty             numeric(12,3) not null check (qty > 0),
  unit_cost       numeric(12,2) not null check (unit_cost >= 0),
  line_total      numeric(12,2) not null,
  constraint return_line_total_is_the_product
    check (line_total = round(qty * unit_cost, 2))
);

create index if not exists purchase_return_line_return_idx
  on public.purchase_return_line (return_id);
create index if not exists purchase_return_line_invoice_line_idx
  on public.purchase_return_line (invoice_line_id);

-- ─── The cap ────────────────────────────────────────────────────────────────
-- A CHECK constraint cannot count other rows, so this is a trigger. It counts
-- only POSTED returns, and excludes the row's own return so re-posting a draft
-- does not double-count it.
create or replace function public.check_return_qty()
returns trigger language plpgsql set search_path = public as $$
declare v_purchased numeric; v_returned numeric; v_item text;
begin
  select l.qty, i.name into v_purchased, v_item
  from public.purchase_invoice_line l
  join public.items i on i.id = l.item_id
  where l.id = new.invoice_line_id;
  if v_purchased is null then raise exception 'invoice line not found'; end if;

  select coalesce(sum(rl.qty), 0) into v_returned
  from public.purchase_return_line rl
  join public.purchase_return r on r.id = rl.return_id
  where rl.invoice_line_id = new.invoice_line_id
    and r.status = 'posted'
    and rl.return_id <> new.return_id;

  if round(v_returned + new.qty, 3) > v_purchased then
    raise exception 'only % of the % of % on this invoice can still be returned',
      round(v_purchased - v_returned, 3), v_purchased, v_item;
  end if;
  return new;
end $$;

drop trigger if exists purchase_return_line_cap on public.purchase_return_line;
create trigger purchase_return_line_cap
  before insert or update on public.purchase_return_line
  for each row execute function public.check_return_qty();

-- ─── Column privacy ─────────────────────────────────────────────────────────
revoke select (total) on public.purchase_return from authenticated, anon;
revoke select (unit_cost, line_total) on public.purchase_return_line from authenticated, anon;

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table public.purchase_return enable row level security;
drop policy if exists purchase_return_read on public.purchase_return;
create policy purchase_return_read on public.purchase_return for select
  using (public.has_perm('suppliers.view'));

alter table public.purchase_return_line enable row level security;
drop policy if exists purchase_return_line_read on public.purchase_return_line;
create policy purchase_return_line_read on public.purchase_return_line for select
  using (public.has_perm('suppliers.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
create or replace view public.purchase_return_v as
  select
    r.id, r.supplier_id, r.supplier_type, r.invoice_id, r.return_date,
    r.status, r.reason, r.created_at, r.posted_at,
    s.name  as supplier_name,
    s.code  as supplier_code,
    pi.invoice_no,
    cb.name as created_by_name,
    case when public.has_perm('suppliers.financial') then r.total end as total
  from public.purchase_return r
  join public.suppliers s on s.id = r.supplier_id
  join public.purchase_invoice pi on pi.id = r.invoice_id
  left join public.profiles cb on cb.id = r.created_by
  where public.has_perm('suppliers.view');
grant select on public.purchase_return_v to authenticated;

create or replace view public.purchase_return_line_v as
  select
    rl.id, rl.return_id, rl.invoice_line_id, rl.item_id, rl.qty,
    i.name as item_name, i.emoji, i.unit,
    case when public.has_perm('suppliers.financial') then rl.unit_cost  end as unit_cost,
    case when public.has_perm('suppliers.financial') then rl.line_total end as line_total
  from public.purchase_return_line rl
  join public.items i on i.id = rl.item_id
  where public.has_perm('suppliers.view');
grant select on public.purchase_return_line_v to authenticated;

-- Reproduced from 0037 with the `returned_qty` placeholder replaced by the real
-- posted-return total, so the return form can cap a new credit note in one read.
create or replace view public.purchase_invoice_line_v as
  select
    l.id, l.invoice_id, l.item_id, l.qty, l.expiry,
    i.name as item_name, i.emoji, i.unit,
    coalesce((
      select sum(rl.qty) from public.purchase_return_line rl
      join public.purchase_return r on r.id = rl.return_id
      where rl.invoice_line_id = l.id and r.status = 'posted'
    ), 0)::numeric as returned_qty,
    case when public.has_perm('suppliers.financial') then l.unit_cost  end as unit_cost,
    case when public.has_perm('suppliers.financial') then l.gst_rate   end as gst_rate,
    case when public.has_perm('suppliers.financial') then l.line_total end as line_total
  from public.purchase_invoice_line l
  join public.items i on i.id = l.item_id
  where public.has_perm('suppliers.view');
grant select on public.purchase_invoice_line_v to authenticated;

-- ─── Post a return ──────────────────────────────────────────────────────────
-- Created and posted in one call: a half-entered credit note has no use, and a
-- draft return would need its own cap arithmetic for no operational gain.
create or replace function public.post_purchase_return(p jsonb)
returns public.purchase_return_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_return_v; v_id uuid;
  v_invoice uuid := (p->>'invoiceId')::uuid;
  v_inv public.purchase_invoice; v_name text;
  ln jsonb; l public.purchase_invoice_line;
  v_qty numeric; v_returned numeric; v_have numeric; v_total numeric := 0;
begin
  if not public.has_perm('purchases.return') then raise exception 'forbidden'; end if;
  if not public.has_perm('suppliers.view') then
    raise exception 'raising a return also needs the "view suppliers" permission';
  end if;
  if not public.has_perm('suppliers.financial') then
    raise exception 'raising a return also needs the "view supplier money" permission';
  end if;
  if btrim(coalesce(p->>'reason','')) = '' then
    raise exception 'give a reason for the return';
  end if;
  if (p->>'returnDate')::date > current_date then
    raise exception 'a return date cannot be in the future';
  end if;
  if jsonb_array_length(coalesce(p->'lines','[]'::jsonb)) = 0 then
    raise exception 'add at least one line to return';
  end if;

  select * into v_inv from public.purchase_invoice where id = v_invoice for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_inv.status <> 'posted' then
    raise exception 'only a posted invoice can be returned against';
  end if;
  select name into v_name from public.suppliers where id = v_inv.supplier_id;
  if v_inv.supplier_type = 'in_house' then
    raise exception '% is in-house — write the stock off instead of returning it', v_name;
  end if;

  insert into public.purchase_return (
    supplier_id, supplier_type, invoice_id, return_date, reason, status, posted_at, created_by
  ) values (
    v_inv.supplier_id, v_inv.supplier_type, v_invoice,
    (p->>'returnDate')::date, btrim(p->>'reason'), 'posted', now(), auth.uid()
  ) returning id into v_id;

  for ln in select * from jsonb_array_elements(p->'lines') loop
    select * into l from public.purchase_invoice_line
      where id = (ln->>'invoiceLineId')::uuid;
    if not found then raise exception 'invoice line not found'; end if;
    if l.invoice_id <> v_invoice then
      raise exception 'that line belongs to a different invoice';
    end if;

    v_qty := round((ln->>'qty')::numeric, 3);
    if v_qty <= 0 then raise exception 'a return quantity must be more than zero'; end if;

    -- Re-checked here so the message names the item and the remaining figure.
    -- The trigger on purchase_return_line is the actual guarantee.
    select coalesce(sum(rl.qty), 0) into v_returned
    from public.purchase_return_line rl
    join public.purchase_return r on r.id = rl.return_id
    where rl.invoice_line_id = l.id and r.status = 'posted' and rl.return_id <> v_id;

    if round(v_returned + v_qty, 3) > l.qty then
      raise exception 'only % of that line can still be returned',
        round(l.qty - v_returned, 3);
    end if;

    -- The stock must actually be there to send back. Checked per line; a
    -- partially-consumed delivery is returned in whatever quantity remains.
    select qty into v_have from public.items where id = l.item_id for update;
    if coalesce(v_have, 0) < v_qty then
      raise exception 'only % of that product is in stock', coalesce(v_have, 0);
    end if;

    insert into public.purchase_return_line (
      return_id, invoice_line_id, item_id, qty, unit_cost, line_total
    ) values (
      v_id, l.id, l.item_id, v_qty, l.unit_cost, round(v_qty * l.unit_cost, 2)
    );

    perform public.consume_fifo(l.item_id, v_qty);
    v_total := v_total + round(v_qty * l.unit_cost, 2);
  end loop;

  update public.purchase_return set total = round(v_total, 2) where id = v_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase_return', auth.uid(), v_name, round(v_total, 2),
            'Returned ' || round(v_total, 2)::text || ' to ' || v_name
            || ' against invoice ' || v_inv.invoice_no || ': ' || btrim(p->>'reason'));

  select * into v_row from public.purchase_return_v where id = v_id;
  return v_row;
end $$;
grant execute on function public.post_purchase_return(jsonb) to authenticated;

-- ─── FR-16: the account summary, computed live ──────────────────────────────
-- One row per supplier, left-joined FROM suppliers so the list is complete and
-- a supplier with no history shows zeroes rather than vanishing.
--
-- Gated on `suppliers.financial` in full: unlike the ledger views, there is
-- nothing here BUT money, so a caller without the key gets no rows rather than
-- a row of NULLs that would render as a misleading pile of dashes.
create or replace view public.supplier_summary_v as
  select
    s.id   as supplier_id,
    s.name as supplier_name,
    s.code as supplier_code,
    s.supplier_type,
    -- Every external aggregate filters on the type, so an in-house receipt can
    -- never appear in a payable.
    case when s.supplier_type = 'external'
         then coalesce(inv.posted_total, 0) else 0 end::numeric as total_purchases,
    coalesce(pay.paid, 0)::numeric                              as total_payments,
    case when s.supplier_type = 'external'
         then coalesce(ret.credited, 0) else 0 end::numeric     as return_credit,
    case when s.supplier_type = 'external'
         then round(coalesce(inv.posted_total, 0)
                    - coalesce(pay.paid, 0)
                    - coalesce(ret.credited, 0), 2)
         else 0 end::numeric                                    as outstanding,
    -- Reported on its own line: what your own production has cost, never a
    -- payable.
    case when s.supplier_type = 'in_house'
         then coalesce(inv.posted_total, 0) else 0 end::numeric as in_house_value,
    greatest(inv.last_purchase, pay.last_paid, ret.last_returned) as last_transaction_date,
    pay.last_paid                                                as last_payment_date,
    -- FR-16 says "Number of Purchase Orders". There is no separate PO entity in
    -- this design — an invoice IS the order record — so this is the posted count.
    coalesce(inv.posted_count, 0)::bigint                        as purchase_order_count,
    (coalesce(inv.posted_count, 0) + coalesce(pay.payment_count, 0)
     + coalesce(ret.return_count, 0))::bigint                    as transaction_count
  from public.suppliers s
  left join (
    select supplier_id,
           sum(total)          as posted_total,
           count(*)            as posted_count,
           max(purchase_date)  as last_purchase
    from public.purchase_invoice where status = 'posted'
    group by supplier_id
  ) inv on inv.supplier_id = s.id
  left join (
    select supplier_id,
           sum(amount)   as paid,
           count(*)      as payment_count,
           max(paid_on)  as last_paid
    from public.supplier_payment
    group by supplier_id
  ) pay on pay.supplier_id = s.id
  left join (
    select supplier_id,
           sum(total)        as credited,
           count(*)          as return_count,
           max(return_date)  as last_returned
    from public.purchase_return where status = 'posted'
    group by supplier_id
  ) ret on ret.supplier_id = s.id
  where public.has_perm('suppliers.financial');
grant select on public.supplier_summary_v to authenticated;

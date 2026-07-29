-- ============================================================================
-- BT Store Management — supplier payments (Phase 3b of the supplier module)
--
--   1. YOU CANNOT PAY YOURSELF. An in-house supplier is your own production: it
--      carries cost but no payable. Enforced by CHECK on the denormalised
--      supplier_type, bound to the supplier by composite FK — the same
--      arrangement 0037 uses, and for the same reason (a CHECK cannot read
--      another table).
--   2. A PAYMENT MAY OR MAY NOT NAME AN INVOICE. `invoice_id` is nullable so a
--      lump sum on account is recordable. When it IS set, the invoice must
--      belong to the same supplier and be posted — paying a draft is paying
--      something that has not happened.
--   3. `purchases.pay` IS ITS OWN KEY, in no preset except Admin, mirroring
--      how OWNER_BY_DEFAULT treats payroll. Money leaving the till is delegated
--      deliberately or not at all.
-- ============================================================================

create table if not exists public.supplier_payment (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references public.suppliers(id),
  supplier_type text not null check (supplier_type in ('external','in_house')),
  invoice_id    uuid references public.purchase_invoice(id) on delete set null,
  amount        numeric(12,2) not null check (amount > 0),
  paid_on       date not null,
  mode          text not null
                  check (mode in ('Cash','UPI','Bank Transfer','Cheque')),
  reference_no  text not null default '',
  notes         text not null default '',
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint supplier_payment_supplier_type_fk
    foreign key (supplier_id, supplier_type)
    references public.suppliers (id, supplier_type),

  -- The one rule that makes in-house safe: no payable, so no payment.
  constraint no_payment_to_in_house
    check (supplier_type = 'external')
);

create index if not exists supplier_payment_supplier_idx
  on public.supplier_payment (supplier_id, paid_on desc);
create index if not exists supplier_payment_invoice_idx
  on public.supplier_payment (invoice_id);

-- ─── Column privacy ─────────────────────────────────────────────────────────
revoke select (amount) on public.supplier_payment from authenticated, anon;

-- ─── RLS: reads need suppliers.view; writes only through the RPCs below ─────
alter table public.supplier_payment enable row level security;
drop policy if exists supplier_payment_read on public.supplier_payment;
create policy supplier_payment_read on public.supplier_payment for select
  using (public.has_perm('suppliers.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
create or replace view public.supplier_payment_v as
  select
    sp.id, sp.supplier_id, sp.supplier_type, sp.invoice_id, sp.paid_on,
    sp.mode, sp.reference_no, sp.notes, sp.created_at,
    s.name  as supplier_name,
    s.code  as supplier_code,
    pi.invoice_no,
    cb.name as created_by_name,
    case when public.has_perm('suppliers.financial') then sp.amount end as amount
  from public.supplier_payment sp
  join public.suppliers s on s.id = sp.supplier_id
  left join public.purchase_invoice pi on pi.id = sp.invoice_id
  left join public.profiles cb on cb.id = sp.created_by
  where public.has_perm('suppliers.view');
grant select on public.supplier_payment_v to authenticated;

-- ─── Record a payment ───────────────────────────────────────────────────────
create or replace function public.record_supplier_payment(p jsonb)
returns public.supplier_payment_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.supplier_payment_v; v_id uuid;
  v_supplier uuid := (p->>'supplierId')::uuid;
  v_invoice uuid := nullif(p->>'invoiceId','')::uuid;
  v_type text; v_status text; v_name text;
  v_amount numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  v_paid_on date := (p->>'paidOn')::date;
  v_mode text := coalesce(p->>'mode','');
  v_inv_supplier uuid; v_inv_status text;
begin
  if not public.has_perm('purchases.pay') then raise exception 'forbidden'; end if;
  -- The return row is read back through supplier_payment_v, which is gated on
  -- suppliers.view. Without it the write would succeed and then hand back NULL.
  if not public.has_perm('suppliers.view') then
    raise exception 'recording a payment also needs the "view suppliers" permission';
  end if;
  -- Recording a payment without being able to see amounts would mean filing a
  -- figure you cannot read back to check.
  if not public.has_perm('suppliers.financial') then
    raise exception 'recording a payment also needs the "view supplier money" permission';
  end if;

  if v_amount <= 0 then raise exception 'a payment must be more than zero'; end if;
  if v_mode not in ('Cash','UPI','Bank Transfer','Cheque') then
    raise exception 'choose a payment mode';
  end if;
  if v_paid_on is null then raise exception 'payment date required'; end if;
  if v_paid_on > current_date then
    raise exception 'a payment date cannot be in the future';
  end if;

  select supplier_type, status, name into v_type, v_status, v_name
    from public.suppliers where id = v_supplier;
  if v_type is null then raise exception 'supplier not found'; end if;
  if v_type = 'in_house' then
    raise exception '% is in-house — there is nothing to pay', v_name;
  end if;
  -- An inactive supplier may still be owed money, so paying one is allowed.

  if v_invoice is not null then
    select supplier_id, status into v_inv_supplier, v_inv_status
      from public.purchase_invoice where id = v_invoice;
    if v_inv_supplier is null then raise exception 'invoice not found'; end if;
    if v_inv_supplier <> v_supplier then
      raise exception 'that invoice belongs to a different supplier';
    end if;
    if v_inv_status <> 'posted' then
      raise exception 'that invoice is % — only a posted invoice can be paid', v_inv_status;
    end if;
  end if;

  insert into public.supplier_payment (
    supplier_id, supplier_type, invoice_id, amount, paid_on, mode, reference_no, notes, created_by
  ) values (
    v_supplier, v_type, v_invoice, v_amount, v_paid_on, v_mode,
    btrim(coalesce(p->>'referenceNo','')), btrim(coalesce(p->>'notes','')), auth.uid()
  ) returning id into v_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase_pay', auth.uid(), v_name, v_amount,
            'Paid ' || v_amount::text || ' to ' || v_name || ' by ' || v_mode
            || ' on ' || v_paid_on::text
            || case when v_invoice is not null
                    then ' against ' || (select invoice_no from public.purchase_invoice
                                         where id = v_invoice)
                    else ' on account' end);

  select * into v_row from public.supplier_payment_v where id = v_id;
  return v_row;
end $$;
grant execute on function public.record_supplier_payment(jsonb) to authenticated;

-- ─── Delete a mis-keyed payment ─────────────────────────────────────────────
-- There is no edit: a payment is a fact about money that moved, so a wrong one
-- is removed and re-entered rather than quietly amended. The removal itself is
-- logged, so the trail survives (NFR-3 — activity_log is append-only).
create or replace function public.delete_supplier_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_amount numeric; v_paid_on date;
begin
  if not public.has_perm('purchases.pay') then raise exception 'forbidden'; end if;

  select s.name, sp.amount, sp.paid_on into v_name, v_amount, v_paid_on
  from public.supplier_payment sp join public.suppliers s on s.id = sp.supplier_id
  where sp.id = p_id;
  if not found then raise exception 'payment not found'; end if;

  delete from public.supplier_payment where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase_pay', auth.uid(), v_name, v_amount,
            'Removed a payment of ' || v_amount::text || ' to ' || v_name
            || ' dated ' || v_paid_on::text);
end $$;
grant execute on function public.delete_supplier_payment(uuid) to authenticated;

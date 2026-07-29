-- ============================================================================
-- BT Store Management — supplier master (Phase 1 of the supplier module)
--
--   1. TWO TYPES, ONE TABLE. `external` is a real vendor you owe money to;
--      `in_house` is your own production, which carries cost but no invoice, no
--      GST and no payable. Making it a type rather than a second system keeps
--      product association, history and cost tracking on one code path.
--   2. DEACTIVATE ONLY. FR-26 and NFR-6 need history to survive and FR-25 needs
--      every purchase to have a supplier, so there is no delete RPC and no
--      `suppliers.delete` key.
--   3. MONEY IS A SEPARATE PERMISSION. `suppliers.financial` gates amounts
--      independently of `suppliers.view` — a storekeeper logs a delivery
--      without seeing what the store owes. Nothing in THIS migration is money;
--      the split starts to matter in 0037.
--   4. OPTIMISTIC CONCURRENCY. `update_supplier` takes the `updated_at` the
--      client loaded and refuses the write if it has moved. TC-16 asks for no
--      corruption, which last-write-wins cannot provide.
--
-- has_perm() needs no change: it already resolves any key present in
-- profiles.perms generically (0028:70).
-- ============================================================================

-- ─── Audit log: supplier entry types ────────────────────────────────────────
-- Widen only, and idempotently — the same shape as 0029, 0030 and 0032.
do $ck$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.activity_log'::regclass
    and conname = 'activity_log_type_check';

  if v_def is null or v_def not like '%purchase_return%' then
    alter table public.activity_log drop constraint if exists activity_log_type_check;
    alter table public.activity_log add constraint activity_log_type_check
      check (type in ('in','out','bill','cancel','delete','open','close',
                      'settings','staff_add','staff_edit','staff_remove','password',
                      'attendance','salary','salary_pay','advance','advance_pay',
                      'supplier','purchase','purchase_pay','purchase_return'));
  end if;
end $ck$;

-- ─── Human-quotable codes ───────────────────────────────────────────────────
-- One sequence for BOTH types: a code identifies a supplier, and needing to
-- know the type before you can read the code would defeat the point. (The
-- IH- sequence in 0037 numbers in-house *receipts*, not suppliers.)
create sequence if not exists supplier_code_seq start 1;

-- ─── The master ─────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique
                    default 'SUP-' || lpad(nextval('supplier_code_seq')::text, 4, '0'),
  supplier_type   text not null default 'external'
                    check (supplier_type in ('external','in_house')),
  name            text not null,
  business_name   text not null default '',
  contact_person  text not null default '',
  mobile          text not null default '',
  email           text not null default '',
  gstin           text not null default '',
  address         text not null default '',
  city            text not null default '',
  state           text not null default '',
  pin_code        text not null default '',
  payment_terms   text not null default '',
  notes           text not null default '',
  status          text not null default 'active' check (status in ('active','inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- FR-6, for external suppliers only. In-house needs a name and someone to
  -- ask about it; demanding a postal address for your own kitchen is paperwork
  -- for its own sake.
  constraint supplier_required_fields check (
    btrim(name) <> '' and btrim(contact_person) <> '' and (
      supplier_type <> 'external' or (
        btrim(business_name) <> '' and btrim(mobile) <> ''
        and btrim(address) <> '' and btrim(city) <> ''
        and btrim(state) <> '' and btrim(pin_code) <> ''
        and btrim(payment_terms) <> ''
      )
    )
  ),
  -- "No GST for in-house" starts here and is completed in 0037.
  constraint in_house_has_no_gstin
    check (supplier_type <> 'in_house' or btrim(gstin) = ''),
  -- Shape checks, only when the field is filled (FR-7, FR-27).
  constraint supplier_mobile_shape
    check (mobile = '' or mobile ~ '^[0-9]{10}$'),
  constraint supplier_pin_shape
    check (pin_code = '' or pin_code ~ '^[1-9][0-9]{5}$'),
  constraint supplier_gstin_shape
    check (gstin = '' or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
);

-- The composite target that lets 0037/0038/0039 enforce "external ⇒ invoice_no"
-- with a plain CHECK. A CHECK cannot read another table, so the type is
-- denormalised onto each purchase row and bound back here by composite FK.
create unique index if not exists suppliers_id_type_key
  on public.suppliers (id, supplier_type);
alter table public.suppliers drop constraint if exists suppliers_id_type_unique;
alter table public.suppliers add constraint suppliers_id_type_unique
  unique using index suppliers_id_type_key;

create index if not exists suppliers_status_idx on public.suppliers (status, name);
create index if not exists suppliers_type_idx   on public.suppliers (supplier_type);
create index if not exists suppliers_city_idx   on public.suppliers (lower(city));

drop trigger if exists suppliers_updated_at on public.suppliers;
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ─── RLS: reads need suppliers.view; writes only through the RPCs below ─────
alter table public.suppliers enable row level security;
drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers for select
  using (public.has_perm('suppliers.view'));

-- ─── Read surface ───────────────────────────────────────────────────────────
-- NOTE: columns are APPENDED, never inserted mid-list or reordered. Same rule
-- as items_v and salary_payment_v; the client reads `select *` and maps by name.
create or replace view public.suppliers_v as
  select
    s.id, s.code, s.supplier_type, s.name, s.business_name, s.contact_person,
    s.mobile, s.email, s.gstin, s.address, s.city, s.state, s.pin_code,
    s.payment_terms, s.notes, s.status, s.created_at, s.updated_at
  from public.suppliers s
  where public.has_perm('suppliers.view');
grant select on public.suppliers_v to authenticated;

-- ─── Internal: normalise one jsonb payload into the column set ──────────────
-- Shared by create and update so the two can never disagree about trimming,
-- upper-casing or which fields an in-house row is allowed to carry.
create or replace function public.supplier_fields(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'supplier_type',  case when p->>'supplierType' = 'in_house' then 'in_house' else 'external' end,
    'name',           btrim(coalesce(p->>'name','')),
    'business_name',  btrim(coalesce(p->>'businessName','')),
    'contact_person', btrim(coalesce(p->>'contactPerson','')),
    'mobile',         btrim(coalesce(p->>'mobile','')),
    'email',          btrim(coalesce(p->>'email','')),
    -- Upper-cased so a lower-case entry is accepted rather than rejected by the
    -- shape constraint; the constraint itself stays strict.
    'gstin',          upper(btrim(coalesce(p->>'gstin',''))),
    'address',        btrim(coalesce(p->>'address','')),
    'city',           btrim(coalesce(p->>'city','')),
    'state',          btrim(coalesce(p->>'state','')),
    'pin_code',       btrim(coalesce(p->>'pinCode','')),
    'payment_terms',  btrim(coalesce(p->>'paymentTerms','')),
    'notes',          btrim(coalesce(p->>'notes',''))
  )
$$;
-- Ungated internal helper: reachable only from the definer RPCs below. The
-- revoke, not the missing grant, is what withholds it (see 0032:169).
revoke execute on function public.supplier_fields(jsonb) from public;

-- ─── Create ─────────────────────────────────────────────────────────────────
create or replace function public.create_supplier(p jsonb)
returns public.suppliers_v
language plpgsql security definer set search_path = public as $$
declare v_row public.suppliers_v; v_id uuid; f jsonb;
begin
  if not public.has_perm('suppliers.create') then raise exception 'forbidden'; end if;
  -- The return row is read back through suppliers_v, which is gated on
  -- suppliers.view. Without it the write would succeed and then hand back NULL.
  if not public.has_perm('suppliers.view') then
    raise exception 'adding a supplier also needs the "view suppliers" permission';
  end if;

  f := public.supplier_fields(p);

  insert into public.suppliers (
    supplier_type, name, business_name, contact_person, mobile, email, gstin,
    address, city, state, pin_code, payment_terms, notes
  ) values (
    f->>'supplier_type', f->>'name', f->>'business_name', f->>'contact_person',
    f->>'mobile', f->>'email', f->>'gstin', f->>'address', f->>'city',
    f->>'state', f->>'pin_code', f->>'payment_terms', f->>'notes'
  ) returning id into v_id;

  insert into public.activity_log (type, actor, item_name, notes)
    select 'supplier', auth.uid(), s.name,
           'Added ' || case when s.supplier_type = 'in_house' then 'in-house' else 'external' end
           || ' supplier ' || s.code
    from public.suppliers s where s.id = v_id;

  select * into v_row from public.suppliers_v where id = v_id;
  return v_row;
end $$;
grant execute on function public.create_supplier(jsonb) to authenticated;

-- ─── Update, with an optimistic version check ───────────────────────────────
-- p_expected is the updated_at the client loaded. If the stored value has moved
-- the write is refused, so two people editing the same supplier cannot silently
-- overwrite each other (TC-16).
--
-- The audit entry is a field-level old→new diff, the same shape
-- app/api/staff/route.ts writes for staff edits (FR-28).
create or replace function public.update_supplier(
  p_id uuid, p jsonb, p_expected timestamptz
)
returns public.suppliers_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.suppliers_v; v_before public.suppliers; f jsonb;
  v_changes text[] := '{}';
  v_key text; v_col text; v_old text; v_new text;
begin
  if not public.has_perm('suppliers.edit') then raise exception 'forbidden'; end if;
  if not public.has_perm('suppliers.view') then
    raise exception 'editing a supplier also needs the "view suppliers" permission';
  end if;

  select * into v_before from public.suppliers where id = p_id for update;
  if not found then raise exception 'supplier not found'; end if;

  if p_expected is null or v_before.updated_at <> p_expected then
    raise exception 'this supplier changed while you were editing — reload and try again';
  end if;

  f := public.supplier_fields(p);

  -- The diff, before the write. Iterating the payload keeps this in step with
  -- supplier_fields automatically: a column added there is diffed here.
  for v_key in select jsonb_object_keys(f) loop
    v_col := v_key;
    execute format('select ($1).%I::text', v_col) into v_old using v_before;
    v_new := f->>v_key;
    if coalesce(v_old,'') is distinct from coalesce(v_new,'') then
      v_changes := v_changes || (v_col || ': ' || coalesce(nullif(v_old,''),'—')
                                 || ' → ' || coalesce(nullif(v_new,''),'—'));
    end if;
  end loop;

  update public.suppliers set
    supplier_type  = f->>'supplier_type',
    name           = f->>'name',
    business_name  = f->>'business_name',
    contact_person = f->>'contact_person',
    mobile         = f->>'mobile',
    email          = f->>'email',
    gstin          = f->>'gstin',
    address        = f->>'address',
    city           = f->>'city',
    state          = f->>'state',
    pin_code       = f->>'pin_code',
    payment_terms  = f->>'payment_terms',
    notes          = f->>'notes'
  where id = p_id;

  -- Nothing changed means nothing to record: an audit trail of no-ops is noise.
  if array_length(v_changes, 1) > 0 then
    insert into public.activity_log (type, actor, item_name, notes)
      values ('supplier', auth.uid(), v_before.name,
              'Updated supplier ' || v_before.code || ' — ' || array_to_string(v_changes, ', '));
  end if;

  select * into v_row from public.suppliers_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.update_supplier(uuid, jsonb, timestamptz) to authenticated;

-- ─── Activate / deactivate (FR-3) ───────────────────────────────────────────
-- The only retirement there is. No delete exists anywhere in this module.
create or replace function public.set_supplier_status(p_id uuid, p_status text)
returns public.suppliers_v
language plpgsql security definer set search_path = public as $$
declare v_row public.suppliers_v; v_before public.suppliers;
begin
  if not public.has_perm('suppliers.status') then raise exception 'forbidden'; end if;
  if not public.has_perm('suppliers.view') then
    raise exception 'changing a supplier''s status also needs the "view suppliers" permission';
  end if;
  if p_status not in ('active','inactive') then
    raise exception 'status must be active or inactive';
  end if;

  select * into v_before from public.suppliers where id = p_id for update;
  if not found then raise exception 'supplier not found'; end if;
  if v_before.status = p_status then
    raise exception 'this supplier is already %', p_status;
  end if;

  update public.suppliers set status = p_status where id = p_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('supplier', auth.uid(), v_before.name,
            case when p_status = 'inactive' then 'Deactivated' else 'Reactivated' end
            || ' supplier ' || v_before.code);

  select * into v_row from public.suppliers_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.set_supplier_status(uuid, text) to authenticated;

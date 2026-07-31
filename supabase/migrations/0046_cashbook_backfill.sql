-- ============================================================================
-- BT Store Management — backfill the cash ledger from existing history
--
--   1. RE-RUNNABLE ON PURPOSE. A one-shot migration over live money data gets
--      run more than once in practice. Every insert is `on conflict do nothing`
--      against cash_entry_source_uniq (0045).
--   2. `on_date` COMES FROM EACH SOURCE'S OWN DATE, not created_at, except for
--      bills — which have no date column, so their timestamptz is converted
--      through store_settings.timezone.
--   3. CANCELLED BILLS POST NOTHING. bills has no cancelled-at date that
--      predates 0011, so a reconstructed reversal would carry an invented date.
--      A sale that was cancelled simply never appears, which is both true of
--      the cash and cheaper to explain.
--   4. PURCHASE INVOICES AND RETURNS ARE NOT HERE. An invoice creates a
--      payable and a return is a credit note against it (0037, 0039); cash
--      moves only when a supplier_payment is recorded.
--   5. NO cash_day ROWS AND NO OPENING ENTRIES. Every historical day is open
--      and was never reconciled — the truth. The derived sum IS the balance.
-- ============================================================================

do $bf$
declare v_tz text; v_n int;
begin
  select timezone into v_tz from public.store_settings where id = 1;

  -- ─── Sales ────────────────────────────────────────────────────────────────
  insert into public.cash_entry (
    on_date, account, direction, amount, payment_mode, category_id,
    source_type, source_id, note, created_by, created_at)
  select
    (b.created_at at time zone v_tz)::date,
    public.mode_to_account(b.payment_method),
    'in', b.total, b.payment_method, public.system_category('Sales'),
    'bill', b.id, '', b.created_by, b.created_at
  from public.bills b
  where b.status = 'active' and b.total > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'backfilled % bills', v_n;

  -- ─── Salary ───────────────────────────────────────────────────────────────
  -- `net`, not `gross`: the net is what left the drawer, after any advance
  -- recovery (0033).
  insert into public.cash_entry (
    on_date, account, direction, amount, payment_mode, category_id,
    source_type, source_id, note, created_by, created_at)
  select
    sp.paid_on,
    public.mode_to_account(sp.payment_mode),
    'out', sp.net, sp.payment_mode, public.system_category('Salary'),
    'salary', sp.id, '', sp.recorded_by, sp.updated_at
  from public.salary_payment sp
  where sp.status = 'paid' and sp.paid_on is not null
    and sp.payment_mode <> '' and sp.net > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'backfilled % salary payments', v_n;

  -- ─── Staff advances ───────────────────────────────────────────────────────
  insert into public.cash_entry (
    on_date, account, direction, amount, payment_mode, category_id,
    source_type, source_id, note, created_by, created_at)
  select
    a.approved_on,
    public.mode_to_account(a.payment_mode),
    'out', a.amount, a.payment_mode, public.system_category('Staff Advance'),
    'advance', a.id, '', a.decided_by, a.approved_on::timestamptz
  from public.staff_advance a
  where a.status = 'approved' and a.approved_on is not null
    and a.payment_mode <> '' and a.amount > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'backfilled % advances', v_n;

  -- ─── Supplier payments ────────────────────────────────────────────────────
  insert into public.cash_entry (
    on_date, account, direction, amount, payment_mode, category_id,
    source_type, source_id, reference_no, note, created_by, created_at)
  select
    sp.paid_on,
    public.mode_to_account(sp.mode),
    'out', sp.amount, sp.mode, public.system_category('Supplier Payment'),
    'supplier_payment', sp.id, sp.reference_no, sp.notes, sp.created_by, sp.created_at
  from public.supplier_payment sp
  where sp.amount > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  raise notice 'backfilled % supplier payments', v_n;
end $bf$;

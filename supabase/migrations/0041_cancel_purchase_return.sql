-- ============================================================================
-- BT Store Management — withdrawing a purchase return
--
-- 0039 could post a return but never take one back, which left a mis-keyed
-- credit note permanent. This adds the missing path.
--
-- WHY CANCEL AND NOT DELETE. Posting a return removed stock and issued supplier
-- credit. Deleting the row would silently drop the credit AND leave the stock
-- missing, so the ledger and the shelf would disagree. Cancelling restores the
-- stock and, because supplier_summary_v only counts `posted` rows, withdraws the
-- credit as a consequence rather than as a second write that could drift.
--
-- The restored stock carries the ORIGINAL provenance (supplier + invoice) from
-- 0040, so cancelling a return puts the batch back where it came from instead of
-- creating an unattributed one.
-- ============================================================================

alter table public.purchase_return
  add column if not exists cancelled_at   timestamptz,
  add column if not exists cancel_reason  text;

-- Columns are APPENDED, never reordered — the client reads `select *` and maps
-- by name (same rule as items_v and every other *_v here).
create or replace view public.purchase_return_v as
  select
    r.id, r.supplier_id, r.supplier_type, r.invoice_id, r.return_date,
    r.status, r.reason, r.created_at, r.posted_at,
    s.name  as supplier_name,
    s.code  as supplier_code,
    pi.invoice_no,
    cb.name as created_by_name,
    case when public.has_perm('suppliers.financial') then r.total end as total,
    r.cancelled_at,
    r.cancel_reason
  from public.purchase_return r
  join public.suppliers s on s.id = r.supplier_id
  join public.purchase_invoice pi on pi.id = r.invoice_id
  left join public.profiles cb on cb.id = r.created_by
  where public.has_perm('suppliers.view');
grant select on public.purchase_return_v to authenticated;

create or replace function public.cancel_purchase_return(p_id uuid, p_reason text)
returns public.purchase_return_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_return_v; v_ret public.purchase_return;
  v_name text; rl public.purchase_return_line; v_expiry date;
begin
  if not public.has_perm('purchases.return') then raise exception 'forbidden'; end if;
  if not public.has_perm('suppliers.view') then
    raise exception 'withdrawing a return also needs the "view suppliers" permission';
  end if;
  -- Withdrawing a credit note changes what is owed, so it needs the money key
  -- for the same reason raising one does.
  if not public.has_perm('suppliers.financial') then
    raise exception 'withdrawing a return also needs the "view supplier money" permission';
  end if;
  if btrim(coalesce(p_reason,'')) = '' then
    raise exception 'give a reason when withdrawing a return';
  end if;

  select * into v_ret from public.purchase_return where id = p_id for update;
  if not found then raise exception 'return not found'; end if;
  if v_ret.status <> 'posted' then
    raise exception 'this return is already %', v_ret.status;
  end if;

  select name into v_name from public.suppliers where id = v_ret.supplier_id;

  -- Put the stock back on the shelf, under the invoice it originally arrived on.
  for rl in select * from public.purchase_return_line where return_id = p_id loop
    select expiry into v_expiry from public.purchase_invoice_line
      where id = rl.invoice_line_id;
    perform public.add_batch(
      rl.item_id, rl.qty, v_expiry, v_ret.supplier_id, v_ret.invoice_id
    );
  end loop;

  update public.purchase_return
    set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason)
    where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('purchase_return', auth.uid(), v_name, v_ret.total,
            'Withdrew a return of ' || v_ret.total::text || ' to ' || v_name
            || ' dated ' || v_ret.return_date::text || ': ' || btrim(p_reason)
            || ' (stock restored)');

  select * into v_row from public.purchase_return_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.cancel_purchase_return(uuid, text) to authenticated;

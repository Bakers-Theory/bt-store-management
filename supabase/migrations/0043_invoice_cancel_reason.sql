-- ============================================================================
-- BT Store Management — keep the cancellation reason on the invoice
--
-- cancel_purchase_invoice has always demanded a reason, but only ever wrote it
-- to activity_log. The invoice row itself kept `status = 'cancelled'` and
-- nothing else, so the record could show THAT it was withdrawn but never WHY —
-- you had to go digging through History to find out.
--
-- purchase_return already carries cancel_reason (0041); this brings invoices
-- into line. The activity_log entry stays exactly as it was: it is the audit
-- trail, and this column is the record's own copy for display.
-- ============================================================================

alter table public.purchase_invoice
  add column if not exists cancel_reason text;

-- Columns are APPENDED, never reordered — the client reads `select *` and maps
-- by name.
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
    case when public.has_perm('suppliers.financial') then pi.total      end as total,
    pi.cancel_reason
  from public.purchase_invoice pi
  join public.suppliers s on s.id = pi.supplier_id
  left join public.profiles cb on cb.id = pi.created_by
  where public.has_perm('suppliers.view');
grant select on public.purchase_invoice_v to authenticated;

-- Reproduced from 0042 with one addition: the reason is now stored on the row.
-- Signature is unchanged, so no drop is needed.
create or replace function public.cancel_purchase_invoice(
  p_id uuid, p_reason text, p_write_off boolean default false
)
returns public.purchase_invoice_v
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchase_invoice_v; v_inv public.purchase_invoice;
  v_supplier text; l public.purchase_invoice_line; v_have numeric;
  v_item text; v_wrote boolean := false;
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
      select qty into v_have from public.items where id = l.item_id for update;
      if coalesce(v_have, 0) < l.qty then
        raise exception
          'only % of the % received on this invoice is still in stock — raise a return instead',
          coalesce(v_have, 0), l.qty;
      end if;
    end loop;

    for l in select * from public.purchase_invoice_line where invoice_id = p_id loop
      perform public.consume_fifo(l.item_id, l.qty);

      if p_write_off then
        select name into v_item from public.items where id = l.item_id;
        insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes)
          values ('out', auth.uid(), l.item_id, v_item, l.qty, 'Write-off',
                  'Cancelled ' || coalesce(v_inv.invoice_no, v_inv.internal_ref)
                  || ' from ' || v_supplier || ': ' || btrim(p_reason));
        v_wrote := true;
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

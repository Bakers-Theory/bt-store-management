-- ============================================================================
-- BT Store Management — Store Open/Closed status
-- Owner-only toggle. Adds status to the store_settings singleton, records who
-- and when, blocks new bills while closed (enforced in generate_bill), and logs
-- every open/close to the activity log.
-- ============================================================================

-- ─── Schema: status on the store_settings singleton ─────────────────────────
alter table public.store_settings
  add column if not exists is_open           boolean     not null default true,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by text        not null default '';

-- ─── Audit log: allow 'open' / 'close' entry types ──────────────────────────
alter table public.activity_log drop constraint if exists activity_log_type_check;
alter table public.activity_log add constraint activity_log_type_check
  check (type in ('in','out','bill','cancel','delete','open','close'));

-- ─── RPC: set_store_status (Owner only) ─────────────────────────────────────
-- The durable "who changed it" is store_settings.status_changed_by; the audit
-- row records the actor (rendered "By {name}" via activity_log_v) — no notes,
-- to avoid duplicating the name in the History meta line.
create or replace function public.set_store_status(p_open boolean, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  update public.store_settings
    set is_open = p_open, status_changed_at = now(), status_changed_by = p_by
    where id = 1;
  insert into public.activity_log (type, actor)
    values (case when p_open then 'open' else 'close' end, auth.uid());
end $$;

grant execute on function public.set_store_status(boolean, text) to authenticated;

-- ─── generate_bill: block new bills while the store is closed ───────────────
-- Full redefinition of the current (0014) body with the store-open guard added
-- right after the sales-permission check. All other logic is byte-for-byte
-- unchanged (FIFO consume, rounding, customer upsert, payment, discount).
create or replace function public.generate_bill(customer jsonb, lines jsonb)
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
        v_disc numeric; v_taxable numeric; v_customer uuid;
        v_phone text := coalesce(customer->>'phone','');
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  if not (select is_open from public.store_settings where id = 1) then
    raise exception 'Store is closed — new bills cannot be created';
  end if;

  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;
  v_sub := round(v_sub, 2);

  if v_phone <> '' then
    insert into public.customers (phone, name)
      values (v_phone, coalesce(customer->>'name',''))
      on conflict (phone) do update
        set name = case when excluded.name <> '' then excluded.name
                        else public.customers.name end,
            last_seen = now()
      returning id into v_customer;
  end if;

  v_disc := least(100, greatest(0, coalesce((customer->>'discount')::numeric, 0)));
  v_taxable := round(v_sub - (v_sub * v_disc / 100), 2);
  v_tax := round(v_taxable * v_rate / 100, 2);
  insert into public.bills (customer_name, customer_phone, customer_id,
                            subtotal, tax, total, tax_rate, payment_method,
                            discount_percent, created_by)
    values (coalesce(customer->>'name',''), v_phone, v_customer,
            v_sub, v_tax, round(v_taxable + v_tax, 2), v_rate,
            case when customer->>'payment' = 'UPI' then 'UPI' else 'Cash' end,
            v_disc, auth.uid())
    returning * into v_bill;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price);
    perform public.consume_fifo(it.id, v_qty);
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;

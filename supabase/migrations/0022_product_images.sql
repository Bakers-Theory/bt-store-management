-- ============================================================================
-- BT Store Management — per-product images
-- Adds a nullable image_url to items and to the bill_items snapshot, threads it
-- through the item mutation RPCs and the bill generator, exposes it on items_v,
-- and provisions a public Storage bucket for the compressed WebP files. All
-- schema changes are additive; emoji remains the fallback so existing items are
-- unaffected.
-- ============================================================================

alter table public.items      add column if not exists image_url text;
alter table public.bill_items add column if not exists image_url text;

-- ─── items_v: append image_url ───────────────────────────────────────────────
-- Reproduced from 0020 (keeps earliest_expiry + batches) with image_url added
-- at the end. CREATE OR REPLACE VIEW can only append columns; the client reads
-- via `select *` and maps by name, so column order is irrelevant.
create or replace view public.items_v as
  select
    id, name, emoji, category, unit, price,
    case when public.has_perm('inventory') or public.has_perm('analytics')
         then cost_price else null end as cost_price,
    qty, created_at, updated_at,
    tracks_expiry,
    (select min(sb.expiry_date) from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as earliest_expiry,
    (select coalesce(
              jsonb_agg(
                jsonb_build_object('qty', sb.qty, 'expiryDate', sb.expiry_date)
                order by sb.expiry_date asc nulls last, sb.created_at asc),
              '[]'::jsonb)
       from public.stock_batches sb
       where sb.item_id = items.id and sb.qty > 0) as batches,
    image_url
  from public.items;
grant select on public.items_v to authenticated;

-- ─── create_item: carry image_url on the INSERT ──────────────────────────────
-- Reproduced from 0016 with image_url added to the new-item INSERT.
create or replace function public.create_item(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dup public.items; v_id uuid;
        v_qty numeric := coalesce((p->>'qty')::numeric, 0);
        v_tracks boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_expiry date := nullif(p->>'expiryDate','')::date;
        v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  select * into v_dup from public.items where name_key = lower(trim(p->>'name'));
  if found then
    if v_qty > 0 then
      perform public.add_batch(v_dup.id, v_qty, v_expiry);
      insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
        values ('in', auth.uid(), v_dup.id, v_dup.name, v_qty,
                'Added via New Item form (existing item)');
    end if;
    select * into v_row from public.items_v where id = v_dup.id;
    return jsonb_build_object('kind','merged','name',v_dup.name,'qty',v_qty,'unit',v_dup.unit,
                               'item',to_jsonb(v_row));
  end if;
  insert into public.items (name, emoji, category, unit, price, cost_price, qty, tracks_expiry, image_url)
    values (p->>'name', coalesce(p->>'emoji','📦'), p->>'category', p->>'unit',
            coalesce((p->>'price')::numeric,0), coalesce((p->>'costPrice')::numeric,0),
            0, v_tracks, nullif(p->>'imageUrl',''))
    returning id into v_id;
  if v_qty > 0 then
    perform public.add_batch(v_id, v_qty, v_expiry);
    insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
      values ('in', auth.uid(), v_id, p->>'name', v_qty, 'Initial stock');
  end if;
  select * into v_row from public.items_v where id = v_id;
  return jsonb_build_object('kind','added','id',v_id,'item',to_jsonb(v_row));
end $$;

-- ─── update_item: set image_url on UPDATE ────────────────────────────────────
-- Reproduced from 0016 with image_url added to the UPDATE (nullif allows
-- clearing an image back to the emoji fallback).
create or replace function public.update_item(p_id uuid, p jsonb)
returns public.items_v language plpgsql security definer set search_path = public as $$
declare v_tracks_old boolean;
        v_tracks_new boolean := coalesce((p->>'tracksExpiry')::boolean, true);
        v_sum numeric; v_row public.items_v;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  select tracks_expiry into v_tracks_old from public.items where id = p_id;
  if not found then raise exception 'item not found'; end if;
  update public.items set
    name = p->>'name', emoji = coalesce(p->>'emoji','📦'), category = p->>'category',
    unit = p->>'unit', price = coalesce((p->>'price')::numeric,0),
    cost_price = coalesce((p->>'costPrice')::numeric,0), tracks_expiry = v_tracks_new,
    image_url = nullif(p->>'imageUrl','')
  where id = p_id;
  if v_tracks_old and not v_tracks_new then
    select coalesce(sum(qty),0) into v_sum from public.stock_batches where item_id = p_id;
    delete from public.stock_batches where item_id = p_id;
    if v_sum > 0 then
      insert into public.stock_batches (item_id, qty, expiry_date) values (p_id, v_sum, null);
    end if;
  end if;
  select * into v_row from public.items_v where id = p_id;
  return v_row;
end $$;
grant execute on function public.update_item(uuid, jsonb) to authenticated;

-- ─── generate_bill: snapshot image_url into bill_items ───────────────────────
-- Reproduced from 0020 with image_url added to the bill_items INSERT so a
-- historical bill keeps the image it was billed with.
drop function if exists public.generate_bill(jsonb, jsonb, text);
create or replace function public.generate_bill(customer jsonb, lines jsonb, p_tz text default 'UTC')
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
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price, image_url)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price, it.image_url);
    perform public.consume_fresh_fifo(it.id, v_qty, p_tz);
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;
grant execute on function public.generate_bill(jsonb, jsonb, text) to authenticated;

-- ─── Storage: public product-images bucket ───────────────────────────────────
-- Public read so plain <img src> works without signed URLs; writes limited to
-- authenticated users (the item-save RPCs enforce inventory permission).
insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

create policy "product images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "authenticated can upload product images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images');

create policy "authenticated can update product images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images');

create policy "authenticated can delete product images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images');

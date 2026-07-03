-- ============================================================================
-- BT Store Management — initial schema
-- Single store · Supabase Auth (userId -> {userId}@bt.local) · DB-enforced RLS
-- Run in the Supabase SQL editor (or `supabase db push`).
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ─── Profiles (extends auth.users) ──────────────────────────────────────────
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  user_id        text not null unique,           -- login handle, e.g. '7873557430'
  name           text not null,
  role           text not null default 'Staff' check (role in ('Owner','Staff')),
  perm_sales     boolean not null default false,
  perm_inventory boolean not null default false,
  perm_analytics boolean not null default false,
  created_at     timestamptz not null default now()
);

-- At most one Owner.
create unique index if not exists one_owner on public.profiles ((role)) where role = 'Owner';

-- Auto-create a profile row for every new auth user, reading metadata set at
-- signup / admin-create time.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, user_id, name, role,
                               perm_sales, perm_inventory, perm_analytics)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'user_id', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'name', 'Staff'),
    coalesce(new.raw_user_meta_data->>'role', 'Staff'),
    coalesce((new.raw_user_meta_data->>'perm_sales')::boolean, false),
    coalesce((new.raw_user_meta_data->>'perm_inventory')::boolean, false),
    coalesce((new.raw_user_meta_data->>'perm_analytics')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── RLS helper functions (mirror permissions.ts) ───────────────────────────
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'Owner', false)
$$;

-- Owner implicitly has every permission.
create or replace function public.has_perm(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'Owner'
           or (perm = 'sales'     and p.perm_sales)
           or (perm = 'inventory' and p.perm_inventory)
           or (perm = 'analytics' and p.perm_analytics))
  )
$$;

-- ─── Shared updated_at trigger ──────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─── Store settings (singleton) ─────────────────────────────────────────────
create table if not exists public.store_settings (
  id              int primary key default 1 check (id = 1),
  name            text not null default 'My Bakery',
  tagline         text not null default '',
  address         text not null default '',
  phone           text not null default '',
  gst             text not null default '',
  logo_url        text,
  currency        text not null default '₹',
  tax_rate        numeric not null default 0,
  low_stock_alert numeric not null default 5,
  updated_at      timestamptz not null default now()
);
insert into public.store_settings (id) values (1) on conflict do nothing;

drop trigger if exists store_settings_updated on public.store_settings;
create trigger store_settings_updated before update on public.store_settings
  for each row execute function public.set_updated_at();

-- ─── Items ──────────────────────────────────────────────────────────────────
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  name_key   text generated always as (lower(trim(name))) stored unique,
  emoji      text not null default '📦',
  category   text not null,
  unit       text not null,
  price      numeric not null default 0,   -- selling price
  cost_price numeric not null default 0,   -- PRIVATE (analytics only)
  qty        numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_category_idx on public.items (category);

drop trigger if exists items_updated on public.items;
create trigger items_updated before update on public.items
  for each row execute function public.set_updated_at();

-- ─── Bills + bill_items ─────────────────────────────────────────────────────
create sequence if not exists bill_no_seq start 1001;

create table if not exists public.bills (
  id             uuid primary key default gen_random_uuid(),
  bill_no        bigint not null unique default nextval('bill_no_seq'),
  customer_name  text not null default '',
  customer_phone text not null default '',
  subtotal       numeric not null,
  tax            numeric not null,
  total          numeric not null,
  tax_rate       numeric not null,
  status         text not null default 'active' check (status in ('active','cancelled')),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null,
  cancelled_at   timestamptz,
  cancelled_by   text
);
create index if not exists bills_created_at_idx on public.bills (created_at);
create index if not exists bills_status_idx on public.bills (status);

create table if not exists public.bill_items (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references public.bills(id) on delete cascade,
  item_id    uuid references public.items(id) on delete set null,
  name       text not null,
  emoji      text not null default '',
  unit       text not null,
  qty        numeric not null,
  price      numeric not null,
  cost_price numeric not null default 0   -- PRIVATE
);
create index if not exists bill_items_bill_id_idx on public.bill_items (bill_id);
create index if not exists bill_items_item_id_idx on public.bill_items (item_id);

-- ─── Activity log (history) ─────────────────────────────────────────────────
create table if not exists public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('in','out','bill','cancel','delete')),
  created_at timestamptz not null default now(),
  actor      uuid references public.profiles(id) on delete set null,
  item_id    uuid references public.items(id) on delete set null,
  item_name  text,
  qty        numeric,
  supplier   text,
  reason     text,
  notes      text,
  bill_no    bigint,
  items      text,
  total      numeric
);
create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);

-- ============================================================================
-- Column privacy: nobody reads cost columns directly from the client.
-- (Access is only via the SECURITY DEFINER functions below.)
-- ============================================================================
revoke select (cost_price) on public.items      from authenticated, anon;
revoke select (cost_price) on public.bill_items from authenticated, anon;

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.store_settings enable row level security;
alter table public.items          enable row level security;
alter table public.bills          enable row level security;
alter table public.bill_items     enable row level security;
alter table public.activity_log   enable row level security;

-- profiles: self + Owner read; only Owner writes (staff management).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_owner());
drop policy if exists profiles_owner_write on public.profiles;
create policy profiles_owner_write on public.profiles for all
  using (public.is_owner()) with check (public.is_owner());

-- store_settings: any authed user reads; Owner updates.
drop policy if exists settings_read on public.store_settings;
create policy settings_read on public.store_settings for select
  using (auth.uid() is not null);
drop policy if exists settings_write on public.store_settings;
create policy settings_write on public.store_settings for update
  using (public.is_owner()) with check (public.is_owner());

-- items: read for sales/inventory/analytics; writes go through RPCs (inventory).
drop policy if exists items_read on public.items;
create policy items_read on public.items for select
  using (public.has_perm('inventory') or public.has_perm('sales') or public.has_perm('analytics'));

-- bills / bill_items / log: read for sales or inventory; writes via RPCs only.
drop policy if exists bills_read on public.bills;
create policy bills_read on public.bills for select
  using (public.has_perm('sales') or public.has_perm('inventory'));
drop policy if exists bill_items_read on public.bill_items;
create policy bill_items_read on public.bill_items for select
  using (public.has_perm('sales') or public.has_perm('inventory'));
drop policy if exists log_read on public.activity_log;
create policy log_read on public.activity_log for select
  using (public.has_perm('sales') or public.has_perm('inventory'));

-- ============================================================================
-- RPCs — replace the Zustand store actions (atomic + permission-checked)
-- ============================================================================

-- Items --------------------------------------------------------------------
create or replace function public.create_item(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dup public.items; v_id uuid; v_qty numeric := coalesce((p->>'qty')::numeric, 0);
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  select * into v_dup from public.items where name_key = lower(trim(p->>'name'));
  if found then
    if v_qty > 0 then
      update public.items set qty = qty + v_qty where id = v_dup.id;
      insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
        values ('in', auth.uid(), v_dup.id, v_dup.name, v_qty,
                'Added via New Item form (existing item)');
    end if;
    return jsonb_build_object('kind','merged','name',v_dup.name,'qty',v_qty,'unit',v_dup.unit);
  end if;
  insert into public.items (name, emoji, category, unit, price, cost_price, qty)
    values (p->>'name', coalesce(p->>'emoji','📦'), p->>'category', p->>'unit',
            coalesce((p->>'price')::numeric,0), coalesce((p->>'costPrice')::numeric,0), v_qty)
    returning id into v_id;
  if v_qty > 0 then
    insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
      values ('in', auth.uid(), v_id, p->>'name', v_qty, 'Initial stock');
  end if;
  return jsonb_build_object('kind','added','id',v_id);
end $$;

create or replace function public.update_item(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_old numeric; v_new numeric := coalesce((p->>'qty')::numeric, 0);
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  select qty into v_old from public.items where id = p_id;
  if not found then raise exception 'item not found'; end if;
  update public.items set
    name = p->>'name', emoji = coalesce(p->>'emoji','📦'), category = p->>'category',
    unit = p->>'unit', price = coalesce((p->>'price')::numeric,0),
    cost_price = coalesce((p->>'costPrice')::numeric,0), qty = v_new
  where id = p_id;
  if v_new <> v_old then
    insert into public.activity_log (type, actor, item_id, item_name, qty, notes)
      values (case when v_new > v_old then 'in' else 'out' end,
              auth.uid(), p_id, p->>'name', abs(v_new - v_old), 'Manual adjustment');
  end if;
end $$;

create or replace function public.delete_item(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  delete from public.items where id = p_id;
end $$;

create or replace function public.stock_in(p_item uuid, p_qty numeric, p_supplier text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.items;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select * into v from public.items where id = p_item;
  if not found then raise exception 'item not found'; end if;
  update public.items set qty = qty + p_qty where id = p_item;
  insert into public.activity_log (type, actor, item_id, item_name, qty, supplier, notes)
    values ('in', auth.uid(), p_item, v.name, p_qty, p_supplier, p_notes);
end $$;

create or replace function public.stock_out(p_item uuid, p_qty numeric, p_reason text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.items;
begin
  if not public.has_perm('inventory') then raise exception 'forbidden'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'invalid quantity'; end if;
  select * into v from public.items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if p_qty > v.qty then raise exception 'only % available', v.qty; end if;
  update public.items set qty = qty - p_qty where id = p_item;
  insert into public.activity_log (type, actor, item_id, item_name, qty, reason, notes)
    values ('out', auth.uid(), p_item, v.name, p_qty, p_reason, p_notes);
end $$;

-- Bills --------------------------------------------------------------------
-- lines: jsonb array of { itemId, qty }
create or replace function public.generate_bill(customer jsonb, lines jsonb)
returns public.bills language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_sub numeric := 0; v_tax numeric; v_bill public.bills;
        ln jsonb; it public.items; v_qty numeric;
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  select tax_rate into v_rate from public.store_settings where id = 1;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid for update;
    if not found then raise exception 'item not found'; end if;
    v_sub := v_sub + v_qty * it.price;
  end loop;

  v_tax := v_sub * v_rate / 100;
  insert into public.bills (customer_name, customer_phone, subtotal, tax, total, tax_rate, created_by)
    values (coalesce(customer->>'name',''), coalesce(customer->>'phone',''),
            v_sub, v_tax, v_sub + v_tax, v_rate, auth.uid())
    returning * into v_bill;

  for ln in select * from jsonb_array_elements(lines) loop
    v_qty := (ln->>'qty')::numeric;
    select * into it from public.items where id = (ln->>'itemId')::uuid;
    insert into public.bill_items (bill_id, item_id, name, emoji, unit, qty, price, cost_price)
      values (v_bill.id, it.id, it.name, it.emoji, it.unit, v_qty, it.price, it.cost_price);
    update public.items set qty = greatest(0, qty - v_qty) where id = it.id;
  end loop;

  insert into public.activity_log (type, actor, bill_no, items, total)
    values ('bill', auth.uid(), v_bill.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = v_bill.id),
            v_bill.total);
  return v_bill;
end $$;

create or replace function public.cancel_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills; li public.bill_items;
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status = 'cancelled' then raise exception 'already cancelled'; end if;
  for li in select * from public.bill_items where bill_id = p_id loop
    if li.item_id is not null then
      update public.items set qty = qty + li.qty where id = li.item_id;
    end if;
  end loop;
  update public.bills set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by
    where id = p_id;
  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('cancel', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Cancelled by ' || p_by);
end $$;

create or replace function public.delete_bill(p_id uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills; li public.bill_items;
begin
  if not public.has_perm('sales') then raise exception 'forbidden'; end if;
  select * into v from public.bills where id = p_id;
  if not found then raise exception 'bill not found'; end if;
  if v.status <> 'cancelled' then
    for li in select * from public.bill_items where bill_id = p_id loop
      if li.item_id is not null then
        update public.items set qty = qty + li.qty where id = li.item_id;
      end if;
    end loop;
  end if;
  insert into public.activity_log (type, actor, bill_no, items, total, notes)
    values ('delete', auth.uid(), v.bill_no,
            (select string_agg(name, ', ') from public.bill_items where bill_id = p_id),
            v.total, 'Deleted by ' || p_by);
  delete from public.bills where id = p_id;   -- cascades bill_items
end $$;

-- Settings / data ----------------------------------------------------------
create or replace function public.save_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  update public.store_settings set
    name = coalesce(nullif(p->>'name',''), 'My Bakery'),
    tagline = coalesce(p->>'tagline',''),
    address = coalesce(p->>'address',''),
    phone = coalesce(p->>'phone',''),
    gst = coalesce(p->>'gst',''),
    currency = coalesce(nullif(p->>'currency',''),'₹'),
    tax_rate = coalesce((p->>'taxRate')::numeric,0),
    low_stock_alert = coalesce((p->>'lowStockAlert')::numeric,5)
  where id = 1;
end $$;

create or replace function public.clear_all_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  delete from public.bills;          -- cascades bill_items
  delete from public.items;
  delete from public.activity_log;
  alter sequence bill_no_seq restart with 1001;
end $$;

-- ─── Analytics cost access (gated on 'analytics') ───────────────────────────
-- Returns bill lines *including* cost, only to analytics-permitted users, so the
-- dashboard P&L / margin views can be computed without exposing cost broadly.
create or replace function public.bill_lines_with_cost()
returns table (bill_id uuid, item_id uuid, category text, qty numeric,
               price numeric, cost_price numeric, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select bi.bill_id, bi.item_id, i.category, bi.qty, bi.price, bi.cost_price,
         b.status, b.created_at
  from public.bill_items bi
  join public.bills b on b.id = bi.bill_id
  left join public.items i on i.id = bi.item_id
  where public.has_perm('analytics')
$$;

-- Grants -------------------------------------------------------------------
grant execute on function
  public.create_item(jsonb), public.update_item(uuid, jsonb), public.delete_item(uuid),
  public.stock_in(uuid, numeric, text, text), public.stock_out(uuid, numeric, text, text),
  public.generate_bill(jsonb, jsonb), public.cancel_bill(uuid, text), public.delete_bill(uuid, text),
  public.save_settings(jsonb), public.clear_all_data(), public.bill_lines_with_cost()
to authenticated;

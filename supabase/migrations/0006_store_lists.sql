-- ============================================================================
-- BT Store Management — admin-managed item option lists
-- Backs categories, emojis, units and stock-out reasons (previously hardcoded
-- in src/lib/constants.ts). Owner-managed via RPCs; read by any authed user.
-- ============================================================================

create table if not exists public.store_lists (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('category','emoji','unit','reason')),
  value      text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (kind, value)
);
create index if not exists store_lists_kind_idx on public.store_lists (kind, sort_order);

-- ─── Seed from the previous constants.ts values (order preserved) ───────────
insert into public.store_lists (kind, value, sort_order) values
  ('category','Breads',0),('category','Cakes',1),('category','Pastries',2),
  ('category','Beverages',3),('category','Ingredients',4),('category','Cookies',5),
  ('category','Others',6),
  ('unit','pcs',0),('unit','kg',1),('unit','g',2),('unit','l',3),('unit','ml',4),
  ('unit','dozen',5),('unit','box',6),('unit','pack',7),('unit','bag',8),
  ('reason','Sold',0),('reason','Damaged',1),('reason','Expired',2),
  ('reason','Used in production',3),('reason','Other',4),
  ('emoji','🥐',0),('emoji','🥖',1),('emoji','🍞',2),('emoji','🧁',3),('emoji','🎂',4),
  ('emoji','🍰',5),('emoji','🍩',6),('emoji','🍪',7),('emoji','🧇',8),('emoji','🥞',9),
  ('emoji','🍫',10),('emoji','🥛',11),('emoji','☕',12),('emoji','🧃',13),('emoji','🍓',14),
  ('emoji','🍋',15),('emoji','🥚',16),('emoji','🧈',17),('emoji','🍯',18),('emoji','🌾',19),
  ('emoji','🧂',20),('emoji','🫙',21),('emoji','🥤',22),('emoji','📦',23)
on conflict (kind, value) do nothing;

-- ─── RLS: any authed user reads; writes only via Owner-gated RPCs ───────────
alter table public.store_lists enable row level security;
drop policy if exists store_lists_read on public.store_lists;
create policy store_lists_read on public.store_lists for select
  using (auth.uid() is not null);

-- ─── RPCs ───────────────────────────────────────────────────────────────────
create or replace function public.add_list_value(p_kind text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := trim(p_value); v_next int;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_kind not in ('category','emoji','unit','reason') then
    raise exception 'unknown list';
  end if;
  if v = '' then raise exception 'value is required'; end if;
  if exists (select 1 from public.store_lists where kind = p_kind and value = v) then
    raise exception '"%" already exists', v;
  end if;
  select coalesce(max(sort_order), -1) + 1 into v_next
    from public.store_lists where kind = p_kind;
  insert into public.store_lists (kind, value, sort_order) values (p_kind, v, v_next);
end $$;

create or replace function public.delete_list_value(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.store_lists; n int;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  select * into r from public.store_lists where id = p_id;
  if not found then raise exception 'not found'; end if;
  if r.kind = 'category' then
    select count(*) into n from public.items where category = r.value;
    if n > 0 then raise exception 'in use by % item(s)', n; end if;
  elsif r.kind = 'unit' then
    select count(*) into n from public.items where unit = r.value;
    if n > 0 then raise exception 'in use by % item(s)', n; end if;
  end if;
  delete from public.store_lists where id = p_id;
end $$;

grant execute on function
  public.add_list_value(text, text), public.delete_list_value(uuid)
to authenticated;

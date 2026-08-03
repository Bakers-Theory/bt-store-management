-- ============================================================================
-- BT Store Management — editing the cashbook category tree (0058)
--
--   1. THE PERSON FILING THE SPEND OWNS THE TREE. 0044 gated the category RPCs
--      on store.lists, which a Cashier does not hold — yet a Cashier records
--      expenses, and a category that does not exist yet blocks them at the till.
--      The gate widens to expense.create. store.lists is kept as an alternative
--      so a custom role holding it alone loses nothing it has today.
--   2. RENAME IS SAFE. Entries reference category_id, and cash_entry_v (0045)
--      and expense_v (0051) both derive category_name/category_path at READ
--      time, so a rename relabels history correctly and instantly.
--   3. REPARENTING AND RE-DIRECTING ARE NOT SAFE, and are deliberately absent.
--      Moving a leaf between groups or flipping its direction rewrites what
--      every past report means.
--   4. SYSTEM CATEGORIES CANNOT BE RENAMED. system_category() in 0045 resolves
--      them BY NAME (`where is_system and name = p_name`), so a rename would
--      break auto-posting outright — not merely confuse a report.
--   5. ARCHIVED, NEVER DELETED — unchanged from 0044. cash_entry_v and
--      expense_v join the BASE TABLE, not the archived_at-filtered
--      cash_category_v, so an archived category keeps labelling its history.
--      Only the picker hides it.
-- ============================================================================

-- ─── Rename ─────────────────────────────────────────────────────────────────
create or replace function public.rename_cash_category(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.cash_category;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not (public.has_perm('expense.create') or public.has_perm('store.lists')) then
    raise exception 'forbidden';
  end if;

  select * into v from public.cash_category where id = p_id;
  if not found then raise exception 'category not found'; end if;
  if v.archived_at is not null then raise exception 'that category was removed'; end if;
  if v.is_system then
    raise exception '"%" is built in and cannot be renamed', v.name;
  end if;
  if v_name = '' then raise exception 'a category needs a name'; end if;
  if v_name = v.name then return; end if;

  begin
    update public.cash_category set name = v_name where id = p_id;
  exception when unique_violation then
    raise exception 'another category is already called "%"', v_name;
  end;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('cashbook', auth.uid(), v_name,
            format('Renamed the cashbook category "%s"', v.name));
end $$;

grant execute on function public.rename_cash_category(uuid, text) to authenticated;

-- ─── Widened gate: add ──────────────────────────────────────────────────────
-- Byte-identical to 0044 apart from the permission check. Repeated in full
-- because create or replace has no way to patch a body.
create or replace function public.add_cash_category(
  p_parent_id uuid, p_name text, p_direction text
)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_next int;
begin
  if not (public.has_perm('expense.create') or public.has_perm('store.lists')) then
    raise exception 'forbidden';
  end if;
  if v_name = '' then raise exception 'a category needs a name'; end if;
  if p_direction not in ('in','out','both') then
    raise exception 'a category must be income, expense or both';
  end if;
  if p_parent_id is not null then
    if not exists (select 1 from public.cash_category
                    where id = p_parent_id and archived_at is null) then
      raise exception 'that category group no longer exists';
    end if;
    if exists (select 1 from public.cash_entry where category_id = p_parent_id) then
      raise exception
        'entries are already filed under "%" — it cannot become a group',
        (select name from public.cash_category where id = p_parent_id);
    end if;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next
  from public.cash_category
  where parent_id is not distinct from p_parent_id;

  insert into public.cash_category (parent_id, name, direction, sort_order)
    values (p_parent_id, v_name, p_direction, v_next);

  insert into public.activity_log (type, actor, item_name, notes)
    values ('cashbook', auth.uid(), v_name, 'Added a cashbook category');
end $$;

-- ─── Widened gate: archive ──────────────────────────────────────────────────
create or replace function public.archive_cash_category(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.cash_category;
begin
  if not (public.has_perm('expense.create') or public.has_perm('store.lists')) then
    raise exception 'forbidden';
  end if;
  select * into v from public.cash_category where id = p_id;
  if not found then raise exception 'category not found'; end if;
  if v.is_system then
    raise exception '"%" is built in and cannot be removed', v.name;
  end if;
  if v.archived_at is not null then raise exception 'already archived'; end if;
  if exists (select 1 from public.cash_category
              where parent_id = p_id and archived_at is null) then
    raise exception 'remove the categories inside "%" first', v.name;
  end if;

  update public.cash_category set archived_at = now() where id = p_id;

  insert into public.activity_log (type, actor, item_name, notes)
    values ('cashbook', auth.uid(), v.name, 'Archived a cashbook category');
end $$;
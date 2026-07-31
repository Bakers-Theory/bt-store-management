-- ============================================================================
-- BT Store Management — the cash ledger (Phase A)
--
--   1. ONE INSERT PATH. `post_cash` is the only place a cash_entry is written.
--      It owns the mode→account map, the leaf check and the no-future-date
--      rule, so those cannot drift between the ten call sites.
--   2. CORRECTIONS ARE REVERSALS, NOT EDITS. An auto-posted row is immutable;
--      cancelling its source writes an opposite row pointing back at it. Two
--      triggers enforce that rather than trusting each RPC to remember.
--   3. NOTHING IS EVER HARD-DELETED. Removal is `deleted_at`, per #32.
--   4. `assert_cash_day_open` AND `reversal_date` ARE STUBS HERE. Phase B adds
--      `cash_day` and fills in their bodies. They exist now, at their final
--      signatures, so every call site in 0047/0048 is written once and never
--      touched again.
--   5. THE NO-FUTURE-DATE RULE IS AN RPC CHECK, NOT A CHECK CONSTRAINT. A CHECK
--      containing a date function is not re-validated and cannot call the
--      non-immutable store_today(). Same approach as record_supplier_payment
--      (0038:33) and approve_advance (0032:325).
-- ============================================================================

-- ─── The ledger ─────────────────────────────────────────────────────────────
create table if not exists public.cash_entry (
  id            uuid primary key default gen_random_uuid(),
  on_date       date not null,
  account       text not null check (account in ('cash','bank')),
  direction     text not null check (direction in ('in','out')),
  amount        numeric(12,2) not null check (amount > 0),
  payment_mode  text not null
                  check (payment_mode in ('Cash','UPI','Bank Transfer','Cheque')),
  category_id   uuid not null references public.cash_category(id),
  source_type   text not null
                  check (source_type in ('bill','expense','salary','advance',
                                         'supplier_payment','manual','transfer',
                                         'opening')),
  -- Not a FK: sources live in five different tables, and delete_bill hard-
  -- deletes its bill while the ledger row must survive as history.
  source_id     uuid,
  reverses_id   uuid references public.cash_entry(id),
  transfer_id   uuid,
  reference_no  text not null default '',
  note          text not null default '',
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),

  -- A manual entry must say why the money moved. That is the whole point of it.
  constraint cash_entry_manual_needs_note
    check (source_type <> 'manual' or btrim(note) <> ''),
  -- A reversal always names what it reverses, and only a reversal may.
  constraint cash_entry_reversal_has_source
    check (reverses_id is null or source_type <> 'opening')
);

create index if not exists cash_entry_date_idx
  on public.cash_entry (on_date desc, created_at desc) where deleted_at is null;
create index if not exists cash_entry_account_idx
  on public.cash_entry (account, on_date) where deleted_at is null;
create index if not exists cash_entry_source_idx
  on public.cash_entry (source_type, source_id);
create index if not exists cash_entry_reverses_idx
  on public.cash_entry (reverses_id) where reverses_id is not null;
create index if not exists cash_entry_transfer_idx
  on public.cash_entry (transfer_id) where transfer_id is not null;

-- Makes the 0046 backfill re-runnable. `reverses_id is null` is load-bearing:
-- a reversal shares its original's source_type, source_id AND account, so
-- without that clause every reversal would collide. `account` is in the key
-- because one Mixed expense (phase C) legitimately posts one row per account.
create unique index if not exists cash_entry_source_uniq
  on public.cash_entry (source_type, source_id, account)
  where source_id is not null and reverses_id is null and deleted_at is null;

alter table public.cash_entry enable row level security;
drop policy if exists cash_entry_read on public.cash_entry;
create policy cash_entry_read on public.cash_entry for select
  using (public.has_perm('cashbook.view'));

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- The single mode→account map. Returns NULL for an unknown mode, which
-- post_cash turns into a readable error.
create or replace function public.mode_to_account(p_mode text)
returns text language sql immutable set search_path = public as $$
  select case p_mode
           when 'Cash'          then 'cash'
           when 'UPI'           then 'bank'
           when 'Bank Transfer' then 'bank'
           when 'Cheque'        then 'bank'
         end
$$;

create or replace function public.system_category(p_name text)
returns uuid language plpgsql stable set search_path = public as $$
declare v uuid;
begin
  select id into v from public.cash_category
   where is_system and name = p_name;
  if v is null then raise exception 'missing system category "%"', p_name; end if;
  return v;
end $$;

create or replace function public.is_leaf_category(p_id uuid)
returns boolean language sql stable set search_path = public as $$
  select not exists (
    select 1 from public.cash_category
     where parent_id = p_id and archived_at is null
  )
$$;

-- Phase B replaces this body with the cash_day lookup. Until then no day can be
-- closed, so it passes.
create or replace function public.assert_cash_day_open(p_date date)
returns void language plpgsql stable set search_path = public as $$
begin
  return; -- phase B: raise if cash_day(p_date).status = 'closed'
end $$;

-- Where a reversal lands. Phase B: the original date if that day is open, else
-- today — and an error if today is closed too, because decision 5 admits no
-- exception. Until then every day is open, so the original date always wins.
create or replace function public.reversal_date(p_orig_date date)
returns date language plpgsql stable set search_path = public as $$
begin
  return p_orig_date;
end $$;

revoke execute on function public.mode_to_account(text) from public;
revoke execute on function public.system_category(text) from public;
revoke execute on function public.is_leaf_category(uuid) from public;
revoke execute on function public.assert_cash_day_open(date) from public;
revoke execute on function public.reversal_date(date) from public;
grant execute on function public.mode_to_account(text) to authenticated;
grant execute on function public.is_leaf_category(uuid) to authenticated;

-- ─── post_cash: the only insert path ────────────────────────────────────────
create or replace function public.post_cash(
  p_on_date     date,
  p_direction   text,
  p_amount      numeric,
  p_mode        text,
  p_category_id uuid,
  p_source_type text,
  p_source_id   uuid,
  p_note        text default '',
  p_reference_no text default '',
  p_reverses_id uuid default null,
  p_transfer_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_account text; v_amount numeric := round(coalesce(p_amount, 0), 2); v_id uuid;
begin
  if v_amount <= 0 then
    raise exception 'an amount must be more than zero';
  end if;
  if p_direction not in ('in','out') then
    raise exception 'a posting must be money in or money out';
  end if;
  if p_on_date is null then raise exception 'a posting needs a date'; end if;
  if p_on_date > public.store_today() then
    raise exception 'a cash book date cannot be in the future';
  end if;

  v_account := public.mode_to_account(p_mode);
  if v_account is null then raise exception 'unknown payment mode "%"', p_mode; end if;

  if p_category_id is null then raise exception 'a posting needs a category'; end if;
  if not exists (select 1 from public.cash_category where id = p_category_id) then
    raise exception 'category not found';
  end if;
  -- Postings file against a leaf. A group is a heading, not a bucket.
  if not public.is_leaf_category(p_category_id) then
    raise exception '"%" is a category group — choose one of the categories inside it',
      (select name from public.cash_category where id = p_category_id);
  end if;

  perform public.assert_cash_day_open(p_on_date);

  insert into public.cash_entry (
    on_date, account, direction, amount, payment_mode, category_id,
    source_type, source_id, reverses_id, transfer_id, reference_no, note, created_by
  ) values (
    p_on_date, v_account, p_direction, v_amount, p_mode, p_category_id,
    p_source_type, p_source_id, p_reverses_id, p_transfer_id,
    btrim(coalesce(p_reference_no, '')), btrim(coalesce(p_note, '')), auth.uid()
  ) returning id into v_id;

  return v_id;
end $$;

-- Internal only. Every caller is a definer function in this schema.
revoke execute on function public.post_cash(
  date, text, numeric, text, uuid, text, uuid, text, text, uuid, uuid) from public;

-- ─── reverse_cash: the correction path ──────────────────────────────────────
create or replace function public.reverse_cash(
  p_source_type text, p_source_id uuid, p_reason text
)
returns int language plpgsql security definer set search_path = public as $$
declare e public.cash_entry; v_cat uuid; v_n int := 0; v_note text;
begin
  if p_source_id is null then return 0; end if;

  -- A bill's reversal is a Sales Reversal; money going back out to anyone else
  -- is a Refund. Both are system categories, so neither can be archived away.
  v_cat := public.system_category(
    case when p_source_type = 'bill' then 'Sales Reversal' else 'Refund' end);

  for e in
    select * from public.cash_entry c
     where c.source_type = p_source_type
       and c.source_id = p_source_id
       and c.reverses_id is null
       and c.deleted_at is null
       -- Idempotent: an entry already reversed is skipped, so a double-cancel
       -- cannot double-reverse.
       and not exists (select 1 from public.cash_entry r
                        where r.reverses_id = c.id and r.deleted_at is null)
     order by c.created_at
     for update
  loop
    v_note := 'Reversal of ' || p_source_type || ' dated ' || e.on_date::text
              || case when btrim(coalesce(p_reason,'')) <> ''
                      then ' — ' || btrim(p_reason) else '' end;

    perform public.post_cash(
      public.reversal_date(e.on_date),
      case when e.direction = 'in' then 'out' else 'in' end,
      e.amount, e.payment_mode, v_cat,
      e.source_type, e.source_id, v_note, e.reference_no, e.id, null);

    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

revoke execute on function public.reverse_cash(text, uuid, text) from public;

-- ─── Immutability ───────────────────────────────────────────────────────────
create or replace function public.cash_entry_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- #32: deleted records are soft-deleted. There is no hard-delete path.
    raise exception 'a cash book entry is never deleted — it is removed with a reason';
  end if;

  -- Phase B inserts the closed-day check here.

  -- An auto-posted row mirrors a document. Change the document; the change
  -- writes a reversal.
  if old.source_type <> 'manual' then
    raise exception
      'this entry came from a % and cannot be edited here — change the % itself',
      old.source_type, old.source_type;
  end if;

  -- Belt and braces: a row someone has already reversed is frozen in the ways
  -- that would make the reversal wrong.
  if exists (select 1 from public.cash_entry r
              where r.reverses_id = old.id and r.deleted_at is null)
     and (new.amount <> old.amount
          or new.account <> old.account
          or new.direction <> old.direction
          or new.on_date <> old.on_date
          or new.source_type <> old.source_type) then
    raise exception 'this entry has already been reversed and cannot be changed';
  end if;

  return new;
end $$;

drop trigger if exists cash_entry_immutable on public.cash_entry;
create trigger cash_entry_immutable
  before update or delete on public.cash_entry
  for each row execute function public.cash_entry_guard();

-- ─── Read surface ───────────────────────────────────────────────────────────
create or replace view public.cash_entry_v as
select
  e.id, e.on_date, e.created_at, e.account, e.direction, e.amount,
  e.payment_mode, e.category_id,
  c.name as category_name,
  coalesce(pc.name, '') as category_group,
  case when pc.name is null then c.name else pc.name || ' › ' || c.name end
    as category_path,
  e.source_type, e.source_id, e.reverses_id, e.transfer_id,
  e.reference_no, e.note,
  -- The id as well as the name: two staff can share a name, and "did I record
  -- this?" is what decides whether an edit button renders.
  e.created_by,
  coalesce(p.name, '') as created_by_name,
  -- #32's Status column, derived. A posting either happened or it didn't.
  case
    when e.reverses_id is not null then 'reversal'
    when exists (select 1 from public.cash_entry r
                  where r.reverses_id = e.id and r.deleted_at is null) then 'reversed'
    else 'posted'
  end as status,
  -- The human handle of whatever produced this row, so the ledger is readable
  -- without ten joins in the client.
  coalesce(case e.source_type
    when 'bill' then
      (select '#' || b.bill_no::text from public.bills b where b.id = e.source_id)
    when 'salary' then
      (select pr.name from public.salary_payment sp
        join public.profiles pr on pr.id = sp.profile_id where sp.id = e.source_id)
    when 'advance' then
      (select pr.name from public.staff_advance a
        join public.profiles pr on pr.id = a.profile_id where a.id = e.source_id)
    when 'supplier_payment' then
      (select s.name from public.supplier_payment sp
        join public.suppliers s on s.id = sp.supplier_id where sp.id = e.source_id)
  end, '') as source_ref,
  sum(case when e.direction = 'in' then e.amount else -e.amount end)
    over (partition by e.account order by e.on_date, e.created_at, e.id)
    as running_balance
from public.cash_entry e
join public.cash_category c on c.id = e.category_id
left join public.cash_category pc on pc.id = c.parent_id
left join public.profiles p on p.id = e.created_by
where e.deleted_at is null
  and public.has_perm('cashbook.view');

grant select on public.cash_entry_v to authenticated;

-- ─── Tiles ──────────────────────────────────────────────────────────────────
-- An RPC, not a view: a view would need `current_date`, which is the SERVER's
-- UTC date. The client passes its own local dates, as dashboard_stats does.
--
-- TWO KINDS OF FIGURE, deliberately:
--   * BALANCES are point-in-time and ignore the range. "Cash in hand" is what is
--     physically in the drawer right now (#32: "live running balance"); it must
--     not become a historical closing figure because someone filtered to July.
--   * PERIOD figures follow the caller's range, so the tiles and the transaction
--     list below them always describe the same slice of time.
--
-- A null bound means unbounded on that side, matching every other range filter
-- in the app.
drop function if exists public.cashbook_summary(date);

create or replace function public.cashbook_summary(
  p_from date default null, p_to date default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.has_perm('cashbook.view') then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    -- Live, whatever the range.
    'cashBalance', coalesce(sum(case when account = 'cash'
      then case when direction = 'in' then amount else -amount end end), 0),
    'bankBalance', coalesce(sum(case when account = 'bank'
      then case when direction = 'in' then amount else -amount end end), 0),
    -- Range-scoped. `in_range` is computed once per row below.
    'periodSales', coalesce(sum(case when in_range and direction = 'in'
      and source_type = 'bill' and reverses_id is null then amount end), 0),
    'periodExpenses', coalesce(sum(case when in_range and direction = 'out'
      and source_type <> 'transfer' then amount end), 0),
    'periodCashIn', coalesce(sum(case when in_range and account = 'cash'
      and direction = 'in' then amount end), 0),
    'periodCashOut', coalesce(sum(case when in_range and account = 'cash'
      and direction = 'out' then amount end), 0)
  ) into v
  from (
    select account, direction, amount, source_type, reverses_id,
           (p_from is null or on_date >= p_from)
             and (p_to is null or on_date <= p_to) as in_range
    from public.cash_entry
    where deleted_at is null
  ) e;

  return v;
end $$;

grant execute on function public.cashbook_summary(date, date) to authenticated;

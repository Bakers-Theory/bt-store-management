-- ============================================================================
-- BT Store Management — a deterministic order for the ledger
--
--   Two entries written by the same RPC share a `created_at`: the default is
--   now(), which is the TRANSACTION timestamp, not the statement's. A bill
--   with a shortfall posts exactly that pair — Sales in, Payment Shortfall
--   out — so the running balance broke the tie on `id`, a random uuid, and
--   half the time showed the loss applied before the sale that caused it
--   (#1289: ₹414.7 above ₹525.7). The list query had the same tie, which also
--   makes its keyset pagination unstable.
--
--   `seq` is the insertion order, assigned by a sequence, and becomes the last
--   tiebreaker everywhere the ledger is ordered. `created_at` still leads, so
--   nothing about how existing rows sort changes — only ties are resolved.
-- ============================================================================

alter table public.cash_entry add column if not exists seq bigint;

create sequence if not exists public.cash_entry_seq owned by public.cash_entry.seq;

-- Existing rows keep the order they are displayed in today. The guard trigger
-- rejects any update to an auto-posted row, so it stands down for the backfill.
alter table public.cash_entry disable trigger cash_entry_immutable;
update public.cash_entry e
   set seq = t.n
  from (select id, row_number() over (order by on_date, created_at, id) as n
          from public.cash_entry) t
 where t.id = e.id and e.seq is null;
alter table public.cash_entry enable trigger cash_entry_immutable;

select setval('public.cash_entry_seq',
              coalesce((select max(seq) from public.cash_entry), 0) + 1, false);

alter table public.cash_entry
  alter column seq set default nextval('public.cash_entry_seq'),
  alter column seq set not null;

-- The list reads on_date desc, created_at desc, seq desc.
drop index if exists cash_entry_date_idx;
create index if not exists cash_entry_date_idx
  on public.cash_entry (on_date desc, created_at desc, seq desc)
  where deleted_at is null;

-- ─── cash_entry_v: reproduced from 0045, with `seq` and the new tiebreaker ──
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
  e.created_by,
  coalesce(p.name, '') as created_by_name,
  case
    when e.reverses_id is not null then 'reversal'
    when exists (select 1 from public.cash_entry r
                  where r.reverses_id = e.id and r.deleted_at is null) then 'reversed'
    else 'posted'
  end as status,
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
    over (partition by e.account order by e.on_date, e.created_at, e.seq)
    as running_balance,
  e.seq
from public.cash_entry e
join public.cash_category c on c.id = e.category_id
left join public.cash_category pc on pc.id = c.parent_id
left join public.profiles p on p.id = e.created_by
where e.deleted_at is null
  and public.has_perm('cashbook.view');

grant select on public.cash_entry_v to authenticated;

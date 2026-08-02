-- ============================================================================
-- BT Store Management — let one source post both ways
--
--   0055 made a short-paid bill post TWICE against the same bill: the gross
--   sale in, and the shortfall straight back out. cash_entry_source_uniq (0045)
--   keyed on (source_type, source_id, account), and both rows share all three —
--   one bill, one payment mode, therefore one account — so the second posting
--   raised `duplicate key value violates unique constraint` and rolled the whole
--   checkout back. Every short-paid bill failed.
--
--   1. DIRECTION JOINS THE KEY. A source may post at most one `in` and one
--      `out` per account. That is exactly the shape 0055 needs, and it still
--      catches the thing the index was built to catch — the same posting
--      written twice.
--   2. THE 0046 BACKFILL STAYS RE-RUNNABLE. Every insert there emits a
--      constant direction per source type ('in' for bills, 'out' for salary,
--      advances and supplier payments), so a re-run produces the same tuple and
--      still conflicts into `do nothing`.
--   3. MIXED EXPENSES ARE UNAFFECTED. Their two rows (0052) differ by account
--      and share a direction, so they were already distinct and remain so.
--   4. REVERSALS WERE NEVER IN SCOPE. The partial index excludes them
--      (`reverses_id is null`), which is what lets a reversal share its
--      original's source and account.
-- ============================================================================

drop index if exists public.cash_entry_source_uniq;

create unique index if not exists cash_entry_source_uniq
  on public.cash_entry (source_type, source_id, account, direction)
  where source_id is not null and reverses_id is null and deleted_at is null;

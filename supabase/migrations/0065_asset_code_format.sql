-- ============================================================================
-- BT Store Management — asset codes become `BT-AST-001`
--
-- 0060 shipped `AST-0001`, following suppliers' `SUP-0001`. An asset label leaves
-- the building ON the asset, so the code should say whose it is without anyone
-- having to ask — hence the store prefix.
--
--   1. A NEW MIGRATION, NOT AN EDIT TO 0060. 0060 is applied, and its
--      `create table if not exists` would skip on a re-run, so the column default
--      would never change. The default is altered here instead.
--   2. EXISTING CODES ARE REWRITTEN, KEEPING THEIR NUMBER. `AST-0007` becomes
--      `BT-AST-007`. Two mixed formats in one register is worse than either, and
--      `code` is quoted by people, not joined on — nothing references it as a
--      foreign key, and the audit trail records the change.
--      ⚠️ If a physical label has already been printed and stuck on an asset,
--      SKIP the update block below: the sticker becomes wrong the moment the row
--      changes. Nothing else in this file touches data.
--   3. lpad ONLY PADS. Asset 1000 reads `BT-AST-1000` rather than being
--      truncated — a code must never collide, and a shorter one is not worth a
--      duplicate.
-- ============================================================================

alter table public.asset
  alter column code set default
    'BT-AST-' || lpad(nextval('asset_code_seq')::text, 3, '0');

-- ─── Bring existing rows onto the new format (note 2) ───────────────────────
-- Idempotent: only rows still on the old prefix are touched, so re-running this
-- file does nothing the second time.
do $rc$
declare v_n int;
begin
  update public.asset
     set code = 'BT-AST-' || lpad(ltrim(substring(code from 5), '0'), 3, '0')
   where code like 'AST-%'
     -- Guard against a collision with a code someone has already typed by hand.
     and not exists (
       select 1 from public.asset other
        where other.code = 'BT-AST-' || lpad(ltrim(substring(public.asset.code from 5), '0'), 3, '0')
     );

  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.activity_log (type, actor, notes)
      values ('asset', null,
              'Renamed ' || v_n::text || ' asset code(s) to the BT-AST-000 format');
    raise notice 'renamed % asset codes', v_n;
  end if;
end $rc$;

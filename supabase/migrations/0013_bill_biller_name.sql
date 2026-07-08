-- ============================================================================
-- BT Store Management — biller name on the bill
-- Every bill already records WHO generated it via `bills.created_by` (auth.uid()
-- at insert time). Staff can't read other users' profiles directly (profiles
-- RLS), so expose the biller's name through a SECURITY DEFINER view that joins
-- profiles on created_by — the same pattern as activity_log_v. No new column;
-- the name is resolved from the existing created_by uuid.
-- Visibility is gated on the same permission as the bills_read policy.
-- ============================================================================

create or replace view public.bills_v as
  select
    b.*,
    p.name as biller_name
  from public.bills b
  left join public.profiles p on p.id = b.created_by
  where public.has_perm('sales') or public.has_perm('inventory');

grant select on public.bills_v to authenticated;

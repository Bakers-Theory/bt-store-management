-- ============================================================================
-- 0003 — Expose the activity-log actor's name to the client.
-- The `actor` uuid is already recorded by every RPC (auth.uid()), but staff
-- can't read other profiles directly (profiles RLS). Read the log through this
-- SECURITY DEFINER view so it can resolve actor_name for everyone, while still
-- gating visibility on the same permission as the log_read policy.
-- ============================================================================

create or replace view public.activity_log_v as
  select
    l.id, l.type, l.created_at,
    l.item_id, l.item_name, l.qty, l.supplier, l.reason, l.notes,
    l.bill_no, l.items, l.total,
    p.name as actor_name
  from public.activity_log l
  left join public.profiles p on p.id = l.actor
  where public.has_perm('sales') or public.has_perm('inventory');

grant select on public.activity_log_v to authenticated;

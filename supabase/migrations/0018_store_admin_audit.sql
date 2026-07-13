-- ============================================================================
-- BT Store Management — Store & staff audit trail
-- Records administrative events (store settings, staff management, password
-- changes) in the activity log, and exposes an Owner-only view for the History
-- "Store" tab. Store open/close (0017) already logs; this adds the rest.
-- ============================================================================

-- ─── Audit log: allow the new administrative entry types ────────────────────
alter table public.activity_log drop constraint if exists activity_log_type_check;
alter table public.activity_log add constraint activity_log_type_check
  check (type in ('in','out','bill','cancel','delete','open','close',
                  'settings','staff_add','staff_edit','staff_remove','password'));

-- ─── save_settings: log a 'settings' entry on every store-profile update ────
-- Full redefinition of the current (0014) body with one audit insert appended.
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
    low_stock_alert = coalesce((p->>'lowStockAlert')::numeric,5),
    expiring_soon_days = coalesce((p->>'expiringSoonDays')::integer,3)
  where id = 1;
  insert into public.activity_log (type, actor, notes)
    values ('settings', auth.uid(), 'Updated store settings');
end $$;

-- ─── log_password_change: record a user changing their OWN password ─────────
-- Called from the client after a successful supabase.auth.updateUser({password}).
-- Clients cannot write the activity log directly (no INSERT policy), so this
-- SECURITY DEFINER RPC records the event with the caller as the actor.
create or replace function public.log_password_change()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  insert into public.activity_log (type, actor, notes)
    values ('password', auth.uid(), 'Changed own password');
end $$;

grant execute on function public.log_password_change() to authenticated;

-- ─── activity_log_admin_v: Owner-only view of administrative events ─────────
-- Same column shape as activity_log_v so the client maps it with mapLog. Gated
-- on is_owner() (non-owners get zero rows) and scoped to the admin event types
-- so the History "Store" tab shows only store/staff activity.
create or replace view public.activity_log_admin_v as
  select
    l.id, l.type, l.created_at,
    l.item_id, l.item_name, l.qty, l.supplier, l.reason, l.notes,
    l.bill_no, l.items, l.total,
    p.name as actor_name
  from public.activity_log l
  left join public.profiles p on p.id = l.actor
  where public.is_owner()
    and l.type in ('open','close','settings','staff_add','staff_edit','staff_remove','password');

grant select on public.activity_log_admin_v to authenticated;

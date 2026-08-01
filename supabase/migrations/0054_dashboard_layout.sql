-- Per-user customizable dashboard widget layout (order, width, visible/
-- dismissed sets). See:
-- docs/superpowers/specs/2026-08-01-dashboard-customizable-layout-design.md

alter table public.profiles add column if not exists dashboard_layout jsonb;

-- profiles is Owner-write-only (0001_init.sql: profiles_owner_write) — a
-- plain user can never update their own row directly. This function is the
-- one narrow exception: security definer, and it can only ever touch
-- dashboard_layout, and only on the caller's own row (auth.uid()).
create or replace function public.set_dashboard_layout(p_layout jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_layout is null then
    raise exception 'layout required';
  end if;
  if not (p_layout ? 'visible' and p_layout ? 'dismissed') then
    raise exception 'layout must have visible and dismissed arrays';
  end if;
  if jsonb_typeof(p_layout->'visible') <> 'array'
     or jsonb_typeof(p_layout->'dismissed') <> 'array' then
    raise exception 'visible and dismissed must be arrays';
  end if;

  update public.profiles
    set dashboard_layout = p_layout
    where id = auth.uid();

  if not found then
    raise exception 'profile not found';
  end if;
end $$;

grant execute on function public.set_dashboard_layout(jsonb) to authenticated;
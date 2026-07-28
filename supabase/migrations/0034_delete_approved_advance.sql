-- ============================================================================
-- BT Store Management — deleting a decided advance
--
-- 0032 let only a PENDING request be deleted: an approved advance is money that
-- moved, so it stayed for audit. The owner wants a way out of a mistaken
-- approval — a wrong amount, or an advance recorded against the wrong person —
-- without hand-editing the table.
--
-- The escape hatch is its own key, `advance.delete`, not a widening of
-- `advance.approve`. Approving is routine; erasing a disbursement is not, and
-- the two want different holders. Like the rest of `advance.*` it sits in no
-- preset, so it is Owner-only until deliberately delegated.
--
-- THE ONE GUARD: an advance that has already been recovered from a payroll
-- record cannot be deleted. The balance is computed as
-- sum(approved) − sum(recoveries) (0032, note 2), so removing an advance whose
-- money has been recovered would push the balance below zero — the store would
-- appear to owe the employee. Recoveries are not linked to a particular
-- advance, so the check is on the total: whatever remains after this deletion
-- must still cover every recovery taken. Reverse the recovery on the Payroll
-- tab first, then delete.
--
-- Rejected requests fall on the same side as approved ones here: they are a
-- decision on record, so removing one needs the same key.
-- ============================================================================

create or replace function public.delete_advance(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_status text; v_amount numeric; v_profile uuid; v_bal numeric;
begin
  select p.name, a.status, a.amount, a.profile_id
    into v_name, v_status, v_amount, v_profile
  from public.staff_advance a join public.profiles p on p.id = a.profile_id
  where a.id = p_id;
  if not found then raise exception 'advance not found'; end if;

  if v_status = 'pending' then
    -- Unchanged from 0032: withdrawing a request you could have approved.
    if not public.has_perm('advance.approve') then raise exception 'forbidden'; end if;
  else
    if not public.has_perm('advance.delete') then raise exception 'forbidden'; end if;
  end if;

  -- Only an approved advance is inside the balance, so only it can strand a
  -- recovery. advance_balance_of is the same definition payroll uses.
  if v_status = 'approved' then
    v_bal := public.advance_balance_of(v_profile);
    if round(v_bal - v_amount, 2) < 0 then
      raise exception
        'this advance has already been recovered from salary — clear the recovery on the Payroll tab first';
    end if;
  end if;

  delete from public.staff_advance where id = p_id;

  insert into public.activity_log (type, actor, item_name, total, notes)
    values ('advance', auth.uid(), v_name, v_amount,
            case v_status
              when 'pending'  then 'Removed a pending advance request'
              when 'approved' then 'Deleted an approved advance of ' || v_amount::text
              else 'Deleted a rejected advance request'
            end);
end $$;
grant execute on function public.delete_advance(uuid) to authenticated;

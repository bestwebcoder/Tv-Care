-- set_primary_branch could never actually move the primary flag.
--
-- 20260922000100_branch_management.sql tried to swap it in a single UPDATE
-- statement, reasoning that two statements leave a crash-sized window with no
-- primary branch. But branches_one_primary_per_organization is a plain partial
-- unique index, not a deferrable constraint, so Postgres checks it row by row
-- within the statement: the moment the new branch is set to is_primary = true,
-- the old one is still true too, and the statement aborts with
--   duplicate key value violates unique constraint
--     "branches_one_primary_per_organization"
-- Every "Make primary" click hit this and surfaced the generic failure toast.
--
-- The window the original was worried about does not exist: a function body is
-- one transaction, so demoting the old primary and promoting the new one in
-- two ordered statements either both commit or both roll back. Do exactly that,
-- old one first so the index is never asked to hold two.

create or replace function public.set_primary_branch(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select organization_id into v_organization_id
  from public.branches
  where id = p_branch_id and deleted_at is null;

  if v_organization_id is null then
    raise exception 'That branch could not be found.';
  end if;

  -- Authorization is the caller's, not this function's: security definer would
  -- otherwise let anyone who can execute it repoint another practice's branches.
  if not ((select public.is_super_admin()) or public.is_admin(v_organization_id)) then
    raise exception 'You do not have access to manage this practice''s branches.';
  end if;

  -- Clear the outgoing primary before setting the new one, so the partial
  -- unique index never sees two primaries at once. Both statements run in this
  -- function's transaction: a failure between them rolls back the first.
  update public.branches
     set is_primary = false
   where organization_id = v_organization_id
     and deleted_at is null
     and is_primary
     and id <> p_branch_id;

  update public.branches
     set is_primary = true
   where id = p_branch_id
     and not is_primary;
end;
$$;

revoke all on function public.set_primary_branch(uuid) from public, anon;
grant execute on function public.set_primary_branch(uuid) to authenticated, service_role;

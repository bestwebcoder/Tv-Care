-- ---------------------------------------------------------------------------
-- Prune the user roster to Shirin Akter and the doctors.
--
-- Read scripts/prune-clients.sql first for the general warning; this one adds
-- three things specific to accounts.
--
-- 1. A user is not a record, it is a person's way in. public.users and
--    auth.users have no foreign key between them — they are kept in step by
--    the profile trigger — so deleting one and not the other leaves either a
--    login with no profile or a profile with no login. Both halves go here.
--
-- 2. audit_logs.actor_user_id is ON DELETE RESTRICT and audit_logs refuses
--    DELETE from everyone, service role included (20260820000200). Anyone who
--    has ever acted in the application therefore CANNOT be deleted, by design
--    and permanently. On a seeded database nobody has, because the seed writes
--    as the service role with a null actor, so this script gets away with it.
--    On a database with real use it will not: expect this to refuse, and
--    expect that to be correct.
--
-- 3. clients.user_id is RESTRICT but nullable. A client whose login is deleted
--    is detached rather than removed — the client record, its pets and its
--    whole history survive, and it becomes a walk-in record that clinic staff
--    maintain on the client's behalf. That is a deliberate downgrade: those
--    people lose portal access. It is not reversible by re-creating the
--    account, because a new account is a new id.
--
-- Usage — dry run (default: reports, then rolls back):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/prune-users.sql
--
-- Usage — commit:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v apply=1 -f scripts/prune-users.sql
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

begin;

-- ---------------------------------------------------------------------------
-- Who stays: the named administrator, and every account still attached to a
-- doctors row. "Still attached" is the operative half — an account whose
-- doctor profile has already been removed is not a doctor any more.
-- ---------------------------------------------------------------------------

create temporary table users_to_keep on commit drop as
  select u.id, u.full_name, u.email
  from public.users u
  where u.full_name = 'Shirin Akter'
     or exists (select 1 from public.doctors d where d.user_id = u.id);

create temporary table users_to_drop on commit drop as
  select u.id, u.full_name, u.email
  from public.users u
  where u.id not in (select id from users_to_keep);

do $$
declare
  v_keep integer;
  v_admin integer;
begin
  select count(*) into v_keep from users_to_keep;
  select count(*) into v_admin from users_to_keep where full_name = 'Shirin Akter';

  if v_keep = 0 then
    raise exception 'The keep set is empty. Refusing to delete every account.';
  end if;

  -- Losing the only administrator would lock the practice out of its own
  -- admin area, and no policy here can grant it back.
  if v_admin = 0 then
    raise exception 'Shirin Akter was not found. Refusing to run without a surviving administrator.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Anything the deletion would hit that is not an account. Reported first: a
-- non-zero count in the last two rows is a person losing access, not
-- bookkeeping.
-- ---------------------------------------------------------------------------

select 'users kept'    as item, count(*) from users_to_keep
union all select 'users deleted',       count(*) from users_to_drop
union all select 'user_roles removed',  count(*) from public.user_roles where user_id in (select id from users_to_drop)
union all select 'staff rows removed',  count(*) from public.staff where user_id in (select id from users_to_drop)
union all select 'notifications removed', count(*) from public.notifications where recipient_user_id in (select id from users_to_drop)
union all select 'clients detached from their login', count(*) from public.clients where user_id in (select id from users_to_drop)
order by 1;

-- The wall this script cannot climb. Zero on a seeded database; not zero on a
-- used one, and then the delete below fails rather than corrupting the trail.
select count(*) as users_blocked_by_audit_trail
from users_to_drop d
where exists (select 1 from public.audit_logs al where al.actor_user_id = d.id);

-- ---------------------------------------------------------------------------
-- Detach the clients first. Their records are staying; only the way in goes.
-- ---------------------------------------------------------------------------

update public.clients
   set user_id = null
 where user_id in (select id from users_to_drop);

-- ---------------------------------------------------------------------------
-- Clear what points at the accounts. notifications.recipient_user_id is NOT
-- NULL, so a reminder addressed to a deleted account cannot be kept.
-- ---------------------------------------------------------------------------

delete from public.notification_logs
 where notification_id in (
   select id from public.notifications where recipient_user_id in (select id from users_to_drop)
 );

delete from public.notifications where recipient_user_id in (select id from users_to_drop);

-- CASCADE would take these anyway; doing it explicitly keeps the order
-- readable and the row counts visible.
delete from public.push_subscriptions      where user_id in (select id from users_to_drop);
delete from public.notification_preferences where user_id in (select id from users_to_drop);

delete from public.staff where user_id in (select id from users_to_drop);

-- A surviving grant recorded as made BY a departing administrator would hold
-- them in place. The grant itself is history worth keeping; who made it is not
-- worth blocking on.
update public.user_roles
   set granted_by = null
 where granted_by in (select id from users_to_drop)
   and user_id in (select id from users_to_keep);

delete from public.user_roles where user_id in (select id from users_to_drop);

-- ---------------------------------------------------------------------------
-- Both halves of the account.
-- ---------------------------------------------------------------------------

delete from public.users where id in (select id from users_to_drop);
delete from auth.users  where id in (select id from users_to_drop);

-- ---------------------------------------------------------------------------
-- Result, including the two halves agreeing with each other.
-- ---------------------------------------------------------------------------

select 'public.users'  as check, count(*) from public.users
union all select 'auth.users',   count(*) from auth.users
union all select 'doctors',      count(*) from public.doctors
union all select 'clients',      count(*) from public.clients
union all select 'clients with a login', count(*) from public.clients where user_id is not null
union all select 'active admins', count(*) from public.user_roles ur join public.roles r on r.id=ur.role_id
                                   where r.slug='admin' and ur.revoked_at is null
order by 1;

\if :apply
  commit;
  \echo '>>> COMMITTED.'
\else
  rollback;
  \echo '>>> DRY RUN — rolled back, nothing changed. Pass -v apply=1 to commit.'
\endif

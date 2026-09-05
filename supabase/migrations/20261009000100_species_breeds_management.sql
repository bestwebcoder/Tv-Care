-- Species and breeds become administrator-managed.
--
-- The vocabulary has existed since 20260820000400_pets.sql and has only ever
-- been readable: `grant select ... to authenticated` and a pair of select
-- policies, with the seed list in that migration the only way a row ever got
-- there. A practice that treats a species the seed does not name — a horse, a
-- pigeon fancier's breed — has had no way to record it, and a typo in the
-- seed has had no way to be corrected. This adds the writes, and the Species
-- card in Settings is the screen for them.
--
-- Scope, stated plainly because it is the one thing here that is not obvious:
-- these two tables carry no organization_id. They are one shared vocabulary,
-- as medications are, and pets.species_id / the composite (breed_id,
-- species_id) foreign key are built on that. So an administrator edits a list
-- every practice reads. That is correct while there is one practice
-- (CLAUDE.md §3 — multi-organization is architecture, not yet a product), and
-- the day a second one needs its own breeds these tables gain an
-- organization_id that is null for the shared rows, rather than being split.
-- Until then the destructive half is held by the database: pets,
-- vaccination_schedules and breeds all reference species ON DELETE RESTRICT,
-- so nothing in use anywhere can be deleted, whatever a screen offers.

-- ---------------------------------------------------------------------------
-- Bookkeeping the read-only tables never needed
-- ---------------------------------------------------------------------------

alter table public.species add column updated_at timestamptz not null default now();
alter table public.breeds add column updated_at timestamptz not null default now();

create trigger species_set_updated_at
  before update on public.species
  for each row execute function public.set_updated_at();

create trigger breeds_set_updated_at
  before update on public.breeds
  for each row execute function public.set_updated_at();

-- Renaming a breed changes what every patient record built on it reads as, so
-- it is an action worth keeping (CLAUDE.md §6). Neither table has an
-- organization_id, so write_audit_log leaves that column null and the row is
-- read back through audit_logs_select's actor clause — by the administrator
-- who made the change, not by a practice-scoped audit view.
create trigger species_audit
  after insert or update on public.species
  for each row execute function public.write_audit_log();

create trigger breeds_audit
  after insert or update on public.breeds
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- Who may write
--
-- settings.manage, the key that already covers the practice's own details and
-- its branches (20260930000200_permission_policies.sql). has_permission with
-- no organization is the right call here and would be wrong on a tenant table:
-- it asks "does this user hold the key anywhere", which is the only question
-- a table with no tenant column can answer.
-- ---------------------------------------------------------------------------

create policy species_insert on public.species
  for insert to authenticated
  with check ((select public.has_permission('settings.manage')));

create policy species_update on public.species
  for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

create policy species_delete on public.species
  for delete to authenticated
  using ((select public.has_permission('settings.manage')));

create policy breeds_insert on public.breeds
  for insert to authenticated
  with check ((select public.has_permission('settings.manage')));

create policy breeds_update on public.breeds
  for update to authenticated
  using ((select public.has_permission('settings.manage')))
  with check ((select public.has_permission('settings.manage')));

create policy breeds_delete on public.breeds
  for delete to authenticated
  using ((select public.has_permission('settings.manage')));

-- ---------------------------------------------------------------------------
-- Privileges
--
-- slug is deliberately absent from the species grant. It is not shown to
-- anyone; it is the stable key 20260826000100 seeds vaccination schedules
-- against and 20260918000100 provisions new practices with. A rename must not
-- move it, so the application derives a slug once, at insert, and the column
-- is unwritable afterwards for everyone but service_role.
-- ---------------------------------------------------------------------------

grant insert on public.species to authenticated;
grant update (name, sort_order, is_active) on public.species to authenticated;
grant delete on public.species to authenticated;

grant insert on public.breeds to authenticated;
grant update (species_id, name, is_active) on public.breeds to authenticated;
grant delete on public.breeds to authenticated;

comment on table public.species is
  'Shared patient vocabulary, managed from Settings by settings.manage. Not
   tenant-scoped: pets and vaccination_schedules reference it directly.';
comment on column public.species.slug is
  'Stable key for seeded data. Derived once at insert and never rewritten — a
   display name changes, this does not.';

-- ---------------------------------------------------------------------------
-- Prune the doctor roster down to a keep-list.
--
-- Doctors are not clients, and this script is deliberately much less
-- destructive than scripts/prune-clients.sql, because the relationship runs
-- the other way. A client OWNS their pets and invoices. A doctor is ATTACHED
-- to records that belong to somebody else: an appointment is the client's, a
-- SOAP note is the patient's medical record. Deleting "the doctor's
-- appointments" deletes other people's history, and the five foreign keys
-- pointing at public.doctors are ON DELETE RESTRICT to stop exactly that.
--
-- doctor_id is NOT NULL on all five, so there is no set-null escape either. A
-- record either keeps the doctor who wrote it, is reassigned to a doctor who
-- did not, or is destroyed. Reassignment would make one clinician appear to
-- have authored another's notes and doses, which CLAUDE.md §11 puts squarely
-- on the attending veterinarian. So this script does neither.
--
-- What it does instead is what 20261005000100_delete_doctor.sql already
-- decided is right, applied in bulk:
--
--   * a doctor with NO history is removed outright, along with their
--     availability, and their doctor grant is revoked;
--   * a doctor WITH history is deactivated — deleted_at is set, the grant is
--     revoked, every record they wrote stays attached to them;
--   * the keep-list stays active.
--
-- It reimplements delete_doctor rather than calling it: that function is
-- security definer and authorizes through auth.uid(), which is null in a psql
-- session, so it would refuse every call. The steps below are the same ones,
-- in the same order.
--
-- Usage — dry run (default: reports, then rolls back):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/prune-doctors.sql
--
-- Usage — commit:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v apply=1 -f scripts/prune-doctors.sql
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

begin;

-- ---------------------------------------------------------------------------
-- KEEP LIST — the doctors that stay active.
-- ---------------------------------------------------------------------------

create temporary table doctors_to_keep (id uuid primary key) on commit drop;

insert into doctors_to_keep (id) values
  ('00000000-0000-0000-0000-000000000000')  -- <- REPLACE ME
;

do $$
declare
  v_asked integer;
  v_found integer;
begin
  select count(*) into v_asked from doctors_to_keep;
  select count(*) into v_found
    from doctors_to_keep k join public.doctors d on d.id = k.id;

  if v_asked = 0 then
    raise exception 'The keep list is empty. Refusing to retire every doctor.';
  end if;

  if v_found <> v_asked then
    raise exception 'Keep list names % doctor(s), but only % exist. Fix the list.', v_asked, v_found;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Split the rest by whether anything they wrote still exists.
-- ---------------------------------------------------------------------------

create temporary table doctors_condemned on commit drop as
  select d.id, d.user_id, d.organization_id,
         (select count(*) from public.appointments      a where a.doctor_id = d.id)
       + (select count(*) from public.soap_records      s where s.doctor_id = d.id)
       + (select count(*) from public.prescriptions     p where p.doctor_id = d.id)
       + (select count(*) from public.vaccinations      v where v.doctor_id = d.id)
       + (select count(*) from public.deworming_records w where w.doctor_id = d.id) as history
  from public.doctors d
  where d.id not in (select id from doctors_to_keep);

create temporary table doctors_to_delete on commit drop as
  select * from doctors_condemned where history = 0;

create temporary table doctors_to_deactivate on commit drop as
  select * from doctors_condemned where history > 0 and id in (
    select id from public.doctors where deleted_at is null
  );

-- ---------------------------------------------------------------------------
-- The plan, before anything is touched.
-- ---------------------------------------------------------------------------

select 'stay active'                as outcome, count(*) from doctors_to_keep
union all select 'deleted (no history)',        count(*) from doctors_to_delete
union all select 'deactivated (has history)',   count(*) from doctors_to_deactivate
order by 1;

-- The clinical history that survives precisely because those doctors are
-- deactivated rather than deleted.
select 'appointments' as preserved, count(*) from public.appointments where doctor_id in (select id from doctors_to_deactivate)
union all select 'soap_records',    count(*) from public.soap_records where doctor_id in (select id from doctors_to_deactivate)
union all select 'prescriptions',   count(*) from public.prescriptions where doctor_id in (select id from doctors_to_deactivate)
union all select 'vaccinations',    count(*) from public.vaccinations where doctor_id in (select id from doctors_to_deactivate)
union all select 'deworming_records', count(*) from public.deworming_records where doctor_id in (select id from doctors_to_deactivate)
order by 1;

-- ---------------------------------------------------------------------------
-- Remove the empty profiles. Availability first — it is the one dependent
-- table delete_doctor takes with the doctor, being scheduling configuration
-- that means nothing without them.
-- ---------------------------------------------------------------------------

delete from public.doctor_availability where doctor_id in (select id from doctors_to_delete);
delete from public.doctors              where id in (select id from doctors_to_delete);

-- ---------------------------------------------------------------------------
-- Retire the rest. Their records stay attached to them, which is the whole
-- point: a SOAP note has to keep saying who wrote it.
-- ---------------------------------------------------------------------------

update public.doctors
   set deleted_at = now()
 where id in (select id from doctors_to_deactivate)
   and deleted_at is null;

-- A retired doctor should not still be able to sign in and open a patient
-- list, so their availability stops being offered too.
delete from public.doctor_availability where doctor_id in (select id from doctors_to_deactivate);

-- ---------------------------------------------------------------------------
-- Revoke the doctor grant for everyone leaving the roster — revoked, not
-- deleted, so user_roles keeps the record that the grant was once made.
-- Only the doctor role, and only at that practice: the same person may hold a
-- client account here or work at another organization, and neither is this
-- script's business.
-- ---------------------------------------------------------------------------

update public.user_roles ur
   set revoked_at = now()
  from public.roles r
 where r.id = ur.role_id
   and r.slug = 'doctor'
   and ur.revoked_at is null
   and (ur.user_id, ur.organization_id) in (
     select user_id, organization_id from doctors_condemned where user_id is not null
   );

-- ---------------------------------------------------------------------------
-- Result.
-- ---------------------------------------------------------------------------

select 'doctors active'      as check, count(*) from public.doctors where deleted_at is null
union all select 'doctors deactivated', count(*) from public.doctors where deleted_at is not null
union all select 'doctors total',       count(*) from public.doctors
union all select 'appointments intact', count(*) from public.appointments
union all select 'soap intact',         count(*) from public.soap_records
union all select 'vaccinations intact', count(*) from public.vaccinations;

\if :apply
  commit;
  \echo '>>> COMMITTED.'
\else
  rollback;
  \echo '>>> DRY RUN — rolled back, nothing changed. Pass -v apply=1 to commit.'
\endif

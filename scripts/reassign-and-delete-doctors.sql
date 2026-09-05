-- ---------------------------------------------------------------------------
-- Move every record off the deactivated doctors and delete them.
--
-- READ THIS. It does something the rest of the schema is built to prevent.
--
-- scripts/retire-deactivated-doctors.sql moves only FUTURE appointments,
-- because those are intentions and reassigning one is what a practice does the
-- day a vet resigns. This script also moves the finished work: completed
-- consultations, and the vaccination and deworming records that say who
-- administered a dose. public.vaccinations carries date_administered,
-- batch_number, lot_number, route and site — it is an administration record,
-- and a vaccination certificate is written from it. After this runs, those
-- rows name a veterinarian who did not perform the procedure.
--
-- That is a deliberate, operator-chosen rewrite of clinical attribution, so it
-- is gated behind an acknowledgement flag rather than a plain --apply. There is
-- no default target and no default consent.
--
-- What makes it defensible rather than silent: appointments, vaccinations and
-- deworming_records all carry audit triggers, so every row this touches leaves
-- an audit_logs entry recording the doctor_id it had and the one it now has.
-- The original clinician is recoverable from the audit trail. Do not remove
-- those triggers to make this quieter.
--
-- Usage — dry run:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v target=<active-doctor-uuid> \
--     -f scripts/reassign-and-delete-doctors.sql
--
-- Usage — commit:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v target=<active-doctor-uuid> \
--     -v rewrite_clinical_attribution=i-understand -v apply=1 \
--     -f scripts/reassign-and-delete-doctors.sql
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?rewrite_clinical_attribution}
\else
  \set rewrite_clinical_attribution 'not-given'
\endif

begin;

create temporary table target_doctor on commit drop as
  select d.id, u.full_name
  from public.doctors d
  left join public.users u on u.id = d.user_id
  where d.id = :'target'::uuid and d.deleted_at is null;

create temporary table doctors_condemned on commit drop as
  select d.id, d.user_id, d.organization_id, u.full_name
  from public.doctors d
  left join public.users u on u.id = d.user_id
  where d.deleted_at is not null;

do $$
declare
  v_target integer;
  v_conflicts integer;
begin
  select count(*) into v_target from target_doctor;
  if v_target <> 1 then
    raise exception 'The target must be exactly one ACTIVE doctor. Pass -v target=<uuid> of a doctor whose deleted_at is null.';
  end if;

  -- appointments_no_double_booking is a GiST exclusion over (doctor_id,
  -- [starts_at, ends_at)). Collapsing a roster onto one person can put two
  -- overlapping appointments on the same calendar, and the constraint would
  -- reject the statement halfway. Say so up front, with a number.
  select count(*) into v_conflicts
    from public.appointments m
    join public.doctors dm on dm.id = m.doctor_id and dm.deleted_at is not null
    join public.appointments x on x.doctor_id = (select id from target_doctor)
     and x.deleted_at is null and x.status not in ('cancelled','no_show')
     and tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(m.starts_at, m.ends_at, '[)')
   where m.deleted_at is null and m.status not in ('cancelled','no_show');

  if v_conflicts > 0 then
    raise exception 'This target already has % appointment(s) overlapping ones being moved. Choose a different active doctor.', v_conflicts;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- What is about to be rewritten.
-- ---------------------------------------------------------------------------

select (select full_name from target_doctor) as "everything moves to";

select 'appointments' as record_type, count(*) as rows_rewritten
  from public.appointments a join doctors_condemned c on c.id = a.doctor_id
union all
select 'vaccinations (who administered)', count(*)
  from public.vaccinations v join doctors_condemned c on c.id = v.doctor_id
union all
select 'deworming_records (who administered)', count(*)
  from public.deworming_records w join doctors_condemned c on c.id = w.doctor_id
union all
select 'doctors deleted', count(*) from doctors_condemned
order by 1;

-- Whether this run is allowed to keep what it does. The rewrite below always
-- runs so a dry run can report real numbers; only the COMMIT is gated. psql
-- does not substitute variables inside a dollar-quoted block, so the check is
-- made out here rather than in plpgsql.
select (:'apply' = '1' and :'rewrite_clinical_attribution' = 'i-understand') as should_commit \gset

-- ---------------------------------------------------------------------------
-- The rewrite. Every one of these three tables has an audit trigger, so each
-- updated row records the doctor it used to name.
-- ---------------------------------------------------------------------------

update public.appointments
   set doctor_id = (select id from target_doctor)
 where doctor_id in (select id from doctors_condemned);

update public.vaccinations
   set doctor_id = (select id from target_doctor)
 where doctor_id in (select id from doctors_condemned);

update public.deworming_records
   set doctor_id = (select id from target_doctor)
 where doctor_id in (select id from doctors_condemned);

-- ---------------------------------------------------------------------------
-- Now nothing points at them. Same three steps delete_doctor performs.
-- ---------------------------------------------------------------------------

delete from public.doctor_availability where doctor_id in (select id from doctors_condemned);
delete from public.doctors              where id in (select id from doctors_condemned);

update public.user_roles ur
   set revoked_at = now()
  from public.roles r
 where r.id = ur.role_id
   and r.slug = 'doctor'
   and ur.revoked_at is null
   and (ur.user_id, ur.organization_id) in (
     select user_id, organization_id from doctors_condemned where user_id is not null
   );

select 'doctors active'      as check, count(*) from public.doctors where deleted_at is null
union all select 'doctors deactivated', count(*) from public.doctors where deleted_at is not null
union all select 'appointments',        count(*) from public.appointments
union all select 'vaccinations',        count(*) from public.vaccinations
union all select 'deworming_records',   count(*) from public.deworming_records
union all select 'pets',                count(*) from public.pets
order by 1;

\if :should_commit
  commit;
  \echo '>>> COMMITTED. The audit log holds the original doctor for every row moved.'
\else
  rollback;
  \if :apply
    \echo '>>> REFUSED — rolled back. This rewrites who administered a dose.'
    \echo '>>> Re-run with -v rewrite_clinical_attribution=i-understand to proceed.'
  \else
    \echo '>>> DRY RUN — rolled back, nothing changed.'
  \endif
\endif

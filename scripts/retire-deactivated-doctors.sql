-- ---------------------------------------------------------------------------
-- Hand over a departed doctor's upcoming work, then remove the ones left empty.
--
-- WHAT THIS DOES NOT DO, AND WHY
--
-- It does not touch a record of something that already happened. Five columns
-- named doctor_id look alike and mean two different things:
--
--   * appointments still in the future — an intention. The vet has left, so
--     somebody else sees the animal. Changing it is the correct answer and the
--     one a practice reaches for the moment a clinician resigns.
--
--   * completed / no-show / cancelled appointments, vaccinations and
--     deworming_records — a record of what one named person did on one date.
--     public.vaccinations carries date_administered, batch_number, lot_number,
--     route and site: it is an administration record, and it is what a
--     vaccination certificate is written from. Pointing it at a different
--     doctor would assert that they gave a dose they did not give. Same for a
--     completed consultation, which says who saw the animal.
--
-- So this reassigns the first kind and leaves the second alone. The
-- consequence is that a doctor who ever treated a patient is NOT deleted here
-- — the five ON DELETE RESTRICT foreign keys still hold them, which is
-- 20261005000100_delete_doctor.sql working as written. They stay deactivated:
-- off every menu, unable to sign in, still named on their own work.
--
-- Deleting those would mean rewriting the records first. That is a decision
-- about clinical accuracy, not a cleanup, and it does not belong in a script
-- that runs unattended.
--
-- Usage — dry run (default: reports, then rolls back):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/retire-deactivated-doctors.sql
--
-- Usage — commit:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v apply=1 -f scripts/retire-deactivated-doctors.sql
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

begin;

create temporary table handovers (
  appointment_id uuid primary key,
  from_doctor text,
  to_doctor_id uuid,
  to_doctor text,
  starts_at timestamptz,
  same_branch boolean
) on commit drop;

-- ---------------------------------------------------------------------------
-- Choose a new doctor for each upcoming appointment.
--
-- One at a time, deliberately. appointments_no_double_booking is a GiST
-- exclusion constraint over (doctor_id, [starts_at, ends_at)), so two
-- appointments handed to the same doctor at overlapping times would be
-- rejected — and a set-based UPDATE cannot see the assignments it is itself
-- making. The loop re-asks who is free after every hand-over.
--
-- Preference order: a doctor at the same branch, then the lightest upcoming
-- workload, then name, so the result is stable rather than whatever the
-- planner returns first.
-- ---------------------------------------------------------------------------

do $$
declare
  appt record;
  target record;
begin
  for appt in
    select a.id, a.starts_at, a.ends_at, a.branch_id, u.full_name as from_doctor
    from public.appointments a
    join public.doctors d on d.id = a.doctor_id
    left join public.users u on u.id = d.user_id
    where d.deleted_at is not null
      and a.deleted_at is null
      and a.starts_at > now()
      and a.status in ('requested', 'confirmed')
    order by a.starts_at
  loop
    select d.id, u.full_name,
           (d.primary_branch_id is not distinct from appt.branch_id) as same_branch
      into target
      from public.doctors d
      join public.users u on u.id = d.user_id
     where d.deleted_at is null
       and not exists (
         select 1 from public.appointments x
          where x.doctor_id = d.id
            and x.deleted_at is null
            and x.status not in ('cancelled', 'no_show')
            and tstzrange(x.starts_at, x.ends_at, '[)') && tstzrange(appt.starts_at, appt.ends_at, '[)')
       )
     order by (d.primary_branch_id is not distinct from appt.branch_id) desc,
              (select count(*) from public.appointments y
                where y.doctor_id = d.id and y.starts_at > now()
                  and y.deleted_at is null and y.status not in ('cancelled','no_show')) asc,
              u.full_name
     limit 1;

    -- No free active doctor at that hour. Left with the departing doctor and
    -- reported: an appointment silently moved onto a clashing calendar, or
    -- silently dropped, is worse than one a human is told to rebook.
    if target.id is null then
      raise notice 'No available doctor for appointment % at % — left as it is.', appt.id, appt.starts_at;
      continue;
    end if;

    update public.appointments set doctor_id = target.id where id = appt.id;

    insert into handovers values
      (appt.id, appt.from_doctor, target.id, target.full_name, appt.starts_at, target.same_branch);
  end loop;
end;
$$;

select from_doctor      as "handed over from",
       to_doctor        as "to",
       starts_at::date  as "on",
       same_branch      as "same branch"
from handovers order by starts_at;

-- ---------------------------------------------------------------------------
-- Whoever is now empty can go. Same three steps delete_doctor performs:
-- availability, the row, and the doctor grant at that practice.
-- ---------------------------------------------------------------------------

create temporary table doctors_emptied on commit drop as
  select d.id, d.user_id, d.organization_id, u.full_name
  from public.doctors d
  left join public.users u on u.id = d.user_id
  where d.deleted_at is not null
    and not exists (select 1 from public.appointments      a where a.doctor_id = d.id)
    and not exists (select 1 from public.soap_records      s where s.doctor_id = d.id)
    and not exists (select 1 from public.prescriptions     p where p.doctor_id = d.id)
    and not exists (select 1 from public.vaccinations      v where v.doctor_id = d.id)
    and not exists (select 1 from public.deworming_records w where w.doctor_id = d.id);

select full_name as "deleted — nothing left attached" from doctors_emptied order by full_name;

select u.full_name as "kept — still named on their own work",
       (select count(*) from public.appointments a where a.doctor_id = d.id) as appts,
       (select count(*) from public.vaccinations v where v.doctor_id = d.id) as vax,
       (select count(*) from public.deworming_records w where w.doctor_id = d.id) as deworm
from public.doctors d left join public.users u on u.id = d.user_id
where d.deleted_at is not null and d.id not in (select id from doctors_emptied)
order by u.full_name;

delete from public.doctor_availability where doctor_id in (select id from doctors_emptied);
delete from public.doctors              where id in (select id from doctors_emptied);

update public.user_roles ur
   set revoked_at = now()
  from public.roles r
 where r.id = ur.role_id
   and r.slug = 'doctor'
   and ur.revoked_at is null
   and (ur.user_id, ur.organization_id) in (
     select user_id, organization_id from doctors_emptied where user_id is not null
   );

select 'doctors active'      as check, count(*) from public.doctors where deleted_at is null
union all select 'doctors deactivated', count(*) from public.doctors where deleted_at is not null
union all select 'appointments',        count(*) from public.appointments
union all select 'vaccinations',        count(*) from public.vaccinations
union all select 'deworming_records',   count(*) from public.deworming_records
order by 1;

\if :apply
  commit;
  \echo '>>> COMMITTED.'
\else
  rollback;
  \echo '>>> DRY RUN — rolled back, nothing changed. Pass -v apply=1 to commit.'
\endif

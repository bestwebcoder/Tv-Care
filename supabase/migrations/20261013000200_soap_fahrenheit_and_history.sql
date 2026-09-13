-- SOAP vitals in Fahrenheit, and two subjective history fields.
--
-- TEMPERATURE
--
-- The practice's vets read and write temperatures in °F. Converting at the
-- form would be lossy in the direction that matters: the vet types 102.5,
-- that becomes 39.2 °C at one decimal, and reads back as 102.6. So Fahrenheit
-- becomes the stored value a vet typed, and temperature_celsius is kept — never
-- dropped, it is clinical history — but is now derived from it by a trigger,
-- so anything still reading Celsius keeps reading a consistent number.
--
-- A Celsius value at one decimal survives C → F → C unchanged (the rounding
-- error is at most 0.028 °C), so the backfill below loses nothing.
--
-- HISTORY
--
--   owner_history       What the owner reports about the animal's background:
--                       earlier illnesses, surgeries, diet, environment.
--                       Distinct from `history`, the presenting history of
--                       this complaint.
--   prior_medications   Anything the animal is already on or was recently
--                       given — drugs, supplements, preventives — as reported.
--                       Recorded, never acted on: CLAUDE.md §11.

alter table public.soap_records
  add column temperature_fahrenheit numeric(4, 1),
  add column owner_history text,
  add column prior_medications text;

-- The same physiological window as soap_records_temperature_sane (20–45 °C).
alter table public.soap_records
  add constraint soap_records_temperature_fahrenheit_sane
  check (temperature_fahrenheit is null or (temperature_fahrenheit > 68 and temperature_fahrenheit < 113));

comment on column public.soap_records.temperature_fahrenheit is
  'The temperature as the vet recorded it, in °F. The source of truth for new
   records; temperature_celsius is derived from it.';

comment on column public.soap_records.temperature_celsius is
  'Derived from temperature_fahrenheit by soap_records_sync_temperature. Kept for
   records written before Fahrenheit, and for any reader still using Celsius.';

-- Backfill. Finalized records are immutable (guard_finalized_soap_update), and
-- this is the one write that must reach them anyway: it adds a unit, it does
-- not change a single clinical value. User triggers are off for the statement
-- so the guard allows it, updated_at keeps saying when the vet last edited the
-- note, and the audit log is not flooded with rows nobody performed.
alter table public.soap_records disable trigger user;

update public.soap_records
   set temperature_fahrenheit = round(temperature_celsius * 9 / 5 + 32, 1)
 where temperature_celsius is not null
   and temperature_fahrenheit is null;

alter table public.soap_records enable trigger user;

create or replace function public.sync_soap_temperature()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.temperature_fahrenheit is not null then
      new.temperature_celsius := round((new.temperature_fahrenheit - 32) * 5 / 9, 1);
    elsif new.temperature_celsius is not null then
      -- A writer that only knows Celsius (an import, an older script).
      new.temperature_fahrenheit := round(new.temperature_celsius * 9 / 5 + 32, 1);
    end if;
  elsif new.temperature_fahrenheit is distinct from old.temperature_fahrenheit then
    new.temperature_celsius := case
      when new.temperature_fahrenheit is null then null
      else round((new.temperature_fahrenheit - 32) * 5 / 9, 1)
    end;
  elsif new.temperature_celsius is distinct from old.temperature_celsius then
    new.temperature_fahrenheit := case
      when new.temperature_celsius is null then null
      else round(new.temperature_celsius * 9 / 5 + 32, 1)
    end;
  end if;

  return new;
end;
$$;

create trigger soap_records_sync_temperature
  before insert or update on public.soap_records
  for each row execute function public.sync_soap_temperature();

-- ---------------------------------------------------------------------------
-- revise_soap_record() copies the finalized row column by column, so every new
-- column has to be named here or a revision silently drops it.
-- ---------------------------------------------------------------------------

create or replace function public.revise_soap_record(p_soap_record_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_new_id uuid;
  v_superseded_count integer;
begin
  update public.soap_records
     set superseded_at = now()
   where id = p_soap_record_id
     and status = 'finalized'
     and superseded_at is null;
  get diagnostics v_superseded_count = row_count;

  if v_superseded_count = 0 then
    raise exception 'Only the current finalized version of a SOAP record can be revised.';
  end if;

  insert into public.soap_records (
    appointment_id, pet_id, organization_id, doctor_id, version, status,
    chief_complaint, history, owner_history, prior_medications, duration, appetite, water_intake, urination,
    defecation, vomiting, diarrhea, coughing, sneezing, other_observations,
    temperature_celsius, temperature_fahrenheit, pulse_bpm, respiratory_rate_bpm, weight_grams,
    body_condition_score, mucous_membrane, capillary_refill_time, hydration_status,
    general_appearance, exam_eyes, exam_ears, exam_nose, exam_oral_cavity,
    exam_cardiovascular, exam_respiratory, exam_gastrointestinal, exam_urinary,
    exam_reproductive, exam_musculoskeletal, exam_neurological, exam_skin,
    exam_lymph_nodes, exam_notes,
    clinical_assessment, problem_list,
    treatment, medication, diagnostics_plan, diet, hospitalization,
    follow_up_needed, follow_up_notes, client_instructions,
    created_by
  )
  select
    appointment_id, pet_id, organization_id, doctor_id, version + 1, 'draft',
    chief_complaint, history, owner_history, prior_medications, duration, appetite, water_intake, urination,
    defecation, vomiting, diarrhea, coughing, sneezing, other_observations,
    temperature_celsius, temperature_fahrenheit, pulse_bpm, respiratory_rate_bpm, weight_grams,
    body_condition_score, mucous_membrane, capillary_refill_time, hydration_status,
    general_appearance, exam_eyes, exam_ears, exam_nose, exam_oral_cavity,
    exam_cardiovascular, exam_respiratory, exam_gastrointestinal, exam_urinary,
    exam_reproductive, exam_musculoskeletal, exam_neurological, exam_skin,
    exam_lymph_nodes, exam_notes,
    clinical_assessment, problem_list,
    treatment, medication, diagnostics_plan, diet, hospitalization,
    follow_up_needed, follow_up_notes, client_instructions,
    (select auth.uid())
  from public.soap_records
  where id = p_soap_record_id
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant update (temperature_fahrenheit, owner_history, prior_medications) on public.soap_records to authenticated;

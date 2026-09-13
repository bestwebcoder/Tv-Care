-- Prescriptions dosed by volume or unit count, from a stated concentration.
--
-- Until now the calculator stopped at a mass — 28 kg × 1 mg/kg = 28 mg — and
-- left the vet to work out how much liquid or how many tablets that is. The
-- practice wants the prescription to carry the whole chain and to say it the
-- same way every time:
--
--   Amoxicillin (50 mg/mL)
--   Give 5.6 mL PO, 2 times a day for 7 days
--
-- Everything is additive. Items written before this keep their free-text
-- frequency/duration and render exactly as they did; nothing is backfilled,
-- because inventing a concentration for an old prescription would be inventing
-- what was prescribed.
--
-- The calculation stays a calculation (CLAUDE.md §11): the stored amount is the
-- one the vet saved, which may differ from what the calculator suggested.

-- ---------------------------------------------------------------------------
-- prescriptions — the weight this prescription was dosed against
-- ---------------------------------------------------------------------------

alter table public.prescriptions
  add column weight_grams integer;

alter table public.prescriptions
  add constraint prescriptions_weight_sane
  check (weight_grams is null or (weight_grams > 0 and weight_grams <= 2000000));

comment on column public.prescriptions.weight_grams is
  'Body weight the vet dosed this prescription against. Prefilled from the
   visit, but its own value: a prescription must keep saying what weight its
   doses were calculated for even if the SOAP note is later revised.';

-- ---------------------------------------------------------------------------
-- prescription_items — generic name, concentration and structured directions
-- ---------------------------------------------------------------------------

alter table public.prescription_items
  add column generic_name text,
  add column concentration_mg_per_unit numeric,
  add column dose_form text,
  add column dose_amount numeric,
  add column frequency_per_day integer,
  add column duration_days integer;

alter table public.prescription_items
  add constraint prescription_items_concentration_sane
    check (concentration_mg_per_unit is null or concentration_mg_per_unit > 0),
  add constraint prescription_items_dose_form_allowed
    check (dose_form is null or dose_form in ('ml', 'tablet', 'capsule')),
  add constraint prescription_items_dose_amount_sane
    check (dose_amount is null or dose_amount > 0),
  add constraint prescription_items_frequency_per_day_sane
    check (frequency_per_day is null or frequency_per_day between 1 and 24),
  add constraint prescription_items_duration_days_sane
    check (duration_days is null or duration_days between 1 and 365),
  -- A concentration means nothing without saying per what.
  add constraint prescription_items_concentration_has_form
    check (concentration_mg_per_unit is null or dose_form is not null);

comment on column public.prescription_items.concentration_mg_per_unit is
  'mg of drug per one dose_form unit: per mL for a liquid, per tablet, per capsule.';
comment on column public.prescription_items.dose_amount is
  'How much is given each time, in dose_form units (mL, tablets, capsules).';
comment on column public.prescription_items.frequency_per_day is
  'How many times a day. Items predating this column carry free-text frequency.';

-- ---------------------------------------------------------------------------
-- revise_prescription() copies column by column — name the new ones.
-- ---------------------------------------------------------------------------

create or replace function public.revise_prescription(p_prescription_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_new_id uuid;
  v_updated integer;
begin
  update public.prescriptions
     set superseded_at = now()
   where id = p_prescription_id
     and status = 'finalized'
     and superseded_at is null;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'Only the current finalized version of a prescription can be revised.';
  end if;

  insert into public.prescriptions (
    appointment_id, pet_id, organization_id, doctor_id, version, status,
    prescription_number, follow_up_date, instructions, weight_grams, created_by
  )
  select
    appointment_id, pet_id, organization_id, doctor_id, version + 1, 'draft',
    prescription_number, follow_up_date, instructions, weight_grams, (select auth.uid())
  from public.prescriptions
  where id = p_prescription_id
  returning id into v_new_id;

  insert into public.prescription_items (
    prescription_id, medication_id, drug_name, generic_name, strength, formulation,
    dose_per_kg, dose_unit, computed_dose, concentration_mg_per_unit, dose_form, dose_amount,
    route, frequency, frequency_per_day, duration, duration_days, quantity, instructions, sort_order
  )
  select
    v_new_id, medication_id, drug_name, generic_name, strength, formulation,
    dose_per_kg, dose_unit, computed_dose, concentration_mg_per_unit, dose_form, dose_amount,
    route, frequency, frequency_per_day, duration, duration_days, quantity, instructions, sort_order
  from public.prescription_items
  where prescription_id = p_prescription_id;

  return v_new_id;
end;
$$;

grant update (weight_grams) on public.prescriptions to authenticated;
grant update (
  generic_name, concentration_mg_per_unit, dose_form, dose_amount, frequency_per_day, duration_days
) on public.prescription_items to authenticated;

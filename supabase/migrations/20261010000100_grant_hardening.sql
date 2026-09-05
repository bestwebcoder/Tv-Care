-- ---------------------------------------------------------------------------
-- Closing a hole every signed-in user could drive through: TRUNCATE.
--
-- Row level security does not apply to TRUNCATE. Postgres checks the TRUNCATE
-- privilege and nothing else — no policy is consulted, no row is filtered. So
-- a role holding TRUNCATE on public.pets can empty it, and with CASCADE take
-- appointments, soap_records, prescriptions, vaccinations, deworming_records,
-- invoices, invoice_items, payments, refunds, diagnoses, diagnostics and
-- documents with it. Verified against a local database before this was
-- written: `set role authenticated; truncate public.pets cascade;` succeeded,
-- and 10 pets, 11 invoices and 11 payments became none.
--
-- authenticated held that privilege on nearly every table, so any account that
-- can sign in — a pet owner included — could have destroyed the practice's
-- whole clinical and financial record in one statement.
--
-- WHERE IT CAME FROM
--
-- Nothing granted it deliberately. pg_default_acl for role postgres in schema
-- public carries `anon=Dxtm` and `authenticated=Dxtm` — TRUNCATE, REFERENCES,
-- TRIGGER, MAINTAIN — so every table a migration creates is born holding them.
-- 20260820000100 did `revoke delete, truncate on all tables in schema public
-- from authenticated`, but ALL TABLES means the tables that exist at that
-- moment, and at that point in migration 0001 almost none of this schema had
-- been created yet. Everything added afterwards quietly kept them.
--
-- The linked remote project is further out again: it carries the full
-- `arwdDxtm` set — which pg_dump renders as `GRANT ALL` — on 40 public tables
-- for authenticated and 13 for anon, among them data_exports, data_imports,
-- refunds, permissions and role_permissions. Table-level UPDATE there also
-- defeats the column-level grants this schema uses as a boundary in its own
-- right, so pets.client_id and pets.organization_id are writable on the remote
-- and are not here.
--
-- WHAT THIS DOES
--
--   1. Takes TRUNCATE, REFERENCES and TRIGGER away from anon and
--      authenticated on everything. No application path uses any of the
--      three: TRUNCATE bypasses RLS, TRIGGER attaches code to a table the
--      caller does not own, REFERENCES reads a column through a foreign key.
--   2. Changes the default privileges so the next table created does not
--      arrive holding them again. Without this the hole reopens on the next
--      migration that adds a table — which is exactly how it opened.
--   3. Revokes the ordinary write privileges from both roles and restates
--      them table by table, so the remote stops being a superset of what
--      these migrations describe and the two databases agree.
--
-- No policy is touched and no row is read or moved. A role that could reach a
-- row before can still reach it; what changes is that it can no longer reach
-- commands and columns the application never offered it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The privileges no client role should hold.
--
-- MAINTAIN only exists from Postgres 17, and this has to apply to older
-- servers too, so it is revoked separately and only where it is a privilege
-- name at all.
-- ---------------------------------------------------------------------------

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

do $$
begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The defaults, so a new table is not born with them.
--
-- Two roles create tables here: postgres runs the migrations, supabase_admin
-- created the schema. The second is attempted only if this role may speak for
-- it — on a hosted project it may not, and that is not a reason to fail the
-- migration. The notice says what to do by hand if so.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke truncate, references, trigger on tables from anon, authenticated';
exception
  when insufficient_privilege or undefined_object then
    raise notice
      'Could not adjust default privileges for supabase_admin. If a later migration''s new table turns up holding TRUNCATE, run that ALTER DEFAULT PRIVILEGES as supabase_admin.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The write privileges, back to what these migrations describe.
--
-- Revoked first so the remote's surplus goes, then restated. SELECT is
-- revoked along with the rest and re-granted per table below, so nothing that
-- could read a table before loses the ability to.
-- ---------------------------------------------------------------------------

revoke select, insert, update, delete on all tables in schema public from anon, authenticated;

-- Restated table grants, one line per table. Generated from the local
-- database, which is built from these migrations and nothing else, so this is
-- the privilege set they have always meant to describe.

grant select on public.appointment_statuses to authenticated;
grant select, insert on public.appointments to authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert, update, delete on public.branches to authenticated;
grant select, insert, delete on public.breeds to authenticated;
grant select, insert, delete on public.clients to authenticated;
grant insert on public.contact_messages to anon;
grant select, insert, update on public.contact_messages to authenticated;
grant select, insert on public.data_exports to authenticated;
grant select, insert on public.data_imports to authenticated;
grant select, insert on public.deworming_records to authenticated;
grant select, insert on public.diagnoses to authenticated;
grant select, insert on public.diagnostics to authenticated;
grant select, insert on public.doctor_availability to authenticated;
grant select, insert on public.doctors to authenticated;
grant select, insert, delete on public.documents to authenticated;
grant select, insert, update, delete on public.invoice_items to authenticated;
grant select, insert on public.invoices to authenticated;
grant select on public.medications to authenticated;
grant select, insert, update, delete on public.nav_menu_items to authenticated;
grant select on public.notification_logs to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update on public.notification_templates to authenticated;
grant select on public.notifications to authenticated;
grant select, insert, update, delete on public.organization_hero_images to authenticated;
grant select, insert on public.organizations to authenticated;
grant select, insert, update, delete on public.page_section_items to authenticated;
grant select, insert on public.payments to authenticated;
grant select on public.permissions to authenticated;
grant select on public.pet_deworming_status to authenticated;
grant select on public.pet_vaccination_status to authenticated;
grant select, insert, delete on public.pets to authenticated;
grant select, insert, delete on public.prescription_items to authenticated;
grant select, insert on public.prescriptions to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select, insert on public.refunds to authenticated;
grant select, insert, delete on public.role_permissions to authenticated;
grant select, insert, update on public.roles to authenticated;
grant select, insert, delete on public.service_categories to authenticated;
grant select, insert, delete on public.services to authenticated;
grant select, insert, update, delete on public.site_content to authenticated;
grant select, insert, update, delete on public.site_page_blocks to authenticated;
grant select, insert, update, delete on public.site_pages to authenticated;
grant select, insert on public.soap_records to authenticated;
grant select, insert, delete on public.species to authenticated;
grant select, insert on public.staff to authenticated;
grant select, insert on public.user_roles to authenticated;
grant select on public.users to authenticated;
grant select, insert, delete on public.vaccination_schedules to authenticated;
grant select, insert on public.vaccinations to authenticated;

-- Column-level UPDATE. These are the boundaries that matter most: a column
-- absent from a list below is one no client may write, whatever the row
-- policy allows. pets.client_id and pets.organization_id are the clearest
-- case — nobody re-homes a patient or moves it between practices through the
-- table (20260820000400) — and species.slug the newest, because vaccination
-- schedules are seeded against it (20261009000100).

grant update (branch_id, doctor_id, service_id, visit_type, status, starts_at, ends_at, reason, location, notes, cancelled_at, cancelled_by, cancellation_reason, deleted_at) on public.appointments to authenticated;
grant update (name, slug, is_primary, email, phone, address, city, is_active, deleted_at) on public.branches to authenticated;
grant update (species_id, name, is_active) on public.breeds to authenticated;
grant update (preferred_branch_id, full_name, email, phone, alternate_phone, address, city, notes, deleted_at) on public.clients to authenticated;
grant update (product, active_ingredient, dose, route, weight_grams, date_administered, interval, custom_interval_days, next_due_date, notes, deleted_at) on public.deworming_records to authenticated;
grant update (deleted_at) on public.diagnoses to authenticated;
grant update (test_name, test_type, status, result_notes, document_id, deleted_at) on public.diagnostics to authenticated;
grant update (branch_id, weekday, starts_at, ends_at, slot_minutes, visit_type, is_active, deleted_at) on public.doctor_availability to authenticated;
grant update (primary_branch_id, registration_number, specialization, qualifications, bio, signature_url, is_accepting_appointments, deleted_at, can_manage_billing, can_view_reports, photo_path, is_lead_doctor) on public.doctors to authenticated;
grant update (file_name, description, is_client_visible, deleted_at, document_type) on public.documents to authenticated;
grant update (pet_id, appointment_id, status, discount_paisa, issued_at, due_date, notes, cancelled_at, cancellation_reason, pdf_path, deleted_at) on public.invoices to authenticated;
grant update (status, retry_count, next_retry_at, failure_reason) on public.notifications to authenticated;
grant update (name, legal_name, timezone, email, phone, address, city, country, is_active, payment_instructions, quiet_hours_start, quiet_hours_end, hero_image_path, whatsapp_number, logo_path, footer_show_logo) on public.organizations to authenticated;
grant update (name, species_id, breed_id, sex, is_neutered, date_of_birth, is_date_of_birth_estimated, weight_grams, weight_recorded_at, colour, microchip_number, allergies, chronic_conditions, notes, photo_path, deleted_at) on public.pets to authenticated;
grant update (medication_id, drug_name, strength, formulation, dose_per_kg, dose_unit, computed_dose, route, frequency, duration, quantity, instructions, sort_order) on public.prescription_items to authenticated;
grant update (doctor_id, status, finalized_at, superseded_at, follow_up_date, instructions, pdf_path, signed_at) on public.prescriptions to authenticated;
grant update (name, sort_order, is_active, deleted_at, description, icon) on public.service_categories to authenticated;
grant update (name, description, duration_minutes, sort_order, is_active, deleted_at, category_id, price_paisa, tax_rate_percent, is_home_visit_available, is_home_visit_fee, requires_doctor, tagline, inclusions_label, inclusions, fee_label, fee_tiers, fee_note) on public.services to authenticated;
grant update (doctor_id, status, finalized_at, superseded_at, chief_complaint, history, duration, appetite, water_intake, urination, defecation, vomiting, diarrhea, coughing, sneezing, other_observations, temperature_celsius, pulse_bpm, respiratory_rate_bpm, weight_grams, body_condition_score, mucous_membrane, capillary_refill_time, hydration_status, general_appearance, exam_eyes, exam_ears, exam_nose, exam_oral_cavity, exam_cardiovascular, exam_respiratory, exam_gastrointestinal, exam_urinary, exam_reproductive, exam_musculoskeletal, exam_neurological, exam_skin, exam_lymph_nodes, exam_notes, clinical_assessment, problem_list, treatment, medication, diagnostics_plan, diet, hospitalization, follow_up_needed, follow_up_notes, follow_up_scheduled_at, client_instructions) on public.soap_records to authenticated;
grant update (name, sort_order, is_active) on public.species to authenticated;
grant update (branch_id, job_title, deleted_at) on public.staff to authenticated;
grant update (revoked_at) on public.user_roles to authenticated;
grant update (full_name, phone, avatar_url) on public.users to authenticated;
grant update (species_id, vaccine_name, interval_value, interval_unit, description, sort_order, is_active, deleted_at) on public.vaccination_schedules to authenticated;
grant update (vaccination_schedule_id, vaccine_name, manufacturer, batch_number, lot_number, expiry_date, date_administered, dose, route, site, next_due_date, notes, deleted_at) on public.vaccinations to authenticated;

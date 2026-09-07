-- Scheduling rules — the practice's own booking policy, as configuration.
--
-- Three questions the booking engine has to answer before it offers a slot,
-- and until now answered two of them with nothing at all:
--
--   How soon may a client book?   Nothing stopped a slot one minute from now,
--                                 and no screen could say otherwise.
--   How far ahead may they book?  Nothing stopped a booking in 2031.
--   How late may they cancel?     cancellation_notice_hours, added by
--                                 20260820000700_appointments.sql — which no
--                                 screen has ever been able to change, because
--                                 the column was never granted to
--                                 `authenticated`.
--
-- All three are business decisions (CLAUDE.md §9: no hard-coded schedules), so
-- they live beside the practice they belong to rather than as constants in
-- src/features/appointments/availability.ts.

-- booking_lead_minutes defaults to 0, which is what the application did before
-- this column existed: a client could book a time starting this minute. A
-- default with teeth would change every practice's behaviour the moment this
-- migration ran, including practices that take walk-ins and want exactly this.
-- The point of the column is that the decision is now theirs to make on the
-- Settings screen, not that this migration makes it for them.
alter table public.organizations
  add column booking_lead_minutes integer not null default 0,
  add column booking_horizon_days integer not null default 180;

comment on column public.organizations.booking_lead_minutes is
  'How long before a slot the practice stops accepting a booking for it.
   0, the default, means a client may book a time that starts this minute.';

comment on column public.organizations.booking_horizon_days is
  'How many days ahead a client may book. Bounds the calendar a client is
   offered, and keeps a booking out of a year the practice has not planned.';

-- A week of notice is already an unusual clinic; a month is not a lead time.
alter table public.organizations
  add constraint organizations_booking_lead_sane
  check (booking_lead_minutes between 0 and 10080);

-- At least tomorrow, at most two years.
alter table public.organizations
  add constraint organizations_booking_horizon_sane
  check (booking_horizon_days between 1 and 730);

-- The write side. cancellation_notice_hours joins them: it has been read by
-- may_client_change_appointment since Phase 3 but was never writable outside
-- the service role, so the notice period could only ever be its default.
grant update (
  booking_lead_minutes, booking_horizon_days, cancellation_notice_hours
) on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- Slot generation reads availability one weekday at a time
--
-- computeAvailableSlots asks for one doctor's windows on one weekday, on every
-- keystroke through the booking form's date step. doctor_availability_doctor_id_idx
-- gets it to the doctor; the weekday, the soft-delete and the active flag were
-- all left to a filter afterwards.
-- ---------------------------------------------------------------------------

create index doctor_availability_doctor_id_weekday_idx
  on public.doctor_availability (doctor_id, weekday)
  where deleted_at is null and is_active;

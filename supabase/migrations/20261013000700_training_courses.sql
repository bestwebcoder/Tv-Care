-- Training courses — the dated sessions behind the Training & Education page.
--
-- /training-education lists programmes (service categories routed to it by
-- src/lib/service-pages.ts): what the practice teaches and what it costs. What
-- it could not say is WHEN. A vet deciding whether to enrol needs the dates,
-- whether it is in person or online, and whether there is room — so each
-- scheduled run of a course is a row here, and the page renders them as a
-- calendar.
--
-- Admin-managed through the Website area, so it reuses the website.view /
-- website.manage permissions rather than adding catalogue keys no policy
-- elsewhere would consult. No enrolment: interested vets enquire through the
-- contact page, as the practice already asks them to.
--
-- Nothing is seeded. Inventing course dates in a migration would put a
-- fictional schedule on every practice's public page, including real ones.

create table public.training_courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- The programme this session is a run of, when it is one. Set null rather
  -- than restrict: retiring a service must not take its past sessions with it.
  service_id uuid references public.services (id) on delete set null,

  title text not null,
  summary text,
  audience text,
  delivery_mode text not null default 'in_person',
  location text,

  starts_at timestamptz not null,
  ends_at timestamptz not null,

  -- Null means no fee is published for this session (free, or on enquiry).
  fee_paisa integer,
  -- Null means the practice does not publish a seat limit.
  seats integer,

  is_published boolean not null default false,
  cancelled_at timestamptz,

  created_by uuid references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint training_courses_title_not_blank check (length(btrim(title)) > 0),
  constraint training_courses_ordered check (ends_at >= starts_at),
  constraint training_courses_delivery_mode_allowed
    check (delivery_mode in ('in_person', 'online', 'hybrid')),
  constraint training_courses_fee_sane check (fee_paisa is null or fee_paisa >= 0),
  constraint training_courses_seats_sane check (seats is null or (seats > 0 and seats <= 10000)),
  -- An in-person session with nowhere to go is not publishable information.
  constraint training_courses_location_for_in_person
    check (delivery_mode = 'online' or location is not null)
);

create index training_courses_organization_id_starts_at_idx
  on public.training_courses (organization_id, starts_at)
  where deleted_at is null;

create index training_courses_service_id_idx
  on public.training_courses (service_id)
  where service_id is not null;

create trigger training_courses_set_updated_at
  before update on public.training_courses
  for each row execute function public.set_updated_at();

create trigger training_courses_audit
  after insert or update on public.training_courses
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- Row level security. The public page reads published sessions server-side
-- through the service client, exactly as it reads services — anon holds no
-- privilege on this table at all.
-- ---------------------------------------------------------------------------

alter table public.training_courses enable row level security;

create policy training_courses_select on public.training_courses
  for select to authenticated
  using (
    (select public.is_super_admin())
    or organization_id in (select public.my_org_ids(array['admin']))
    or organization_id in (select public.my_permission_org_ids('website.view'))
  );

create policy training_courses_insert on public.training_courses
  for insert to authenticated
  with check (
    (select public.is_super_admin())
    or organization_id in (select public.my_org_ids(array['admin']))
    or organization_id in (select public.my_permission_org_ids('website.manage'))
  );

create policy training_courses_update on public.training_courses
  for update to authenticated
  using (
    (select public.is_super_admin())
    or organization_id in (select public.my_org_ids(array['admin']))
    or organization_id in (select public.my_permission_org_ids('website.manage'))
  )
  with check (
    (select public.is_super_admin())
    or organization_id in (select public.my_org_ids(array['admin']))
    or organization_id in (select public.my_permission_org_ids('website.manage'))
  );

-- No delete: a session is cancelled (visible, marked) or archived (deleted_at).
revoke all on public.training_courses from anon, authenticated;
grant select, insert on public.training_courses to authenticated;
grant update (
  service_id, title, summary, audience, delivery_mode, location, starts_at, ends_at,
  fee_paisa, seats, is_published, cancelled_at, deleted_at
) on public.training_courses to authenticated;
grant all on public.training_courses to service_role;

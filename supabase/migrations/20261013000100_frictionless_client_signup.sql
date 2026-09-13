-- Frictionless client registration.
--
-- 20260820000300_signup.sql, and the later decision in d42eede, made
-- registration ask for a name, an email, a phone number and a strong password,
-- and then held the account back until an emailed link was clicked. The
-- practice has decided that is too much to ask of a pet owner standing in
-- front of a vet: registration is now one identifier (email OR mobile number)
-- and a password or 6-digit PIN, signed in immediately, with name and phone
-- numbers collected on the first screen after sign-in.
--
-- That breaks two invariants the schema used to hold at insert time, and this
-- migration moves each to where it can still be held:
--
--   users.email NOT NULL      A phone-only account has no email in auth.users.
--                             Replaced by "email or phone", which every real
--                             account still satisfies.
--
--   clients.phone NOT NULL    Reception calls this number, so it stays required
--                             for every client record a person at the practice
--                             creates, and for every self-registered client once
--                             they have completed their profile. The one row it
--                             may be missing from is a self-registered client
--                             who has not finished the profile screen yet — and
--                             the /client area will not let them past it.
--
-- The auth-server half (password floor, confirmations, phone signup) lives in
-- supabase/config.toml, which no migration carries: the hosted project must be
-- given the same settings by hand.

-- ---------------------------------------------------------------------------
-- users — email or phone
-- ---------------------------------------------------------------------------

alter table public.users
  alter column email drop not null;

alter table public.users
  add constraint users_email_or_phone check (email is not null or phone is not null);

-- ---------------------------------------------------------------------------
-- clients — profile completion
-- ---------------------------------------------------------------------------

-- Defaults to now(): a client record created by staff, an import or a script
-- already has the name and phone that completion means. Only the signup trigger
-- below inserts null, for the one kind of record that does not.
alter table public.clients
  add column profile_completed_at timestamptz default now();

comment on column public.clients.profile_completed_at is
  'When a self-registered client finished the post-sign-in profile screen.
   Null only for a self-registered client who has not done so yet; every
   client created by staff, and every client that existed before this column,
   counts as complete.';

-- Every existing client already has a name and a phone number, which is all
-- completion means — so they are complete, as of when they were created.
-- clients has an audit trigger; this is a backfill of a new derived column, not
-- anybody's action, so it is not attributed to anyone.
alter table public.clients disable trigger user;
update public.clients set profile_completed_at = created_at where profile_completed_at is null;
alter table public.clients enable trigger user;

alter table public.clients
  alter column phone drop not null;

alter table public.clients
  add constraint clients_phone_required_once_complete
  check (phone is not null or (user_id is not null and profile_completed_at is null));

-- The column is writable by the client completing their own profile; the
-- existing clients_update policy already limits which row that can be.
grant update (profile_completed_at) on public.clients to authenticated;

-- ---------------------------------------------------------------------------
-- The signup trigger, for an account that may carry only an email or only a
-- phone, and no name at all yet.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_full_name text;
  v_phone text;
  v_organization_id uuid;
  v_role_id uuid;
begin
  -- A client who registered with a mobile number signs in through a placeholder
  -- address on a reserved, undeliverable domain (src/lib/validation/auth.ts,
  -- phoneLoginEmail) — Supabase will not take phone + password accounts without
  -- an SMS provider. It is an identity, not a contact address, so it is never
  -- stored as one.
  v_email := case
    when new.email like '%@phone.tvcare.invalid' then null
    else nullif(btrim(new.email), '')
  end;

  -- auth.users stores a phone as bare digits (8801712345678). The application
  -- stores the +880 form everywhere else, and a duplicate-phone check that
  -- compared the two spellings would never fire.
  v_phone := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    case
      when nullif(btrim(new.phone), '') is null then null
      when new.phone like '+%' then new.phone
      else '+' || new.phone
    end
  );

  -- A placeholder until the profile screen asks: the part of the email before
  -- the @, or the phone number. Never shown as if it were a real name — the
  -- /client area sends the person to complete their profile first.
  v_full_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    v_phone
  );

  -- Every account gets a profile, however it was created.
  insert into public.users (id, full_name, email, phone)
  values (new.id, v_full_name, v_email, v_phone);

  -- Only the public registration form provisions a pet owner. Doctors, staff
  -- and admins are invited through an administrative flow that grants the
  -- right role deliberately, so this must not fire for them.
  if coalesce(new.raw_user_meta_data ->> 'signup_source', '') <> 'self_registration' then
    return new;
  end if;

  v_organization_id := public.default_organization_id();

  if v_organization_id is null then
    raise exception 'No active organization is available to register into'
      using errcode = '23503';
  end if;

  select r.id into v_role_id from public.roles r where r.slug = 'client';

  insert into public.user_roles (user_id, role_id, organization_id)
  values (new.id, v_role_id, v_organization_id);

  -- profile_completed_at stays null: name and phone are asked for after the
  -- first sign-in.
  insert into public.clients (user_id, organization_id, full_name, phone, email, profile_completed_at)
  values (new.id, v_organization_id, v_full_name, v_phone, v_email, null);

  return new;
end;
$$;

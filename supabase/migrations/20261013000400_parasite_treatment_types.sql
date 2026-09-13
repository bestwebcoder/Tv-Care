-- Internal and external parasite treatment, recorded separately.
--
-- deworming_records has only ever meant internal parasites — worms. Tick,
-- flea and mite control runs on its own products and its own clock (a monthly
-- spot-on next to a quarterly dewormer), so folding the two into one "last
-- treatment" per pet made the due date wrong for whichever was given second.
--
-- One table, one new discriminator, rather than a second table: the two share
-- every column, every policy, the reminder engine and the soft-delete, and a
-- copy of all that would drift. Every existing row is an internal treatment,
-- which is what the default says.

alter table public.deworming_records
  add column parasite_type text not null default 'internal';

alter table public.deworming_records
  add constraint deworming_records_parasite_type_allowed
  check (parasite_type in ('internal', 'external'));

comment on column public.deworming_records.parasite_type is
  'internal — worms (deworming). external — ticks, fleas, mites. Each has its own
   due date: pet_deworming_status keeps the latest of each per pet.';

create index deworming_records_pet_id_parasite_type_idx
  on public.deworming_records (pet_id, parasite_type)
  where deleted_at is null;

grant update (parasite_type) on public.deworming_records to authenticated;

-- One row per pet per parasite type now. parasite_type is appended as the last
-- column so this can stay a CREATE OR REPLACE and keep its grants.
create or replace view public.pet_deworming_status as
select distinct on (d.pet_id, d.parasite_type)
  d.pet_id,
  d.organization_id,
  d.id as deworming_record_id,
  d.product,
  d.date_administered,
  d.next_due_date,
  d.parasite_type
from public.deworming_records d
where d.deleted_at is null
order by d.pet_id, d.parasite_type, d.date_administered desc, d.created_at desc;

-- The reminder says which kind of treatment is due. Otherwise identical to
-- 20260829000100_notifications.sql's definition.
create or replace function public.notify_due_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_user_id uuid;
  v_notification_type text;
  v_title text;
  v_body text;
begin
  if new.next_due_date is null then
    return new;
  end if;

  select c.user_id
    into v_recipient_user_id
  from public.pets p
  join public.clients c on c.id = p.client_id
  where p.id = new.pet_id;

  -- A walk-in client with no login yet has nothing to notify.
  if v_recipient_user_id is null then
    return new;
  end if;

  if tg_table_name = 'vaccinations' then
    v_notification_type := 'vaccination_reminder';
    v_title := 'Vaccination due: ' || new.vaccine_name;
  else
    v_notification_type := 'deworming_reminder';
    v_title := case new.parasite_type
      when 'external' then 'Tick & flea treatment due: '
      else 'Deworming due: '
    end || new.product;
  end if;
  v_body := 'Next due ' || to_char(new.next_due_date, 'DD Mon YYYY') || '.';

  perform public.enqueue_notification(
    new.organization_id, v_recipient_user_id, v_notification_type,
    v_title, v_body, tg_table_name, new.id, new.next_due_date - interval '7 days'
  );

  return new;
end;
$$;

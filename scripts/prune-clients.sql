-- ---------------------------------------------------------------------------
-- Prune the client roster down to a keep-list, taking their records with them.
--
-- READ THIS BEFORE RUNNING IT. This script permanently destroys clinical and
-- financial records: SOAP notes, prescriptions, vaccinations, deworming,
-- diagnostics, issued invoices, payments and refunds. That is the opposite of
-- what the rest of this schema is built to allow — every foreign key out of
-- clients and pets is ON DELETE RESTRICT precisely so this cannot happen by
-- accident, and 20261003000100_archive_purge.sql says why in as many words:
-- "Cascading there would mean an archived patient quietly taking a paid
-- invoice with it, and money is not the archive's to destroy."
--
-- So there is no cascade to lean on. This walks the graph by hand, in reverse
-- dependency order, inside one transaction.
--
-- It lives outside supabase/migrations deliberately. Migrations run in every
-- environment; this must only ever run where someone has typed it on purpose.
--
-- Usage — dry run (default: reports, then rolls back):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/prune-clients.sql
--
-- Usage — commit the deletion:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v apply=1 -f scripts/prune-clients.sql
--
-- The keep-list is the block marked KEEP LIST below. Edit it, do not guess.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

begin;

-- ---------------------------------------------------------------------------
-- KEEP LIST — the clients that survive. Everything else goes.
--
-- Replace the contents of this insert with the client ids to retain. It is an
-- explicit list rather than "the latest five" on purpose: created_at ties are
-- common (a seed or an import writes a whole roster in one second), and a
-- silent tie-break on a destructive operation is how the wrong person gets
-- deleted. If you genuinely want the newest five, run the SELECT commented out
-- underneath, read the names it returns, and paste those ids in here.
-- ---------------------------------------------------------------------------

create temporary table clients_to_keep (id uuid primary key) on commit drop;

insert into clients_to_keep (id) values
  ('00000000-0000-0000-0000-000000000000')  -- <- REPLACE ME
  -- ('...'), ('...'), ('...'), ('...')
;

--   select id, full_name, phone, created_at
--     from public.clients
--    where deleted_at is null
--    order by created_at desc, id
--    limit 5;

-- A keep-list that does not match real clients means "delete everyone", which
-- is never what was meant. Refuse rather than proceed.
do $$
declare
  v_asked integer;
  v_found integer;
begin
  select count(*) into v_asked from clients_to_keep;
  select count(*) into v_found
    from clients_to_keep k join public.clients c on c.id = k.id;

  if v_asked = 0 then
    raise exception 'The keep list is empty. Refusing to delete every client.';
  end if;

  if v_found <> v_asked then
    raise exception 'Keep list names % client(s), but only % exist. Fix the list.', v_asked, v_found;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The condemned set, resolved once so every delete below agrees on it.
-- ---------------------------------------------------------------------------

create temporary table clients_to_drop on commit drop as
  select c.id from public.clients c
  where c.id not in (select id from clients_to_keep);

create temporary table pets_to_drop on commit drop as
  select p.id from public.pets p
  where p.client_id in (select id from clients_to_drop);

create temporary table appointments_to_drop on commit drop as
  select a.id from public.appointments a
  where a.client_id in (select id from clients_to_drop)
     or a.pet_id in (select id from pets_to_drop);

create temporary table invoices_to_drop on commit drop as
  select i.id from public.invoices i
  where i.client_id in (select id from clients_to_drop)
     or i.pet_id in (select id from pets_to_drop)
     or i.appointment_id in (select id from appointments_to_drop);

create temporary table prescriptions_to_drop on commit drop as
  select pr.id from public.prescriptions pr
  where pr.pet_id in (select id from pets_to_drop)
     or pr.appointment_id in (select id from appointments_to_drop);

create temporary table documents_to_drop on commit drop as
  select d.id from public.documents d
  where d.pet_id in (select id from pets_to_drop);

-- ---------------------------------------------------------------------------
-- What is about to be destroyed. Printed before anything is touched, so a dry
-- run is a report and not a guess.
-- ---------------------------------------------------------------------------

select 'clients'            as table_name, count(*) as rows_to_delete from clients_to_drop
union all select 'pets',            count(*) from pets_to_drop
union all select 'appointments',    count(*) from appointments_to_drop
union all select 'invoices',        count(*) from invoices_to_drop
union all select 'prescriptions',   count(*) from prescriptions_to_drop
union all select 'documents',       count(*) from documents_to_drop
union all select 'invoice_items',   count(*) from public.invoice_items where invoice_id in (select id from invoices_to_drop)
union all select 'payments',        count(*) from public.payments where invoice_id in (select id from invoices_to_drop)
union all select 'refunds',         count(*) from public.refunds where invoice_id in (select id from invoices_to_drop)
union all select 'prescription_items', count(*) from public.prescription_items where prescription_id in (select id from prescriptions_to_drop)
union all select 'soap_records',    count(*) from public.soap_records where pet_id in (select id from pets_to_drop)
union all select 'diagnoses',       count(*) from public.diagnoses where pet_id in (select id from pets_to_drop)
union all select 'diagnostics',     count(*) from public.diagnostics where pet_id in (select id from pets_to_drop)
union all select 'vaccinations',    count(*) from public.vaccinations where pet_id in (select id from pets_to_drop)
union all select 'deworming_records', count(*) from public.deworming_records where pet_id in (select id from pets_to_drop)
order by 1;

-- Money that is about to stop existing, called out separately because a row
-- count does not convey it.
select
  round(coalesce(sum(p.amount_paisa), 0) / 100.0, 2) as payments_deleted_taka,
  count(*)                                           as payment_rows
from public.payments p
where p.invoice_id in (select id from invoices_to_drop);

-- ---------------------------------------------------------------------------
-- The deletion, in reverse dependency order.
--
-- guard_finalized_prescription_items has no auth.uid() escape hatch — unlike
-- guard_issued_invoice_items, which lets a no-session caller through — so a
-- finalized prescription's items refuse to go however privileged the caller
-- is. The trigger is disabled for this transaction and restored immediately;
-- it is a rule about editing a prescription, not about deleting the patient it
-- belonged to.
-- ---------------------------------------------------------------------------

alter table public.prescription_items disable trigger prescription_items_guard_finalized;

delete from public.refunds            where invoice_id in (select id from invoices_to_drop);
delete from public.payments           where invoice_id in (select id from invoices_to_drop);
delete from public.invoice_items      where invoice_id in (select id from invoices_to_drop);
delete from public.invoices           where id in (select id from invoices_to_drop);

delete from public.prescription_items where prescription_id in (select id from prescriptions_to_drop);
delete from public.prescriptions      where id in (select id from prescriptions_to_drop);

delete from public.soap_records       where pet_id in (select id from pets_to_drop);
delete from public.diagnoses          where pet_id in (select id from pets_to_drop);

-- diagnostics before documents: diagnostics.document_id references documents.
delete from public.diagnostics        where pet_id in (select id from pets_to_drop);
delete from public.documents          where id in (select id from documents_to_drop);

delete from public.vaccinations       where pet_id in (select id from pets_to_drop);
delete from public.deworming_records  where pet_id in (select id from pets_to_drop);

delete from public.appointments       where id in (select id from appointments_to_drop);
delete from public.pets               where id in (select id from pets_to_drop);
delete from public.clients            where id in (select id from clients_to_drop);

alter table public.prescription_items enable trigger prescription_items_guard_finalized;

-- notifications.related_table/related_id is a soft reference with no foreign
-- key, so nothing above touched it. Left dangling it makes reminders point at
-- patients that no longer exist.
delete from public.notification_logs
 where notification_id in (
   select n.id from public.notifications n
    where (n.related_table = 'pets'         and n.related_id in (select id from pets_to_drop))
       or (n.related_table = 'appointments' and n.related_id in (select id from appointments_to_drop))
       or (n.related_table = 'invoices'     and n.related_id in (select id from invoices_to_drop))
 );

delete from public.notifications n
 where (n.related_table = 'pets'         and n.related_id in (select id from pets_to_drop))
    or (n.related_table = 'appointments' and n.related_id in (select id from appointments_to_drop))
    or (n.related_table = 'invoices'     and n.related_id in (select id from invoices_to_drop));

-- ---------------------------------------------------------------------------
-- What is left.
--
-- Two things deliberately survive:
--   * audit_logs — the table refuses DELETE from everyone, service role
--     included (20260820000200). The clients, pets and documents deleted above
--     each leave a row recording who removed them and what they contained;
--     appointments, invoices and the clinical tables carry no delete trigger,
--     so their removal is not recorded anywhere. That asymmetry is worth
--     knowing before you rely on this for an audit answer.
--   * auth.users / public.users — a deleted client's login still exists.
--     Removing an account is a separate act with its own blast radius;
--     scripts/cleanup-orphaned-accounts.mjs is the supported way.
-- ---------------------------------------------------------------------------

select 'clients remaining' as check, count(*) from public.clients
union all select 'pets remaining', count(*) from public.pets
union all select 'appointments remaining', count(*) from public.appointments
union all select 'invoices remaining', count(*) from public.invoices;

\if :apply
  commit;
  \echo '>>> COMMITTED. The rows above are gone.'
\else
  rollback;
  \echo '>>> DRY RUN — rolled back, nothing was deleted. Pass -v apply=1 to commit.'
\endif

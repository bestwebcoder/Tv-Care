-- Three new ways money reaches an invoice.
--
-- Until now a payment was typed in by a billing manager, and was complete the
-- moment it was typed. A traveling vet takes cash or bKash in someone's living
-- room, and a client pays by bKash from their phone at midnight; neither is a
-- billing manager at a desk.
--
--   doctor_on_site     The attending vet records what they collected, against
--                      an invoice for their own appointment. Complete at once:
--                      the vet has the money. collected_by_doctor_id says who
--                      is holding it, for reconciliation.
--
--   client_submission  The client pays by bKash/Nagad/bank transfer themselves
--                      and submits the amount and transaction ID. It is
--                      PENDING — it does not reduce the balance — until someone
--                      with billing access checks it arrived and verifies it,
--                      or rejects it with a reason.
--
--   online_gateway     A hosted checkout (SSLCommerz). Created pending by the
--                      server, completed only by the server after it has
--                      validated the transaction with the gateway itself.
--
-- The ledger stays a ledger. The only update a payment can ever take is its one
-- status transition, pending → completed or pending → failed, enforced by a
-- trigger for every caller including the service role.

alter table public.payments
  add column source text not null default 'staff',
  add column collected_by_doctor_id uuid references public.doctors (id) on delete restrict,
  add column submitted_by uuid references public.users (id) on delete restrict,
  add column verified_by uuid references public.users (id) on delete restrict,
  add column verified_at timestamptz,
  add column rejection_reason text,
  add column gateway_validation_id text;

alter table public.payments
  add constraint payments_source_allowed
    check (source in ('staff', 'doctor_on_site', 'client_submission', 'online_gateway')),
  add constraint payments_on_site_names_doctor
    check (source <> 'doctor_on_site' or collected_by_doctor_id is not null),
  -- A submission is only checkable against a statement if it says which
  -- transaction to look for.
  add constraint payments_client_submission_shape
    check (
      source <> 'client_submission'
      or (reference_number is not null and method in ('bkash', 'nagad', 'bank_transfer'))
    ),
  add constraint payments_rejection_has_reason
    check (status <> 'failed' or source not in ('client_submission') or rejection_reason is not null);

-- The same bKash transaction cannot be submitted twice. A rejected submission
-- frees the ID again, in case it was rejected by mistake.
create unique index payments_submitted_reference_key
  on public.payments (organization_id, method, lower(reference_number))
  where source in ('client_submission', 'online_gateway')
    and status <> 'failed'
    and reference_number is not null;

create index payments_pending_idx
  on public.payments (organization_id, created_at)
  where status = 'pending';

create index payments_collected_by_doctor_id_idx
  on public.payments (collected_by_doctor_id)
  where collected_by_doctor_id is not null;

-- ---------------------------------------------------------------------------
-- Amount guard. The actions check this too, for the message; this is the
-- guarantee, and it holds under concurrent submissions because it locks the
-- invoice row first.
--
-- Scoped to the new sources and to verification. Staff-recorded payments keep
-- exactly the behaviour they had — including the data import, which writes
-- historical payments through the service role.
-- ---------------------------------------------------------------------------

create or replace function public.guard_payment_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
  v_status text;
  v_pending integer;
begin
  if tg_op = 'INSERT' and new.source = 'staff' then
    return new;
  end if;

  if tg_op = 'UPDATE' and not (old.status = 'pending' and new.status = 'completed') then
    return new;
  end if;

  select balance_paisa, status into v_balance, v_status
    from public.invoices
   where id = new.invoice_id
   for update;

  if v_status not in ('issued', 'partially_paid') then
    raise exception 'This invoice is not open for payment.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    -- Other submissions still waiting count against what is left, or two
    -- submissions could each cover the whole balance.
    select coalesce(sum(amount_paisa), 0) into v_pending
      from public.payments
     where invoice_id = new.invoice_id and status = 'pending';

    if new.amount_paisa > v_balance - v_pending then
      raise exception 'That amount is more than the balance still to be paid.'
        using errcode = '23514';
    end if;
  elsif new.amount_paisa > v_balance then
    raise exception 'That amount is more than the remaining balance on this invoice.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger payments_guard_amount
  before insert or update on public.payments
  for each row execute function public.guard_payment_amount();

-- ---------------------------------------------------------------------------
-- The one permitted update: pending → completed | failed.
-- ---------------------------------------------------------------------------

create or replace function public.guard_payment_update()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' or new.status not in ('completed', 'failed') then
    raise exception 'A recorded payment cannot be changed. Record a refund instead.';
  end if;

  if to_jsonb(new) - 'status' - 'verified_by' - 'verified_at' - 'rejection_reason' - 'gateway_validation_id'
     is distinct from
     to_jsonb(old) - 'status' - 'verified_by' - 'verified_at' - 'rejection_reason' - 'gateway_validation_id'
  then
    raise exception 'Only a pending payment''s status can change.';
  end if;

  new.verified_at := coalesce(new.verified_at, now());
  return new;
end;
$$;

create trigger payments_guard_update
  before update on public.payments
  for each row execute function public.guard_payment_update();

-- Totals and the audit trail follow the transition.
create trigger payments_recalculate_totals_on_status
  after update of status on public.payments
  for each row
  when (old.status is distinct from new.status)
  execute function public.recalculate_invoice_totals();

create trigger payments_audit_update
  after update on public.payments
  for each row execute function public.write_audit_log();

-- "Payment received" only once money has actually been received: on a
-- completed insert, or when a pending payment is verified.
create or replace function public.notify_payment_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_user_id uuid;
  v_client_id uuid;
  v_organization_id uuid;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'completed' then
    return new;
  end if;

  select client_id, organization_id into v_client_id, v_organization_id
    from public.invoices where id = new.invoice_id;
  select c.user_id into v_recipient_user_id from public.clients c where c.id = v_client_id;

  if v_recipient_user_id is null then
    return new;
  end if;

  perform public.enqueue_notification(
    v_organization_id, v_recipient_user_id, 'payment_confirmation',
    'Payment received',
    'We received a payment of ' || (new.amount_paisa / 100.0)::text || ' BDT.',
    'payments', new.id, now()
  );

  return new;
end;
$$;

create trigger payments_notify_verified
  after update of status on public.payments
  for each row
  when (old.status = 'pending' and new.status = 'completed')
  execute function public.notify_payment_recorded();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- The attending vet, on their own appointment's open invoice, recording money
-- they took themselves. Not billing access: they cannot raise, discount,
-- cancel or refund an invoice, and cannot record against anyone else's visit.
create policy payments_insert_attending_doctor on public.payments
  for insert to authenticated
  with check (
    source = 'doctor_on_site'
    and status = 'completed'
    and gateway = 'manual'
    and recorded_by = (select auth.uid())
    and exists (
      select 1
      from public.invoices i
      join public.appointments a on a.id = i.appointment_id
      join public.doctors d on d.id = a.doctor_id
      where i.id = payments.invoice_id
        and i.organization_id = payments.organization_id
        and i.status in ('issued', 'partially_paid')
        and d.id = payments.collected_by_doctor_id
        and d.user_id = (select auth.uid())
        and d.deleted_at is null
    )
  );

-- A client, on their own open invoice, telling the practice they paid. Pending
-- only: the balance does not move until staff verify it.
create policy payments_insert_client_submission on public.payments
  for insert to authenticated
  with check (
    source = 'client_submission'
    and status = 'pending'
    and gateway = 'manual'
    and submitted_by = (select auth.uid())
    and recorded_by is null
    and verified_by is null
    and exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id
        and i.organization_id = payments.organization_id
        and i.status in ('issued', 'partially_paid')
        and public.owns_client(i.client_id)
    )
  );

-- Verifying or rejecting a pending payment: whoever may take payments.
create policy payments_verify on public.payments
  for update to authenticated
  using (
    status = 'pending'
    and (
      public.is_billing_manager(organization_id)
      or organization_id in (select public.my_org_ids(array['finance_manager']))
      or organization_id in (select public.my_permission_org_ids('billing.manage'))
    )
  )
  with check (
    status in ('completed', 'failed')
    and verified_by = (select auth.uid())
  );

grant update (status, verified_by, verified_at, rejection_reason) on public.payments to authenticated;

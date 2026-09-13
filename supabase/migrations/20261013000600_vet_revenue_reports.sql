-- Revenue per veterinarian, and each vet's view of their own.
--
-- report_revenue_by_doctor (20260828000100, guard widened in 20260917000100)
-- answers one number per doctor: billed revenue. A practice paying traveling
-- vets needs the rest of the picture — what was collected, what they are
-- holding from home visits, what is still owed, and how much of the work was
-- at the clinic versus on the road.
--
-- ACCESS
--
-- Same boundary as every financial report: security definer, checked before a
-- row is read, through is_financial_report_viewer(). With one addition — a
-- doctor may always ask about THEMSELVES. That does not widen what a doctor
-- can already see (they read invoices and payments org-wide for per-record
-- reasons; see 20260828000100's header); it gives them the sums of their own
-- work without the org-wide report permission.
--
-- DEFINITIONS (consistent with the existing financial report)
--
--   billed       invoice totals by issued_at, excluding draft/cancelled,
--                attributed through the invoice's appointment's doctor
--   collected    completed payments by paid_at, less refunds by refunded_at,
--                on those same invoices
--   on_site      completed payments the vet recorded collecting in person,
--                by paid_at — what they should be handing over
--   outstanding  balance still open on invoices issued in the range

create or replace function public.can_view_vet_revenue(p_organization_id uuid, p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_financial_report_viewer(p_organization_id)
    or (
      p_doctor_id is not null and exists (
        select 1 from public.doctors d
        where d.id = p_doctor_id
          and d.organization_id = p_organization_id
          and d.user_id = (select auth.uid())
          and d.deleted_at is null
      )
    );
$$;

revoke all on function public.can_view_vet_revenue(uuid, uuid) from public, anon;
grant execute on function public.can_view_vet_revenue(uuid, uuid) to authenticated, service_role;

-- p_doctor_id null = every vet in the practice (report viewers only);
-- a doctor id = just that vet.
create or replace function public.report_vet_revenue(
  p_organization_id uuid, p_from date, p_to date, p_doctor_id uuid default null
)
returns table (
  doctor_id uuid,
  doctor_name text,
  completed_appointments bigint,
  clinic_visits bigint,
  home_visits bigint,
  billed_paisa bigint,
  collected_paisa bigint,
  collected_on_site_paisa bigint,
  outstanding_paisa bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_doctor_id is null then
    if not public.is_financial_report_viewer(p_organization_id) then
      raise exception 'You do not have access to reports.';
    end if;
  elsif not public.can_view_vet_revenue(p_organization_id, p_doctor_id) then
    raise exception 'You do not have access to reports.';
  end if;

  return query
  with vets as (
    select d.id, coalesce(u.full_name, 'Unnamed doctor') as name
    from public.doctors d
    left join public.users u on u.id = d.user_id
    where d.organization_id = p_organization_id
      and (p_doctor_id is null or d.id = p_doctor_id)
      -- A removed vet still appears if they have activity in the range; see
      -- the having-style filter at the end.
  ),
  visits as (
    select a.doctor_id,
           count(*) as completed,
           count(*) filter (where a.visit_type = 'home') as home,
           count(*) filter (where a.visit_type <> 'home') as clinic
    from public.appointments a
    where a.organization_id = p_organization_id
      and a.status = 'completed'
      and a.deleted_at is null
      and a.starts_at::date between p_from and p_to
    group by a.doctor_id
  ),
  billed as (
    select a.doctor_id,
           sum(i.total_paisa) as billed,
           sum(i.balance_paisa) filter (where i.status in ('issued', 'partially_paid')) as outstanding
    from public.invoices i
    join public.appointments a on a.id = i.appointment_id
    where i.organization_id = p_organization_id
      and i.deleted_at is null
      and i.status not in ('draft', 'cancelled')
      and i.issued_at::date between p_from and p_to
    group by a.doctor_id
  ),
  paid as (
    select a.doctor_id, sum(p.amount_paisa) as paid
    from public.payments p
    join public.invoices i on i.id = p.invoice_id
    join public.appointments a on a.id = i.appointment_id
    where p.organization_id = p_organization_id
      and p.status = 'completed'
      and p.paid_at::date between p_from and p_to
    group by a.doctor_id
  ),
  refunded as (
    select a.doctor_id, sum(r.amount_paisa) as refunded
    from public.refunds r
    join public.invoices i on i.id = r.invoice_id
    join public.appointments a on a.id = i.appointment_id
    where r.organization_id = p_organization_id
      and r.refunded_at::date between p_from and p_to
    group by a.doctor_id
  ),
  on_site as (
    select p.collected_by_doctor_id as doctor_id, sum(p.amount_paisa) as on_site
    from public.payments p
    where p.organization_id = p_organization_id
      and p.source = 'doctor_on_site'
      and p.status = 'completed'
      and p.paid_at::date between p_from and p_to
    group by p.collected_by_doctor_id
  )
  select v.id,
         v.name,
         coalesce(vi.completed, 0)::bigint,
         coalesce(vi.clinic, 0)::bigint,
         coalesce(vi.home, 0)::bigint,
         coalesce(b.billed, 0)::bigint,
         (coalesce(pd.paid, 0) - coalesce(rf.refunded, 0))::bigint,
         coalesce(os.on_site, 0)::bigint,
         coalesce(b.outstanding, 0)::bigint
  from vets v
  left join visits vi on vi.doctor_id = v.id
  left join billed b on b.doctor_id = v.id
  left join paid pd on pd.doctor_id = v.id
  left join refunded rf on rf.doctor_id = v.id
  left join on_site os on os.doctor_id = v.id
  where p_doctor_id is not null
     or exists (select 1 from public.doctors d where d.id = v.id and d.deleted_at is null)
     or vi.completed is not null or b.billed is not null or pd.paid is not null or os.on_site is not null
  order by coalesce(b.billed, 0) desc, v.name;
end;
$$;

-- One vet's billed revenue by line item — the drill-down.
create or replace function public.report_vet_revenue_by_service(
  p_organization_id uuid, p_doctor_id uuid, p_from date, p_to date
)
returns table (service_name text, quantity bigint, revenue_paisa bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_vet_revenue(p_organization_id, p_doctor_id) then
    raise exception 'You do not have access to reports.';
  end if;

  return query
  select ii.description as service_name,
         sum(ii.quantity)::bigint as quantity,
         sum(ii.line_total_paisa)::bigint as revenue_paisa
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
  join public.appointments a on a.id = i.appointment_id
  where i.organization_id = p_organization_id
    and a.doctor_id = p_doctor_id
    and i.deleted_at is null
    and i.status not in ('draft', 'cancelled')
    and i.issued_at::date between p_from and p_to
  group by ii.description
  order by revenue_paisa desc;
end;
$$;

revoke all on function public.report_vet_revenue(uuid, date, date, uuid) from public, anon;
revoke all on function public.report_vet_revenue_by_service(uuid, uuid, date, date) from public, anon;
grant execute on function public.report_vet_revenue(uuid, date, date, uuid) to authenticated, service_role;
grant execute on function public.report_vet_revenue_by_service(uuid, uuid, date, date) to authenticated, service_role;

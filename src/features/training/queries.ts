import { formatCurrency } from "@/lib/currency";
import type { DeliveryMode } from "@/lib/validation/training-course";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { formatZonedRange, utcToZonedParts } from "@/lib/zoned-time";

/** Training course reads. Admin reads run under RLS; the public page reads published sessions through the service client, as it reads services. */

export type Result<T> = { status: "ok"; data: T } | { status: "error" };

export type TrainingCourse = {
  id: string;
  title: string;
  summary: string | null;
  audience: string | null;
  serviceId: string | null;
  programmeName: string | null;
  deliveryMode: DeliveryMode;
  location: string | null;
  startsAt: string;
  endsAt: string;
  /** In the practice's timezone, for forms and calendar placement. */
  startsOn: string;
  startTime: string;
  endsOn: string;
  endTime: string;
  when: string;
  feePaisa: number | null;
  fee: string | null;
  seats: number | null;
  isPublished: boolean;
  isCancelled: boolean;
};

const COURSE_COLUMNS = `
  id, title, summary, audience, service_id, delivery_mode, location, starts_at, ends_at,
  fee_paisa, seats, is_published, cancelled_at,
  service:services (name)
`;

/* eslint-disable @typescript-eslint/no-explicit-any -- shaped by COURSE_COLUMNS */
function toCourse(row: any, timeZone: string): TrainingCourse {
  const service = Array.isArray(row.service) ? row.service[0] : row.service;
  const start = utcToZonedParts(row.starts_at, timeZone);
  const end = utcToZonedParts(row.ends_at, timeZone);

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    audience: row.audience,
    serviceId: row.service_id,
    programmeName: service?.name ?? null,
    deliveryMode: row.delivery_mode,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startsOn: start.date,
    startTime: start.time,
    endsOn: end.date,
    endTime: end.time,
    when: formatZonedRange(row.starts_at, row.ends_at, timeZone),
    feePaisa: row.fee_paisa,
    fee: row.fee_paisa === null ? null : row.fee_paisa === 0 ? "Free" : formatCurrency(row.fee_paisa),
    seats: row.seats,
    isPublished: row.is_published,
    isCancelled: row.cancelled_at !== null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listTrainingCoursesForAdmin(organizationId: string, timeZone: string): Promise<Result<TrainingCourse[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("training_courses")
    .select(COURSE_COLUMNS)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("starts_at", { ascending: false });

  if (error) {
    console.error("[training] admin list failed", error);
    return { status: "error" };
  }

  return { status: "ok", data: (data ?? []).map((row) => toCourse(row, timeZone)) };
}

/** The practice's timezone, for the public page — which has no session to read it through. */
export async function getPracticeTimeZone(organizationId: string): Promise<string> {
  const { data } = await createServiceClient().from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  return data?.timezone ?? "Asia/Dhaka";
}

/**
 * Published sessions overlapping [fromIso, toIso) — a calendar month, or
 * "from now" for the upcoming list. Cancelled sessions are included so a
 * cancellation is visible rather than a session silently vanishing.
 */
export async function listPublicTrainingCourses(
  organizationId: string,
  timeZone: string,
  window: { fromIso: string; toIso?: string; limit?: number },
): Promise<Result<TrainingCourse[]>> {
  let query = createServiceClient()
    .from("training_courses")
    .select(COURSE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("is_published", true)
    .is("deleted_at", null)
    .gte("ends_at", window.fromIso)
    .order("starts_at", { ascending: true });

  if (window.toIso) query = query.lt("starts_at", window.toIso);
  if (window.limit) query = query.limit(window.limit);

  const { data, error } = await query;

  if (error) {
    console.error("[training] public list failed", error);
    return { status: "error" };
  }

  return { status: "ok", data: (data ?? []).map((row) => toCourse(row, timeZone)) };
}

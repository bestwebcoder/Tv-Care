"use server";

import { revalidatePath } from "next/cache";

import { getSessionUser } from "@/features/auth/session";
import { getOwnOrganization } from "@/features/organizations/queries";
import { failure, invalid, text, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { trainingCourseSchema, trainingCourseToRow } from "@/lib/validation/training-course";

/**
 * Training course writes. Who may make them — an administrator, or a role
 * holding website.manage — is decided by row level security on
 * training_courses; these shape the write and say what went wrong.
 */

function readCourseForm(formData: FormData) {
  return {
    title: text(formData, "title") ?? "",
    summary: text(formData, "summary") ?? "",
    audience: text(formData, "audience") ?? "",
    serviceId: text(formData, "serviceId") ?? "",
    deliveryMode: text(formData, "deliveryMode") ?? "",
    location: text(formData, "location") ?? "",
    startsOn: text(formData, "startsOn") ?? "",
    startTime: text(formData, "startTime") ?? "",
    endsOn: text(formData, "endsOn") ?? "",
    endTime: text(formData, "endTime") ?? "",
    feePaisa: text(formData, "feePaisa") ?? "",
    seats: text(formData, "seats") ?? "",
    isPublished: text(formData, "isPublished") ?? "false",
  };
}

function revalidateTraining() {
  revalidatePath("/admin/website/training");
  revalidatePath("/training-education");
}

async function practice(): Promise<{ organizationId: string; timeZone: string; userId: string } | null> {
  const user = await getSessionUser();
  const organizationId = user?.organizationIds[0];
  if (!user || !organizationId) return null;

  const organization = await getOwnOrganization(organizationId);
  const timeZone = organization.status === "ok" && organization.data ? organization.data.timezone : "Asia/Dhaka";
  return { organizationId, timeZone, userId: user.id };
}

export async function createTrainingCourseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = trainingCourseSchema.safeParse(readCourseForm(formData));
  if (!parsed.success) return invalid(parsed.error);

  const context = await practice();
  if (!context) return { status: "error", message: "Please sign in again." };

  const supabase = await createClient();
  const { error } = await supabase.from("training_courses").insert({
    ...trainingCourseToRow(parsed.data, context.timeZone),
    organization_id: context.organizationId,
    created_by: context.userId,
  });

  if (error) return failure("training_courses", error, "We could not save that course just now. Please try again.");

  revalidateTraining();
  return {
    status: "success",
    message: parsed.data.isPublished ? "Course added to the public calendar." : "Course saved as a draft.",
  };
}

export async function updateTrainingCourseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const courseId = text(formData, "courseId");
  if (!courseId) return { status: "error", message: "We could not tell which course to update." };

  const parsed = trainingCourseSchema.safeParse(readCourseForm(formData));
  if (!parsed.success) return invalid(parsed.error);

  const context = await practice();
  if (!context) return { status: "error", message: "Please sign in again." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_courses")
    .update(trainingCourseToRow(parsed.data, context.timeZone))
    .eq("id", courseId)
    .select("id")
    .maybeSingle();

  if (error) return failure("training_courses", error, "We could not save these changes just now. Please try again.");
  if (!data) return { status: "error", message: "You do not have access to this course." };

  revalidateTraining();
  return { status: "success", message: "Changes saved." };
}

/** Publish/unpublish, cancel/restore and archive — one small update each. */
export async function setTrainingCourseStateAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const courseId = text(formData, "courseId");
  const change = text(formData, "change");
  if (!courseId || !change) return { status: "error", message: "We could not tell what to change." };

  const now = new Date().toISOString();
  const updates: Record<string, { patch: Record<string, unknown>; message: string }> = {
    publish: { patch: { is_published: true }, message: "Course published." },
    unpublish: { patch: { is_published: false }, message: "Course hidden from the public calendar." },
    cancel: { patch: { cancelled_at: now }, message: "Course marked as cancelled." },
    restore: { patch: { cancelled_at: null }, message: "Course reinstated." },
    archive: { patch: { deleted_at: now }, message: "Course archived." },
  };

  const update = updates[change];
  if (!update) return { status: "error", message: "We could not tell what to change." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_courses")
    .update(update.patch)
    .eq("id", courseId)
    .select("id")
    .maybeSingle();

  if (error) return failure("training_courses", error, "We could not update this course just now. Please try again.");
  if (!data) return { status: "error", message: "You do not have access to this course." };

  revalidateTraining();
  return { status: "success", message: update.message };
}

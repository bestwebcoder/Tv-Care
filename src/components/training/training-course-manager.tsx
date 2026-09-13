"use client";

import { useActionState, useState } from "react";

import { DatePicker } from "@/components/form/date-picker";
import { Field } from "@/components/form/field";
import { FormAlert } from "@/components/form/form-alert";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { TextAreaField } from "@/components/form/textarea-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createTrainingCourseAction,
  setTrainingCourseStateAction,
  updateTrainingCourseAction,
} from "@/features/training/actions";
import type { TrainingCourse } from "@/features/training/queries";
import { idleState } from "@/lib/forms";
import { DELIVERY_MODE_LABELS, DELIVERY_MODES, type DeliveryMode } from "@/lib/validation/training-course";

type Programme = { id: string; name: string };

function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

function CourseFields({
  programmes,
  defaults,
  errors,
  timeZone,
}: {
  programmes: Programme[];
  defaults?: TrainingCourse;
  errors?: Record<string, string[] | undefined>;
  timeZone: string;
}) {
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(defaults?.deliveryMode ?? "in_person");

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Course title" name="title" defaultValue={defaults?.title ?? ""} errors={errors?.title} />
        <Field
          label="Who it is for (optional)"
          name="audience"
          defaultValue={defaults?.audience ?? ""}
          hint="For example: registered veterinarians, final-year students"
          errors={errors?.audience}
        />
        <SelectField
          label="Programme (optional)"
          name="serviceId"
          options={[{ value: "", label: "Not part of a listed programme" }, ...programmes.map((p) => ({ value: p.id, label: p.name }))]}
          defaultValue={defaults?.serviceId ?? ""}
        />
        <SelectField
          label="Delivery"
          name="deliveryMode"
          options={DELIVERY_MODES.map((value) => ({ value, label: DELIVERY_MODE_LABELS[value] }))}
          value={deliveryMode}
          onValueChange={(value) => setDeliveryMode(value as DeliveryMode)}
          errors={errors?.deliveryMode}
        />
      </div>

      <Field
        label={deliveryMode === "online" ? "Joining details (optional)" : "Location"}
        name="location"
        defaultValue={defaults?.location ?? ""}
        hint={deliveryMode === "online" ? "Shown publicly — share private links with attendees directly." : undefined}
        errors={errors?.location}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <DatePicker label="Starts on" name="startsOn" defaultValue={toDate(defaults?.startsOn)} errors={errors?.startsOn} />
        <Field label="Start time" name="startTime" type="time" defaultValue={defaults?.startTime ?? "09:00"} errors={errors?.startTime} />
        <DatePicker label="Ends on" name="endsOn" defaultValue={toDate(defaults?.endsOn)} errors={errors?.endsOn} />
        <Field label="End time" name="endTime" type="time" defaultValue={defaults?.endTime ?? "17:00"} errors={errors?.endTime} />
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">Times are in the practice&apos;s timezone ({timeZone}).</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Fee (৳, optional)"
          name="feePaisa"
          inputMode="decimal"
          defaultValue={defaults?.feePaisa != null ? (defaults.feePaisa / 100).toFixed(2) : ""}
          hint="0 for free; blank to leave unpublished"
          errors={errors?.feePaisa}
        />
        <Field
          label="Seats (optional)"
          name="seats"
          inputMode="numeric"
          defaultValue={defaults?.seats?.toString() ?? ""}
          errors={errors?.seats}
        />
        <SelectField
          label="Visibility"
          name="isPublished"
          options={[
            { value: "false", label: "Draft — admins only" },
            { value: "true", label: "Published on the website" },
          ]}
          defaultValue={defaults ? String(defaults.isPublished) : "false"}
        />
      </div>

      <TextAreaField label="Summary (optional)" name="summary" rows={3} defaultValue={defaults?.summary ?? ""} errors={errors?.summary} />
    </div>
  );
}

function AddCourseForm({ programmes, timeZone }: { programmes: Programme[]; timeZone: string }) {
  const [state, formAction] = useActionState(createTrainingCourseAction, idleState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <FormAlert state={state} />
      <CourseFields programmes={programmes} errors={fieldErrors} timeZone={timeZone} />
      <div>
        <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
          Add course
        </SubmitButton>
      </div>
    </form>
  );
}

function StateButton({ courseId, change, label }: { courseId: string; change: string; label: string }) {
  const [, formAction] = useActionState(setTrainingCourseStateAction, idleState);

  return (
    <form action={formAction}>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="change" value={change} />
      <Button type="submit" variant="ghost" size="sm">
        {label}
      </Button>
    </form>
  );
}

function ArchiveDialog({ course }: { course: TrainingCourse }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(setTrainingCourseStateAction, idleState);

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "success") setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>Archive</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive “{course.title}”?</DialogTitle>
          <DialogDescription>
            It disappears from this list and the public calendar. To tell people a session will not run, use Cancel
            instead — it stays visible, marked as cancelled.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="grid gap-4">
          <FormAlert state={state} />
          <input type="hidden" name="courseId" value={course.id} />
          <input type="hidden" name="change" value="archive" />
          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <SubmitButton variant="destructive" pendingLabel="Archiving…" className="sm:w-auto">
              Archive
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CourseRow({ course, programmes, timeZone }: { course: TrainingCourse; programmes: Programme[]; timeZone: string }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(updateTrainingCourseAction, idleState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  if (editing) {
    return (
      <li className="rounded-lg border p-3">
        <form action={formAction} className="grid gap-4" noValidate>
          <FormAlert state={state} />
          <input type="hidden" name="courseId" value={course.id} />
          <CourseFields programmes={programmes} defaults={course} errors={fieldErrors} timeZone={timeZone} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
              Save changes
            </SubmitButton>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Done
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="grid gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="font-medium">{course.title}</span>
          <span className="text-muted-foreground text-xs" data-numeric>
            {course.when} · {DELIVERY_MODE_LABELS[course.deliveryMode]}
            {course.location ? ` · ${course.location}` : ""}
          </span>
          <span className="text-muted-foreground text-xs" data-numeric>
            {[course.programmeName, course.fee, course.seats ? `${course.seats} seats` : null].filter(Boolean).join(" · ") ||
              "No fee or seat limit published"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={course.isPublished ? "default" : "outline"}>{course.isPublished ? "Published" : "Draft"}</Badge>
          {course.isCancelled ? <Badge variant="destructive">Cancelled</Badge> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <StateButton courseId={course.id} change={course.isPublished ? "unpublish" : "publish"} label={course.isPublished ? "Unpublish" : "Publish"} />
        <StateButton courseId={course.id} change={course.isCancelled ? "restore" : "cancel"} label={course.isCancelled ? "Reinstate" : "Cancel"} />
        <ArchiveDialog course={course} />
      </div>
    </li>
  );
}

export function TrainingCourseList({
  courses,
  programmes,
  timeZone,
  emptyMessage,
}: {
  courses: TrainingCourse[];
  programmes: Programme[];
  timeZone: string;
  emptyMessage: string;
}) {
  if (courses.length === 0) return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;

  return (
    <ul className="grid gap-2">
      {courses.map((course) => (
        <CourseRow key={course.id} course={course} programmes={programmes} timeZone={timeZone} />
      ))}
    </ul>
  );
}

export { AddCourseForm };

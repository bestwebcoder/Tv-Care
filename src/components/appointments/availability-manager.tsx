"use client";

import { useActionState, useState } from "react";

import { Field } from "@/components/form/field";
import { FormAlert } from "@/components/form/form-alert";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  createAvailabilityAction,
  deleteAvailabilityAction,
  setAvailabilityActiveAction,
  updateAvailabilityAction,
} from "@/features/appointments/availability-actions";
import type { AvailabilityWindow } from "@/features/appointments/queries";
import { idleState, type FormState } from "@/lib/forms";
import { VISIT_TYPE_LABELS, VISIT_TYPES } from "@/lib/validation/appointment";
import { slotCount, WEEKDAY_LABELS, WEEKDAY_SHORT_LABELS } from "@/lib/validation/availability";
import { cn } from "@/lib/utils";

type Branch = { id: string; name: string };
type ServerAction = (state: FormState, formData: FormData) => Promise<FormState>;

const TIME_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function timeLabel(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return TIME_LABEL_FORMATTER.format(new Date(2000, 0, 1, hours, minutes));
}

function visitTypeLabel(visitType: string | null) {
  if (!visitType) return "Any visit type";
  return VISIT_TYPE_LABELS[visitType as keyof typeof VISIT_TYPE_LABELS] ?? visitType;
}

/**
 * Closes a dialog once its action has succeeded — the species manager's trick.
 *
 * A success carrying a warning stays open: adding one window across five days
 * can land on four of them, and closing the dialog would take the sentence
 * saying which day was skipped away with it.
 */
function useCloseOnSuccess(action: ServerAction) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, idleState);

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state.status === "success" && !state.warning) setOpen(false);
  }

  return { open, setOpen, state, formAction };
}

/** A one-field form posted by a button — pause, resume. */
function InlineAction({
  action,
  fields,
  children,
}: {
  action: ServerAction;
  fields: Record<string, string>;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, idleState);

  return (
    <form action={formAction} className="contents">
      {Object.entries(fields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <Button type="submit" variant="ghost" size="sm">
        {children}
      </Button>
      {state.status === "error" ? (
        <span className="text-destructive w-full text-sm" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// The window itself — the same fields whether it is being added or edited
// ---------------------------------------------------------------------------

function WindowFields({
  idPrefix,
  defaults,
  branches,
  errors,
}: {
  idPrefix: string;
  defaults?: AvailabilityWindow;
  branches: Branch[];
  errors?: Record<string, string[] | undefined>;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Starts at"
          id={`${idPrefix}-startsAt`}
          name="startsAt"
          type="time"
          required
          defaultValue={defaults?.startsAt ?? "09:00"}
          errors={errors?.startsAt}
        />
        <Field
          label="Ends at"
          id={`${idPrefix}-endsAt`}
          name="endsAt"
          type="time"
          required
          defaultValue={defaults?.endsAt ?? "17:00"}
          errors={errors?.endsAt}
        />
      </div>

      <Field
        label="Slot length (minutes)"
        id={`${idPrefix}-slotMinutes`}
        name="slotMinutes"
        type="number"
        inputMode="numeric"
        min={5}
        max={240}
        step={5}
        defaultValue={defaults?.slotMinutes ?? 30}
        required
        hint="How often a start time is offered. A longer service simply takes more than one slot's worth of the window."
        errors={errors?.slotMinutes}
      />

      <SelectField
        label="Visit type"
        id={`${idPrefix}-visitType`}
        name="visitType"
        options={[
          { value: "", label: "Any visit type" },
          ...VISIT_TYPES.map((value) => ({ value, label: VISIT_TYPE_LABELS[value] })),
        ]}
        defaultValue={defaults?.visitType ?? ""}
        hint="Restrict the window to one kind of visit — a home-visit round, or a surgery list."
        errors={errors?.visitType}
      />

      {branches.length > 0 ? (
        <SelectField
          label="Branch"
          id={`${idPrefix}-branchId`}
          name="branchId"
          options={[
            { value: "", label: "Any branch (or home visits)" },
            ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
          ]}
          defaultValue={defaults?.branchId ?? ""}
          hint="Where the doctor is during this window. Recorded for the rota; every branch's clients see the same times."
          errors={errors?.branchId}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

/**
 * The days a window covers.
 *
 * Checkboxes rather than a single day select: a doctor working Sunday to
 * Thursday is one decision, and asking for the same times five separate times
 * is how a Wednesday goes missing.
 */
function WeekdayPicker({ idPrefix, errors }: { idPrefix: string; errors?: string[] }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Working days</legend>
      <div className="flex flex-wrap gap-2">
        {WEEKDAY_SHORT_LABELS.map((short, index) => (
          <label
            key={short}
            htmlFor={`${idPrefix}-day-${index}`}
            className="has-checked:border-primary has-checked:bg-primary/10 has-checked:text-foreground text-muted-foreground border-input hover:bg-muted/60 has-focus-visible:ring-ring/50 flex min-h-11 min-w-13 cursor-pointer items-center justify-center rounded-md border px-3 text-sm transition-colors select-none has-focus-visible:ring-3"
          >
            <input
              id={`${idPrefix}-day-${index}`}
              type="checkbox"
              name="weekdays"
              value={index}
              className="sr-only"
            />
            <span aria-hidden>{short}</span>
            <span className="sr-only">{WEEKDAY_LABELS[index]}</span>
          </label>
        ))}
      </div>
      {errors?.length ? (
        <p className="text-destructive text-sm" role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </fieldset>
  );
}

function AddWindowDialog({ doctorId, doctorName, branches }: { doctorId: string; doctorName: string; branches: Branch[] }) {
  const { open, setOpen, state, formAction } = useCloseOnSuccess(createAvailabilityAction);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const idPrefix = `availability-new-${doctorId}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="touch" />}>Add hours</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add working hours</DialogTitle>
          <DialogDescription>
            {doctorName}&rsquo;s bookable hours. To leave a lunch break, add a morning window and an afternoon one —
            the gap between them is the break.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="grid gap-4" noValidate>
          <FormAlert state={state} />
          <input type="hidden" name="doctorId" value={doctorId} />

          <WeekdayPicker idPrefix={idPrefix} errors={fieldErrors?.weekdays} />
          <WindowFields idPrefix={idPrefix} branches={branches} errors={fieldErrors} />

          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Adding…" className="sm:w-auto">
              Add hours
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit and remove
// ---------------------------------------------------------------------------

function EditWindowDialog({ window, branches }: { window: AvailabilityWindow; branches: Branch[] }) {
  const { open, setOpen, state, formAction } = useCloseOnSuccess(updateAvailabilityAction);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const idPrefix = `availability-${window.id}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>Edit</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {WEEKDAY_LABELS[window.weekday]} hours</DialogTitle>
          <DialogDescription>
            Changing these hours changes what is offered from now on. Appointments already booked keep their times.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="grid gap-4" noValidate>
          <FormAlert state={state} />
          <input type="hidden" name="availabilityId" value={window.id} />

          <SelectField
            label="Day"
            id={`${idPrefix}-weekday`}
            name="weekday"
            options={WEEKDAY_LABELS.map((label, index) => ({ value: String(index), label }))}
            defaultValue={String(window.weekday)}
            errors={fieldErrors?.weekday}
          />
          <WindowFields idPrefix={idPrefix} defaults={window} branches={branches} errors={fieldErrors} />

          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
              Save hours
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveWindowDialog({ window }: { window: AvailabilityWindow }) {
  const { open, setOpen, state, formAction } = useCloseOnSuccess(deleteAvailabilityAction);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>Remove</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove these hours?</DialogTitle>
          <DialogDescription>
            {WEEKDAY_LABELS[window.weekday]}, {timeLabel(window.startsAt)} to {timeLabel(window.endsAt)}. No new times
            will be offered in this window. Appointments already booked in it are not cancelled — if the doctor is away
            for a while, pause it instead.
          </DialogDescription>
        </DialogHeader>
        <FormAlert state={state} />
        <form action={formAction}>
          <input type="hidden" name="availabilityId" value={window.id} />
          <DialogFooter>
            <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton variant="destructive" pendingLabel="Removing…" className="sm:w-auto">
              Remove hours
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function WindowRow({
  window,
  branches,
  branchName,
}: {
  window: AvailabilityWindow;
  branches: Branch[];
  branchName: string | null;
}) {
  const slots = slotCount(window.startsAt, window.endsAt, window.slotMinutes);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1.5",
        !window.isActive && "opacity-70",
      )}
    >
      <div className="grid gap-0.5">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium" data-numeric>
            {timeLabel(window.startsAt)} – {timeLabel(window.endsAt)}
          </span>
          {window.isActive ? null : <Badge variant="outline">Paused</Badge>}
        </p>
        <p className="text-muted-foreground text-xs">
          <span data-numeric>{window.slotMinutes}</span> minute slots ·{" "}
          <span data-numeric>{slots}</span> {slots === 1 ? "time" : "times"} a day · {visitTypeLabel(window.visitType)}
          {branchName ? ` · ${branchName}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-0.5">
        <InlineAction
          action={setAvailabilityActiveAction}
          fields={{ availabilityId: window.id, isActive: window.isActive ? "false" : "true" }}
        >
          {window.isActive ? "Pause" : "Resume"}
        </InlineAction>
        <EditWindowDialog window={window} branches={branches} />
        <RemoveWindowDialog window={window} />
      </div>
    </div>
  );
}

export function DoctorAvailabilityCard({
  doctorId,
  doctorName,
  windows,
  branches,
}: {
  doctorId: string;
  doctorName: string;
  windows: AvailabilityWindow[];
  branches: Branch[];
}) {
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

  const byWeekday = WEEKDAY_LABELS.map((label, index) => ({
    label,
    windows: windows.filter((window) => window.weekday === index),
  })).filter((day) => day.windows.length > 0);

  const workingDays = byWeekday.filter((day) => day.windows.some((window) => window.isActive)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{doctorName}</CardTitle>
        <CardDescription>
          {workingDays === 0
            ? "Not bookable — no working hours in use."
            : `Bookable on ${workingDays} ${workingDays === 1 ? "day" : "days"} a week.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {byWeekday.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No working hours set yet, so this doctor is offered no times at all.
          </p>
        ) : (
          <div className="grid gap-4">
            {byWeekday.map((day) => (
              <div key={day.label} className="grid gap-1">
                <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{day.label}</p>
                <div className="divide-border grid divide-y">
                  {day.windows.map((window) => (
                    <WindowRow
                      key={window.id}
                      window={window}
                      branches={branches}
                      branchName={window.branchId ? (branchNames.get(window.branchId) ?? null) : null}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <AddWindowDialog doctorId={doctorId} doctorName={doctorName} branches={branches} />
        </div>
      </CardContent>
    </Card>
  );
}

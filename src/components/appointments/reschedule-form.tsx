"use client";

import { format } from "date-fns";
import { useActionState, useEffect, useState } from "react";

import { DatePicker } from "@/components/form/date-picker";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { SlotPicker, slotTimeLabel, type SlotsState } from "@/components/appointments/slot-picker";
import { getDaySlotsAction, rescheduleAppointmentAction } from "@/features/appointments/actions";
import { idleState } from "@/lib/forms";

/** Picks a new date and time for an existing appointment, keeping doctor/service fixed. */
export function RescheduleForm({
  appointmentId,
  doctorId,
  serviceId,
  visitType,
  currentStartsAt,
  onDone,
}: {
  appointmentId: string;
  doctorId: string;
  serviceId: string;
  visitType: string;
  currentStartsAt: string;
  onDone?: () => void;
}) {
  const [date, setDate] = useState<Date | undefined>(new Date(currentStartsAt));
  const [time, setTime] = useState("");
  const dateValue = date ? format(date, "yyyy-MM-dd") : "";

  const [slotsState, setSlotsState] = useState<SlotsState>({ status: "idle" });

  // See the equivalent block in BookingForm: resetting state synchronously
  // when a dependency changes belongs during render, not inside the effect.
  const [lastDateValue, setLastDateValue] = useState(dateValue);

  if (dateValue !== lastDateValue) {
    setLastDateValue(dateValue);
    setTime("");
    setSlotsState(dateValue ? { status: "loading" } : { status: "idle" });
  }

  useEffect(() => {
    if (!dateValue) return;

    let cancelled = false;

    // Excluding this appointment: without it a 10:00–11:00 visit could not be
    // moved to 10:30, because the time it is about to vacate counted as taken.
    getDaySlotsAction({
      doctorId,
      serviceId,
      visitType,
      date: dateValue,
      excludeAppointmentId: appointmentId,
    }).then((result) => {
      if (cancelled) return;
      if (result.status === "error") setSlotsState({ status: "error" });
      else if (result.status === "empty") setSlotsState({ status: "empty", reason: result.reason });
      else setSlotsState({ status: "loaded", slots: result.slots });
    });

    return () => {
      cancelled = true;
    };
  }, [appointmentId, doctorId, serviceId, visitType, dateValue]);

  const [state, formAction] = useActionState(rescheduleAppointmentAction, idleState);

  // Closing the dialog on success, without a synchronous setState in an effect.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "success") onDone?.();
  }

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <FormAlert state={state} />

      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="date" value={dateValue} />
      <input type="hidden" name="time" value={time} />

      <DatePicker label="New date" name="_date" defaultValue={date} onSelect={setDate} fromDate={new Date()} />

      <SlotPicker state={slotsState} selected={time} onSelect={setTime} label="New time" />

      <SubmitButton pendingLabel="Rescheduling…">
        {time ? `Confirm ${slotTimeLabel(time)}` : "Confirm new time"}
      </SubmitButton>
    </form>
  );
}

"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NOTHING_BOOKABLE_MESSAGE, SLOT_STATUS_LABELS, noSlotsMessage } from "@/features/appointments/messages";
import type { Slot } from "@/features/appointments/slots";

/**
 * The day's start times, bookable and not.
 *
 * One component for booking and rescheduling, which each carried their own
 * copy of this grid and had already drifted: the reschedule dialog told a
 * client "fully booked for that day" when the date had simply passed.
 *
 * Every time the doctor's windows define is drawn, not only the free ones. A
 * grid that silently omits what is taken cannot distinguish a busy morning
 * from a short one, and a client comparing days needs to see the difference.
 * Blocked times are disabled rather than hidden, and each says why underneath
 * — so choosing eleven o'clock leaves half past ten and half past eleven
 * exactly as selectable as they were, which is the point of showing them.
 */

export type SlotsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; slots: Slot[] }
  | { status: "empty"; reason: string }
  | { status: "error" };

const TIME_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export function slotTimeLabel(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return TIME_LABEL_FORMATTER.format(new Date(2000, 0, 1, hours, minutes));
}

function SlotButton({
  slot,
  isSelected,
  onSelect,
}: {
  slot: Slot;
  isSelected: boolean;
  onSelect: (time: string) => void;
}) {
  const label = slotTimeLabel(slot.time);

  if (slot.status === "available") {
    return (
      <Button
        type="button"
        variant={isSelected ? "default" : "outline"}
        size="touch"
        aria-pressed={isSelected}
        onClick={() => onSelect(slot.time)}
      >
        {label}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      disabled
      // The reason is in the accessible name, not only in the small print and
      // the strikethrough — a screen reader hears "10:30, booked", and so does
      // anyone who cannot pick the styling apart.
      aria-label={`${label} — ${SLOT_STATUS_LABELS[slot.status]}`}
      // min-h-11 keeps the grid's rows aligned with the tappable slots beside
      // them; the 44px floor itself matters for those, not for a disabled one.
      className="text-muted-foreground h-auto min-h-11 flex-col gap-0 py-1.5 text-sm disabled:opacity-60"
    >
      <span className="line-through">{label}</span>
      <span aria-hidden className="text-[0.6875rem] leading-tight font-normal">
        {SLOT_STATUS_LABELS[slot.status]}
      </span>
    </Button>
  );
}

export function SlotPicker({
  state,
  selected,
  onSelect,
  label = "Time",
  errors,
}: {
  state: SlotsState;
  selected: string;
  onSelect: (time: string) => void;
  label?: string;
  errors?: string[];
}) {
  const nothingBookable =
    state.status === "loaded" && !state.slots.some((slot) => slot.status === "available");

  return (
    <div className="grid gap-3">
      <p className="text-sm font-medium">{label}</p>

      {state.status === "loading" ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Checking availability…
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="text-destructive text-sm">We could not check availability just now. Please try again.</p>
      ) : null}

      {state.status === "empty" ? (
        <p className="text-muted-foreground text-sm">{noSlotsMessage(state.reason)}</p>
      ) : null}

      {nothingBookable ? <p className="text-muted-foreground text-sm">{NOTHING_BOOKABLE_MESSAGE}</p> : null}

      {/* "Times", not "Available times": the group holds the blocked ones too. */}
      {state.status === "loaded" ? (
        <div role="group" aria-label="Times" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {state.slots.map((slot) => (
            <SlotButton
              key={slot.time}
              slot={slot}
              isSelected={slot.time === selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}

      {errors?.length ? (
        <p className="text-destructive text-sm" role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

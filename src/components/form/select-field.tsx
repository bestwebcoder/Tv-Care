"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

type SelectFieldProps = {
  label: string;
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  hint?: string;
  errors?: string[];
  disabled?: boolean;
  /**
   * Pass where two forms on one page share a field name — Settings has a
   * species picker in both the add-breed form and each edit dialog, and
   * without this the label points at whichever trigger the browser finds
   * first. Matches the `id` escape hatch on `Field`.
   */
  id?: string;
};

/**
 * The Field counterpart for a choice.
 *
 * Renders the option's label rather than its stored value: without this, a
 * select whose value is "unknown" shows the word "unknown" to the user instead
 * of "Not known".
 */
export function SelectField({
  label,
  name,
  options,
  defaultValue,
  value,
  onValueChange,
  placeholder,
  hint,
  errors,
  disabled,
  id,
}: SelectFieldProps) {
  const selectId = id ?? name;
  const errorId = `${selectId}-error`;
  const hintId = `${selectId}-hint`;
  const hasError = Boolean(errors?.length);

  const labelFor = (current: unknown) =>
    options.find((option) => option.value === String(current ?? ""))?.label ?? null;

  return (
    <div className="grid gap-2">
      <Label htmlFor={selectId}>{label}</Label>

      <Select
        name={name}
        defaultValue={defaultValue}
        value={value}
        onValueChange={(next) => onValueChange?.(String(next ?? ""))}
        disabled={disabled}
      >
        <SelectTrigger
          id={selectId}
          aria-invalid={hasError || undefined}
          aria-describedby={cn(hasError && errorId, hint && hintId) || undefined}
          className={cn("h-11 w-full", hasError && "border-destructive")}
        >
          <SelectValue placeholder={placeholder}>
            {(current) => labelFor(current) ?? placeholder ?? ""}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hint ? (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} className="text-destructive text-sm" role="alert">
          {errors!.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

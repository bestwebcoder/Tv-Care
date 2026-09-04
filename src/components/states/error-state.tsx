import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ErrorStateProps = {
  /** Plain language. Never a stack trace, error code, or database message. */
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /**
   * Overrides the title/description colour. Both default to the theme-aware
   * app tokens, correct wherever this renders on the app's own background —
   * every caller but two. /services and /training-education sit on the fixed
   * marketing palette instead (see globals.css), where a theme-aware colour
   * reads fine in light mode and disappears in dark mode against a background
   * that never darkens; they pass the fixed marketing tokens here instead.
   */
  titleClassName?: string;
  descriptionClassName?: string;
};

/**
 * Shown when something failed. The cause belongs in the server log; the person
 * reading this needs to know what happened and what to do next.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We could not load this just now. Please try again in a moment.",
  action,
  className,
  titleClassName,
  descriptionClassName,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
      role="alert"
    >
      <span className="bg-destructive/10 text-destructive flex size-11 items-center justify-center rounded-full">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <div className="grid gap-1">
        <h3 className={cn("text-base font-medium", titleClassName)}>{title}</h3>
        <p className={cn("text-muted-foreground mx-auto max-w-sm text-sm", descriptionClassName)}>{description}</p>
      </div>
      {action ? <div className="mt-2 w-full max-w-xs">{action}</div> : null}
    </div>
  );
}

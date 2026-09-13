import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/states/empty-state";
import type { TrainingCourse } from "@/features/training/queries";
import { cn } from "@/lib/utils";
import { DELIVERY_MODE_LABELS } from "@/lib/validation/training-course";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** `2026-10` ± n months. */
export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, index - 1, 1)),
  );
}

function CourseDetails({ course }: { course: TrainingCourse }) {
  return (
    <article className={cn("grid gap-1.5 rounded-lg border border-black/10 bg-white/60 p-4", course.isCancelled && "opacity-70")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={cn("text-marketing-ink font-medium", course.isCancelled && "line-through")}>{course.title}</h3>
        {course.isCancelled ? (
          <span className="text-destructive text-xs font-medium">Cancelled</span>
        ) : course.fee ? (
          <span className="text-marketing-ink text-sm" data-numeric>
            {course.fee}
          </span>
        ) : null}
      </div>
      <p className="text-marketing-quiet text-sm" data-numeric>
        {course.when}
      </p>
      <p className="text-marketing-quiet text-sm">
        {DELIVERY_MODE_LABELS[course.deliveryMode]}
        {course.location ? ` · ${course.location}` : ""}
        {course.seats ? ` · ${course.seats} seats` : ""}
      </p>
      {course.audience ? <p className="text-marketing-quiet text-sm">For {course.audience}</p> : null}
      {course.summary ? <p className="text-marketing-ink text-sm">{course.summary}</p> : null}
      {!course.isCancelled ? (
        <Link href="/contact" className="text-marketing-ink justify-self-start text-sm font-medium underline underline-offset-4">
          Enquire about this course
        </Link>
      ) : null}
    </article>
  );
}

/**
 * The public course calendar: a month grid on wider screens, the same month as
 * a list on a phone (a seven-column grid of 40px cells cannot hold a course
 * title), and the next sessions coming up underneath. Server-rendered —
 * month navigation is a link, so it works without JavaScript.
 */
export function TrainingCalendar({
  month,
  monthCourses,
  upcoming,
  basePath,
  today,
}: {
  /** `yyyy-MM`, in the practice's timezone. */
  month: string;
  monthCourses: TrainingCourse[];
  upcoming: TrainingCourse[];
  basePath: string;
  /** `yyyy-MM-dd`, in the practice's timezone. */
  today: string;
}) {
  const [year, index] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const leadingBlanks = (new Date(Date.UTC(year, index - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, day) => `${month}-${String(day + 1).padStart(2, "0")}`),
  ];

  const coursesOn = (date: string) => monthCourses.filter((course) => course.startsOn <= date && date <= course.endsOn);

  return (
    <section className="grid gap-6 py-12" aria-labelledby="training-calendar-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 id="training-calendar-heading" className="text-marketing-ink text-2xl font-semibold">
            Course calendar
          </h2>
          <p className="text-marketing-quiet">Dates for upcoming training sessions. Times are local to the practice.</p>
        </div>
        <nav className="flex items-center gap-2" aria-label="Choose month">
          <Link
            href={`${basePath}?month=${shiftMonth(month, -1)}#training-calendar-heading`}
            className="text-marketing-ink inline-flex size-10 items-center justify-center rounded-md border border-black/10"
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <span className="text-marketing-ink min-w-36 text-center font-medium">{monthLabel(month)}</span>
          <Link
            href={`${basePath}?month=${shiftMonth(month, 1)}#training-calendar-heading`}
            className="text-marketing-ink inline-flex size-10 items-center justify-center rounded-md border border-black/10"
            aria-label="Next month"
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </nav>
      </div>

      {/* Month grid — tablet and up. */}
      <div className="hidden overflow-hidden rounded-lg border border-black/10 sm:block">
        <div className="grid grid-cols-7 border-b border-black/10 bg-white/40">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="text-marketing-quiet px-2 py-2 text-center text-xs font-medium">
              {weekday}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, cell) => {
            const courses = date ? coursesOn(date) : [];
            return (
              <div
                key={date ?? `blank-${cell}`}
                className={cn(
                  "min-h-24 border-r border-b border-black/5 p-1.5 [&:nth-child(7n)]:border-r-0",
                  !date && "bg-black/[0.02]",
                )}
              >
                {date ? (
                  <>
                    <span
                      className={cn(
                        "text-marketing-quiet inline-flex size-6 items-center justify-center rounded-full text-xs",
                        date === today && "bg-marketing-ink text-white",
                      )}
                      data-numeric
                    >
                      {Number(date.slice(8))}
                    </span>
                    <ul className="mt-1 grid gap-1">
                      {courses.map((course) => (
                        <li
                          key={course.id}
                          className={cn(
                            "text-marketing-ink truncate rounded bg-amber-100/80 px-1.5 py-0.5 text-[11px] leading-tight",
                            course.isCancelled && "line-through opacity-60",
                          )}
                          title={`${course.title} · ${course.when}`}
                        >
                          {course.startsOn === date ? `${course.startTime} ` : ""}
                          {course.title}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* The same month as a list — phones, and anyone who prefers reading to scanning. */}
      <div className="grid gap-3 sm:hidden">
        {monthCourses.length === 0 ? (
          <p className="text-marketing-quiet text-sm">No sessions in {monthLabel(month)}.</p>
        ) : (
          monthCourses.map((course) => <CourseDetails key={course.id} course={course} />)
        )}
      </div>

      <div className="grid gap-3">
        <h3 className="text-marketing-ink text-lg font-medium">Coming up</h3>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No sessions scheduled right now"
            description="New course dates are added here as soon as they are set. Contact us to hear about the next intake."
            titleClassName="text-marketing-ink"
            descriptionClassName="text-marketing-quiet"
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {upcoming.map((course) => (
              <CourseDetails key={course.id} course={course} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

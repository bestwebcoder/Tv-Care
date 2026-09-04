import Link from "next/link";

import type { RosterCounts, RosterRoleTab, RosterTab } from "@/features/team/queries";
import { cn } from "@/lib/utils";

/**
 * The label for a tab, given the roles fetched for the strip. "All" and
 * "None" are not roles and are named here; every other tab's label is
 * whatever the role is called.
 */
export function tabLabel(tab: RosterTab, roles: RosterRoleTab[]): string {
  if (tab === "all") return "All";
  if (tab === "none") return "No role";
  return roles.find((role) => role.id === tab)?.name ?? "";
}

/**
 * The role filter, as links rather than client state — the same reasoning as
 * Pagination: which tab you are on belongs in the URL, so a page of Doctors
 * can be bookmarked, shared and reached before JavaScript loads. It also lets
 * the server fetch only that tab instead of every user in the practice.
 *
 * Selecting a tab drops the page number: page 4 of Admins is rarely the page
 * you want when you switch to Clients.
 *
 * The tabs themselves are not a fixed list: every role this practice can
 * assign through the UI gets one — built-ins and whatever roles the practice
 * defined for itself alike (see listRosterRoles) — with "All" and "No role"
 * bookending them as the two views that are not roles.
 */
export function RosterTabs({
  active,
  counts,
  roles,
}: {
  active: RosterTab;
  counts: RosterCounts | null;
  roles: RosterRoleTab[];
}) {
  const tabs: { key: RosterTab; label: string }[] = [
    { key: "all", label: "All" },
    ...roles.map((role) => ({ key: role.id, label: role.name })),
    { key: "none", label: "No role" },
  ];

  return (
    <nav className="flex flex-wrap gap-1" aria-label="Filter by role">
      {tabs.map(({ key, label }) => {
        const isActive = key === active;
        const count = counts?.[key];

        return (
          <Link
            key={key}
            href={key === "all" ? "/admin/users" : `/admin/users?role=${key}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            {label}
            {count === undefined ? null : (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  isActive ? "bg-primary-foreground/20" : "bg-secondary text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

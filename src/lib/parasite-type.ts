/**
 * Internal and external parasite treatment — two sections of one module
 * (20261013000400_parasite_treatment_types.sql). Fixed by definition, not a
 * catalog: there is nothing here for an administrator to configure.
 */

export const PARASITE_TYPES = ["internal", "external"] as const;
export type ParasiteType = (typeof PARASITE_TYPES)[number];

/** Section headings. */
export const PARASITE_TYPE_TITLES: Record<ParasiteType, string> = {
  internal: "Internal parasites",
  external: "External parasites",
};

/** What each section covers, under its heading. */
export const PARASITE_TYPE_DESCRIPTIONS: Record<ParasiteType, string> = {
  internal: "Deworming — roundworms, hookworms, tapeworms and other gut parasites.",
  external: "Ticks, fleas, mites and lice.",
};

/** A short label for a list row or badge. */
export const PARASITE_TYPE_SHORT_LABELS: Record<ParasiteType, string> = {
  internal: "Deworming",
  external: "Tick & flea",
};

export function isParasiteType(value: unknown): value is ParasiteType {
  return typeof value === "string" && (PARASITE_TYPES as readonly string[]).includes(value);
}

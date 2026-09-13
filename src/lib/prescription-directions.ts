/**
 * How a prescription item reads, and the one step past `computeDose` the
 * calculator takes: from a total mass to a volume or a unit count, using the
 * product's stated concentration.
 *
 *   Amoxicillin (50 mg/mL)
 *   Give 5.6 mL PO, 2 times a day for 7 days
 *
 * Same standing as src/lib/dose.ts (CLAUDE.md §11): a calculation and a
 * sentence template. Nothing here chooses a drug, a dose or a schedule — every
 * value comes from what the vet typed, and the stored amount is whatever they
 * saved, not what this suggested.
 */

export const DOSE_FORMS = ["ml", "tablet", "capsule"] as const;
export type DoseForm = (typeof DOSE_FORMS)[number];

export const DOSE_FORM_LABELS: Record<DoseForm, string> = {
  ml: "Liquid (mg/mL)",
  tablet: "Tablet (mg/tablet)",
  capsule: "Capsule (mg/capsule)",
};

export class InvalidConcentrationError extends Error {}

/** "mL", "tablet"/"tablets", "capsule"/"capsules" — "0.5 tablet", as a label would say it. */
export function doseFormUnit(form: DoseForm, amount?: number): string {
  if (form === "ml") return "mL";
  return amount === undefined || amount <= 1 ? form : `${form}s`;
}

/** 50 → "50 mg/mL"; 250 tablet → "250 mg/tablet". */
export function formatConcentration(concentrationMgPerUnit: number, form: DoseForm): string {
  return `${formatNumber(concentrationMgPerUnit)} mg/${doseFormUnit(form)}`;
}

/**
 * Total mg → how much of the product to give. mL to two decimals — what a
 * syringe can be read to; tablets and capsules to two decimals as well, so a
 * vet sees 0.56 tablet and decides for themselves whether that is a half.
 * Rounding a solid dose to a practical fraction is a clinical judgement and is
 * deliberately not made here.
 */
export function doseAmountFromMass(doseMg: number, concentrationMgPerUnit: number): number {
  if (!Number.isFinite(doseMg) || doseMg <= 0) {
    throw new InvalidConcentrationError("Calculate or enter a dose in mg first.");
  }
  if (!Number.isFinite(concentrationMgPerUnit) || concentrationMgPerUnit <= 0) {
    throw new InvalidConcentrationError("Enter the product's concentration, greater than zero.");
  }

  return Math.round((doseMg / concentrationMgPerUnit) * 100) / 100;
}

/**
 * `Drug generic name (concentration)`. Falls back to the drug name when no
 * generic name was recorded, and drops the brackets when no concentration was —
 * which is how every item written before concentrations existed will read.
 */
export function prescriptionItemLabel(item: {
  drugName: string;
  genericName: string | null;
  concentrationMgPerUnit: number | null;
  doseForm: DoseForm | null;
}): string {
  const name = item.genericName?.trim() || item.drugName;

  if (item.concentrationMgPerUnit == null || item.doseForm == null) return name;
  return `${name} (${formatConcentration(item.concentrationMgPerUnit, item.doseForm)})`;
}

/**
 * `Give [amount] [route], [n] times a day for [x] days`.
 *
 * Null when the item does not carry every structured part — an item from before
 * this format existed, or a draft still being filled in. The caller shows the
 * item's free-text frequency/duration instead; a half-built sentence ("Give
 * mL , times a day") on a prescription is worse than none.
 */
export function prescriptionDirections(item: {
  doseAmount: number | null;
  doseForm: DoseForm | null;
  route: string | null;
  frequencyPerDay: number | null;
  durationDays: number | null;
}): string | null {
  const { doseAmount, doseForm, frequencyPerDay, durationDays } = item;
  const route = item.route?.trim();

  if (doseAmount == null || doseForm == null || !route || frequencyPerDay == null || durationDays == null) {
    return null;
  }

  const amount = `${formatNumber(doseAmount)} ${doseFormUnit(doseForm, doseAmount)}`;
  const times = frequencyPerDay === 1 ? "1 time" : `${frequencyPerDay} times`;
  const days = durationDays === 1 ? "1 day" : `${durationDays} days`;

  return `Give ${amount} ${route}, ${times} a day for ${days}`;
}

/** 5.60 → "5.6", 2.00 → "2" — no trailing zeros on a prescription. */
function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

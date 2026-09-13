import type { Metadata } from "next";
import Link from "next/link";

import { VetRevenueDetail } from "@/components/reports/vet-revenue";
import { ErrorState } from "@/components/states/error-state";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/features/auth/session";
import { getOwnDoctorRecord } from "@/features/doctors/queries";
import { readDateRange } from "@/lib/validation/date-range";

export const metadata: Metadata = { title: "My revenue · TV Care" };

/**
 * Every doctor's own revenue, with no report permission needed — a traveling
 * vet should be able to see what their visits earned and what they are holding.
 * report_vet_revenue enforces that the id asked about is the caller's own.
 */
export default async function MyRevenuePage({ searchParams }: PageProps<"/doctor/reports/my-revenue">) {
  const user = await requireRole("doctor");
  const query = await searchParams;
  const organizationId = user.organizationIds[0];
  const doctor = await getOwnDoctorRecord();

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/doctor/reports" className="underline underline-offset-4">
            Back to reports
          </Link>
        </p>
        <h1>My revenue</h1>
        <p className="text-muted-foreground">Figures for the visits you attended, computed live from invoices and payments.</p>
      </div>

      {doctor.status !== "ok" || !doctor.data || !organizationId ? (
        <Card>
          <CardContent>
            <ErrorState title="Your doctor record could not be found" />
          </CardContent>
        </Card>
      ) : (
        <VetRevenueDetail
          organizationId={organizationId}
          doctorId={doctor.data.id}
          range={readDateRange(query)}
          basePath="/doctor/reports/my-revenue"
          searchParams={query}
        />
      )}
    </div>
  );
}

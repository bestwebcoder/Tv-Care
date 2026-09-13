import { Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { VetRevenueDetail } from "@/components/reports/vet-revenue";
import { EmptyState } from "@/components/states/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/features/auth/session";
import { getOwnDoctorRecord } from "@/features/doctors/queries";
import { readDateRange } from "@/lib/validation/date-range";

export const metadata: Metadata = { title: "Veterinarian revenue · TV Care" };

/** A doctor with report access looking at one vet — the drill-down from their financial report. */
export default async function DoctorVetRevenuePage({ params, searchParams }: PageProps<"/doctor/reports/financial/vets/[doctorId]">) {
  const user = await requireRole("doctor");
  const { doctorId } = await params;
  const query = await searchParams;
  const organizationId = user.organizationIds[0];

  const doctor = await getOwnDoctorRecord();
  const allowed =
    doctor.status === "ok" && Boolean(doctor.data) && (doctor.data?.canViewReports === true || doctor.data?.id === doctorId);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/doctor/reports/financial" className="underline underline-offset-4">
            Back to financial reports
          </Link>
        </p>
        <h1>Veterinarian revenue</h1>
      </div>

      {!allowed || !organizationId ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Lock}
              title="You do not have report access"
              description="You can always see your own figures under Reports → My revenue."
            />
          </CardContent>
        </Card>
      ) : (
        <VetRevenueDetail
          organizationId={organizationId}
          doctorId={doctorId}
          range={readDateRange(query)}
          basePath={`/doctor/reports/financial/vets/${doctorId}`}
          searchParams={query}
          titlePrefix="Dr."
        />
      )}
    </div>
  );
}

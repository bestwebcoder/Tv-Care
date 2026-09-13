import type { Metadata } from "next";
import Link from "next/link";

import { VetRevenueDetail } from "@/components/reports/vet-revenue";
import { ErrorState } from "@/components/states/error-state";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/features/auth/access";
import { readDateRange } from "@/lib/validation/date-range";

export const metadata: Metadata = { title: "Veterinarian revenue · TV Care" };

export default async function AdminVetRevenuePage({ params, searchParams }: PageProps<"/admin/reports/financial/vets/[doctorId]">) {
  const user = await requireAccess("finance");
  const { doctorId } = await params;
  const query = await searchParams;
  const organizationId = user.organizationIds[0];

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/admin/reports/financial" className="underline underline-offset-4">
            Back to financial reports
          </Link>
        </p>
        <h1>Veterinarian revenue</h1>
      </div>

      {!organizationId ? (
        <Card>
          <CardContent>
            <ErrorState />
          </CardContent>
        </Card>
      ) : (
        <VetRevenueDetail
          organizationId={organizationId}
          doctorId={doctorId}
          range={readDateRange(query)}
          basePath={`/admin/reports/financial/vets/${doctorId}`}
          searchParams={query}
          titlePrefix="Dr."
        />
      )}
    </div>
  );
}

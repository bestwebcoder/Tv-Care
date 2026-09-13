import { Stethoscope } from "lucide-react";
import Link from "next/link";

import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { ReportTable } from "@/components/reports/report-table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getVetRevenue, getVetRevenueByService } from "@/features/reports/queries";
import { formatCurrency } from "@/lib/currency";
import { readReportPage, singleValued, type DateRange } from "@/lib/validation/date-range";

function rangeQuery(range: DateRange): string {
  return new URLSearchParams({ from: range.from, to: range.to }).toString();
}

/**
 * Every vet's revenue for the range, one row each, linking to that vet's
 * breakdown. Rendered inside the financial report.
 */
export async function VetRevenueTable({
  organizationId,
  range,
  detailBasePath,
}: {
  organizationId: string;
  range: DateRange;
  /** `${detailBasePath}/${doctorId}` is the vet's breakdown page. */
  detailBasePath: string;
}) {
  const result = await getVetRevenue(organizationId, range);

  if (result.status === "error") return <ErrorState title="Revenue by veterinarian could not be loaded" />;
  if (result.data.length === 0) {
    return <EmptyState icon={Stethoscope} title="No veterinarians yet" description="Revenue per vet appears here once doctors are added." />;
  }

  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Veterinarian</TableHead>
            <TableHead className="text-right">Visits</TableHead>
            <TableHead className="text-right">Billed</TableHead>
            <TableHead className="text-right">Collected</TableHead>
            <TableHead className="text-right">Collected on site</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.data.map((vet) => (
            <TableRow key={vet.doctorId}>
              <TableCell className="font-medium">
                <Link href={`${detailBasePath}/${vet.doctorId}?${rangeQuery(range)}`} className="underline-offset-4 hover:underline">
                  {vet.doctorName}
                </Link>
              </TableCell>
              <TableCell className="text-right" data-numeric>
                {vet.completedAppointments}
                <span className="text-muted-foreground block text-xs">
                  {vet.homeVisits} home · {vet.clinicVisits} clinic
                </span>
              </TableCell>
              <TableCell className="text-right" data-numeric>
                {formatCurrency(vet.billedPaisa)}
              </TableCell>
              <TableCell className="text-right" data-numeric>
                {formatCurrency(vet.collectedPaisa)}
              </TableCell>
              <TableCell className="text-right" data-numeric>
                {formatCurrency(vet.collectedOnSitePaisa)}
              </TableCell>
              <TableCell className="text-right" data-numeric>
                {formatCurrency(vet.outstandingPaisa)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="grid gap-1">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span className="text-2xl font-semibold" data-numeric>
          {value}
        </span>
        {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

/**
 * One vet's revenue for the range: the headline figures, the visit mix, and
 * what they billed by service. Shared by the admin drill-down, a permitted
 * doctor's drill-down, and every doctor's own "My revenue" page.
 */
export async function VetRevenueDetail({
  organizationId,
  doctorId,
  range,
  basePath,
  searchParams,
  titlePrefix,
}: {
  organizationId: string;
  doctorId: string;
  range: DateRange;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  /** Shown before the vet's name; omit on a vet's own page. */
  titlePrefix?: string;
}) {
  const [summaryResult, byServiceResult] = await Promise.all([
    getVetRevenue(organizationId, range, doctorId),
    getVetRevenueByService(organizationId, doctorId, range),
  ]);

  if (summaryResult.status === "error" || byServiceResult.status === "error") {
    return (
      <div className="grid gap-6">
        <DateRangeFilter action={basePath} range={range} />
        <Card>
          <CardContent>
            <ErrorState title="These figures could not be loaded" description="You may not have access to this veterinarian's revenue." />
          </CardContent>
        </Card>
      </div>
    );
  }

  const vet = summaryResult.data[0];

  if (!vet) {
    return (
      <Card>
        <CardContent>
          <EmptyState icon={Stethoscope} title="Veterinarian not found" description="This doctor is not part of your practice." />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {titlePrefix ? (
        <h2 className="text-lg font-medium">
          {titlePrefix} {vet.doctorName}
        </h2>
      ) : null}

      <DateRangeFilter action={basePath} range={range} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Billed" value={formatCurrency(vet.billedPaisa)} hint="Invoices issued for these visits" />
        <Stat label="Collected" value={formatCurrency(vet.collectedPaisa)} hint="Payments received, less refunds" />
        <Stat
          label="Collected on site"
          value={formatCurrency(vet.collectedOnSitePaisa)}
          hint="Taken in person by this vet — to hand over"
        />
        <Stat label="Outstanding" value={formatCurrency(vet.outstandingPaisa)} hint="Still owed on those invoices" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visits completed</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportTable
            columns={["", "Visits"]}
            rows={[
              ["Home visits", vet.homeVisits],
              ["Clinic and other visits", vet.clinicVisits],
              ["Total", vet.completedAppointments],
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billed by service</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportTable
            columns={["Service", "Quantity", "Revenue"]}
            rows={byServiceResult.data.map((row) => [row.serviceName, row.quantity, formatCurrency(row.revenuePaisa)])}
            pageParam="byService"
            page={readReportPage(searchParams, "byService")}
            basePath={basePath}
            searchParams={singleValued(searchParams)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { ExportButtons } from "@/components/reports/export-buttons";
import { ReportBarChart } from "@/components/reports/report-bar-chart";
import { ReportTable } from "@/components/reports/report-table";
import { VetRevenueTable } from "@/components/reports/vet-revenue";
import { ErrorState } from "@/components/states/error-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRevenueByService, getRevenueSeries, getRevenueTotals } from "@/features/reports/queries";
import { formatCurrency } from "@/lib/currency";
import { readReportPage, singleValued, type DateRange } from "@/lib/validation/date-range";

/** §8.1 — shared between `/admin/reports/financial` and `/doctor/reports/financial`. */
export async function FinancialReportView({
  organizationId,
  range,
  basePath,
  searchParams,
}: {
  organizationId: string;
  range: DateRange;
  basePath: string;
  /** Raw params from the page, so each table can read its own page number. */
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [seriesResult, totalsResult, byServiceResult] = await Promise.all([
    getRevenueSeries(organizationId, range, "day"),
    getRevenueTotals(organizationId, range),
    getRevenueByService(organizationId, range),
  ]);

  return (
    <div className="grid gap-6">
      <DateRangeFilter action={basePath} range={range} />

      {seriesResult.status === "error" ||
      totalsResult.status === "error" ||
      byServiceResult.status === "error" ? (
        <Card>
          <CardContent>
            <ErrorState title="Financial reports could not be loaded" />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue collected, by day</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportBarChart
                data={seriesResult.data.map((point) => ({ label: point.periodStart, value: point.revenuePaisa }))}
                format="currency"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outstanding vs. paid invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                columns={["", "Invoices", "Amount"]}
                rows={[
                  ["Outstanding", totalsResult.data.outstandingCount, formatCurrency(totalsResult.data.outstandingPaisa)],
                  ["Paid", totalsResult.data.paidCount, formatCurrency(totalsResult.data.paidPaisa)],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue by service</CardTitle>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue by veterinarian</CardTitle>
              <p className="text-muted-foreground text-sm">
                Billed, collected and outstanding for each vet&apos;s visits, and what they collected on site. Select a
                vet for their breakdown.
              </p>
            </CardHeader>
            <CardContent>
              <VetRevenueTable organizationId={organizationId} range={range} detailBasePath={`${basePath}/vets`} />
            </CardContent>
          </Card>
        </>
      )}

      <ExportButtons exportBasePath={`${basePath}/export`} range={range} />
    </div>
  );
}

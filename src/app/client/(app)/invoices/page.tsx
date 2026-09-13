import { format } from "date-fns";
import { Download, Printer, Receipt } from "lucide-react";
import type { Metadata } from "next";

import { ClientPaymentPanel } from "@/components/invoices/client-payment-panel";
import { Pagination } from "@/components/search/pagination";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/features/auth/session";
import { getOwnClientRecord } from "@/features/clients/queries";
import { listInvoicesForClient, signedInvoicePdfUrl, type InvoiceStatus } from "@/features/invoices/queries";
import { getOwnOrganization } from "@/features/organizations/queries";
import { listPaymentsForInvoices, type Payment } from "@/features/payments/queries";
import { isOnlineGatewayConfigured } from "@/lib/payments/sslcommerz";

export const metadata: Metadata = { title: "Invoices · TV Care" };

/** Long enough to scan, short enough to render on a phone. */
const PAGE_SIZE = 25;

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const STATUS_BADGE_VARIANT: Record<InvoiceStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  issued: "secondary",
  partially_paid: "default",
  paid: "default",
  cancelled: "destructive",
  refunded: "destructive",
};

/** What the page says after the browser comes back from the online checkout. */
const CHECKOUT_RESULTS: Record<string, { message: string; tone: "ok" | "error" }> = {
  paid: { message: "Payment received — thank you. Your invoice has been updated.", tone: "ok" },
  processing: {
    message: "Your payment is being confirmed with the payment gateway. This page will show it as paid shortly.",
    tone: "ok",
  },
  cancelled: { message: "Payment cancelled. Nothing was charged.", tone: "ok" },
  failed: {
    message: "The payment did not go through. Nothing was recorded — you can try again, or pay by bKash or Nagad.",
    tone: "error",
  },
};

export default async function ClientInvoicesPage({ searchParams }: PageProps<"/client/invoices">) {
  await requireRole("client");

  const { page: pageParam, payment: paymentParam } = await searchParams;
  const returnedFromCheckout = typeof paymentParam === "string" ? CHECKOUT_RESULTS[paymentParam] : undefined;
  const page = typeof pageParam === "string" ? Number(pageParam) || 1 : 1;

  const client = await getOwnClientRecord();

  if (client.status === "error" || !client.data) {
    return (
      <Card>
        <CardContent className="grid gap-4">
          <ErrorState
            title="We could not load your invoices"
            description="Your client record could not be found. Please contact your clinic."
          />
        </CardContent>
      </Card>
    );
  }

  const invoicesResult = await listInvoicesForClient(client.data.id);
  if (invoicesResult.status === "error") {
    return (
      <Card>
        <CardContent>
          <ErrorState title="Your invoices could not be loaded" />
        </CardContent>
      </Card>
    );
  }

  const [pdfLinks, paymentsResult, organizationResult] = await Promise.all([
    Promise.all(invoicesResult.data.map((invoice) => signedInvoicePdfUrl(invoice.pdfPath))),
    listPaymentsForInvoices(invoicesResult.data.map((invoice) => invoice.id)),
    getOwnOrganization(client.data.organizationId),
  ]);

  const paymentsByInvoice = new Map<string, Payment[]>();
  for (const payment of paymentsResult.status === "ok" ? paymentsResult.data : []) {
    paymentsByInvoice.set(payment.invoiceId, [...(paymentsByInvoice.get(payment.invoiceId) ?? []), payment]);
  }
  const paymentInstructions = organizationResult.status === "ok" ? (organizationResult.data?.paymentInstructions ?? null) : null;
  const gatewayEnabled = isOnlineGatewayConfigured();

  const total = invoicesResult.status === "ok" ? invoicesResult.data.length : 0;
  // A page beyond the end is clamped to the last one rather than rendered
  // blank: with a single page of results the control hides itself, so an
  // out-of-range ?page would otherwise be a dead end with no way back.
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = invoicesResult.status === "ok" ? invoicesResult.data.slice(start, start + PAGE_SIZE) : [];

  return (
    <div className="grid gap-6">
      <h1>Invoices</h1>

      {returnedFromCheckout ? (
        <Card>
          <CardContent>
            <p className={returnedFromCheckout.tone === "error" ? "text-destructive text-sm" : "text-sm"} role="status">
              {returnedFromCheckout.message}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {invoicesResult.data.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={Receipt} title="No invoices yet" description="Invoices issued for your pets' visits will appear here." />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {visible.map((invoice, index) => (
            <Card key={invoice.id}>
              <CardContent className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium" data-numeric>
                      {invoice.invoiceNumber}
                      {invoice.petName ? ` · ${invoice.petName}` : ""}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {invoice.issuedAt ? format(new Date(invoice.issuedAt), "d MMM yyyy") : "Not issued yet"}
                    </p>
                  </div>
                  <Badge variant={STATUS_BADGE_VARIANT[invoice.status]}>{STATUS_LABEL[invoice.status]}</Badge>
                </div>

                <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm" data-numeric>
                  <span>Total {invoice.total}</span>
                  <span>Paid {invoice.amountPaid}</span>
                  {invoice.balancePaisa > 0 ? <span className="text-destructive">Balance {invoice.balance}</span> : null}
                </div>

                {invoice.status !== "draft" && invoice.status !== "cancelled" ? (
                  <ClientPaymentPanel
                    invoiceId={invoice.id}
                    balancePaisa={invoice.balancePaisa}
                    isOpen={invoice.status === "issued" || invoice.status === "partially_paid"}
                    payments={paymentsByInvoice.get(invoice.id) ?? []}
                    instructions={paymentInstructions}
                    gatewayEnabled={gatewayEnabled}
                  />
                ) : null}

                {pdfLinks[index] ? (
                  <div className="flex flex-wrap gap-3 pt-2">
                    <a href={pdfLinks[index]!} download className={buttonVariants({ variant: "outline", size: "sm" })}>
                      <Download aria-hidden />
                      Download
                    </a>
                    <a
                      href={pdfLinks[index]!}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      <Printer aria-hidden />
                      Print
                    </a>
                  </div>
                ) : null}
              
          <Pagination
            basePath="/client/invoices"
            searchParams={{}}
            page={currentPage}
            pageSize={PAGE_SIZE}
            totalCount={total}
          />
        </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

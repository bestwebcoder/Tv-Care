import { format } from "date-fns";
import { Worm } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listDewormingForPet, type DewormingRecord } from "@/features/deworming/queries";
import { dueStatusBadgeVariant, getDueInfo } from "@/lib/due-window";
import { DEWORMING_INTERVAL_LABELS } from "@/lib/deworming-interval";
import { PARASITE_TYPE_DESCRIPTIONS, PARASITE_TYPE_TITLES, PARASITE_TYPES } from "@/lib/parasite-type";

/**
 * A pet's full deworming history, newest first. Same shape as
 * PetVaccinationSummary — doctor/admin link back to the visit, client is
 * read-only.
 */
export async function PetDewormingSummary({ petId, editable = false }: { petId: string; editable?: boolean }) {
  const result = await listDewormingForPet(petId);

  if (result.status === "error") {
    return (
      <Card>
        <CardContent>
          <ErrorState title="Deworming records could not be loaded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {PARASITE_TYPES.map((parasiteType) => {
        const records = result.data.filter((record) => record.parasiteType === parasiteType);

        return (
          <section key={parasiteType} className="grid gap-3" aria-labelledby={`parasite-${parasiteType}`}>
            <div className="grid gap-0.5">
              <h2 id={`parasite-${parasiteType}`} className="text-base font-medium">
                {PARASITE_TYPE_TITLES[parasiteType]}
              </h2>
              <p className="text-muted-foreground text-sm">{PARASITE_TYPE_DESCRIPTIONS[parasiteType]}</p>
            </div>
            {records.length === 0 ? (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={Worm}
                    title={parasiteType === "external" ? "No external parasite treatment yet" : "No deworming recorded yet"}
                    description="Treatment recorded during a visit will appear here, along with when the next one is due."
                  />
                </CardContent>
              </Card>
            ) : (
              <PetDewormingRecords records={records} editable={editable} />
            )}
          </section>
        );
      })}
    </div>
  );
}

function PetDewormingRecords({
  records,
  editable,
}: {
  records: DewormingRecord[];
  editable: boolean;
}) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        {records.map((record) => {
          const due = getDueInfo(record.nextDueDate);
          const content = (
            <div className="grid gap-1 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{record.product}</span>
                <Badge variant={dueStatusBadgeVariant(due.status)}>{due.label}</Badge>
              </div>
              <span className="text-muted-foreground text-xs" data-numeric>
                Given {format(new Date(`${record.dateAdministered}T00:00:00`), "d MMM yyyy")} ·{" "}
                {DEWORMING_INTERVAL_LABELS[record.interval]}
                {record.weight ? ` · ${record.weight}` : ""}
              </span>
              {record.notes ? <p className="text-sm">{record.notes}</p> : null}
            </div>
          );

          return editable ? (
            <Link key={record.id} href={`/doctor/appointments/${record.appointmentId}/deworming`} className="focus-visible:ring-ring rounded-lg focus-visible:ring-2 focus-visible:outline-none">
              {content}
            </Link>
          ) : (
            <div key={record.id}>{content}</div>
          );
        })}
      </CardContent>
    </Card>
  );
}

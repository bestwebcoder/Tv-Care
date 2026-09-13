import type { Metadata } from "next";
import Link from "next/link";

import { DoctorAvailabilityCard } from "@/components/appointments/availability-manager";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/features/auth/access";
import { listAvailabilityByDoctor } from "@/features/appointments/queries";
import { listBranches } from "@/features/clients/queries";
import { listDoctors } from "@/features/doctors/queries";
import { CalendarClock } from "lucide-react";

export const metadata: Metadata = { title: "Doctor availability · TV Care" };

export default async function AvailabilityAdminPage() {
  await requireAccess("reception");

  const [doctors, branches] = await Promise.all([listDoctors(), listBranches()]);

  if (doctors.status === "error") {
    return (
      <Card>
        <CardContent>
          <ErrorState title="Doctors could not be loaded" />
        </CardContent>
      </Card>
    );
  }

  // One read for every doctor's windows, including paused ones — a paused
  // window has to be on screen or it can never be brought back.
  const windows = await listAvailabilityByDoctor(
    doctors.data.map((doctor) => doctor.id),
    { includePaused: true },
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1>Doctor availability</h1>
        <p className="text-muted-foreground">
          <Link href="/admin/appointments" className="underline underline-offset-4">
            Back to appointments
          </Link>
        </p>
        <p className="text-muted-foreground text-sm">
          The working days, hours and breaks each doctor is bookable for. A gap between two windows on the same day is a
          break — add a morning window and an afternoon window to leave one out. How soon and how far ahead clients may
          book are set in{" "}
          <Link href="/admin/settings" className="underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      </div>

      {windows.status === "error" ? (
        <Card>
          <CardContent>
            <ErrorState title="Availability could not be loaded" />
          </CardContent>
        </Card>
      ) : doctors.data.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={CalendarClock}
              title="No doctors yet"
              description="Doctors are added to the practice before their availability can be configured."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {doctors.data.map((doctor) => (
            <DoctorAvailabilityCard
              key={doctor.id}
              doctorId={doctor.id}
              doctorName={doctor.fullName}
              windows={windows.data.get(doctor.id) ?? []}
              branches={branches}
            />
          ))}
        </div>
      )}
    </div>
  );
}

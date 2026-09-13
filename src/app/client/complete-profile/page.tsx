import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ErrorState } from "@/components/states/error-state";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/features/auth/session";
import { getOwnClientRecord, getOwnProfileCompletion } from "@/features/clients/queries";

import { CompleteProfileForm } from "./complete-profile-form";

export const metadata: Metadata = { title: "Complete your profile · TV Care" };

export default async function CompleteProfilePage() {
  await requireRole("client");
  const [completion, record] = await Promise.all([getOwnProfileCompletion(), getOwnClientRecord()]);

  if (completion.status === "ok" && completion.data === "complete") {
    redirect("/client");
  }

  if (completion.status === "error" || record.status === "error" || !record.data) {
    return (
      <Card className="mx-auto w-full max-w-xl">
        <CardContent>
          <ErrorState
            title="Your account is not set up yet"
            description="We could not find your client record. Contact The Traveling Vet and we will sort it out."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <div className="grid gap-1">
        <h1>Welcome to The Traveling Vet</h1>
        <p className="text-muted-foreground">
          Tell us who you are and how to reach you. Your vet and the clinic use these to contact you about your pets.
        </p>
      </div>
      {/* The registration trigger stores a placeholder name (the email's first
          part, or the phone number); it is not offered back as if it were one. */}
      <CompleteProfileForm phone={record.data.phone || null} alternatePhone={record.data.alternatePhone} />
    </div>
  );
}

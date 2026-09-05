import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientForm } from "@/components/clients/client-form";
import { AdminSetPasswordDialog } from "@/components/profile/admin-set-password-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/features/auth/session";
import { updateClientAction } from "@/features/clients/actions";
import { getClientRecord, listBranches } from "@/features/clients/queries";

export const metadata: Metadata = { title: "Edit client · TV Care" };

export default async function EditClientPage({
  params,
}: PageProps<"/admin/clients/[clientId]/edit">) {
  await requireRole("admin", "super_admin");
  const { clientId } = await params;

  const [result, branches] = await Promise.all([getClientRecord(clientId), listBranches()]);
  if (result.status === "error" || !result.data) notFound();

  const client = result.data;

  return (
    <div className="mx-auto grid w-full max-w-xl gap-6">
      <div className="grid gap-1">
        <h1>Edit {client.fullName}</h1>
        <p className="text-muted-foreground">
          <Link href={`/admin/clients/${clientId}`} className="underline underline-offset-4">
            Back to client
          </Link>
        </p>
      </div>

      <ClientForm
        action={updateClientAction}
        branches={branches}
        client={client}
        submitLabel="Save changes"
      />

      {/*
        Deliberately its own card and its own form, not a field inside
        ClientForm. A password is not part of the client record: it lives in
        auth.users, it is written by a different action through the service
        role, and it is authorized separately (is_admin_of_user, not the
        clients policy). Folding it into the same submit would make one button
        perform two unrelated writes, either of which can fail on its own — and
        would put a password field on the Add-a-client screen, which shares
        this form and has no account to set one on.
      */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle className="text-base">Sign-in password</CardTitle>
            <CardDescription>
              {client.userId
                ? "Replaces their password immediately. Saving the form above does not change it."
                : "This client has no online account."}
            </CardDescription>
          </div>
          {client.userId ? (
            <AdminSetPasswordDialog targetUserId={client.userId} targetName={client.fullName} />
          ) : null}
        </CardHeader>

        {/*
          An empty state rather than a card that simply is not there. A client
          with no login is ordinary — most of a practice's roster is walk-in
          records staff maintain on their behalf — but an administrator who
          came here looking for a password field needs to be told why there
          isn't one, not left to wonder whether the screen is broken
          (CLAUDE.md §7).
        */}
        {client.userId ? null : (
          <CardContent>
            <p className="text-muted-foreground flex items-start gap-2 text-sm">
              <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                There is no password to set. {client.fullName} has never registered online, so the
                practice holds this record on their behalf. They can create their own account by
                signing up with the email on this record.
              </span>
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

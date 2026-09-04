"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { RoleEditorDialog } from "@/components/roles/role-editor-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteRoleAction } from "@/features/roles/actions";
import type { RoleSummary } from "@/features/roles/queries";
import { idleState } from "@/lib/forms";

function DeleteRoleDialog({ role }: { role: RoleSummary }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(deleteRoleAction, idleState);

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "success") setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" />}
      >
        <Trash2 aria-hidden />
        <span className="sr-only">Delete {role.name}</span>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {role.name}?</DialogTitle>
          <DialogDescription>
            The role stops being offered when assigning someone, and only while nobody still holds it. Anyone who has
            held it keeps their history — a revoked grant still says which role it was.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="grid gap-4" noValidate>
          <FormAlert state={state} />
          <input type="hidden" name="roleId" value={role.id} />

          <DialogFooter>
            <Button type="button" variant="outline" size="touch" className="w-full sm:w-auto" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <SubmitButton variant="destructive" pendingLabel="Deleting…" className="w-full sm:w-auto">
              Delete role
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The practice's roles, with what each may do.
 *
 * Every role sits in one table on purpose, and none of them is labelled as
 * coming from the system: they are the same kind of object to whoever is
 * assigning somebody a job, and marking some of them out only suggests the
 * practice's own roles are second-class when they are enforced by the same
 * policies.
 */
export function RolesPanel({ roles }: { roles: RoleSummary[] }) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          What each role may do. A change takes effect the next time someone holding that role loads a page.
        </p>
        <RoleEditorDialog />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead className="text-right">Permissions</TableHead>
            <TableHead className="text-right">People</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.id}>
              <TableCell>
                <span className="font-medium">{role.name}</span>
                {role.description ? <p className="text-muted-foreground text-sm">{role.description}</p> : null}
              </TableCell>
              <TableCell className="text-right">
                {/* Every role carries its own permission rows (20261006000100),
                    so this is a real count for all of them. A short list is not
                    an omission: a lab user may update a test result, and no key
                    in the catalogue says so without also unlocking the notes
                    around it. */}
                <span data-numeric>{role.permissions.length}</span>
              </TableCell>
              <TableCell className="text-right" data-numeric>
                {role.holderCount}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <RoleEditorDialog role={role} />
                  <DeleteRoleDialog role={role} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import { redirect } from "next/navigation";

import { getOwnProfileCompletion } from "@/features/clients/queries";

/**
 * Registration asks only for an email or mobile number and a PIN. Until a new
 * client has told the practice their name and phone number, every page in the
 * client area sends them to /client/complete-profile, which lives outside this
 * group so it is not caught by its own redirect.
 *
 * A lookup error is let through rather than locking someone out of their pets'
 * records; the pages behind it have their own error states.
 */
export default async function ClientAppLayout({ children }: { children: React.ReactNode }) {
  const completion = await getOwnProfileCompletion();

  if (completion.status === "ok" && completion.data === "incomplete") {
    redirect("/client/complete-profile");
  }

  return children;
}

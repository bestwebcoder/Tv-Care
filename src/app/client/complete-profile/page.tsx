import { redirect } from "next/navigation";

/**
 * Registration used to send new clients here before anything else. They now
 * land on their dashboard and add a name and mobile number on their profile
 * whenever they choose; this keeps old links and bookmarks working.
 */
export default function CompleteProfilePage() {
  redirect("/client/profile");
}

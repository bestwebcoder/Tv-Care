import type { Metadata } from "next";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create an account · TV Care" };

// The link back to sign in lives inside the form: once registration succeeds
// the form is replaced by a "confirm your email" panel, and "Already have an
// account?" is the wrong sentence to leave sitting under it.
export default function RegisterPage() {
  return <RegisterForm />;
}

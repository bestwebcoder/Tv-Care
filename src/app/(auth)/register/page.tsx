import type { Metadata } from "next";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create an account · TV Care" };

// A successful registration signs the client in and redirects them to complete
// their profile, so everything on this page lives inside the form.
export default function RegisterPage() {
  return <RegisterForm />;
}

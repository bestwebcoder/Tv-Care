import type { Metadata } from "next";
import Link from "next/link";

import { ErrorState } from "@/components/states/error-state";
import { AddCourseForm, TrainingCourseList } from "@/components/training/training-course-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/features/auth/session";
import { getOwnOrganization } from "@/features/organizations/queries";
import { listServices } from "@/features/services/queries";
import { listTrainingCoursesForAdmin } from "@/features/training/queries";
import { categoriesFor, intoCategories } from "@/lib/service-pages";

export const metadata: Metadata = { title: "Training calendar · TV Care" };

/**
 * Course sessions shown on the public Training & Education page. Programmes
 * (what is taught, and the fee structure) stay in Services; this is when.
 */
export default async function AdminTrainingCalendarPage() {
  const user = await requireRole("admin", "super_admin");
  const organizationId = user.organizationIds[0];

  if (!organizationId) {
    return (
      <Card>
        <CardContent>
          <ErrorState />
        </CardContent>
      </Card>
    );
  }

  const organization = await getOwnOrganization(organizationId);
  const timeZone = organization.status === "ok" && organization.data ? organization.data.timezone : "Asia/Dhaka";

  const [coursesResult, servicesResult] = await Promise.all([
    listTrainingCoursesForAdmin(organizationId, timeZone),
    listServices(),
  ]);

  const programmes =
    servicesResult.status === "ok"
      ? categoriesFor(intoCategories(servicesResult.data), "/training-education").flatMap((category) =>
          category.services.map((service) => ({ id: service.id, name: service.name })),
        )
      : [];

  const now = new Date().toISOString();
  const courses = coursesResult.status === "ok" ? coursesResult.data : [];
  const upcoming = courses.filter((course) => course.endsAt >= now).reverse();
  const past = courses.filter((course) => course.endsAt < now);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="grid gap-1">
        <p className="text-muted-foreground text-sm">
          <Link href="/admin/website" className="underline underline-offset-4">
            Back to website
          </Link>
        </p>
        <h1>Training calendar</h1>
        <p className="text-muted-foreground">
          Course dates for veterinarians, shown as a calendar on the public{" "}
          <Link href="/training-education" className="underline underline-offset-4">
            Training &amp; Education
          </Link>{" "}
          page once published.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a course</CardTitle>
          <CardDescription>Save as a draft to prepare it, then publish when the dates are confirmed.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddCourseForm programmes={programmes} timeZone={timeZone} />
        </CardContent>
      </Card>

      {coursesResult.status === "error" ? (
        <Card>
          <CardContent>
            <ErrorState title="Courses could not be loaded" />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming and running</CardTitle>
            </CardHeader>
            <CardContent>
              <TrainingCourseList
                courses={upcoming}
                programmes={programmes}
                timeZone={timeZone}
                emptyMessage="No upcoming courses. Add one above to start the public calendar."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Past courses</CardTitle>
            </CardHeader>
            <CardContent>
              <TrainingCourseList courses={past} programmes={programmes} timeZone={timeZone} emptyMessage="No past courses yet." />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

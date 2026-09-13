import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { admin, createUserWithRole, organizationId, runId, signedInClient } from "./setup/http";
import { parsePublicEnv } from "@/lib/env";

/** Training course sessions — 20261013000700_training_courses.sql. */

const RUN = runId();

let orgA: string;
let practiceAdmin: SupabaseClient;
let vet: SupabaseClient;
let owner: SupabaseClient;

const course = (fields: Record<string, unknown> = {}) => ({
  organization_id: orgA,
  title: `Ultrasound basics ${RUN}`,
  delivery_mode: "online",
  starts_at: "2027-01-10T03:00:00.000Z",
  ends_at: "2027-01-10T11:00:00.000Z",
  is_published: true,
  ...fields,
});

beforeAll(async () => {
  orgA = await organizationId();

  const [adminUser, vetUser, ownerUser] = await Promise.all([
    createUserWithRole(`tc-admin-${RUN}`, "admin"),
    createUserWithRole(`tc-vet-${RUN}`, "doctor"),
    createUserWithRole(`tc-owner-${RUN}`, "client"),
  ]);

  [practiceAdmin, vet, owner] = await Promise.all([
    signedInClient(adminUser.email),
    signedInClient(vetUser.email),
    signedInClient(ownerUser.email),
  ]);
}, 120_000);

describe("who manages the training calendar", () => {
  it("lets an administrator add a course, and audits it", async () => {
    const { data, error } = await practiceAdmin.from("training_courses").insert(course()).select("id").single();
    expect(error).toBeNull();

    const { data: audit } = await admin.from("audit_logs").select("id").eq("entity_table", "training_courses").eq("entity_id", data!.id);
    expect(audit!.length).toBeGreaterThanOrEqual(1);
  });

  it("does not let a doctor or a client write it", async () => {
    expect((await vet.from("training_courses").insert(course())).error).not.toBeNull();
    expect((await owner.from("training_courses").insert(course())).error).not.toBeNull();
  });

  it("keeps drafts and management out of anyone else's reads", async () => {
    const { data } = await owner.from("training_courses").select("id");
    expect(data ?? []).toHaveLength(0);

    const anon = createClient(parsePublicEnv(process.env).NEXT_PUBLIC_SUPABASE_URL, parsePublicEnv(process.env).NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { error } = await anon.from("training_courses").select("id");
    expect(error).not.toBeNull();
  });
});

describe("what a course must say", () => {
  it("needs a location unless it is online", async () => {
    const { error } = await practiceAdmin.from("training_courses").insert(course({ delivery_mode: "in_person" }));
    expect(error?.code).toBe("23514");
  });

  it("must end after it starts", async () => {
    const { error } = await practiceAdmin
      .from("training_courses")
      .insert(course({ starts_at: "2027-01-10T11:00:00.000Z", ends_at: "2027-01-10T03:00:00.000Z" }));
    expect(error?.code).toBe("23514");
  });
});

import Link from "next/link";

import { WhatsAppButton } from "@/components/marketing/whatsapp-button";
import { getPublicNavTree } from "@/features/nav-menu/queries";
import type { PublicOrganizationInfo } from "@/features/organizations/queries";
import { siteContentValue } from "@/features/site-content/fields";
import { getPublicSiteContent } from "@/features/site-content/queries";
import { cn } from "@/lib/utils";

export async function PublicFooter({
  organization,
  tone = "app",
}: {
  organization: PublicOrganizationInfo | null;
  /**
   * The footer has no background of its own — it shows through to whatever
   * the page wraps it in. "app" reads the theme-aware app tokens, correct
   * wherever that's the app's own background. /services and /training-
   * education wrap it in the fixed marketing palette instead (see
   * globals.css), where a theme-aware colour reads fine in light mode and
   * disappears in dark mode against a background that never darkens; they
   * pass "marketing" for the fixed tokens instead.
   */
  tone?: "app" | "marketing";
}) {
  const practiceName = organization?.name ?? "The Traveling Vet";
  const isMarketing = tone === "marketing";

  // A footer link list is meant to be scannable, not a full site map — only
  // the top-level items, dropdowns flattened away. Fetched here rather than
  // threaded through as a prop, same as the nav tree — every caller already
  // has `organization` in scope, nothing else to pass down.
  const [navItems, content] = await Promise.all([
    organization ? getPublicNavTree(organization.id) : Promise.resolve([]),
    organization ? getPublicSiteContent(organization.id) : Promise.resolve({}),
  ]);

  const tagline = siteContentValue(content, "footer.tagline", practiceName);
  const copyright = siteContentValue(content, "footer.copyright_override", practiceName);
  const showLogo = organization?.footerShowLogo ?? true;

  return (
    <>
      <footer className="border-border/60 border-t">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 sm:grid-cols-2 sm:px-6">
          <div className={cn("grid gap-3 text-sm", isMarketing ? "text-marketing-quiet" : "text-muted-foreground")}>
            <div className="flex items-center gap-2.5">
              {showLogo ? (
                organization?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded, arbitrary dimensions; no build-time optimization to gain here.
                  <img src={organization.logoUrl} alt="" className="size-8 shrink-0 rounded-lg object-contain" />
                ) : (
                  <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold">
                    TV
                  </span>
                )
              ) : null}
              <p className={cn("font-medium", isMarketing ? "text-marketing-ink" : "text-foreground")}>
                {practiceName}
              </p>
            </div>
            {tagline ? <p>{tagline}</p> : null}
            {organization?.address || organization?.city ? (
              <p>{[organization.address, organization.city].filter(Boolean).join(", ")}</p>
            ) : null}
            <p className="flex flex-wrap gap-x-4">
              {organization?.phone ? <span>{organization.phone}</span> : null}
              {organization?.email ? <span>{organization.email}</span> : null}
            </p>
            <p>{copyright}</p>
          </div>

          <nav className="flex flex-wrap gap-x-6 gap-y-2 sm:justify-end" aria-label="Footer">
            {navItems.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                target={item.opensNewTab ? "_blank" : undefined}
                rel={item.opensNewTab ? "noopener noreferrer" : undefined}
                className={cn(
                  "text-sm",
                  isMarketing
                    ? "text-marketing-quiet hover:text-marketing-forest"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>

      <WhatsAppButton whatsappNumber={organization?.whatsappNumber ?? null} />
    </>
  );
}

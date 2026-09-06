import { Card, CardContent } from "@/components/ui/card";
import { iconByKey } from "@/lib/icons";

/**
 * One card list, rendered the same way wherever it appears: the fixed pages'
 * page_section_items sections, and the custom-page builder's "cards" block.
 *
 * Every item may carry a picture, an icon, or both. The picture leads when
 * present — an icon badge under a photograph reads as clutter — except in the
 * numbered "steps" variant, where the number is the point.
 *
 * `tone` picks the palette, not the layout. The default follows the app theme
 * and flips with it. "marketing" is for /services and /training-education,
 * whose parchment and gold are defined only on :root and so stay light in
 * either theme — an app-themed Card there renders a dark card on a parchment
 * ground the moment the viewer switches to dark.
 */

export type SectionCardItem = {
  id: string;
  icon: string | null;
  imageUrl: string | null;
  title: string;
  description: string;
};

export type SectionCardsVariant = "cards" | "rows" | "steps";
export type SectionCardsTone = "app" | "marketing";

export function SectionCards({
  items,
  variant = "cards",
  columns = 4,
  tone = "app",
}: {
  items: SectionCardItem[];
  variant?: SectionCardsVariant;
  /** Only used by the "cards" variant — the others have a fixed layout. */
  columns?: 2 | 3 | 4;
  tone?: SectionCardsTone;
}) {
  if (items.length === 0) return null;

  const marketing = tone === "marketing";
  const titleClass = marketing ? "text-marketing-ink font-medium" : "font-medium";
  const bodyClass = marketing ? "text-marketing-quiet text-sm" : "text-muted-foreground text-sm";
  const badgeClass = marketing
    ? "bg-marketing-gold/15 text-marketing-gold"
    : "bg-primary/10 text-primary";

  if (variant === "steps") {
    return (
      <div className="grid gap-6 sm:grid-cols-3">
        {items.map((item, index) => (
          <div key={item.id} className="grid gap-2 text-center sm:text-left">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- see CardImage
              <img src={item.imageUrl} alt="" className="bg-muted mb-1 aspect-video w-full rounded-xl object-cover" />
            ) : null}
            <span className="bg-primary text-primary-foreground mx-auto flex size-9 items-center justify-center rounded-full text-sm font-semibold sm:mx-0">
              {index + 1}
            </span>
            <p className={titleClass}>{item.title}</p>
            <p className={bodyClass}>{item.description}</p>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "rows") {
    return (
      <div className="grid gap-6 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = iconByKey(item.icon);
          return (
            <div key={item.id} className="flex gap-4">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- see CardImage
                <img src={item.imageUrl} alt="" className="bg-muted size-16 shrink-0 rounded-xl object-cover" />
              ) : Icon ? (
                <span className={`${badgeClass} flex size-11 shrink-0 items-center justify-center rounded-full`}>
                  <Icon className="size-5" aria-hidden />
                </span>
              ) : null}
              <div className="grid gap-1">
                <p className={titleClass}>{item.title}</p>
                <p className={bodyClass}>{item.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const columnClass = columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";

  // The marketing pages square their corners and carry a gold top rule, the
  // same chrome ServiceCategorySection uses, so a card list sits with the
  // programme blocks below it rather than looking imported from the app.
  if (marketing) {
    return (
      <div className={`grid gap-4 ${columnClass}`}>
        {items.map((item) => {
          const Icon = iconByKey(item.icon);
          return (
            <div
              key={item.id}
              className="border-marketing-rule bg-marketing-parchment border-t-marketing-gold flex flex-col border border-t-[3px] p-5 sm:p-6"
            >
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- see below
                <img src={item.imageUrl} alt="" className="mb-4 aspect-video w-full object-cover" />
              ) : null}
              {!item.imageUrl && Icon ? (
                <span className={`${badgeClass} mb-3 flex size-10 items-center justify-center rounded-full`}>
                  <Icon className="size-5" aria-hidden />
                </span>
              ) : null}
              <p className={titleClass}>{item.title}</p>
              <p className={`${bodyClass} mt-2`}>{item.description}</p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`grid gap-4 ${columnClass}`}>
      {items.map((item) => {
        const Icon = iconByKey(item.icon);
        return (
          <Card key={item.id} className="transition-all hover:-translate-y-0.5 hover:shadow-md">
            {/* A direct child of Card, so its own `has-[>img:first-child]:pt-0`
                and `*:[img:first-child]:rounded-t-xl` handle the bleed and the
                corners — no negative margins guessing at --card-spacing. */}
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- an admin-uploaded, arbitrary-dimension public image; no build-time optimization to gain here.
              <img src={item.imageUrl} alt="" className="bg-muted aspect-video w-full object-cover" />
            ) : null}
            <CardContent className="grid gap-3">
              {!item.imageUrl && Icon ? (
                <span className={`${badgeClass} flex size-10 items-center justify-center rounded-full`}>
                  <Icon className="size-5" aria-hidden />
                </span>
              ) : null}
              <p className={titleClass}>{item.title}</p>
              <p className={bodyClass}>{item.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

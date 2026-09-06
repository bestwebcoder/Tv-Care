-- Gives the Training & Education page a card list of its own.
--
-- /training-education already renders its programmes (service categories
-- routed to it by src/lib/service-pages.ts) and its hero and closing call to
-- action (site_content). What it had no way to carry was the same
-- drag-reorderable card list every other fixed page has — a short "who this is
-- for" grid above the programmes. That list is page_section_items, and this
-- page was excluded from the table by two check constraints.
--
-- Both are widened rather than dropped: the coarse allowlist living in
-- Postgres is deliberate (20260916000100_page_sections.sql) — the precise
-- page/section shape lives in the TypeScript registry, and this guard exists
-- so a typo can never reach a row. Removing it would remove that guarantee.

alter table public.page_section_items
  drop constraint page_section_items_page_allowed;

alter table public.page_section_items
  add constraint page_section_items_page_allowed
  check (page in ('home', 'about', 'services', 'contact', 'training'));

-- 'audiences' is namespaced to the training page by the (page, section) pair,
-- the same way 'services' means one thing as a home slot and another on the
-- Services page.
alter table public.page_section_items
  drop constraint page_section_items_section_allowed;

alter table public.page_section_items
  add constraint page_section_items_section_allowed
  check (section in ('services', 'why', 'how_it_works', 'values', 'highlights', 'points', 'audiences'));

-- No seed rows, deliberately — the same call 20260916000100 made for Services
-- and Contact. Nothing is hardcoded on the training page for a seed to
-- preserve, and inventing marketing copy in a migration would put fictional
-- text into every practice's database, including real ones. The page renders
-- nothing at all until an admin adds a card, which is the correct empty state.

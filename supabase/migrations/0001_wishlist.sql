-- Feedback table for Sorcery Practice Table (wishes + problem reports).
-- Mirrors the archMGMT `wishlist` table, plus a `context` column for diagnostics.
-- NOT applied anywhere by default. Run it in the Supabase project that should hold this app's feedback.
create table if not exists public.wishlist (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'wish' check (kind in ('wish', 'problem')),
  title text not null,
  details text,
  status text not null default 'new' check (status in ('new','under_review','approved','planned','in_progress','complete','infeasible','duplicate')),
  response text,
  submitted_by text,
  sort_order integer not null default 0,
  priority smallint check (priority between 1 and 4),
  context jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.wishlist enable row level security;
-- The app has no sign-in. Anyone holding the publishable key (you and the friends you give the app to)
-- can add entries and read the list. Status, response and priority are edited from the Supabase
-- dashboard or by Claude through the Supabase connector; the publishable key cannot update or delete.
create policy "anyone with the key reads" on public.wishlist for select to anon using (true);
create policy "anyone with the key adds" on public.wishlist for insert to anon
  with check (status = 'new' and response is null and priority is null);

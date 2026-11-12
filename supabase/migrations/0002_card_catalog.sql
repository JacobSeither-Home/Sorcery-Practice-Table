-- Applied to the Supabase project "sorcery-practice-table" on 2026-11-12.
-- A private copy of the card text from the official API, written by Card Sync (members only), with
-- how much of each card the rules engine automates. It lets a Claude Code session read every card's
-- text and the unautomated sentences without reaching api.sorcerytcg.com itself.
create table public.card_catalog (
  id text primary key,
  name text not null,
  type text not null,
  rules text not null default '',
  keywords text[] not null default '{}',
  subtypes text[] not null default '{}',
  cost integer not null default 0,
  attack integer not null default 0,
  defense integer not null default 0,
  life integer not null default 0,
  thresholds jsonb not null default '{}'::jsonb,
  sets text[] not null default '{}',
  -- 'auto' | 'partial' | 'manual' | 'plain' (keywords only)
  status text not null default 'manual',
  unmatched text[] not null default '{}',
  categories text[] not null default '{}',
  synced_at timestamptz not null default now(),
  synced_by text
);
alter table public.card_catalog enable row level security;
create policy "members read catalog" on public.card_catalog for select to authenticated using (private.is_member());
create policy "members add catalog" on public.card_catalog for insert to authenticated with check (private.is_member());
create policy "members update catalog" on public.card_catalog for update to authenticated using (private.is_member()) with check (private.is_member());

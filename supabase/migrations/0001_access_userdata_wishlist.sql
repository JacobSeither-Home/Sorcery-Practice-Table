-- Applied to the Supabase project "sorcery-practice-table" (org JacobSeither-ForFun) on 2026-11-10.
-- Sign-in gate, access list, per-person saved data, and the wishlist/problem table.
create schema if not exists private;

create table public.app_admins (email text primary key, added_at timestamptz not null default now());
create table public.app_access (email text primary key, note text, added_at timestamptz not null default now());

create or replace function private.jwt_email() returns text language sql stable set search_path = '' as $$
  select lower(auth.jwt() ->> 'email') $$;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins a where a.email = lower(auth.jwt() ->> 'email')) $$;
create or replace function private.is_member() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_admin() or exists (select 1 from public.app_access a where a.email = lower(auth.jwt() ->> 'email')), false) $$;
grant usage on schema private to authenticated;
grant execute on function private.jwt_email(), private.is_admin(), private.is_member() to authenticated;

-- What the app asks right after sign-in.
create or replace function public.my_access() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('member', private.is_member(), 'admin', private.is_admin(),
    'unclaimed', not exists (select 1 from public.app_admins)) $$;
-- The first confirmed account to ask becomes the administrator. Does nothing once one exists.
create or replace function public.claim_admin() returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or lower(auth.jwt() ->> 'email') is null then return false; end if;
  lock table public.app_admins in exclusive mode;
  if exists (select 1 from public.app_admins) then return false; end if;
  insert into public.app_admins (email) values (lower(auth.jwt() ->> 'email'));
  return true;
end $$;
revoke all on function public.my_access(), public.claim_admin() from public, anon;
grant execute on function public.my_access(), public.claim_admin() to authenticated;

alter table public.app_admins enable row level security;
alter table public.app_access enable row level security;
create policy "admins read admins" on public.app_admins for select to authenticated using (private.is_admin());
create policy "admins read access list" on public.app_access for select to authenticated using (private.is_admin());
create policy "admins add access" on public.app_access for insert to authenticated with check (private.is_admin() and email = lower(email));
create policy "admins remove access" on public.app_access for delete to authenticated using (private.is_admin());

-- One row per person: settings, decks, custom cards, automated-effect entries.
create table public.user_data (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;
create policy "own row read" on public.user_data for select to authenticated using (user_id = (select auth.uid()) and private.is_member());
create policy "own row insert" on public.user_data for insert to authenticated with check (user_id = (select auth.uid()) and private.is_member());
create policy "own row update" on public.user_data for update to authenticated using (user_id = (select auth.uid()) and private.is_member()) with check (user_id = (select auth.uid()));

-- Wishlist + problem reports, same shape as archMGMT's wishlist plus a context column.
create table public.wishlist (
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
create policy "members read" on public.wishlist for select to authenticated using (private.is_member());
create policy "members add" on public.wishlist for insert to authenticated
  with check (private.is_member() and submitted_by = private.jwt_email() and (private.is_admin() or (status = 'new' and response is null and priority is null)));
create policy "admin edits" on public.wishlist for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admin deletes" on public.wishlist for delete to authenticated using (private.is_admin());

create or replace function private.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_user_data before update on public.user_data for each row execute function private.touch();
create trigger touch_wishlist before update on public.wishlist for each row execute function private.touch();

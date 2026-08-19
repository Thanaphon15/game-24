-- 24 GAME ONLINE — Supabase schema
-- Run this once in Supabase Dashboard → SQL Editor (or `supabase db push`).
-- Safe to re-run: guarded with IF NOT EXISTS / OR REPLACE where possible.

-- ============================================================
-- profiles: one row per registered player, keyed to auth.users
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  school text not null default 'TANTRARAK SCHOOL',
  grade text not null default '',
  classroom text default '',
  is_admin boolean not null default false,
  is_banned boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up.
-- Reads the metadata passed via supabase.auth.signUp({ options: { data: {...} } })
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, school, grade, classroom)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'Player'),
    coalesce(new.raw_user_meta_data->>'school', 'TANTRARAK SCHOOL'),
    coalesce(new.raw_user_meta_data->>'grade', ''),
    coalesce(new.raw_user_meta_data->>'classroom', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Admin check as security-definer function so RLS policies that call it
-- don't recurse back into the profiles table's own RLS.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

-- Regardless of which RLS update policy let an UPDATE through, only an
-- admin caller may actually change is_admin / is_banned on any row.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- auth.uid() is NULL for direct sessions (SQL Editor, migrations) —
  -- only lock these columns down for actual logged-in app users who
  -- aren't admins. A trusted direct DB session may always set them.
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    new.is_admin := old.is_admin;
    new.is_banned := old.is_banned;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileges_trigger on public.profiles;
create trigger protect_profile_privileges_trigger
  before update on public.profiles
  for each row execute procedure public.protect_profile_privileges();

alter table public.profiles enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "admins can update any profile" on public.profiles;
create policy "admins can update any profile"
  on public.profiles for update
  using (public.is_admin(auth.uid()));

-- ============================================================
-- app_settings: single-row table holding the current season number.
-- Admin "clear scores for the season" = bump current_season. Old score
-- rows are never deleted (kept for history) — leaderboard/personal score
-- just stop counting rows from earlier seasons.
-- ============================================================
create table if not exists public.app_settings (
  id boolean primary key default true,
  current_season int not null default 1,
  season_started_at timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings publicly readable" on public.app_settings;
create policy "app_settings publicly readable"
  on public.app_settings for select
  using (true);

drop policy if exists "admins can update app_settings" on public.app_settings;
create policy "admins can update app_settings"
  on public.app_settings for update
  using (public.is_admin(auth.uid()));

-- ============================================================
-- scores: one row per completed Challenge session
-- ============================================================
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'challenge',
  level int not null check (level between 1 and 5),
  score int not null check (score >= 0),
  correct int not null default 0,
  wrong int not null default 0,
  best_streak int not null default 0,
  duration_ms int not null default 0,
  season int not null default 1,
  created_at timestamptz not null default now()
);

alter table public.scores add column if not exists season int not null default 1;

create index if not exists scores_user_id_idx on public.scores(user_id);
create index if not exists scores_score_idx on public.scores(score desc);
create index if not exists scores_season_idx on public.scores(season);

alter table public.scores enable row level security;

drop policy if exists "scores are publicly readable" on public.scores;
create policy "scores are publicly readable"
  on public.scores for select
  using (true);

drop policy if exists "users can insert their own scores" on public.scores;
create policy "users can insert their own scores"
  on public.scores for insert
  with check (auth.uid() = user_id);

-- Every inserted score gets stamped with whatever season is current right
-- now — callers never need to know/send the season themselves.
create or replace function public.stamp_score_season()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  select current_season into new.season from public.app_settings where id = true;
  return new;
end;
$$;

drop trigger if exists stamp_score_season_trigger on public.scores;
create trigger stamp_score_season_trigger
  before insert on public.scores
  for each row execute procedure public.stamp_score_season();

-- ============================================================
-- leaderboard_view: best score per non-banned player, THIS SEASON only
-- ============================================================
create or replace view public.leaderboard_view
with (security_invoker = true) as
select
  p.id as user_id,
  p.name,
  p.school,
  p.grade,
  p.classroom,
  max(s.score) as best_score
from public.scores s
join public.profiles p on p.id = s.user_id
cross join public.app_settings st
where p.is_banned = false
  and s.season = st.current_season
group by p.id, p.name, p.school, p.grade, p.classroom;

-- ============================================================
-- player_stats: per-player personal totals for the current season —
-- powers the "your score" card shown after login.
-- ============================================================
create or replace view public.player_stats
with (security_invoker = true) as
select
  s.user_id,
  max(s.score) as best_score,
  count(*) as games_played,
  max(s.best_streak) as best_streak
from public.scores s
cross join public.app_settings st
where s.season = st.current_season
group by s.user_id;

-- ============================================================
-- First admin: after your own account has registered once through
-- register.html, run this (replace the email) to promote it:
--
--   update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
-- ============================================================

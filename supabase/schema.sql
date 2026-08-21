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

  -- Block only the act of *banning yourself* (false -> true) through the
  -- app — this is what caused a real admin lockout. Fixed version of an
  -- earlier bug: this used to unconditionally force is_banned to false
  -- on ANY self-update, which let a banned player unban themselves just
  -- by editing their own name. Now it only ever blocks the OFF->ON
  -- transition; an already-banned user's self-update leaves is_banned
  -- untouched (still true).
  if auth.uid() is not null and auth.uid() = old.id
     and new.is_banned and not old.is_banned then
    new.is_banned := false;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileges_trigger on public.profiles;
create trigger protect_profile_privileges_trigger
  before update on public.profiles
  for each row execute procedure public.protect_profile_privileges();

alter table public.profiles enable row level security;

-- Own profile, or an admin reading anyone's — NOT fully public. This
-- keeps is_admin/is_banned from being queryable by anonymous requests
-- or by other students. The public Leaderboard still works because
-- leaderboard_view/player_stats (below) run without security_invoker,
-- so they can join profiles for just name/school/grade/classroom
-- regardless of this policy, without ever selecting is_admin/is_banned.
drop policy if exists "profiles are publicly readable" on public.profiles;
drop policy if exists "own profile or admin can read profiles" on public.profiles;
create policy "own profile or admin can read profiles"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin(auth.uid()));

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
alter table public.scores add column if not exists current_streak int not null default 0;

-- Sanity cap on submitted scores: the highest possible score for one
-- correct answer is (100 base + 50 time bonus + 100 max streak bonus) *
-- 3x (Expert multiplier) = 750. A client could still lie within this
-- bound, but this blocks the trivial "one fake insert with an absurd
-- score" attack without needing full server-side score recomputation.
alter table public.scores drop constraint if exists scores_score_plausible;
alter table public.scores add constraint scores_score_plausible
  check (score <= correct * 750);

create index if not exists scores_user_id_idx on public.scores(user_id);
create index if not exists scores_score_idx on public.scores(score desc);
create index if not exists scores_season_idx on public.scores(season);

alter table public.scores enable row level security;

-- Raw per-round rows are only readable by signed-in accounts (not fully
-- public) — the public Leaderboard page reads leaderboard_view instead,
-- which exposes just the aggregated total, not this granular history.
drop policy if exists "scores are publicly readable" on public.scores;
drop policy if exists "signed-in users can read scores" on public.scores;
create policy "signed-in users can read scores"
  on public.scores for select
  using (auth.uid() is not null);

drop policy if exists "users can insert their own scores" on public.scores;
create policy "users can insert their own scores"
  on public.scores for insert
  with check (auth.uid() = user_id);

-- Throttle: blocks the "loop calling insert() thousands of times" attack
-- that let a fake total_score grow without bound now that the leaderboard
-- sums every row. A real Challenge session can only start this often
-- through real UI interaction; a script trying to mint many rows fast
-- gets rejected. This raises the bar a lot but is not a perfect fix —
-- true elimination needs server-side score recomputation.
create or replace function public.throttle_score_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  last_insert timestamptz;
  recent_count int;
begin
  select max(created_at) into last_insert
  from public.scores
  where user_id = new.user_id;

  if last_insert is not null and now() - last_insert < interval '2 seconds' then
    raise exception 'กำลังบันทึกเกมก่อนหน้าอยู่ กรุณารอสักครู่ก่อนเริ่มเกมใหม่';
  end if;

  select count(*) into recent_count
  from public.scores
  where user_id = new.user_id
    and created_at > now() - interval '24 hours';

  if recent_count >= 200 then
    raise exception 'เล่นครบโควตาต่อวันแล้ว กรุณาลองใหม่พรุ่งนี้';
  end if;

  return new;
end;
$$;

drop trigger if exists throttle_score_insert_trigger on public.scores;
create trigger throttle_score_insert_trigger
  before insert on public.scores
  for each row execute procedure public.throttle_score_insert();

-- Deliberately NO client UPDATE policy on scores. Score increments now
-- happen exclusively inside the submit-answer Edge Function using
-- service_role (which bypasses RLS entirely), after it has itself
-- verified the answer against the numbers it issued via new-round.
-- A previous version of this schema had a client-facing "users can
-- update their own scores" policy for live score updates — that was
-- exactly the hole that let a client write any score/correct value it
-- wanted directly via the REST API. Do not re-add it.
drop policy if exists "users can update their own scores" on public.scores;

-- ============================================================
-- rounds: one row per issued puzzle. Fully server-only — no RLS policy
-- grants anon/authenticated any access at all, so this table (and the
-- numbers/answers in it) is invisible from the browser. Only the
-- new-round and submit-answer Edge Functions touch it, via service_role.
-- ============================================================
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id bigint not null references public.scores(id) on delete cascade,
  level int not null check (level between 1 and 5),
  numbers int[] not null,
  used boolean not null default false,
  correct boolean,
  wrong_attempts int not null default 0,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

alter table public.rounds add column if not exists wrong_attempts int not null default 0;

create index if not exists rounds_session_id_idx on public.rounds(session_id);

alter table public.rounds enable row level security;
-- No policies created: RLS with zero policies denies all access to
-- anon/authenticated roles by default. service_role always bypasses RLS.

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
-- leaderboard_view: TOTAL accumulated score (sum of every Challenge
-- round this season, including in-progress ones) per non-banned player.
-- Ties are broken by who started accumulating that total earlier —
-- without a secondary sort, PostgreSQL doesn't guarantee stable order
-- among tied sums, so rank could shuffle between page loads.
-- ============================================================
-- Dropped and recreated (not CREATE OR REPLACE) because the column set
-- changed from an earlier version — Postgres won't let REPLACE rename
-- or reorder view columns, only append to the end.
-- No security_invoker: this view intentionally runs with the view
-- owner's privileges so it can still be read by anonymous visitors (the
-- public Leaderboard requirement) even though the underlying profiles/
-- scores tables now require auth.uid() to be set. Safe because the view
-- only ever selects the aggregate columns listed below — never
-- is_admin/is_banned or per-round rows.
drop view if exists public.leaderboard_view;
create view public.leaderboard_view as
select
  p.id as user_id,
  p.name,
  p.school,
  p.grade,
  p.classroom,
  sum(s.score) as total_score,
  min(s.created_at) as first_played_at
from public.scores s
join public.profiles p on p.id = s.user_id
cross join public.app_settings st
where p.is_banned = false
  and s.season = st.current_season
group by p.id, p.name, p.school, p.grade, p.classroom;

-- ============================================================
-- player_stats: per-player personal totals for the current season —
-- powers the "your score" card shown after login. total_score matches
-- what ranks them on the leaderboard; best_score is kept for reference
-- (their single best round).
-- ============================================================
drop view if exists public.player_stats;
create view public.player_stats as
select
  s.user_id,
  sum(s.score) as total_score,
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

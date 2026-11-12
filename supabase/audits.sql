-- ContractSoup: the table that saved reports are kept in when Supabase is connected.
--
-- WHEN TO RUN THIS
--   * Setting up a new Supabase project for ContractSoup.
--   * Settings -> "Check account storage" in the app reports a failed step.
--   If the check passes, there is nothing to do here.
--
-- HOW:  Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--
-- SAFE TO RUN MORE THAN ONCE. It never drops or changes columns, rows or
-- policies that already exist. It only adds what is missing:
--   the table, an index, row-level security, and four policies that let a
--   signed-in user read and change their own rows and nobody else's.
--
-- WHAT IS STORED: one row per finished audit, holding the report only (the
-- contract terms with their short excerpts, the findings and the totals).
-- The contract PDF, its full text and the claims rows are never uploaded.

create table if not exists public.audits (
  id                 uuid        primary key,
  user_id            uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name               text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  contract_file_name text        not null default '',
  page_count         integer     not null default 0,
  claims_count       integer     not null default 0,
  terms              jsonb       not null default '[]'::jsonb,
  findings           jsonb       not null default '[]'::jsonb,
  summary            jsonb       not null default '{}'::jsonb,
  analyzer_version   text        not null default ''
);

-- The app lists a user's audits newest first.
create index if not exists audits_user_id_created_at_idx on public.audits (user_id, created_at desc);

-- Without this, every signed-in user could read every row.
alter table public.audits enable row level security;

-- Signed-in users reach the table through the API. Visitors who are not signed in get nothing.
grant select, insert, update, delete on public.audits to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audits' and policyname = 'contractsoup_audits_select_own') then
    create policy contractsoup_audits_select_own on public.audits
      for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audits' and policyname = 'contractsoup_audits_insert_own') then
    create policy contractsoup_audits_insert_own on public.audits
      for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audits' and policyname = 'contractsoup_audits_update_own') then
    create policy contractsoup_audits_update_own on public.audits
      for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audits' and policyname = 'contractsoup_audits_delete_own') then
    create policy contractsoup_audits_delete_own on public.audits
      for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end
$$;

-- TO SEE WHAT PROTECTS THE TABLE NOW (read only, changes nothing):
--
--   select relrowsecurity as row_level_security_on from pg_class where oid = 'public.audits'::regclass;
--   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'audits';
--
-- Every policy listed should compare user_id with auth.uid(). A policy whose
-- "qual" is just "true" lets every user see every row: remove that one.

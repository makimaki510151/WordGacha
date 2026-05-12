-- Google ログイン後のゲームデータ同期用（既存プロジェクトは SQL Editor で実行）
-- 新規に schema.sql 一式を流す場合は、schema.sql 末尾に同内容が含まれます。

create table if not exists public.wg_user_save (
  user_id uuid primary key references auth.users on delete cascade,
  owned_ids jsonb not null default '[]'::jsonb,
  jam integer not null default 0,
  pull_day text,
  pulls_today integer not null default 0,
  presets jsonb not null default '[]'::jsonb,
  gacha_log jsonb not null default '[]'::jsonb,
  gacha_skip_fx boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists wg_user_save_updated on public.wg_user_save (updated_at desc);

alter table public.wg_user_save enable row level security;

drop policy if exists "wg_user_save_select_own" on public.wg_user_save;
create policy "wg_user_save_select_own"
  on public.wg_user_save for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "wg_user_save_insert_own" on public.wg_user_save;
create policy "wg_user_save_insert_own"
  on public.wg_user_save for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "wg_user_save_update_own" on public.wg_user_save;
create policy "wg_user_save_update_own"
  on public.wg_user_save for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- プロフィールに Google 表示名を入れる（既存トリガーを置き換え）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dn text;
begin
  dn := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    ''
  );
  insert into public.profiles (id, short_code, display_name)
  values (new.id, lower(left(replace(gen_random_uuid()::text, '-', ''), 8)), nullif(trim(dn), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

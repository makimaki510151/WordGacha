-- WordGacha / Supabase 初期スキーマ
-- ダッシュボード → SQL Editor に貼り付けて実行してください。
-- その後: Authentication → Providers で Google を有効化（匿名は不要）。
-- Database → Replication で public.battles を Realtime に追加する場合は任意。

-- ---- profiles ----
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  short_code text not null unique,
  display_name text,
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_all"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 新規ユーザーにプロフィール行（短い友達コード・Google 表示名があれば保存）
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- 公開名刺（他プレイヤーがランダム対戦の相手にできる） ----
create table if not exists public.shared_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null,
  fingerprint text not null,
  payload jsonb not null,
  created_at timestamptz default now()
);

create index if not exists shared_cards_owner_idx on public.shared_cards (owner_id);
create index if not exists shared_cards_fingerprint_idx on public.shared_cards (fingerprint);

alter table public.shared_cards enable row level security;

create policy "shared_cards_select_public"
  on public.shared_cards for select
  to authenticated
  using (true);

create policy "shared_cards_insert_own"
  on public.shared_cards for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "shared_cards_delete_own"
  on public.shared_cards for delete
  to authenticated
  using (owner_id = auth.uid());

-- ---- オンライン対戦ログ（登録名刺ランダム・指定対戦） ----
create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('random_card', 'direct')),
  a_user uuid not null references auth.users on delete cascade,
  b_user uuid not null references auth.users on delete cascade,
  a_payload jsonb not null,
  b_payload jsonb not null,
  a_fp text,
  b_fp text,
  winner text not null check (winner in ('a', 'b', 'draw')),
  created_at timestamptz default now()
);

create index if not exists battles_users_idx on public.battles (a_user, b_user);
create index if not exists battles_created_idx on public.battles (created_at desc);

alter table public.battles enable row level security;

create policy "battles_select_participant"
  on public.battles for select
  to authenticated
  using (auth.uid() = a_user or auth.uid() = b_user);

-- 自分を a 側として記録する形式のみ許可（データ整合・改ざん耐性は Edge Functions 追加で強化可能）
create policy "battles_insert_as_a"
  on public.battles for insert
  to authenticated
  with check (a_user = auth.uid());

-- ========= RPC =========

-- 登録済み名刺からランダムに 1 枚（未対戦を優先）
create or replace function public.rpc_pick_random_shared_card()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  picked shared_cards%rowtype;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select sc.* into picked
  from public.shared_cards sc
  where sc.owner_id <> me
    and not exists (
      select 1 from public.battles b
      where b.mode = 'random_card'
        and b.a_user = me
        and b.b_fp = sc.fingerprint
    )
  order by random()
  limit 1;

  if not found then
    select sc.* into picked
    from public.shared_cards sc
    where sc.owner_id <> me
    order by random()
    limit 1;
  end if;

  if not found then
    return jsonb_build_object('ok', true, 'card', null::jsonb);
  end if;

  return jsonb_build_object('ok', true, 'card', to_jsonb(picked));
end;
$$;

grant execute on function public.rpc_pick_random_shared_card() to authenticated;

-- 短いコード → ユーザー UUID（指定対戦で入力）
create or replace function public.rpc_resolve_short_code(p_code text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.profiles
  where short_code = lower(trim(p_code))
  limit 1;
$$;

grant execute on function public.rpc_resolve_short_code(text) to authenticated;

-- 相手ユーザーの公開名刺から 1 枚（指定対戦）
create or replace function public.rpc_pick_opponent_shared_card(p_target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  picked shared_cards%rowtype;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_target_user is null or p_target_user = me then
    return jsonb_build_object('ok', false, 'error', 'bad_target');
  end if;

  select sc.* into picked
  from public.shared_cards sc
  where sc.owner_id = p_target_user
  order by random()
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'card', null::jsonb);
  end if;

  return jsonb_build_object('ok', true, 'card', to_jsonb(picked));
end;
$$;

grant execute on function public.rpc_pick_opponent_shared_card(uuid) to authenticated;

-- ---- ログイン中ユーザーのゲームデータ同期（図鑑・ガチャ・名刺入れ） ----
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

create policy "wg_user_save_select_own"
  on public.wg_user_save for select
  to authenticated
  using (user_id = auth.uid());

create policy "wg_user_save_insert_own"
  on public.wg_user_save for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "wg_user_save_update_own"
  on public.wg_user_save for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

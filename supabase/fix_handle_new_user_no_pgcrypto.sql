-- 新規 Google ログイン時の「gen_random_bytes が無い」エラー修正
-- ★ Supabase ダッシュボード → SQL Editor にこのファイル全文を貼り、Run してください。
-- （ローカルの Git を直しただけでは、クラウド上の DB は変わりません）

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
  values (
    new.id,
    lower(left(replace(gen_random_uuid()::text, '-', ''), 8)),
    nullif(trim(dn), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

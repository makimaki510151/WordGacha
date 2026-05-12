-- 実プレイヤー用ランダムマッチを廃止した既存プロジェクト向け（SQL Editor で 1 回実行）
--
-- 1) まだ random_human の行があると mode の CHECK 変更に失敗します。
--    その場合は次の行のコメントを外して実行してから、もう一度このファイル全体を実行。
-- delete from public.battles where mode = 'random_human';
--
-- 2) battles の CHECK 制約名が battles_mode_check でない場合は、次で名前を確認:
--    select conname from pg_constraint where conrelid = 'public.battles'::regclass and contype = 'c';

alter table public.battles drop constraint if exists battles_mode_check;
alter table public.battles add constraint battles_mode_check check (mode in ('random_card', 'direct'));

drop function if exists public.rpc_match_random_queue(jsonb);
drop function if exists public.rpc_finalize_human_battle(uuid, text);
drop table if exists public.random_queue cascade;

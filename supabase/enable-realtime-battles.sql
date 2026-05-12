-- 手順4（Realtime）の代替: SQL だけで battles を Realtime に載せる
-- ダッシュボードのメニューが分かりにくいときは、SQL Editor でこれを 1 回実行してください。

alter publication supabase_realtime add table public.battles;

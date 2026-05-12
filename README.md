# WordGacha

言葉をガチャで引いてそれらを組み合わせ相性バトルをする Web アプリです。

## Supabase でオンライン機能を使う手順

### 1. Supabase でプロジェクトを作成

1. [Supabase](https://supabase.com/) にログインし、新規プロジェクトを作成します。
2. **Project Settings → API** で **Project URL** と **anon public** キーをコピーします。

### 2. データベースにスキーマを流し込む

1. **SQL Editor** を開き、`supabase/schema.sql` の全文を貼り付けて **Run** します。
2. エラーが出た場合はメッセージを確認してください（トリガー構文は PostgreSQL 15 で `EXECUTE FUNCTION` を使用しています）。

### 3. Google ログインを有効にする

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成し、**API とサービス → 認証情報 → OAuth 2.0 クライアント ID** で **ウェブアプリケーション** を作成します。
2. **承認済みのリダイレクト URI** に、Supabase が案内する URL を追加します。形式は次のとおりです（`YOUR_PROJECT_REF` は自分のプロジェクト ID）:  
   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`
3. Supabase ダッシュボード **Authentication → Providers → Google** をオンにし、クライアント ID とクライアントシークレットを貼り付けます。
4. **Authentication → URL Configuration** で、実際にゲームを開く **Site URL** と **Redirect URLs**（例: `https://ユーザー名.github.io/WordGacha/` や `http://localhost:8080/`）を登録します。

### 3b. 既に schema.sql だけ流している場合（ゲームデータ同期テーブル追加）

**SQL Editor** で `supabase/migration_wg_user_save.sql` を実行すると、`wg_user_save` テーブルと RLS、プロフィール用トリガーの更新が入ります。

**以前の schema で「実プレイヤー用ランダム」を入れたプロジェクト**では、不要になったキューと RPC を消すために `supabase/drop_random_human.sql` も実行してください（`battles` の `mode` に `random_human` が残っている場合は、ファイル内の `DELETE` のコメントを外してから実行します）。

### 4. Realtime（任意）

`battles` テーブルを Realtime に載せると、将来クライアントで変更を購読しやすくなります。現状のゲーム機能では**必須ではありません**。有効にする場合は `supabase/enable-realtime-battles.sql` を SQL Editor で実行するか、ダッシュボード **Database → Replication** から `public.battles` をオンにしてください。

**API キーについて:** [Settings → API](https://supabase.com/dashboard/project/_/settings/api) の **anon** はブラウザ埋め込み用の公開鍵です。**GitHub Pages** では `js/supabase-config.js` をリポジトリに含める必要があるため（含めないと 404）、このリポジトリでは既定で `js/supabase-config.js` を追跡しています。公開リポジトリで気になる場合は [Dashboard で anon をローテート](https://supabase.com/dashboard/project/_/settings/api)し、値を差し替えてください。

### 5. ホスティング

静的ファイル（`index.html`, `css/`, `js/`）を **GitHub Pages / Cloudflare Pages / Netlify** などに置くだけで動きます。ビルドは不要です。**`js/supabase-config.js`** は Pages で読み込まれるため、必ずコミットに含め、`url` / `anonKey` を自分の Supabase に合わせてください。

---

## セキュリティについて

- 現在の構成では、対戦の勝敗はブラウザで計算した结果被せて RPC で保存しています。**改ざん防止を厳密にする場合**は、Supabase **Edge Functions** で同じ対戦ロジック（`js/battle-engine.js` と同等）を実行し、サーバー側でだけ勝敗を確定させることを推奨します。

## ライセンス

プロジェクトに合わせてください。

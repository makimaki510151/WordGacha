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

### 4. Realtime（任意・推奨）

**何のためか:** 「ランダム対戦（実プレイヤー）」でキューに入って待っているとき、誰かとマッチするとサーバーに `battles` の行が追加されます。ブラウザが **Realtime** でその追加を購読すると、**すぐ**対戦結果画面に進めます。Realtime を付けなくても、**約 2.5 秒ごとのポーリング**で同じ行を拾うので、最終的には動きます。

**やり方 A（ダッシュボード）※画面名はプロジェクトで多少違うことがあります**

1. 左メニュー **Database** を開く。
2. 上部または左の **Replication**（または「パブリケーション」「Realtime」に近い項目）を開く。
3. **`public`** スキーマの一覧からテーブル **`battles`** を探し、**Realtime を ON** にする（「Enable」やトグルで有効化）。

**やり方 B（SQL の方が確実）**

1. **SQL Editor** を開く。
2. リポジトリ内の `supabase/enable-realtime-battles.sql` の中身（1 行の `alter publication ...`）を貼り付けて **Run** する。

**API キーについて:** [Legacy API keys](https://supabase.com/dashboard/project/_/settings/api-keys/legacy) の **anon** は、ブラウザに埋め込む用途向けの公開鍵です（[Settings → API](https://supabase.com/dashboard/project/_/settings/api) からも取得できます）。それでも **GitHub にそのまま push しない**よう、このリポジトリでは `js/supabase-config.js` を `.gitignore` に入れています。

### 5. フロントの設定ファイル

1. `js/supabase-config.example.js` をコピーして `js/supabase-config.js` を作成します。
2. `url` と `anonKey` に、手順 1 の値を貼り付けます。

```javascript
window.WG_SUPABASE_CONFIG = {
  url: "https://xxxx.supabase.co",
  anonKey: "eyJhbGciOi...",
};
```

### 6. ホスティング

静的ファイル（`index.html`, `css/`, `js/`）を **GitHub Pages / Cloudflare Pages / Netlify** などに置くだけで動きます。ビルドは不要です。

---

## セキュリティについて

- 現在の構成では、対戦の勝敗はブラウザで計算した结果被せて RPC で保存しています。**改ざん防止を厳密にする場合**は、Supabase **Edge Functions** で同じ対戦ロジック（`js/battle-engine.js` と同等）を実行し、サーバー側でだけ勝敗を確定させることを推奨します。

## ライセンス

プロジェクトに合わせてください。

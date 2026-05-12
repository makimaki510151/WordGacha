-- 既存DB向け: 同じ名刺（同一 fingerprint）の二重登録を禁止。
-- すでに (owner_id, fingerprint) の重複行がある場合は先に片方を削除してから実行してください。

create unique index if not exists shared_cards_owner_fingerprint_unique
  on public.shared_cards (owner_id, fingerprint);

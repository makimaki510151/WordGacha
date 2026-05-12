/**
 * Supabase オンライン: Google ログイン後の名刺公開・登録名刺ランダム対戦・指定対戦
 */
(function (global) {
  "use strict";

  let deps = null;

  function getSb() {
    return global.WordGachaCloudSync && typeof global.WordGachaCloudSync.getClient === "function"
      ? global.WordGachaCloudSync.getClient()
      : null;
  }

  function cfgOk() {
    const c = global.WG_SUPABASE_CONFIG;
    return c && typeof c.url === "string" && c.url.startsWith("http") && c.anonKey && c.anonKey.length > 10;
  }

  function getCreateClient() {
    const lib = global.supabase;
    if (lib && typeof lib.createClient === "function") return lib.createClient.bind(lib);
    if (lib && lib.default && typeof lib.default.createClient === "function") return lib.default.createClient.bind(lib.default);
    return null;
  }

  function presetToPayload(preset, getPresetDisplayLine, oppBattleFingerprint, FIXED_INTRO_TAIL) {
    const fp = oppBattleFingerprint(preset.wordIds, preset.playerName, preset.fixedTail);
    return {
      wordIds: preset.wordIds,
      playerName: preset.playerName,
      fixedTail: preset.fixedTail || FIXED_INTRO_TAIL,
      displayLine: preset.displayLine || getPresetDisplayLine(preset),
      fingerprint: fp,
    };
  }

  function parsePayloadAsParsedOpp(payload) {
    return {
      wordIds: payload.wordIds || null,
      playerName: payload.playerName || null,
      fixedTail: payload.fixedTail || null,
      displayLine: payload.displayLine || null,
    };
  }

  function mapBattleResultToDbWinner(r, iAmA) {
    if (r.winner === "draw") return "draw";
    if (r.winner === "a") return iAmA ? "a" : "b";
    return iAmA ? "b" : "a";
  }

  function pickInsertedBattleId(data) {
    if (data == null) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return row && row.id != null ? String(row.id) : null;
  }

  function appendOnlineBattleRecordNotes(outEl, countedForRate, mode, battleId) {
    if (!outEl) return;
    const p1 = document.createElement("p");
    p1.className = "battle-record-note";
    p1.textContent = countedForRate
      ? "名刺入れに記録しました（初めて対戦する相手のため、勝率に反映されます）。"
      : "名刺入れに記録しました（すでに対戦済みの相手のため、勝率は変わりません）。";
    outEl.appendChild(p1);
    const p2 = document.createElement("p");
    p2.className = "battle-record-note battle-record-note--db";
    const modeJa = mode === "direct" ? "指定対戦（オンライン）" : "ランダム（公開名刺・オンライン）";
    const idStr = battleId != null && String(battleId).length > 0 ? String(battleId) : "";
    p2.textContent = idStr
      ? `Supabase に保存しました（${modeJa} · 対戦ID: ${idStr}）。`
      : `Supabase に保存しました（${modeJa}）。`;
    outEl.appendChild(p2);
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setOnlineMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
    el.className = text ? (isError ? "msg-error" : "msg-ok") : "";
  }

  async function ensureSession() {
    const client = getSb();
    if (!client) return null;
    const {
      data: { session },
    } = await client.auth.getSession();
    return session;
  }

  async function refreshIdentityPanel() {
    const statusEl = $("online-status");
    const idEl = $("online-identity");
    const session = await ensureSession();
    if (!session) {
      if (statusEl) statusEl.textContent = "未ログインです。";
      if (idEl) idEl.textContent = "";
      return null;
    }
    if (statusEl) statusEl.textContent = "ログイン済みです。";
    const client = getSb();
    if (!client) return null;
    const { data: prof } = await client.from("profiles").select("short_code").eq("id", session.user.id).maybeSingle();
    const code = prof && prof.short_code ? prof.short_code : "（プロフィール未取得）";
    const email = session.user.email ? deps.escapeHtml(session.user.email) : "";
    const metaName =
      session.user.user_metadata && session.user.user_metadata.full_name
        ? deps.escapeHtml(String(session.user.user_metadata.full_name))
        : "";
    if (idEl) {
      idEl.innerHTML =
        (metaName || email ? `${metaName ? `<strong>${metaName}</strong> · ` : ""}${email ? `${email} · ` : ""}` : "") +
        `共有コード: <code>${deps.escapeHtml(code)}</code>`;
    }
    return session;
  }

  function fillPresetSelect(selectEl) {
    if (!selectEl || !deps.loadPresets) return;
    const presets = deps.loadPresets();
    selectEl.innerHTML =
      presets.map((p, i) => `<option value="${i}">${deps.escapeHtml(p.name || `名刺 ${i + 1}`)}</option>`).join("") ||
      `<option value="">— 名刺入れに保存してください —</option>`;
  }

  async function signInGoogle() {
    const msgEl = $("online-config-msg");
    if (!getCreateClient() || !cfgOk()) {
      setOnlineMsg(msgEl, "Supabase の URL / anon キーを js/supabase-config.js に設定してください。", true);
      return;
    }
    if (!global.WordGachaCloudSync || typeof global.WordGachaCloudSync.signInWithGoogle !== "function") {
      setOnlineMsg(msgEl, "cloud-sync が読み込まれていません。", true);
      return;
    }
    const { error } = await global.WordGachaCloudSync.signInWithGoogle();
    if (error) {
      setOnlineMsg(msgEl, `Google ログインを開始できませんでした: ${error.message}`, true);
      return;
    }
    setOnlineMsg(msgEl, "Google にリダイレクトしています…", false);
  }

  async function signOutOnline() {
    const msgEl = $("online-config-msg");
    if (global.WordGachaCloudSync && typeof global.WordGachaCloudSync.signOut === "function") {
      await global.WordGachaCloudSync.signOut();
    }
    setOnlineMsg(msgEl, "ログアウトしました（この端末のデータはブラウザに残ります）。", false);
    await refreshIdentityPanel();
  }

  async function uploadSharedCard() {
    const msgEl = $("online-config-msg");
    const session = await ensureSession();
    if (!session) {
      setOnlineMsg(msgEl, "先にログインしてください。", true);
      return;
    }
    const sel = $("sel-online-preset");
    const presets = deps.loadPresets();
    const idx = sel ? parseInt(sel.value, 10) : NaN;
    if (!presets[idx]) {
      setOnlineMsg(msgEl, "名刺を選んでください。", true);
      return;
    }
    const payload = presetToPayload(
      presets[idx],
      deps.getPresetDisplayLine,
      deps.oppBattleFingerprint,
      deps.FIXED_INTRO_TAIL
    );
    const client = getSb();
    if (!client) return;
    const { error } = await client.from("shared_cards").insert({
      owner_id: session.user.id,
      name: presets[idx].name || "名刺",
      fingerprint: payload.fingerprint,
      payload,
    });
    if (error) {
      setOnlineMsg(msgEl, `公開に失敗: ${error.message}`, true);
      return;
    }
    setOnlineMsg(msgEl, "サーバーに名刺を公開しました（ランダム対戦の相手プールに載ります）。", false);
  }

  function renderOnlineBattle(el, r, myTitle, myLine, oppLine) {
    el.innerHTML = "";
    el.className = "battle-log battle-theater";
    deps.renderBattleResult(el, r, myTitle, myLine, oppLine);
  }

  async function runRandomCard() {
    const msgEl = $("online-config-msg");
    const out = $("online-out");
    const session = await ensureSession();
    if (!session) {
      setOnlineMsg(msgEl, "先にログインしてください。", true);
      return;
    }
    const sel = $("sel-online-preset");
    const presets = deps.loadPresets();
    const idx = sel ? parseInt(sel.value, 10) : NaN;
    if (!presets[idx]) {
      setOnlineMsg(msgEl, "名刺を選んでください。", true);
      return;
    }
    const myPreset = presets[idx];
    const myPayload = presetToPayload(myPreset, deps.getPresetDisplayLine, deps.oppBattleFingerprint, deps.FIXED_INTRO_TAIL);

    const client = getSb();
    if (!client) return;
    const { data, error } = await client.rpc("rpc_pick_random_shared_card");
    if (error) {
      setOnlineMsg(msgEl, `取得エラー: ${error.message}`, true);
      return;
    }
    if (!data || !data.ok || !data.card) {
      setOnlineMsg(msgEl, "対戦できる公開名刺がありません。友人に公開してもらうか、自分以外がアップロードするまで待ってください。", true);
      return;
    }

    const card = data.card;
    const oppPayload = card.payload;
    const parsed = parsePayloadAsParsedOpp(oppPayload);
    const r = deps.battle(myPayload.wordIds, parsed.wordIds || []);
    const myLine = deps.getPresetDisplayLine(myPreset);
    const oppLine = deps.buildOpponentDisplayLine({}, parsed);
    renderOnlineBattle(out, r, myPreset.name, myLine, oppLine);

    const dbWinner = mapBattleResultToDbWinner(r, true);
    const oppOwner = card.owner_id;

    const ins = await client
      .from("battles")
      .insert({
        mode: "random_card",
        a_user: session.user.id,
        b_user: oppOwner,
        a_payload: myPayload,
        b_payload: oppPayload,
        a_fp: myPayload.fingerprint,
        b_fp: card.fingerprint,
        winner: dbWinner,
      })
      .select("id");
    if (ins.error) {
      setOnlineMsg(msgEl, `記録エラー: ${ins.error.message}`, true);
    } else {
      const battleId = pickInsertedBattleId(ins.data);
      let countedForRate = true;
      if (typeof deps.appendPresetBattleHistory === "function") {
        const meta = deps.appendPresetBattleHistory(idx, parsed, oppLine, r.winner, {
          battleSource: "random_card",
          battleId,
        });
        countedForRate = meta ? meta.countedForRate : true;
      }
      appendOnlineBattleRecordNotes(out, countedForRate, "random_card", battleId);
      setOnlineMsg(msgEl, "対戦完了（未対戦の名刺を優先して選んでいます）。", false);
    }
  }

  async function runDirect() {
    const msgEl = $("online-config-msg");
    const out = $("online-out");
    const codeInput = $("online-target-code");
    const session = await ensureSession();
    if (!session) {
      setOnlineMsg(msgEl, "先にログインしてください。", true);
      return;
    }
    const rawCode = (codeInput && codeInput.value.trim()) || "";
    if (!rawCode) {
      setOnlineMsg(msgEl, "相手の短いコードを入力してください。", true);
      return;
    }

    const client = getSb();
    if (!client) return;
    const { data: targetUuid, error: rErr } = await client.rpc("rpc_resolve_short_code", { p_code: rawCode });
    if (rErr || !targetUuid) {
      setOnlineMsg(msgEl, "そのコードのユーザーが見つかりません。", true);
      return;
    }

    const { data: pick, error: pErr } = await client.rpc("rpc_pick_opponent_shared_card", { p_target_user: targetUuid });
    if (pErr) {
      setOnlineMsg(msgEl, `エラー: ${pErr.message}`, true);
      return;
    }
    if (!pick || !pick.ok || !pick.card) {
      setOnlineMsg(msgEl, "相手はまだ公開名刺を登録していません。", true);
      return;
    }

    const sel = $("sel-online-preset");
    const presets = deps.loadPresets();
    const idx = sel ? parseInt(sel.value, 10) : NaN;
    if (!presets[idx]) {
      setOnlineMsg(msgEl, "自分の名刺を選んでください。", true);
      return;
    }
    const myPreset = presets[idx];
    const myPayload = presetToPayload(myPreset, deps.getPresetDisplayLine, deps.oppBattleFingerprint, deps.FIXED_INTRO_TAIL);
    const card = pick.card;
    const oppPayload = card.payload;
    const parsed = parsePayloadAsParsedOpp(oppPayload);
    const r = deps.battle(myPayload.wordIds, parsed.wordIds || []);
    const myLine = deps.getPresetDisplayLine(myPreset);
    const oppLine = deps.buildOpponentDisplayLine({}, parsed);
    renderOnlineBattle(out, r, myPreset.name, myLine, oppLine);

    const dbWinner = mapBattleResultToDbWinner(r, true);
    const ins = await client
      .from("battles")
      .insert({
        mode: "direct",
        a_user: session.user.id,
        b_user: targetUuid,
        a_payload: myPayload,
        b_payload: oppPayload,
        a_fp: myPayload.fingerprint,
        b_fp: card.fingerprint,
        winner: dbWinner,
      })
      .select("id");
    if (ins.error) {
      setOnlineMsg(msgEl, `記録エラー: ${ins.error.message}`, true);
    } else {
      const battleId = pickInsertedBattleId(ins.data);
      let countedForRate = true;
      if (typeof deps.appendPresetBattleHistory === "function") {
        const meta = deps.appendPresetBattleHistory(idx, parsed, oppLine, r.winner, {
          battleSource: "direct",
          battleId,
        });
        countedForRate = meta ? meta.countedForRate : true;
      }
      appendOnlineBattleRecordNotes(out, countedForRate, "direct", battleId);
      setOnlineMsg(msgEl, "指定対戦を記録しました。", false);
    }
  }

  function init(appDeps) {
    deps = appDeps;
    const msgEl = $("online-config-msg");

    if (!cfgOk()) {
      setOnlineMsg(msgEl, "オンライン機能のために js/supabase-config.js に Supabase の URL と anon キーを設定してください。", true);
    } else if (!getCreateClient()) {
      setOnlineMsg(msgEl, "Supabase JS が読み込まれていません（index.html の CDN を確認）。", true);
    } else {
      setOnlineMsg(msgEl, "", false);
    }

    fillPresetSelect($("sel-online-preset"));

    const btnGoogle = $("btn-online-google");
    if (btnGoogle) btnGoogle.addEventListener("click", () => signInGoogle());
    const btnOut = $("btn-online-logout");
    if (btnOut) btnOut.addEventListener("click", () => signOutOnline());

    const btnUp = $("btn-upload-shared");
    if (btnUp) btnUp.addEventListener("click", () => uploadSharedCard());

    const btnRc = $("btn-random-card");
    if (btnRc) btnRc.addEventListener("click", () => runRandomCard());

    const btnDir = $("btn-direct-battle");
    if (btnDir) btnDir.addEventListener("click", () => runDirect());

    global.addEventListener("wg:presets-changed", () => fillPresetSelect($("sel-online-preset")));

    global.addEventListener("wg:auth-changed", () => refreshIdentityPanel());
    refreshIdentityPanel();
  }

  global.WordGachaOnline = { init };
})(window);

/**
 * Supabase: Google ログイン + 図鑑・ガチャ・名刺のクラウド同期（wg_user_save）
 */
(function (global) {
  "use strict";

  let sb = null;
  let ctx = null;
  let pushTimer = null;
  let suppressPush = false;

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

  function getRedirectUrl() {
    const c = global.WG_SUPABASE_CONFIG || {};
    if (c.redirectUrl && typeof c.redirectUrl === "string") return c.redirectUrl;
    return `${global.location.origin}${global.location.pathname}`;
  }

  function getClient() {
    if (sb) return sb;
    const create = getCreateClient();
    if (!create || !cfgOk()) return null;
    sb = create(global.WG_SUPABASE_CONFIG.url, global.WG_SUPABASE_CONFIG.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
    return sb;
  }

  async function getSession() {
    const c = getClient();
    if (!c) return null;
    const {
      data: { session },
    } = await c.auth.getSession();
    return session;
  }

  function isSignedIn() {
    return !!(sb && sb.auth);
  }

  async function pushNow(force) {
    if (!force && suppressPush) return;
    if (!ctx) return;
    const client = getClient();
    if (!client) return;
    const session = await getSession();
    if (!session) return;

    const row = ctx.getGameState();
    row.user_id = session.user.id;
    row.updated_at = new Date().toISOString();

    const { error } = await client.from("wg_user_save").upsert(row, { onConflict: "user_id" });
    if (error) console.warn("[WordGachaCloudSync] push failed", error.message);
  }

  function requestPush() {
    if (suppressPush || !ctx) return;
    const client = getClient();
    if (!client) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushNow(false);
    }, 850);
  }

  async function pullSyncAndRefresh() {
    if (!ctx) return;
    const client = getClient();
    if (!client) return;
    const session = await getSession();
    if (!session) return;

    suppressPush = true;
    try {
      const { data, error } = await client.from("wg_user_save").select("*").eq("user_id", session.user.id).maybeSingle();
      if (error) {
        console.warn("[WordGachaCloudSync] pull failed", error.message);
        return;
      }
      if (data) {
        ctx.applyGameState(data);
      } else {
        await pushNow(true);
      }
    } finally {
      suppressPush = false;
      ctx.onRefreshAllUI();
      global.dispatchEvent(new CustomEvent("wg:auth-changed", { detail: { session } }));
    }
  }

  async function hydrateFromSessionIfAny() {
    const session = await getSession();
    if (session) await pullSyncAndRefresh();
  }

  async function signInWithGoogle() {
    const client = getClient();
    if (!client) return { error: new Error("Supabase 未設定") };
    return client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getRedirectUrl(),
      },
    });
  }

  async function signOut() {
    const client = getClient();
    if (!client) return;
    suppressPush = true;
    await client.auth.signOut();
    suppressPush = false;
    global.dispatchEvent(new CustomEvent("wg:auth-changed", { detail: { session: null } }));
  }

  function init(config) {
    ctx = config;
    const client = getClient();
    if (!client) return;

    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        global.dispatchEvent(new CustomEvent("wg:auth-changed", { detail: { session: null } }));
      } else if (session) {
        global.dispatchEvent(new CustomEvent("wg:auth-changed", { detail: { session } }));
      }
    });
  }

  global.WordGachaCloudSync = {
    init,
    getClient,
    getSession,
    signInWithGoogle,
    signOut,
    requestPush,
    hydrateFromSessionIfAny,
  };
})(window);

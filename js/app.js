/**
 * WordGacha — ローカル保存・ガチャ・図鑑・ビルダー・名刺入れ・JSON対戦
 */
(function () {
  "use strict";

  const STORAGE = {
    owned: "wg_owned_ids",
    jam: "wg_jam_points",
    day: "wg_ymd",
    pulls: "wg_pulls_today",
    presets: "wg_presets",
    gachaLog: "wg_gacha_log",
    gachaSkipFx: "wg_gacha_skip_fx",
  };

  const MAX_PULLS_PER_DAY = 100;
  const MAX_WORDS_IN_PHRASE = 10;
  const JAM_FOR_PITY = 50;
  const MAX_GACHA_LOG = 120;
  /** 語の並びの直後に付く固定文（プレイヤー名の直前は語列） */
  const FIXED_INTRO_TAIL = "です。対戦によろしくお願いします。";

  /** 対戦共有: true なら語ID配列を Base64 で包む（難読化。鍵を伴わないため暗号ではない） */
  const BATTLE_SHARE_BASE64 = true;
  const BATTLE_SHARE_VER = 1;

  /** @type {typeof WORD_CATALOG} */
  const CATALOG = WORD_CATALOG;
  const byId = new Map(CATALOG.map((w) => [w.id, w]));

  /** よく使う助詞・接続詞（常に図鑑登録済み。ガチャでは出ません） */
  const STARTER_GRAMMAR_IDS = [
    "w051", "w052", "w053", "w054", "w055", "w121", "w241",
    "w041", "w042", "w043", "w044",
  ];
  const STARTER_GRAMMAR_SET = new Set(STARTER_GRAMMAR_IDS.filter((id) => byId.has(id)));

  const GOOD_PAIRS = new Set([
    "fire-wind",
    "water-life",
    "earth-metal",
    "light-mind",
    "shadow-cosmos",
    "hero-light",
    "mage-cosmos",
  ]);
  const BAD_PAIRS = new Set([
    "fire-water",
    "fire-ice",
    "light-shadow",
    "wind-earth",
  ]);

  let gachaBusy = false;

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function loadOwned() {
    let base;
    try {
      const raw = localStorage.getItem(STORAGE.owned);
      const arr = raw ? JSON.parse(raw) : [];
      base = new Set(Array.isArray(arr) ? arr : []);
    } catch {
      base = new Set();
    }
    STARTER_GRAMMAR_IDS.forEach((id) => {
      if (byId.has(id)) base.add(id);
    });
    return base;
  }

  function saveOwned(set) {
    localStorage.setItem(STORAGE.owned, JSON.stringify([...set]));
  }

  function loadJam() {
    const n = parseInt(localStorage.getItem(STORAGE.jam) || "0", 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  function saveJam(n) {
    localStorage.setItem(STORAGE.jam, String(n));
  }

  function getPullState() {
    const key = todayKey();
    const day = localStorage.getItem(STORAGE.day);
    if (day !== key) {
      localStorage.setItem(STORAGE.day, key);
      localStorage.setItem(STORAGE.pulls, "0");
      return { pulls: 0, key };
    }
    const pulls = parseInt(localStorage.getItem(STORAGE.pulls) || "0", 10) || 0;
    return { pulls, key };
  }

  function addPullCount(n) {
    const { pulls } = getPullState();
    localStorage.setItem(STORAGE.pulls, String(pulls + n));
  }

  function loadGachaLog() {
    try {
      const raw = localStorage.getItem(STORAGE.gachaLog);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveGachaLog(entries) {
    localStorage.setItem(STORAGE.gachaLog, JSON.stringify(entries.slice(0, MAX_GACHA_LOG)));
  }

  function prependGachaLog(newItems) {
    const cur = loadGachaLog();
    const merged = [...newItems, ...cur].slice(0, MAX_GACHA_LOG);
    saveGachaLog(merged);
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(STORAGE.presets);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function savePresets(arr) {
    localStorage.setItem(STORAGE.presets, JSON.stringify(arr));
  }

  function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function unownedIds(owned) {
    return CATALOG.filter((w) => !owned.has(w.id)).map((w) => w.id);
  }

  function pullWord(owned, jamBefore) {
    const unowned = unownedIds(owned);
    const usePity = jamBefore >= JAM_FOR_PITY && unowned.length > 0;
    let pool;
    if (usePity) pool = unowned.map((id) => byId.get(id)).filter(Boolean);
    else {
      pool = CATALOG.filter((w) => !STARTER_GRAMMAR_SET.has(w.id));
      if (!pool.length) pool = CATALOG.slice();
    }

    const picked = randomChoice(pool);
    const isDup = owned.has(picked.id);
    let jamAfter = jamBefore;
    if (usePity && !isDup) jamAfter = jamBefore - JAM_FOR_PITY;
    else if (isDup) jamAfter = jamBefore + 1;
    return { word: picked, isDup, usedPity: usePity && !isDup, jamAfter };
  }

  function pairKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  function adjacentAffinity(tagsA, tagsB) {
    let score = 0;
    const setA = new Set(tagsA);
    const setB = new Set(tagsB);
    for (const t of setA) if (setB.has(t)) score += 2;
    for (const ta of tagsA) {
      for (const tb of tagsB) {
        const k = pairKey(ta, tb);
        if (GOOD_PAIRS.has(k)) score += 3;
        if (BAD_PAIRS.has(k)) score -= 2;
      }
    }
    return score;
  }

  function positionClash(wA, wB) {
    if (!wA || !wB) return 0;
    return adjacentAffinity(wA.tags, wB.tags) + Math.floor((wA.power - wB.power) / 2);
  }

  function scoreLine(wordIds) {
    const words = wordIds.map((id) => byId.get(id)).filter(Boolean);
    let power = 0;
    let synergy = 0;
    words.forEach((w) => {
      power += w.power;
    });
    for (let i = 0; i < words.length - 1; i++) {
      synergy += adjacentAffinity(words[i].tags, words[i + 1].tags);
    }
    let position = 0;
    words.forEach((w, i) => {
      const mul = 1 + i * 0.03 + (w.kind === "adj_na" ? 0.05 : 0);
      position += Math.round(w.power * (mul - 1));
    });
    return { power, synergy, position, words };
  }

  function battle(idsA, idsB) {
    const lineA = scoreLine(idsA);
    const lineB = scoreLine(idsB);
    const n = Math.max(lineA.words.length, lineB.words.length);
    let clashA = 0;
    let clashB = 0;
    for (let i = 0; i < n; i++) {
      const a = lineA.words[i];
      const b = lineB.words[i];
      const c = positionClash(a, b);
      if (c > 0) clashA += c;
      if (c < 0) clashB += -c;
    }
    const totalA = lineA.power + lineA.synergy + lineA.position + clashA;
    const totalB = lineB.power + lineB.synergy + lineB.position + clashB;
    return {
      lineA,
      lineB,
      clashA,
      clashB,
      totalA,
      totalB,
      winner: totalA === totalB ? "draw" : totalA > totalB ? "a" : "b",
    };
  }

  /**
   * 共有データから相手の完成名乗りを復元（displayLine / w+n+t / 語だけ 等）
   * @param {object} rawOpp 生のパース結果
   * @param {{ wordIds: string[] | null, playerName: string | null, fixedTail: string | null, displayLine: string | null }} parsed parseBattleShare の戻り
   */
  function buildOpponentDisplayLine(rawOpp, parsed) {
    if (parsed.displayLine && String(parsed.displayLine).trim()) return String(parsed.displayLine).trim();
    if (rawOpp && typeof rawOpp.displayLine === "string" && rawOpp.displayLine.trim()) {
      return rawOpp.displayLine.trim();
    }
    const ids = parsed.wordIds || [];
    const wordsPart = ids.map((id) => (byId.get(id) ? byId.get(id).text : "")).join("");
    if (!wordsPart) return "（語が読み取れませんでした）";
    const pn = (parsed.playerName && String(parsed.playerName).trim()) || "";
    const tail = (parsed.fixedTail && String(parsed.fixedTail).trim()) || FIXED_INTRO_TAIL;
    if (pn) return `${wordsPart}${pn}${tail}`;
    return `${wordsPart}……（共有は語の並びまで。名乗りの続きは霧の向こうだ）`;
  }

  function pickFromSeed(arr, seed) {
    if (!arr.length) return "";
    const i = Math.abs(Math.floor(seed)) % arr.length;
    return arr[i];
  }

  function mergePools(themed, base) {
    return themed.length ? [...themed, ...base] : base;
  }

  function buildBattleContext(r) {
    const wa = r.lineA.words;
    const wb = r.lineB.words;
    const allTags = (words) => {
      const s = new Set();
      words.forEach((w) => w.tags.forEach((t) => s.add(t)));
      return s;
    };
    const tagCounts = (words) => {
      const m = {};
      words.forEach((w) => w.tags.forEach((t) => {
        m[t] = (m[t] || 0) + 1;
      }));
      return m;
    };
    const setA = allTags(wa);
    const setB = allTags(wb);
    const share = [...setA].filter((t) => setB.has(t));
    const ca = tagCounts(wa);
    const cb = tagCounts(wb);
    const topFrom = (m) =>
      Object.keys(m)
        .sort((a, b) => m[b] - m[a])
        .slice(0, 3);
    const kindScore = (words, kind) => words.reduce((n, w) => n + (w.kind === kind ? 1 : 0), 0);
    return {
      setA,
      setB,
      share,
      domA: topFrom(ca),
      domB: topFrom(cb),
      firstA: wa[0]?.text || "",
      firstB: wb[0]?.text || "",
      adjA: kindScore(wa, "adj_na"),
      adjB: kindScore(wb, "adj_na"),
    };
  }

  function pickBattleIntro(ctx, seed) {
    const pool = [
      "―――― 名乗り合い ――――",
      "◇ 言葉を重ねる前の一拍。名乗りの帷が開く ◇",
      "◆ 息を呑み、互いの紹介が通り過ぎる瞬間 ◆",
      "―― 交わる前の静寂。その奥で名乗りが弓を張る ――",
      "▽ 絵空事では済まない。実在する二つの名乗り ▽",
      "※ 礼儀と衝動のあいだで、一文が刃になる ※",
      "～ 盤上に座すのは言葉だけ。名乗りの禊が始まる ～",
      "＊ 聴衆は風だけ。二つの自己紹介が背中越しに擦れる ＊",
      "┄ 名刺も剣も持たず、語だけを挺する ┄",
      "◎ 対戦の前に来るのは、いつも名乗りの儀式だった ◎",
    ];
    if (ctx.share.includes("cosmos")) {
      pool.push("☆ 星の隙間から、二つの名乗りが覗き込む ☆", "・軌道が交差する。言葉の運行が名乗りを揺らす・");
    }
    if (ctx.share.includes("hero")) {
      pool.push("『 誇りを背負い、名乗りが道を詰める 』", "〈 征く者同士、最初の一礼は言葉で 〉");
    }
    if (ctx.share.includes("shadow")) {
      pool.push("… 影が長く伸び、紹介の端が触れ合う …", "﹅ 灯りの届かぬところで、名乗りが囁き合う ﹅");
    }
    if (ctx.share.includes("nature")) {
      pool.push("～ 葉擦れの音に紛れ、名乗りが芽吹く ～");
    }
    return pickFromSeed(pool, seed);
  }

  function pickBattleMid(ctx, seed) {
    const generic = [
      "両の一文が中空で重なり、見えない拍が火花を散らす……",
      "名乗りと名乗りのあいだに、張りつめた空気の薄膜がはためく。",
      "言葉の尻尾が絡まり、どちらが先にほどけるかはまだ見えない。",
      "静かな拍子が二人分あり、やがてどちらかに収束しようとする。",
      "紹介の拍が噛み合い、その瞬間だけ世界が狭くなる。",
      "聴く耳のない虚空に、二つのリズムがぶつかり落ちる。",
      "名乗りの刃先が虚を切り、次の一拍を待ち構える。",
    ];
    if (
      (ctx.setA.has("fire") && ctx.setB.has("water")) ||
      (ctx.setA.has("water") && ctx.setB.has("fire"))
    ) {
      return pickFromSeed(
        [
          "炎色の気配と水の膜がぶつかり、白いけむりが名乗りのあいだに立ち上った。",
          "熱と冷が交差し、言葉のすきまに霧の壁が一瞬だけ見えた。",
          "沸騰と鎮静が同時に訪れ、名乗りの温度が読めなくなる。",
        ],
        seed + 3
      );
    }
    if (ctx.share.includes("light") && ctx.share.includes("shadow")) {
      return pickFromSeed(
        [
          "光と影の縁が同じ場所に折り重なり、名乗りの輪郭を二重に見せた。",
          "明暗が交互に点滅し、どちらの紹介も片方だけでは完結しない。",
        ],
        seed + 5
      );
    }
    if (ctx.share.includes("hero")) {
      return pickFromSeed(
        [
          "誇り高い語が二筋並び、どちらも折れないまま拍を競う。",
          "物語の匂いが重なり、名乗りの背後に仮想のざわめきが聞こえた。",
          "征く者同士の響きがぶつかり、空に弧を描いて消えた。",
        ],
        seed
      );
    }
    if (ctx.share.includes("craft") || ctx.share.includes("metal")) {
      return pickFromSeed(
        [
          "金属の硬い余韻と職人的な手触りが、名乗りの歯車を噛ませる。",
          "鍛えた言葉同士が擦れ、小さな火花だけが耳に残った。",
        ],
        seed + 1
      );
    }
    if (ctx.domA[0] === "sound" || ctx.domB[0] === "sound" || ctx.share.includes("sound")) {
      return pickFromSeed(
        [
          "言葉に旋律が宿り、名乗りが短い和音となって重なる。",
          "聴く者なき演奏のように、二つの紹介が拍を譲り合う。",
        ],
        seed + 2
      );
    }
    if (ctx.share.includes("ice") || ctx.share.includes("thunder")) {
      return pickFromSeed(
        [
          "冷えた拍と鋭い閃光が交じり、名乗りの空気が刺すように張る。",
          "静電のようなざわめきが肌を撫で、次の語を急かす。",
        ],
        seed + 4
      );
    }
    return pickFromSeed(generic, seed);
  }

  function narrativeBattleClosing(r, ctx) {
    const diff = r.totalA - r.totalB;
    const gap = Math.abs(diff);
    let seed = r.totalA * 13 + r.totalB * 7;
    seed += ctx.share.reduce((s, t) => s + t.length * 3, 0);

    const drawBase = [
      "互いの名乗りが釣り合い、勝敗は宙に浮いたまま霧散していく。",
      "言葉と言葉が重なり合い、どちらも折れないまま引き分けとなった。",
      "拍が合い、空に残ったのは静かな緊張だけだ。",
      "両者の紹介が同じ高さで鳴り止み、裁定は風に預けられた。",
      "均衡の秤が微かに震え、どちらにも傾かなかった。",
    ];
    const drawThemed = [];
    if (ctx.share.length) {
      drawThemed.push(
        "同じ匂いを纏った言葉同士は、けん制し合いながら引き分けに落ち着いた。",
        "属性が重なりすぎ、互いの名乗りが響きを分け合った。"
      );
    }
    if (r.winner === "draw") {
      return pickFromSeed(mergePools(drawThemed, drawBase), seed);
    }

    const winNarrow = [
      "わずかな差で、こちらの名乗りの流れが前に出た。",
      "相手の弾みも鋭いが、最後の響きはこちらに傾いた。",
      "僅差の読み合いの末、こちらの一文が胸に残った。",
      "紙一重の勝負。こちらの語の並びがひと息だけ長く続いた。",
    ];
    const winWide = [
      "言葉の勢いがはっきりとこちらに傾き、名乗りの流れを支配した。",
      "相手の並びを押し流すような迫力が、こちらの名乗りに宿っていた。",
      "相性の輪が大きく開き、こちらの紹介が空間を満たした。",
      "こちらの名乗りが幅を取り、相手の言葉を背後へ押しやった。",
    ];
    const loseNarrow = [
      "僅かに相手の名乗りが食い込み、こちらは歯がみを呑む。",
      "拮抗の末、相手の言葉の縁がわずかに深かった。",
      "紙一重の差で、相手の紹介が心に食い込んだ。",
      "こちらも届きかけたが、相手の紹介が一歩先に押し切った。",
    ];
    const loseWide = [
      "相手の名乗りの重みに押され、こちらの言葉は届かなかった。",
      "言葉の弾みが相手に奪われ、虚しさだけが残る。",
      "相手の並びが圧を作り、こちらは一歩退いた。",
      "相手の紹介が壁となり、こちらの名乗りはその前で散った。",
    ];

    if (r.winner === "a") {
      let pool = gap < 10 ? winNarrow : winWide;
      const themed = [];
      if (ctx.domA.includes("fire")) themed.push("炎のような勢いがこちらに偏り、名乗りが焼き切れるように残った。");
      if (ctx.domA.includes("ice")) themed.push("冷たい澄んだ響きがこちらに残り、相手の熱を鎮めた。");
      if (ctx.adjA >= 2) themed.push("形容の重なりが華を作り、こちらの紹介が艶やかに勝った。");
      if (ctx.domA.includes("wind")) themed.push("風を切るようなリズムがこちらに残り、相手の拍を抜いた。");
      if (ctx.domA.includes("life")) themed.push("生気に満ちた名乗りがこちらに傾き、相手を柔らかく圧した。");
      pool = mergePools(themed, pool);
      return pickFromSeed(pool, seed);
    }

    let pool = gap < 10 ? loseNarrow : loseWide;
    const themed = [];
    if (ctx.domB.includes("shadow")) themed.push("相手の影色の深みがこちらを吞み、名乗りを沈めた。");
    if (ctx.domB.includes("thunder")) themed.push("相手の言葉に雷糸が走り、こちらの拍をかき消した。");
    if (ctx.adjB >= 2) themed.push("相手の形容の重なりが厚く、こちらを覆い被さった。");
    if (ctx.domB.includes("metal")) themed.push("相手の金属的な硬さがこちらを弾き、名乗りを砕いた。");
    if (ctx.domB.includes("cosmos")) themed.push("相手の名乗りに星屑が降り、こちらの視界を奪った。");
    pool = mergePools(themed, pool);
    return pickFromSeed(pool, seed);
  }

  function battleBannerLabel(r) {
    if (r.winner === "draw") return "引き分け";
    if (r.winner === "a") return "勝利";
    return "敗北";
  }

  function battleResultSubline(r) {
    if (r.winner === "draw") return "互角の名乗りでした。勝敗はつきませんでした。";
    if (r.winner === "a") return "あなたの名乗りが上回りました。おめでとうございます。";
    return "相手の名乗りが上回りました。次は言葉を練り直しましょう。";
  }

  function composeBattleNarrativeText(r, myCardTitle, myFullLine, oppFullLine, ctx, seed) {
    const title = (myCardTitle || "名刺").trim() || "名刺";
    const intro = pickBattleIntro(ctx, seed);
    const mid = pickBattleMid(ctx, seed + 11);
    const body = narrativeBattleClosing(r, ctx);
    return [
      intro,
      "",
      `【${title}】`,
      `「${myFullLine}」`,
      "",
      "【相手】",
      `「${oppFullLine}」`,
      "",
      mid,
      "",
      body,
    ].join("\n");
  }

  function renderBattleResult(el, r, myCardTitle, myFullLine, oppFullLine) {
    const ctx = buildBattleContext(r);
    const seed = r.totalA * 17 + r.totalB * 23 + (myFullLine?.length || 0) * 3 + (oppFullLine?.length || 0);
    const narrative = composeBattleNarrativeText(r, myCardTitle, myFullLine, oppFullLine, ctx, seed);
    const w = r.winner;
    const cls = w === "draw" ? "draw" : w === "a" ? "win" : "lose";
    el.className = `battle-theater battle-result battle-result--${cls}`;
    el.innerHTML =
      `<div class="battle-banner battle-banner--${cls}">${escapeHtml(battleBannerLabel(r))}</div>` +
      `<p class="battle-subline">${escapeHtml(battleResultSubline(r))}</p>` +
      `<pre class="battle-narrative">${escapeHtml(narrative)}</pre>`;
  }

  /** ---------- UI ---------- */
  const els = {
    navGacha: document.getElementById("nav-gacha"),
    navDex: document.getElementById("nav-dex"),
    navBuild: document.getElementById("nav-build"),
    navCase: document.getElementById("nav-case"),
    navBattle: document.getElementById("nav-battle"),
    secGacha: document.getElementById("sec-gacha"),
    secDex: document.getElementById("sec-dex"),
    secBuild: document.getElementById("sec-build"),
    secCase: document.getElementById("sec-case"),
    secBattle: document.getElementById("sec-battle"),
    gachaStatus: document.getElementById("gacha-status"),
    gachaResult: document.getElementById("gacha-result"),
    gachaStage: document.getElementById("gacha-stage"),
    gachaReveal: document.getElementById("gacha-reveal"),
    gachaHint: document.getElementById("gacha-hint"),
    gachaLogList: document.getElementById("gacha-log-list"),
    btnPull: document.getElementById("btn-pull"),
    btnPull10: document.getElementById("btn-pull-10"),
    gachaSkipFx: document.getElementById("gacha-skip-fx"),
    dexGrid: document.getElementById("dex-grid"),
    buildStatus: document.getElementById("build-status"),
    buildPreview: document.getElementById("build-preview"),
    buildSlots: document.getElementById("build-slots"),
    btnAddSlot: document.getElementById("btn-add-slot"),
    btnSavePreset: document.getElementById("btn-save-preset"),
    presetName: document.getElementById("preset-name"),
    playerName: document.getElementById("player-name"),
    buildWordSearch: document.getElementById("build-word-search"),
    buildKindFilter: document.getElementById("build-kind-filter"),
    caseList: document.getElementById("case-list"),
    caseCopyToast: document.getElementById("case-copy-toast"),
    battleLocal: document.getElementById("battle-local"),
    battleOpp: document.getElementById("battle-opp"),
    btnBattle: document.getElementById("btn-battle"),
    battleOut: document.getElementById("battle-out"),
  };

  /** 並べる言葉のID（順序そのものが名刺） */
  let builder = {
    slots: [""],
  };

  function setSection(id) {
    [
      ["gacha", els.secGacha, els.navGacha],
      ["dex", els.secDex, els.navDex],
      ["build", els.secBuild, els.navBuild],
      ["case", els.secCase, els.navCase],
      ["battle", els.secBattle, els.navBattle],
    ].forEach(([name, sec, nav]) => {
      const on = name === id;
      sec.classList.toggle("active", on);
      nav.classList.toggle("active", on);
    });
  }

  const KIND_LABEL_JA = {
    noun: "名詞",
    adj_na: "な形容",
    conj: "接続詞",
    particle: "助詞",
  };

  function kindLabelJa(kind) {
    return KIND_LABEL_JA[kind] || "その他";
  }

  function getBuildFilterState() {
    const q = els.buildWordSearch ? els.buildWordSearch.value.trim() : "";
    const k = els.buildKindFilter ? els.buildKindFilter.value : "";
    return { q, k };
  }

  /** 表示は語と種類（日本語）のみ。value に id は使うが画面には出さない */
  function slotWordOptionsHtml(owned, selectedId) {
    const { q, k } = getBuildFilterState();
    const matchText = (w) => !q || w.text.includes(q);
    const matchKind = (w) => !k || w.kind === k;
    let words = CATALOG.filter((w) => owned.has(w.id) && matchText(w) && matchKind(w));
    const sel = selectedId && byId.get(selectedId);
    if (sel && owned.has(sel.id) && !words.some((w) => w.id === selectedId)) {
      words = [sel, ...words];
    }
    words.sort((a, b) => a.text.localeCompare(b.text, "ja"));
    let html = '<option value="">— 選択 —</option>';
    words.forEach((w) => {
      const label = `${w.text}（${kindLabelJa(w.kind)}）`;
      html += `<option value="${escapeHtml(w.id)}">${escapeHtml(label)}</option>`;
    });
    if (!words.length) {
      html += '<option value="" disabled>該当する言葉がありません</option>';
    }
    return html;
  }

  function setGachaUiLocked(locked) {
    gachaBusy = locked;
    els.btnPull.disabled = locked;
    els.btnPull10.disabled = locked || getPullsRemaining() < 10;
  }

  function getPullsRemaining() {
    const { pulls } = getPullState();
    return Math.max(0, MAX_PULLS_PER_DAY - pulls);
  }

  function renderGachaStatus() {
    const owned = loadOwned();
    const jam = loadJam();
    const left = getPullsRemaining();
    els.gachaStatus.innerHTML = `
      <span class="stat-pill">本日の残りガチャ <strong>${left}</strong> / ${MAX_PULLS_PER_DAY}</span>
      <span class="stat-pill">図鑑登録 <strong>${owned.size}</strong> / ${CATALOG.length}</span>
      <span class="stat-pill">言葉詰まり <strong>${jam}</strong> pt（${JAM_FOR_PITY}で未所持狙い）</span>
    `;
    if (!gachaBusy) {
      els.btnPull10.disabled = left < 10;
    }
  }

  function formatLogTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function renderGachaLog() {
    const items = loadGachaLog();
    if (!items.length) {
      els.gachaLogList.innerHTML = "<li>まだログはありません。</li>";
      return;
    }
    els.gachaLogList.innerHTML = items
      .map((e) => {
        const pity = e.usedPity ? '<span class="log-dup"> · 詰まりボーナス</span>' : "";
        const multi = e.multiLabel ? escapeHtml(e.multiLabel) : "";
        const cls = e.isDup ? "log-dup" : "log-new";
        const tail = e.isDup ? "（被り）" : "（新規）";
        return `<li><span class="log-time">${formatLogTime(e.at)}</span> <span class="${cls}">「${escapeHtml(e.text)}」</span>${multi}${pity} ${tail}</li>`;
      })
      .join("");
  }

  function renderDex() {
    const owned = loadOwned();
    els.dexGrid.innerHTML = CATALOG.map((w) => {
      if (owned.has(w.id)) {
        return `<div class="word-chip owned"><span>${escapeHtml(w.text)}</span></div>`;
      }
      return `<div class="word-chip mystery" title="未入手"><span class="mystery-title">？？？</span></div>`;
    }).join("");
  }

  function collectBuilderIds() {
    return builder.slots.filter(Boolean);
  }

  function validateBuilder(owned) {
    const ids = collectBuilderIds();
    if (builder.slots.some((id) => !id)) {
      return { ok: false, msg: "空の枠があります。言葉を選ぶか、枠を減らしてください。" };
    }
    if (!ids.length) return { ok: false, msg: "語を1つ以上並べてください。" };
    const vocab = ids.filter((id) => owned.has(id));
    if (vocab.length !== ids.length) return { ok: false, msg: "未登録の言葉が含まれています。" };
    const uniq = new Set(ids);
    if (uniq.size !== ids.length) return { ok: false, msg: "同じ言葉は1度しか使えません。" };
    if (ids.length > MAX_WORDS_IN_PHRASE) return { ok: false, msg: `一度に使える言葉は${MAX_WORDS_IN_PHRASE}個までです。` };
    const pn = (els.playerName.value || "").trim();
    if (!pn) return { ok: false, msg: "プレイヤー名を入力してください。" };
    return { ok: true, msg: "" };
  }

  function refreshPreview() {
    const parts = builder.slots.map((id) => (id && byId.get(id) ? byId.get(id).text : "…"));
    const wordsPart = parts.join("");
    const pn = (els.playerName.value || "").trim() || "（プレイヤー名）";
    const full = `${wordsPart}${pn}${FIXED_INTRO_TAIL}`;
    els.buildPreview.textContent = `「${full}」`;
  }

  function renderBuilder(owned) {
    if (!builder.slots.length) builder.slots = [""];
    els.buildSlots.innerHTML = builder.slots
      .map(
        (id, i) => `
      <div class="chain-row" data-slot-row="${i}">
        <label class="slot-label">${i + 1}</label>
        <select data-slot="${i}" class="slot-word-select">${slotWordOptionsHtml(owned, builder.slots[i] || "")}</select>
        <button type="button" class="secondary" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="secondary" data-down="${i}" ${i === builder.slots.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="secondary" data-remove-slot="${i}" ${builder.slots.length <= 1 ? "disabled" : ""}>削除</button>
      </div>`
      )
      .join("");

    els.buildSlots.querySelectorAll("select[data-slot]").forEach((sel) => {
      const i = parseInt(sel.getAttribute("data-slot"), 10);
      sel.value = builder.slots[i] || "";
      sel.addEventListener("change", () => {
        builder.slots[i] = sel.value;
        refreshPreview();
        const v = validateBuilder(owned);
        els.buildStatus.textContent = v.ok ? "" : v.msg;
        els.buildStatus.className = v.ok ? "" : "msg-error";
      });
    });

    els.buildSlots.querySelectorAll("button[data-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-up"), 10);
        if (i <= 0) return;
        const t = builder.slots[i - 1];
        builder.slots[i - 1] = builder.slots[i];
        builder.slots[i] = t;
        renderBuilder(owned);
      });
    });

    els.buildSlots.querySelectorAll("button[data-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-down"), 10);
        if (i >= builder.slots.length - 1) return;
        const t = builder.slots[i + 1];
        builder.slots[i + 1] = builder.slots[i];
        builder.slots[i] = t;
        renderBuilder(owned);
      });
    });

    els.buildSlots.querySelectorAll("button[data-remove-slot]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (builder.slots.length <= 1) return;
        const i = parseInt(btn.getAttribute("data-remove-slot"), 10);
        builder.slots.splice(i, 1);
        renderBuilder(owned);
      });
    });

    refreshPreview();
  }

  function getPresetDisplayLine(p) {
    if (p.displayLine && String(p.displayLine).trim()) return String(p.displayLine).trim();
    const ids = Array.isArray(p.wordIds) ? p.wordIds : [];
    const wordsPart = ids.map((id) => (byId.get(id) ? byId.get(id).text : "")).join("");
    const pn = (p.playerName != null ? String(p.playerName) : "").trim();
    const tail = (p.fixedTail && String(p.fixedTail).trim()) || FIXED_INTRO_TAIL;
    return `${wordsPart}${pn}${tail}`;
  }

  function encodeBase64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function decodeBase64Utf8(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /**
   * 共有JSONを解析（Base64 の内側・フラット・旧名刺JSON など）
   * n / playerName: プレイヤー名、t / fixedTail: 固定文末（省略時はアプリ既定）
   */
  function parseBattleShare(obj) {
    const out = {
      wordIds: null,
      playerName: null,
      fixedTail: null,
      displayLine: null,
    };
    if (!obj || typeof obj !== "object") return out;

    let cur = obj;
    while (cur && typeof cur === "object" && typeof cur.b === "string" && cur.b.trim()) {
      try {
        cur = JSON.parse(decodeBase64Utf8(cur.b.trim()));
      } catch {
        break;
      }
    }
    const o = cur;
    if (o.displayLine && String(o.displayLine).trim()) out.displayLine = String(o.displayLine).trim();

    const ids = Array.isArray(o.w)
      ? o.w.filter((x) => typeof x === "string")
      : Array.isArray(o.wordIds)
        ? o.wordIds.filter((x) => typeof x === "string")
        : null;
    if (ids && ids.length) out.wordIds = ids;

    if (typeof o.n === "string" && o.n.trim()) out.playerName = o.n.trim();
    else if (typeof o.playerName === "string" && o.playerName.trim()) out.playerName = o.playerName.trim();

    if (typeof o.t === "string" && o.t.trim()) out.fixedTail = o.t.trim();
    else if (typeof o.fixedTail === "string" && o.fixedTail.trim()) out.fixedTail = o.fixedTail.trim();

    return out;
  }

  /** 対戦用: 語ID・名前・文末を必要最小限で包む（コピー時） */
  function buildBattleSharePayload(wordIds, playerName, fixedTail) {
    const ids = Array.isArray(wordIds) ? wordIds.filter((x) => typeof x === "string") : [];
    const core = { w: ids.slice() };
    const pn = playerName != null ? String(playerName).trim() : "";
    if (pn) core.n = pn;
    const tail = (fixedTail != null && String(fixedTail).trim()) || FIXED_INTRO_TAIL;
    if (tail !== FIXED_INTRO_TAIL) core.t = tail;

    if (!BATTLE_SHARE_BASE64) {
      return { v: BATTLE_SHARE_VER, ...core };
    }
    return {
      v: BATTLE_SHARE_VER,
      b: encodeBase64Utf8(JSON.stringify(core)),
    };
  }

  /** Discord 貼り付け用: フェンス付きでコードブロックとして解釈される */
  function wrapJsonForDiscordCodeBlock(obj) {
    const inner = JSON.stringify(obj, null, 2);
    return "```json\n" + inner + "\n```";
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  function showCaseCopyToast(msg) {
    if (!els.caseCopyToast) return;
    els.caseCopyToast.textContent = msg;
    window.clearTimeout(showCaseCopyToast._t);
    showCaseCopyToast._t = window.setTimeout(() => {
      els.caseCopyToast.textContent = "";
    }, 2800);
  }

  function renderCase() {
    if (els.caseCopyToast) els.caseCopyToast.textContent = "";
    const presets = loadPresets();
    if (!presets.length) {
      els.caseList.innerHTML = "<p class=\"msg-error\">まだ名刺がありません。組み立て画面から保存してください。</p>";
      return;
    }
    els.caseList.innerHTML = `<ul class="preset-list">${presets
      .map(
        (p, i) => {
          const line = getPresetDisplayLine(p);
          return `<li>
        <div class="preset-head">
          <strong>${escapeHtml(p.name || `名刺 ${i + 1}`)}</strong>
          <span class="stat-pill">${p.wordIds.length}語</span>
        </div>
        <p class="preset-fulltext">「${escapeHtml(line)}」</p>
        <div class="preset-actions">
          <button type="button" class="secondary" data-copy-json="${i}">JSONをコピー（Discord用）</button>
          <button type="button" class="secondary danger" data-del="${i}">削除</button>
        </div>
      </li>`;
        }
      )
      .join("")}</ul>`;
    els.caseList.querySelectorAll("button[data-copy-json]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-copy-json"), 10);
        const payload = wrapJsonForDiscordCodeBlock(
          buildBattleSharePayload(presets[i].wordIds, presets[i].playerName, presets[i].fixedTail)
        );
        copyTextToClipboard(payload).then((ok) => {
          showCaseCopyToast(ok ? "クリップボードにコピーしました。Discord にそのまま貼り付けできます。" : "コピーに失敗しました。ブラウザの権限を確認してください。");
        });
      });
    });
    els.caseList.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-del"), 10);
        presets.splice(i, 1);
        savePresets(presets);
        renderCase();
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Discord 等から貼った ```json ... ``` を外して JSON 文字列だけにする */
  function extractJsonFromPastedText(raw) {
    let s = String(raw || "").trim();
    if (!s.startsWith("```")) return s;
    s = s.replace(/^```(?:json)?\s*/i, "");
    s = s.replace(/\s*```\s*$/i, "");
    return s.trim();
  }

  function renderBattleSelects() {
    const presets = loadPresets();
    const opts =
      presets.map((p, i) => `<option value="${i}">${escapeHtml(p.name || `名刺 ${i + 1}`)}</option>`).join("") ||
      `<option value="">— 名刺を保存してください —</option>`;
    els.battleLocal.innerHTML = `<select id="sel-local">${opts}</select>`;
  }

  function runRevealAnimation(finalWord, fast) {
    if (els.gachaSkipFx && els.gachaSkipFx.checked) {
      els.gachaStage.classList.remove("is-spinning");
      els.gachaReveal.classList.remove("is-blur", "reveal-pop");
      els.gachaReveal.textContent = finalWord.text;
      els.gachaHint.textContent = `${finalWord.kind} · ${finalWord.tags.slice(0, 3).join(", ")}`;
      return Promise.resolve();
    }
    const ticks = fast ? 12 : 20;
    const intervalMs = fast ? 38 : 52;
    return new Promise((resolve) => {
      let n = 0;
      els.gachaStage.classList.add("is-spinning");
      els.gachaReveal.classList.add("is-blur");
      const t = setInterval(() => {
        n += 1;
        if (n < ticks) {
          els.gachaReveal.textContent = randomChoice(CATALOG).text;
        } else {
          clearInterval(t);
          els.gachaReveal.classList.remove("is-blur");
          els.gachaReveal.textContent = finalWord.text;
          els.gachaReveal.classList.add("reveal-pop");
          els.gachaHint.textContent = `${finalWord.kind} · ${finalWord.tags.slice(0, 3).join(", ")}`;
          setTimeout(() => {
            els.gachaReveal.classList.remove("reveal-pop");
            els.gachaStage.classList.remove("is-spinning");
            resolve();
          }, 500);
        }
      }, intervalMs);
    });
  }

  function makeLogEntry(word, isDup, usedPity, multiLabel) {
    return {
      at: Date.now(),
      text: word.text,
      wordId: word.id,
      isDup,
      usedPity,
      multiLabel: multiLabel || "",
    };
  }

  function wire() {
    els.navGacha.addEventListener("click", () => {
      setSection("gacha");
      renderGachaLog();
      renderGachaStatus();
    });

    if (els.gachaSkipFx) {
      els.gachaSkipFx.addEventListener("change", () => {
        localStorage.setItem(STORAGE.gachaSkipFx, els.gachaSkipFx.checked ? "1" : "0");
      });
    }
    els.navDex.addEventListener("click", () => {
      setSection("dex");
      renderDex();
    });
    els.navBuild.addEventListener("click", () => {
      setSection("build");
      renderBuilder(loadOwned());
    });
    els.navCase.addEventListener("click", () => {
      setSection("case");
      renderCase();
    });
    els.navBattle.addEventListener("click", () => {
      setSection("battle");
      renderBattleSelects();
    });

    els.btnPull.addEventListener("click", async () => {
      if (gachaBusy) return;
      const { pulls } = getPullState();
      if (pulls >= MAX_PULLS_PER_DAY) {
        els.gachaResult.textContent = "本日のガチャ回数が上限に達しました。";
        return;
      }
      setGachaUiLocked(true);
      const owned = loadOwned();
      let jam = loadJam();
      const r = pullWord(owned, jam);
      addPullCount(1);
      if (!r.isDup) owned.add(r.word.id);
      saveOwned(owned);
      saveJam(r.jamAfter);
      jam = r.jamAfter;
      prependGachaLog([makeLogEntry(r.word, r.isDup, r.usedPity, "")]);
      renderGachaLog();

      await runRevealAnimation(r.word, false);

      let msg = `「${r.word.text}」 — `;
      if (r.usedPity) msg += "言葉詰まりボーナスで未所持！";
      else if (r.isDup) msg += `被り（言葉詰まり +1 → 現在 ${jam} pt）`;
      else msg += "図鑑に新規登録！";
      els.gachaResult.textContent = msg;
      renderGachaStatus();
      setGachaUiLocked(false);
    });

    els.btnPull10.addEventListener("click", async () => {
      if (gachaBusy) return;
      const left = getPullsRemaining();
      if (left < 10) {
        els.gachaResult.textContent = "10連を回すには残り回数が10以上必要です。";
        return;
      }
      setGachaUiLocked(true);
      const owned = loadOwned();
      let jam = loadJam();
      const logBatch = [];
      let lastWord = CATALOG[0];
      const t0 = Date.now();

      for (let i = 0; i < 10; i++) {
        const r = pullWord(owned, jam);
        addPullCount(1);
        if (!r.isDup) owned.add(r.word.id);
        saveOwned(owned);
        saveJam(r.jamAfter);
        jam = r.jamAfter;
        lastWord = r.word;
        const entry = makeLogEntry(r.word, r.isDup, r.usedPity, `（10連 ${i + 1}/10）`);
        entry.at = t0 + i;
        logBatch.push(entry);
        await runRevealAnimation(r.word, true);
      }

      prependGachaLog(logBatch.slice().reverse());
      renderGachaLog();
      els.gachaResult.textContent = `10連完了。最後は「${lastWord.text}」。詳細はログを確認してください。言葉詰まりは ${jam} pt です。`;
      renderGachaStatus();
      setGachaUiLocked(false);
    });

    if (els.playerName) {
      els.playerName.addEventListener("input", () => {
        refreshPreview();
        const owned = loadOwned();
        const v = validateBuilder(owned);
        els.buildStatus.textContent = v.ok ? "" : v.msg;
        els.buildStatus.className = v.ok ? "" : "msg-error";
      });
    }

    function onBuildFilterInput() {
      const owned = loadOwned();
      renderBuilder(owned);
    }
    if (els.buildWordSearch) {
      els.buildWordSearch.addEventListener("input", onBuildFilterInput);
    }
    if (els.buildKindFilter) {
      els.buildKindFilter.addEventListener("change", onBuildFilterInput);
    }

    els.btnAddSlot.addEventListener("click", () => {
      const owned = loadOwned();
      if (builder.slots.length >= MAX_WORDS_IN_PHRASE) {
        els.buildStatus.textContent = `枠は最大${MAX_WORDS_IN_PHRASE}までです。`;
        els.buildStatus.className = "msg-error";
        return;
      }
      builder.slots.push("");
      renderBuilder(owned);
    });

    els.btnSavePreset.addEventListener("click", () => {
      const owned = loadOwned();
      const v = validateBuilder(owned);
      if (!v.ok) {
        els.buildStatus.textContent = v.msg;
        els.buildStatus.className = "msg-error";
        return;
      }
      const wordIds = collectBuilderIds();
      const name = (els.presetName.value || "").trim() || `名刺 ${loadPresets().length + 1}`;
      const playerName = (els.playerName.value || "").trim();
      const wordsPart = wordIds.map((id) => byId.get(id).text).join("");
      const displayLine = `${wordsPart}${playerName}${FIXED_INTRO_TAIL}`;
      const preset = {
        schema: "wordgacha-preset/v1",
        name,
        playerName,
        wordIds,
        displayLine,
        fixedTail: FIXED_INTRO_TAIL,
        createdAt: new Date().toISOString(),
        template: "free-v1",
      };
      const all = loadPresets();
      all.push(preset);
      savePresets(all);
      els.buildStatus.textContent = "名刺入れに保存しました。";
      els.buildStatus.className = "msg-ok";
    });

    els.btnBattle.addEventListener("click", () => {
      els.battleOut.innerHTML = "";
      els.battleOut.className = "battle-log battle-theater";
      const presets = loadPresets();
      const sel = document.getElementById("sel-local");
      const idx = sel ? parseInt(sel.value, 10) : NaN;
      if (!presets[idx]) {
        els.battleOut.textContent = "ローカル名刺を選んでください。";
        return;
      }
      let opp;
      try {
        opp = JSON.parse(extractJsonFromPastedText(els.battleOpp.value || "") || "{}");
      } catch {
        els.battleOut.textContent = "相手データの解析に失敗しました。";
        return;
      }
      const parsedOpp = parseBattleShare(opp);
      if (!parsedOpp.wordIds || !parsedOpp.wordIds.length) {
        els.battleOut.textContent =
          "相手データから語IDを読み取れませんでした。対戦用の共有データ（v と b、または w / wordIds）を貼り付けてください。";
        return;
      }
      const localIds = presets[idx].wordIds;
      const r = battle(localIds, parsedOpp.wordIds);
      const myPreset = presets[idx];
      const myLine = getPresetDisplayLine(myPreset);
      const oppLine = buildOpponentDisplayLine(opp, parsedOpp);
      renderBattleResult(els.battleOut, r, myPreset.name, myLine, oppLine);
    });
  }

  function init() {
    els.gachaReveal.textContent = "ガチャを回すと演出が始まります";
    els.gachaHint.textContent = "";
    if (els.gachaSkipFx) {
      els.gachaSkipFx.checked = localStorage.getItem(STORAGE.gachaSkipFx) === "1";
    }
    renderGachaStatus();
    renderGachaLog();
    wire();
    setSection("gacha");
  }

  init();
})();

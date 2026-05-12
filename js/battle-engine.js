/**
 * 対戦計算の共有エンジン（ローカル対戦・オンライン結果の両方で同一ロジックを使う）
 */
(function (global) {
  "use strict";

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

  const FIXED_INTRO_TAIL = "です。対戦よろしくお願いします。";

  const BATTLE_PWR_EXP = 0.48;
  const BATTLE_PWR_SCALE = 3.85;
  const BATTLE_AFF_AVG_SCALE = 40;
  const BATTLE_POS_MUL = 0.28;
  const BATTLE_OVERFLOW_TAX = 0.52;

  function pairKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  function createBattleEngine(CATALOG) {
    const byId = new Map(CATALOG.map((w) => [w.id, w]));

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
      const aff = adjacentAffinity(wA.tags, wB.tags);
      return aff * 2 + Math.floor((wA.power - wB.power) / 3);
    }

    function scoreLine(wordIds) {
      const words = wordIds.map((id) => byId.get(id)).filter(Boolean);
      const n = words.length;
      let sumPower = 0;
      let synergy = 0;
      words.forEach((w) => {
        sumPower += w.power;
      });
      for (let i = 0; i < n - 1; i++) {
        synergy += adjacentAffinity(words[i].tags, words[i + 1].tags);
      }
      const edges = Math.max(1, n - 1);
      const avgSynergy = synergy / edges;

      let position = 0;
      words.forEach((w, i) => {
        const mul = 1 + i * 0.03 + (w.kind === "adj_na" ? 0.05 : 0);
        position += Math.round(w.power * (mul - 1));
      });
      const positionTerm = Math.round(position * BATTLE_POS_MUL);

      const powerTerm = BATTLE_PWR_SCALE * Math.pow(Math.max(1, sumPower), BATTLE_PWR_EXP);
      const affinityTerm = BATTLE_AFF_AVG_SCALE * avgSynergy * Math.sqrt(edges);

      return {
        words,
        sumPower,
        synergy,
        edges,
        avgSynergy,
        power: sumPower,
        position: positionTerm,
        powerTerm,
        affinityTerm,
      };
    }

    function overflowPowerDeduction(line, opponentWordCount) {
      const extra = line.words.length > opponentWordCount ? line.words.slice(opponentWordCount) : [];
      let raw = 0;
      extra.forEach((w) => {
        raw += w.power;
      });
      return raw * BATTLE_OVERFLOW_TAX;
    }

    function battle(idsA, idsB) {
      const lineA = scoreLine(idsA);
      const lineB = scoreLine(idsB);
      const lenA = lineA.words.length;
      const lenB = lineB.words.length;
      const n = Math.max(lenA, lenB);
      let clashA = 0;
      let clashB = 0;
      for (let i = 0; i < n; i++) {
        const a = lineA.words[i];
        const b = lineB.words[i];
        const c = positionClash(a, b);
        if (c > 0) clashA += c;
        if (c < 0) clashB += -c;
      }
      const totalA =
        lineA.affinityTerm + lineA.powerTerm + lineA.position + clashA - overflowPowerDeduction(lineA, lenB);
      const totalB =
        lineB.affinityTerm + lineB.powerTerm + lineB.position + clashB - overflowPowerDeduction(lineB, lenA);
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

    function oppBattleFingerprint(wordIds, playerName, fixedTail) {
      const ids = Array.isArray(wordIds) ? wordIds.filter((x) => typeof x === "string") : [];
      const n = playerName != null ? String(playerName).trim() : "";
      const t = (fixedTail != null && String(fixedTail).trim()) || FIXED_INTRO_TAIL;
      return `v1|${ids.join("\x1e")}|${n}|${t}`;
    }

    return {
      byId,
      battle,
      scoreLine,
      FIXED_INTRO_TAIL,
      oppBattleFingerprint,
      adjacentAffinity,
    };
  }

  global.WordGachaBattle = { createBattleEngine, FIXED_INTRO_TAIL };
})(typeof window !== "undefined" ? window : globalThis);

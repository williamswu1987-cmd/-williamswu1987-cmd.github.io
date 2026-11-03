(() => {
  /**
   * Kitchen-facing order tweaks when a dish would overshoot calories
   * or undershoot protein for the remaining meal budget.
   * Phrases are always offered as: local → English → 中文.
   */
  const LANG_LABEL = {
    en: "English",
    zh: "中文",
    sr: "Crnogorski / Srpski",
    de: "Deutsch",
    es: "Español",
  };

  const PACKS = {
    en: {
      lessOil: "Please cook with less oil and less sauce to reduce calories.",
      noFry: "Please grill or steam instead of frying, if possible.",
      sauceSide: "Please put the sauce on the side.",
      moreProtein: "Please add extra protein: egg, chicken, tuna, or extra meat if available.",
      extraEgg: "Please add one or two eggs for more protein.",
      doubleChicken: "Please add an extra portion of chicken / lean meat if possible.",
      veggiesSwap: "Please replace fries / rice with extra vegetables or salad.",
      lessCarb: "Please less rice / pasta / bread, more vegetables.",
    },
    zh: {
      lessOil: "请少油少酱，帮我降低热量。",
      noFry: "可以的话请烤或蒸，不要油炸。",
      sauceSide: "酱汁请分开装。",
      moreProtein: "请多加一点蛋白质：鸡蛋、鸡肉、金枪鱼或瘦肉。",
      extraEgg: "请加一到两个鸡蛋，增加蛋白质。",
      doubleChicken: "可以的话请多加一份鸡肉/瘦肉。",
      veggiesSwap: "薯条/米饭请换成蔬菜或沙拉。",
      lessCarb: "请少一点米饭/意面/面包，多一点蔬菜。",
    },
    // Montenegrin / Serbian — useful for Tivat & Balkan restaurants
    sr: {
      lessOil: "Molim vas, manje ulja i manje sosa da smanjimo kalorije.",
      noFry: "Molim vas, pečeno ili kuvano umjesto prženog, ako je moguće.",
      sauceSide: "Molim vas, sos sa strane.",
      moreProtein: "Molim vas, dodajte više proteina: jaje, piletinu, tunjevinu ili meso.",
      extraEgg: "Molim vas, dodajte jedno ili dva jaja za više proteina.",
      doubleChicken: "Molim vas, dodatnu porciju piletine / mršavog mesa ako može.",
      veggiesSwap: "Molim vas, umjesto pomfrita / pirinča ekstra povrće ili salatu.",
      lessCarb: "Molim vas, manje pirinča / tjestenine / hljeba, više povrća.",
    },
    de: {
      lessOil: "Bitte wenig Öl und wenig Sauce, um Kalorien zu sparen.",
      noFry: "Bitte grillen oder dämpfen statt frittieren, wenn möglich.",
      sauceSide: "Bitte die Sauce separat.",
      moreProtein: "Bitte mehr Protein: Ei, Hähnchen, Thunfisch oder magere Fleischportion.",
      extraEgg: "Bitte ein oder zwei Eier extra für mehr Protein.",
      doubleChicken: "Bitte eine Extra-Portion Hähnchen / mageres Fleisch, wenn möglich.",
      veggiesSwap: "Bitte Pommes / Reis durch Gemüse oder Salat ersetzen.",
      lessCarb: "Bitte weniger Reis / Nudeln / Brot, mehr Gemüse.",
    },
    es: {
      lessOil: "Por favor, poca aceite y poca salsa para bajar calorías.",
      noFry: "Por favor, a la plancha o al vapor en vez de frito, si es posible.",
      sauceSide: "Por favor, la salsa a parte.",
      moreProtein: "Por favor, más proteína: huevo, pollo, atún o carne magra.",
      extraEgg: "Por favor, uno o dos huevos extra para más proteína.",
      doubleChicken: "Por favor, una porción extra de pollo / carne magra si se puede.",
      veggiesSwap: "Por favor, cambiar patatas / arroz por verduras o ensalada.",
      lessCarb: "Por favor, menos arroz / pasta / pan, más verduras.",
    },
  };

  function detectLang(catalog, restaurant) {
    const blob = `${catalog?.country || ""} ${catalog?.city || ""} ${restaurant?.cuisine || ""} ${restaurant?.name || ""}`.toLowerCase();
    if (/montenegro|serbia|croatia|bosnia|crna gora|tivat|kotor|budva|belgrade|zagreb/.test(blob)) return "sr";
    if (/germany|austria|switzerland|deutschland|berlin|munich|wien/.test(blob)) return "de";
    if (/spain|mexico|argentina|madrid|barcelona/.test(blob)) return "es";
    if (/china|中国|taiwan|hong kong|singapore/.test(blob)) return "zh";
    return "en";
  }

  function looksEnglish(s) {
    return /^(i'?d like|please\b|can i |may i |i would like)/i.test(String(s || "").trim());
  }

  function mid(range) {
    if (Array.isArray(range)) return (Number(range[0]) + Number(range[1])) / 2;
    return Number(range) || 0;
  }

  function formatTripleCopy(local, en, zh, langLabel) {
    return [
      `Local (${langLabel}): ${local}`,
      `English: ${en}`,
      `中文: ${zh}`,
    ].join("\n");
  }

  /** Triple rows for UI: local → English → 中文 */
  function tripleRows(local, en, zh, lang) {
    return [
      { tag: LANG_LABEL[lang] || "Local", code: "local", text: local },
      { tag: "English", code: "en", text: en },
      { tag: "中文", code: "zh", text: zh },
    ];
  }

  function renderTripleHtml(rows) {
    return rows
      .map(
        (r) =>
          `<div class="tri-line" data-lang="${r.code}"><span class="tri-tag">${r.tag}</span><span class="tri-text">${r.text}</span></div>`
      )
      .join("");
  }

  /**
   * Build dish order phrase in local + English + 中文.
   */
  function buildAskTriple(dish, catalog) {
    const lang = detectLang(catalog, dish?.restaurant);
    const name = dish?.name || "this dish";
    const nameLocal = dish?.nameLocal || name;
    const raw = dish?.askLocal || "";

    const en =
      dish?.askEn ||
      (looksEnglish(raw) ? raw : `I'd like the ${name}, please.`);
    const zh = dish?.askZh || `请给我一份${name}。`;

    let local;
    if (lang === "en") local = en;
    else if (lang === "zh") local = zh;
    else if (raw && !looksEnglish(raw)) local = raw;
    else if (lang === "sr") local = `Molim vas, ${nameLocal}.`;
    else if (lang === "de") local = `Bitte einmal ${nameLocal}.`;
    else if (lang === "es") local = `Por favor, ${nameLocal}.`;
    else local = en;

    const langLabel = LANG_LABEL[lang] || lang;
    const rows = tripleRows(local, en, zh, lang);
    return {
      lang,
      langLabel,
      local,
      en,
      zh,
      rows,
      html: renderTripleHtml(rows),
      copyText: formatTripleCopy(local, en, zh, langLabel),
    };
  }

  function tripleForKey(key, lang) {
    const localPack = PACKS[lang] || PACKS.en;
    const local = localPack[key] || PACKS.en[key];
    const en = PACKS.en[key];
    const zh = PACKS.zh[key];
    return {
      key,
      local,
      en,
      zh,
      rows: tripleRows(local, en, zh, lang),
      html: renderTripleHtml(tripleRows(local, en, zh, lang)),
    };
  }

  /**
   * @returns coach payload; lines are trilingual when needed
   */
  function buildCoach({ dish, goals, log, catalog }) {
    const remainKcal = Math.max(0, (goals?.kcal || 0) - (log?.kcal || 0));
    const remainProtein = Math.max(0, (goals?.protein || 0) - (log?.protein || 0));
    const mealsPerDay = Number(goals?.mealsPerDay) || 3;
    const eaten = Array.isArray(log?.items) ? log.items.length : 0;
    const mealsLeft = Math.max(1, mealsPerDay - eaten);
    const mealKcal = remainKcal / mealsLeft;
    const mealProtein =
      remainProtein <= 0 ? 0 : Math.min(55, Math.max(18, remainProtein / mealsLeft));

    const k = mid(dish.kcal);
    const p = mid(dish.protein);
    const overKcal = k > mealKcal + 40;
    const lowProtein = remainProtein > 0 && p < mealProtein - 8;

    const ask = buildAskTriple(dish, catalog);

    if (!overKcal && !lowProtein) {
      return {
        needed: false,
        overKcal: false,
        lowProtein: false,
        reasons: [],
        local: "",
        userZh: "",
        lang: ask.lang,
        langLabel: ask.langLabel,
        ask,
        triples: [],
        copyText: ask.copyText,
      };
    }

    const lang = ask.lang;
    const keys = [];
    const reasons = [];

    if (overKcal) {
      reasons.push(`High calories (~${Math.round(k)} kcal; this meal ≤ ${Math.round(mealKcal)})`);
      keys.push("lessOil", "sauceSide");
      if (/fried|frit|pomfrit|炸|chips|fries/i.test(dish.name || "")) keys.push("noFry", "veggiesSwap");
      else keys.push("lessCarb");
    }
    if (lowProtein) {
      reasons.push(`Low protein (~${Math.round(p)}g; this meal ≥ ${Math.round(mealProtein)}g)`);
      if (/salad|bowl|pasta|pizza|soup|沙拉|面/i.test(dish.name || "")) keys.push("moreProtein", "extraEgg");
      else keys.push("moreProtein", "doubleChicken");
    }

    const uniq = [...new Set(keys)];
    const triples = uniq.map((key) => tripleForKey(key, lang));
    const localLines = triples.map((t) => t.local);
    const enLines = triples.map((t) => t.en);
    const zhLines = triples.map((t) => t.zh);

    const tweakCopy = triples
      .map((t, i) => {
        const n = i + 1;
        return [
          `${n}. Local (${ask.langLabel}): ${t.local}`,
          `   English: ${t.en}`,
          `   中文: ${t.zh}`,
        ].join("\n");
      })
      .join("\n");

    const copyText = [ask.copyText, "", "—— Kitchen tweaks ——", tweakCopy].join("\n");

    const userZh = [
      `Order: ${dish.name}`,
      ...reasons.map((r) => `· ${r}`),
      "Tell the chef/waiter:",
      ...zhLines.map((l, i) => `${i + 1}. ${l}`),
    ].join("\n");

    return {
      needed: true,
      overKcal,
      lowProtein,
      reasons,
      localLines,
      enLines,
      zhLines,
      triples,
      ask,
      local: [ask.local, ...localLines].join("\n"),
      userZh,
      lang,
      langLabel: ask.langLabel,
      copyText,
      mealKcal: Math.round(mealKcal),
      mealProtein: Math.round(mealProtein),
      dishKcal: Math.round(k),
      dishProtein: Math.round(p),
    };
  }

  window.ProtivaCoach = {
    buildCoach,
    buildAskTriple,
    detectLang,
    PACKS,
    LANG_LABEL,
    renderTripleHtml,
  };
})();

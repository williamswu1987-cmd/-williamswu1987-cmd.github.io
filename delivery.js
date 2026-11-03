(() => {
  /**
   * Delivery mode: pick local apps by country code, deep-link/search only.
   * No partner APIs yet — ranking stays on FitBite goals (kcal/protein/taste),
   * not live courier ETAs or app-native menus.
   */
  const MODE_KEY = "fitbite-dining-mode-v1";
  const MODES = ["dine", "delivery"];

  const APP_CATALOG = {
    wolt: {
      id: "wolt",
      name: "Wolt",
      searchUrl: (q, city) =>
        `https://wolt.com/en/search?q=${encodeURIComponent([q, city].filter(Boolean).join(" "))}`,
    },
    glovo: {
      id: "glovo",
      name: "Glovo",
      searchUrl: (q, city) =>
        `https://glovoapp.com/en/search/?searchQuery=${encodeURIComponent(q || city || "food")}`,
    },
    bolt: {
      id: "bolt",
      name: "Bolt Food",
      searchUrl: (q) =>
        `https://food.bolt.eu/en/search?query=${encodeURIComponent(q || "restaurants")}`,
    },
    ubereats: {
      id: "ubereats",
      name: "Uber Eats",
      searchUrl: (q, city) =>
        `https://www.ubereats.com/search?q=${encodeURIComponent([q, city].filter(Boolean).join(" "))}`,
    },
    doordash: {
      id: "doordash",
      name: "DoorDash",
      searchUrl: (q) => `https://www.doordash.com/search/store/${encodeURIComponent(q || "food")}/`,
    },
    deliveroo: {
      id: "deliveroo",
      name: "Deliveroo",
      searchUrl: (q) => `https://deliveroo.com/search?query=${encodeURIComponent(q || "food")}`,
    },
    justeat: {
      id: "justeat",
      name: "Just Eat",
      searchUrl: (q) => `https://www.just-eat.co.uk/search?q=${encodeURIComponent(q || "food")}`,
    },
    lieferando: {
      id: "lieferando",
      name: "Lieferando",
      searchUrl: (q) =>
        `https://www.lieferando.de/en/menu/search?q=${encodeURIComponent(q || "essen")}`,
    },
    meituan: {
      id: "meituan",
      name: "美团",
      searchUrl: (q) => `https://www.meituan.com/s/?q=${encodeURIComponent(q || "外卖")}`,
    },
    eleme: {
      id: "eleme",
      name: "饿了么",
      searchUrl: (q) => `https://www.ele.me/search/?kw=${encodeURIComponent(q || "美食")}`,
    },
    foodpanda: {
      id: "foodpanda",
      name: "foodpanda",
      searchUrl: (q, city) =>
        `https://www.foodpanda.com/search/?q=${encodeURIComponent([q, city].filter(Boolean).join(" "))}`,
    },
    grab: {
      id: "grab",
      name: "GrabFood",
      searchUrl: (q) => `https://food.grab.com/search?q=${encodeURIComponent(q || "food")}`,
    },
  };

  /** ISO country code → preferred local delivery apps (ordered). */
  const COUNTRY_APPS = {
    ME: ["wolt", "glovo", "bolt"],
    HR: ["wolt", "glovo", "bolt"],
    RS: ["wolt", "glovo", "bolt"],
    BA: ["wolt", "glovo"],
    SI: ["wolt", "glovo"],
    AL: ["wolt", "glovo"],
    XK: ["wolt", "glovo"],
    MK: ["wolt", "glovo"],
    DE: ["lieferando", "ubereats", "wolt"],
    AT: ["lieferando", "ubereats", "wolt"],
    CH: ["ubereats", "deliveroo"],
    FR: ["ubereats", "deliveroo"],
    ES: ["glovo", "ubereats", "justeat"],
    IT: ["glovo", "ubereats", "deliveroo"],
    PT: ["glovo", "ubereats"],
    GB: ["deliveroo", "ubereats", "justeat"],
    IE: ["deliveroo", "ubereats", "justeat"],
    NL: ["ubereats", "deliveroo"],
    BE: ["ubereats", "deliveroo"],
    SE: ["wolt", "ubereats"],
    NO: ["wolt", "ubereats"],
    DK: ["wolt", "ubereats"],
    FI: ["wolt", "ubereats"],
    PL: ["glovo", "ubereats", "bolt"],
    CZ: ["wolt", "bolt"],
    HU: ["wolt", "foodpanda"],
    RO: ["glovo", "bolt", "wolt"],
    BG: ["glovo", "bolt"],
    GR: ["wolt", "efood"],
    TR: ["yemeksepeti", "getir"],
    US: ["ubereats", "doordash"],
    CA: ["ubereats", "doordash"],
    AU: ["ubereats", "deliveroo", "doordash"],
    NZ: ["ubereats", "deliveroo"],
    CN: ["meituan", "eleme"],
    HK: ["foodpanda", "deliveroo"],
    TW: ["foodpanda", "ubereats"],
    SG: ["grab", "foodpanda", "deliveroo"],
    MY: ["grab", "foodpanda"],
    TH: ["grab", "foodpanda"],
    PH: ["grab", "foodpanda"],
    ID: ["grab", "foodpanda"],
    JP: ["ubereats", "demae"],
    KR: ["baemin", "coupang"],
    IN: ["swiggy", "zomato"],
    AE: ["talabat", "deliveroo"],
    SA: ["hungerstation", "jahez"],
  };

  /** Soft fallbacks when country unknown / niche apps not catalogued yet. */
  const REGION_FALLBACK = {
    EU: ["ubereats", "glovo", "wolt", "deliveroo"],
    ASIA: ["foodpanda", "grab", "ubereats"],
    AMERICAS: ["ubereats", "doordash"],
    DEFAULT: ["ubereats", "wolt", "glovo"],
  };

  /** Extra apps referenced above but not fully deep-linked — map to search-friendly URLs. */
  const EXTRA_APPS = {
    efood: {
      id: "efood",
      name: "efood",
      searchUrl: (q) => `https://www.e-food.gr/search?q=${encodeURIComponent(q || "φαγητό")}`,
    },
    yemeksepeti: {
      id: "yemeksepeti",
      name: "Yemeksepeti",
      searchUrl: (q) => `https://www.yemeksepeti.com/search?q=${encodeURIComponent(q || "yemek")}`,
    },
    getir: {
      id: "getir",
      name: "Getir",
      searchUrl: (q) => `https://getir.com/search/?q=${encodeURIComponent(q || "yemek")}`,
    },
    demae: {
      id: "demae",
      name: "出前館",
      searchUrl: (q) => `https://demae-can.com/search/?keyword=${encodeURIComponent(q || "配達")}`,
    },
    baemin: {
      id: "baemin",
      name: "배달의민족",
      searchUrl: (q) => `https://www.baemin.com/search?keyword=${encodeURIComponent(q || "배달")}`,
    },
    coupang: {
      id: "coupang",
      name: "Coupang Eats",
      searchUrl: (q) => `https://www.coupangeats.com/search?q=${encodeURIComponent(q || "배달")}`,
    },
    swiggy: {
      id: "swiggy",
      name: "Swiggy",
      searchUrl: (q) => `https://www.swiggy.com/search?query=${encodeURIComponent(q || "food")}`,
    },
    zomato: {
      id: "zomato",
      name: "Zomato",
      searchUrl: (q) => `https://www.zomato.com/search?q=${encodeURIComponent(q || "food")}`,
    },
    talabat: {
      id: "talabat",
      name: "talabat",
      searchUrl: (q) => `https://www.talabat.com/search?q=${encodeURIComponent(q || "food")}`,
    },
    hungerstation: {
      id: "hungerstation",
      name: "HungerStation",
      searchUrl: (q) => `https://hungerstation.com/search?q=${encodeURIComponent(q || "food")}`,
    },
    jahez: {
      id: "jahez",
      name: "Jahez",
      searchUrl: (q) => `https://www.jahez.net/search?q=${encodeURIComponent(q || "food")}`,
    },
  };

  const ALL_APPS = { ...APP_CATALOG, ...EXTRA_APPS };

  const COUNTRY_NAME_TO_CODE = {
    montenegro: "ME",
    croatia: "HR",
    serbia: "RS",
    "bosnia and herzegovina": "BA",
    bosnia: "BA",
    slovenia: "SI",
    albania: "AL",
    "north macedonia": "MK",
    macedonia: "MK",
    germany: "DE",
    austria: "AT",
    switzerland: "CH",
    france: "FR",
    spain: "ES",
    italy: "IT",
    portugal: "PT",
    "united kingdom": "GB",
    uk: "GB",
    england: "GB",
    ireland: "IE",
    netherlands: "NL",
    belgium: "BE",
    sweden: "SE",
    norway: "NO",
    denmark: "DK",
    finland: "FI",
    poland: "PL",
    "czech republic": "CZ",
    czechia: "CZ",
    hungary: "HU",
    romania: "RO",
    bulgaria: "BG",
    greece: "GR",
    turkey: "TR",
    "united states": "US",
    usa: "US",
    canada: "CA",
    australia: "AU",
    "new zealand": "NZ",
    china: "CN",
    "hong kong": "HK",
    taiwan: "TW",
    singapore: "SG",
    malaysia: "MY",
    thailand: "TH",
    philippines: "PH",
    indonesia: "ID",
    japan: "JP",
    "south korea": "KR",
    korea: "KR",
    india: "IN",
    "united arab emirates": "AE",
    uae: "AE",
    "saudi arabia": "SA",
  };

  function normalizeCountryCode(code, countryName) {
    const c = String(code || "").trim().toUpperCase();
    if (c.length === 2 && /^[A-Z]{2}$/.test(c)) return c;
    const name = String(countryName || "").trim().toLowerCase();
    if (COUNTRY_NAME_TO_CODE[name]) return COUNTRY_NAME_TO_CODE[name];
    return "";
  }

  function resolveApp(id) {
    return ALL_APPS[id] || null;
  }

  function appsForCountry(countryCode, countryName) {
    const code = normalizeCountryCode(countryCode, countryName);
    const ids = COUNTRY_APPS[code] || REGION_FALLBACK.DEFAULT;
    const apps = ids.map(resolveApp).filter(Boolean);
    if (apps.length) return { code: code || "XX", apps };
    return {
      code: code || "XX",
      apps: REGION_FALLBACK.DEFAULT.map(resolveApp).filter(Boolean),
    };
  }

  function loadMode() {
    const m = localStorage.getItem(MODE_KEY) || "dine";
    return MODES.includes(m) ? m : "dine";
  }

  function saveMode(mode) {
    const m = MODES.includes(mode) ? mode : "dine";
    localStorage.setItem(MODE_KEY, m);
    return m;
  }

  function isDelivery() {
    return loadMode() === "delivery";
  }

  /** Rough kitchen-distance ETA — not a live courier ETA from any app. */
  function etaMinutes(walkMin) {
    const walk = Math.max(1, Number(walkMin) || 8);
    return Math.min(55, Math.max(20, Math.round(18 + walk * 1.6)));
  }

  function deliveryLinks(restaurant, city, countryCode, countryName) {
    const q = restaurant?.name || "";
    const c = city || restaurant?.city || "";
    const { code, apps } = appsForCountry(
      countryCode || restaurant?.countryCode,
      countryName || restaurant?.country
    );
    return {
      countryCode: code,
      apps: apps.map((app) => ({
        id: app.id,
        name: app.name,
        url: app.searchUrl(q, c),
      })),
    };
  }

  function appNamesForPlace(countryCode, countryName) {
    return appsForCountry(countryCode, countryName).apps.map((a) => a.name);
  }

  function nutritionAccuracyNote({ estimated, fromUserMenu, confidence, delivery, appNames } = {}) {
    const conf = Math.round(Math.min(0.98, Number(confidence) || 0.55) * 100);
    const band =
      conf >= 80 ? "roughly ±15%" : conf >= 65 ? "roughly ±20–25%" : "roughly ±25–35%";
    const apps =
      Array.isArray(appNames) && appNames.length
        ? appNames.slice(0, 3).join("/")
        : "local delivery apps";
    if (fromUserMenu) {
      return `Confirmed dish · macros still estimated (${band}, ~${conf}% confidence). Not lab-accurate.`;
    }
    if (delivery) {
      return `Delivery pick · macros estimated from dish type (${band}, ~${conf}% confidence). ${apps} rarely publish real kcal/protein — use the range as a budget guardrail.`;
    }
    if (estimated) {
      return `Template estimate (not the live menu) · ${band} · ~${conf}% confidence. Correct with the buttons below.`;
    }
    return `Estimated range · ${band} · ~${conf}% confidence (not false precision). Official restaurant nutrition would be more accurate.`;
  }

  /**
   * Ranking note for UI: we can rank relatively well for FitBite goals using
   * range midpoints; we cannot rank by true app ETA/price without partner APIs.
   */
  function rankingHonestyNote(delivery) {
    if (delivery) {
      return "Sorted for your calorie/protein budget (using range midpoints). Delivery ETA is only a distance guess — not live Wolt/Glovo/Bolt data.";
    }
    return "Sorted for your calorie/protein budget (using range midpoints), then taste / local / distance.";
  }

  window.FitBiteDelivery = {
    MODES,
    APP_CATALOG,
    COUNTRY_APPS,
    loadMode,
    saveMode,
    isDelivery,
    etaMinutes,
    deliveryLinks,
    appsForCountry,
    appNamesForPlace,
    normalizeCountryCode,
    nutritionAccuracyNote,
    rankingHonestyNote,
  };
})();

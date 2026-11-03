(() => {
  /**
   * Delivery mode helpers for FitBite.
   * Montenegro / Adriatic: Wolt · Glovo · Bolt Food (deep-link / search — no partner API yet).
   * Nutrition for delivery dishes stays estimated unless the restaurant publishes macros.
   */
  const MODE_KEY = "fitbite-dining-mode-v1";
  const MODES = ["dine", "delivery"];

  const APPS = [
    {
      id: "wolt",
      name: "Wolt",
      regions: ["me", "hr", "rs", "ba", "si", "eu"],
      searchUrl: (q, city) =>
        `https://wolt.com/en/search?q=${encodeURIComponent([q, city].filter(Boolean).join(" "))}`,
    },
    {
      id: "glovo",
      name: "Glovo",
      regions: ["me", "hr", "rs", "ba", "si", "eu"],
      searchUrl: (q, city) =>
        `https://glovoapp.com/en/search/?searchQuery=${encodeURIComponent(q || city || "food")}`,
    },
    {
      id: "bolt",
      name: "Bolt Food",
      regions: ["me", "hr", "rs", "eu"],
      searchUrl: (q) =>
        `https://food.bolt.eu/en/search?query=${encodeURIComponent(q || "restaurants")}`,
    },
  ];

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

  /** Rough delivery ETA from walk distance — not a live courier ETA. */
  function etaMinutes(walkMin) {
    const walk = Math.max(1, Number(walkMin) || 8);
    return Math.min(55, Math.max(20, Math.round(18 + walk * 1.6)));
  }

  function deliveryLinks(restaurant, city) {
    const q = restaurant?.name || "";
    const c = city || restaurant?.city || "";
    return APPS.map((app) => ({
      id: app.id,
      name: app.name,
      url: app.searchUrl(q, c),
    }));
  }

  /**
   * Honest accuracy copy for kcal/protein.
   * FitBite uses cuisine / dish-name ranges — not weighed lab nutrition.
   */
  function nutritionAccuracyNote({ estimated, fromUserMenu, confidence, delivery } = {}) {
    const conf = Math.round(Math.min(0.98, Number(confidence) || 0.55) * 100);
    const band =
      conf >= 80 ? "roughly ±15%" : conf >= 65 ? "roughly ±20–25%" : "roughly ±25–35%";
    if (fromUserMenu) {
      return `Confirmed dish · macros still estimated (${band}, ~${conf}% confidence). Not lab-accurate.`;
    }
    if (delivery) {
      return `Delivery pick · macros estimated from dish type (${band}, ~${conf}% confidence). Wolt/Glovo/Bolt almost never publish real kcal/protein — treat as a budget guardrail, not a precise count.`;
    }
    if (estimated) {
      return `Template estimate (not the live menu) · ${band} · ~${conf}% confidence. Correct with the buttons below.`;
    }
    return `Estimated range · ${band} · ~${conf}% confidence (not false precision). Official restaurant nutrition would be more accurate.`;
  }

  window.FitBiteDelivery = {
    MODES,
    APPS,
    loadMode,
    saveMode,
    isDelivery,
    etaMinutes,
    deliveryLinks,
    nutritionAccuracyNote,
  };
})();

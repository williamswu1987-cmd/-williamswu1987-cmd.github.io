(() => {
  const ENTITLEMENT_KEY = "protiva-pro-v1";
  const USAGE_KEY = "protiva-usage-v1";

  /** Free tier: 3 Top-3 refreshes / day, 1 city demo ok. Pro: unlimited. */
  const FREE_DAILY_LOOKUPS = 3;

  /** App Store Connect product IDs — create these before TestFlight */
  const PRODUCTS = {
    monthly: "app.protiva.meal.pro.monthly",
    yearly: "app.protiva.meal.pro.yearly",
  };

  const PRICES = {
    monthlyLabel: "€4.99 / 月",
    yearlyLabel: "€29.99 / 年",
    yearlySave: "省约 50%",
  };

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function loadEntitlement() {
    try {
      return JSON.parse(localStorage.getItem(ENTITLEMENT_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveEntitlement(ent) {
    if (!ent) localStorage.removeItem(ENTITLEMENT_KEY);
    else localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(ent));
  }

  function isPro() {
    const ent = loadEntitlement();
    if (!ent?.active) return false;
    if (ent.expiresAt && Date.now() > ent.expiresAt) {
      saveEntitlement(null);
      return false;
    }
    return true;
  }

  function loadUsage() {
    try {
      const u = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
      if (u.day !== todayKey()) return { day: todayKey(), lookups: 0 };
      return u;
    } catch {
      return { day: todayKey(), lookups: 0 };
    }
  }

  function saveUsage(u) {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  }

  function remainingLookups() {
    if (isPro()) return Infinity;
    return Math.max(0, FREE_DAILY_LOOKUPS - loadUsage().lookups);
  }

  /**
   * Call before a "lookup" action (location refresh that generates Top 3).
   * Returns { ok, remaining } — if !ok, show paywall.
   */
  function consumeLookup() {
    if (isPro()) return { ok: true, remaining: Infinity, pro: true };
    const u = loadUsage();
    if (u.lookups >= FREE_DAILY_LOOKUPS) {
      return { ok: false, remaining: 0, pro: false };
    }
    u.lookups += 1;
    saveUsage(u);
    return { ok: true, remaining: FREE_DAILY_LOOKUPS - u.lookups, pro: false };
  }

  function peekLookupAllowed() {
    if (isPro()) return { ok: true, remaining: Infinity, pro: true };
    const left = remainingLookups();
    return { ok: left > 0, remaining: left, pro: false };
  }

  /** Web / simulator purchase until StoreKit is wired on a Mac build */
  function activateProMock(plan) {
    const days = plan === "yearly" ? 365 : 31;
    saveEntitlement({
      active: true,
      plan,
      productId: PRODUCTS[plan],
      source: "mock",
      purchasedAt: Date.now(),
      expiresAt: Date.now() + days * 86400000,
    });
    return loadEntitlement();
  }

  function restorePurchasesMock() {
    const ent = loadEntitlement();
    return !!(ent && isPro());
  }

  function deactivatePro() {
    saveEntitlement(null);
  }

  /**
   * Native hook — replace body with RevenueCat / StoreKit when shipping.
   * Keep the same return shape so UI stays stable.
   */
  async function purchase(plan) {
    // TODO(native): Purchases.purchaseProduct(PRODUCTS[plan])
    activateProMock(plan);
    return { ok: true, mock: true };
  }

  async function restore() {
    // TODO(native): Purchases.restorePurchases()
    return { ok: restorePurchasesMock(), mock: true };
  }

  window.ProtivaPay = {
    PRODUCTS,
    PRICES,
    FREE_DAILY_LOOKUPS,
    isPro,
    remainingLookups,
    consumeLookup,
    peekLookupAllowed,
    purchase,
    restore,
    activateProMock,
    deactivatePro,
    loadEntitlement,
  };
})();

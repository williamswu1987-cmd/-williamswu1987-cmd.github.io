(() => {
  const DEVICE_KEY = "protiva-device-v1";
  const CACHE_KEY = "protiva-entitlement-cache-v1";
  const USAGE_CACHE_KEY = "protiva-usage-cache-v1";

  const PRODUCTS = {
    monthly: "app.protiva.meal.pro.monthly",
    yearly: "app.protiva.meal.pro.yearly",
  };

  const PRICES = {
    monthlyLabel: "€4.99 / month",
    yearlyLabel: "€29.99 / year",
    yearlySave: "Save ~50%",
  };

  const FREE_DAILY_LOOKUPS = 3;

  /** Same-origin on Contabo; override with window.PROTIVA_API_BASE if needed */
  function apiBase() {
    if (window.PROTIVA_API_BASE) return window.PROTIVA_API_BASE.replace(/\/$/, "");
    return `${location.origin}/protiva-api`;
  }

  function uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function cacheStatus(st) {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...st, cachedAt: Date.now() }));
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch {
      return null;
    }
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${apiBase()}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  async function refreshStatus() {
    const st = await api(`/v1/status?deviceId=${encodeURIComponent(deviceId())}`);
    cacheStatus(st);
    return st;
  }

  function isPro() {
    const st = readCache();
    if (!st) return false;
    if (!st.pro) return false;
    if (st.expiresAt && Date.now() > st.expiresAt) return false;
    return true;
  }

  function remainingLookups() {
    if (isPro()) return Infinity;
    const st = readCache();
    if (st && typeof st.remaining === "number") return st.remaining;
    try {
      const u = JSON.parse(localStorage.getItem(USAGE_CACHE_KEY) || "{}");
      const day = new Date().toISOString().slice(0, 10);
      if (u.day === day) return Math.max(0, FREE_DAILY_LOOKUPS - (u.lookups || 0));
    } catch {
      /* ignore */
    }
    return FREE_DAILY_LOOKUPS;
  }

  function peekLookupAllowed() {
    if (isPro()) return { ok: true, remaining: Infinity, pro: true };
    const left = remainingLookups();
    return { ok: left > 0, remaining: left, pro: false };
  }

  async function consumeLookup() {
    try {
      const st = await api("/v1/usage/consume", {
        method: "POST",
        body: JSON.stringify({ deviceId: deviceId() }),
      });
      cacheStatus({
        ...(readCache() || {}),
        pro: st.pro,
        remaining: st.remaining,
        lookupsToday: st.lookupsToday,
        freeLimit: st.freeLimit,
      });
      return st;
    } catch (err) {
      console.warn("usage API offline, denying to avoid free bypass", err);
      // Fail closed for consume when server unreachable after quota design —
      // allow one soft local fallback only if never contacted server.
      const cache = readCache();
      if (!cache?.server) {
        const day = new Date().toISOString().slice(0, 10);
        let u = { day, lookups: 0 };
        try {
          u = JSON.parse(localStorage.getItem(USAGE_CACHE_KEY) || "{}");
          if (u.day !== day) u = { day, lookups: 0 };
        } catch {
          u = { day, lookups: 0 };
        }
        if (u.lookups >= FREE_DAILY_LOOKUPS) return { ok: false, remaining: 0, pro: false };
        u.lookups += 1;
        localStorage.setItem(USAGE_CACHE_KEY, JSON.stringify(u));
        return { ok: true, remaining: FREE_DAILY_LOOKUPS - u.lookups, pro: false, offline: true };
      }
      return { ok: false, remaining: 0, pro: false, offline: true };
    }
  }

  async function purchase(plan) {
    const st = await api("/v1/pro/activate", {
      method: "POST",
      body: JSON.stringify({ deviceId: deviceId(), plan }),
    });
    if (!st.ok) throw new Error("activate failed");
    cacheStatus(st);
    return st;
  }

  async function restore() {
    try {
      const st = await api("/v1/pro/restore", {
        method: "POST",
        body: JSON.stringify({ deviceId: deviceId() }),
      });
      cacheStatus(st);
      return { ok: !!st.pro, ...st };
    } catch (err) {
      const cached = readCache();
      return { ok: !!(cached && cached.pro), mock: false, offline: true };
    }
  }

  async function boot() {
    try {
      await refreshStatus();
    } catch (err) {
      console.warn("Protiva API status unavailable", err);
    }
  }

  async function reportFeedback(payload) {
    try {
      await api("/v1/feedback", {
        method: "POST",
        body: JSON.stringify({ deviceId: deviceId(), ...payload }),
      });
    } catch {
      /* optional */
    }
  }

  window.ProtivaPay = {
    PRODUCTS,
    PRICES,
    FREE_DAILY_LOOKUPS,
    deviceId,
    isPro,
    remainingLookups,
    peekLookupAllowed,
    consumeLookup,
    purchase,
    restore,
    refreshStatus,
    boot,
    reportFeedback,
    apiBase,
  };
})();

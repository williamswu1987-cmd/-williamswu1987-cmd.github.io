(() => {
  /**
   * Steps + deficit reminders.
   * Real HealthKit / Health Connect needs the native FitBite shell (Capacitor).
   * On the web we sync when a native bridge exists; otherwise manual entry remains.
   */
  const NOTIFY_KEY = "fitbite-step-notify-v1";
  const SOURCE_KEY = "fitbite-steps-source-v1";

  function isNative() {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch {
      return false;
    }
  }

  function getHealthPlugin() {
    const plugins = window.Capacitor?.Plugins || {};
    return plugins.Health || plugins.HealthKit || plugins.HealthConnect || null;
  }

  function loadNotifyPrefs() {
    try {
      return {
        enabled: true,
        hour: 18,
        lastDay: null,
        ...JSON.parse(localStorage.getItem(NOTIFY_KEY) || "{}"),
      };
    } catch {
      return { enabled: true, hour: 18, lastDay: null };
    }
  }

  function saveNotifyPrefs(p) {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(p));
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function msUntilNextHour(hour) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  async function ensurePermission() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const res = await Notification.requestPermission();
    return res === "granted";
  }

  async function showLocalNotification(title, body, tag = "fitbite-deficit") {
    const ok = await ensurePermission();
    if (!ok) return false;
    const opts = {
      body,
      tag,
      renotify: true,
      icon: "./assets/icons/icon-192.png",
      badge: "./assets/icons/icon-192.png",
      data: { url: "./" },
    };
    if (navigator.serviceWorker?.ready) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
      return true;
    }
    new Notification(title, opts);
    return true;
  }

  /**
   * Try native Health / Health Connect for today's step count.
   * Returns { ok, steps, source, message }
   */
  async function syncFromHealth() {
    if (!isNative()) {
      return {
        ok: false,
        steps: null,
        source: "web",
        message:
          "Apple Health / Google Fit sync needs the FitBite iOS/Android app. On the web, enter steps or install the native build.",
      };
    }
    const health = getHealthPlugin();
    if (!health) {
      return {
        ok: false,
        steps: null,
        source: "native-missing-plugin",
        message:
          "Health plugin not installed in this build yet. Steps stay manual until HealthKit / Health Connect is wired.",
      };
    }
    try {
      if (health.requestAuthorization) {
        await health.requestAuthorization({
          read: ["steps", "STEP_COUNT", "STEPS"],
          write: [],
        });
      }
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      let steps = null;
      if (health.queryHKitSampleType) {
        const res = await health.queryHKitSampleType({
          sampleName: "steps",
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          limit: 0,
        });
        steps = Math.round(Number(res?.resultData?.[0]?.value ?? res?.count ?? res?.steps) || 0);
      } else if (health.readSteps) {
        const res = await health.readSteps({ from: start.toISOString(), to: end.toISOString() });
        steps = Math.round(Number(res?.steps ?? res?.count) || 0);
      } else if (health.queryAggregate) {
        const res = await health.queryAggregate({
          dataType: "steps",
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        });
        steps = Math.round(Number(res?.value ?? res?.steps) || 0);
      }
      if (steps == null || !Number.isFinite(steps)) {
        return {
          ok: false,
          steps: null,
          source: "native",
          message: "Health connected, but no step sample returned for today.",
        };
      }
      localStorage.setItem(SOURCE_KEY, "health");
      return { ok: true, steps, source: "health", message: `Synced ${steps.toLocaleString()} steps from Health` };
    } catch (err) {
      return {
        ok: false,
        steps: null,
        source: "native-error",
        message: err?.message || "Could not read steps from Health",
      };
    }
  }

  function stepsSource() {
    return localStorage.getItem(SOURCE_KEY) || "manual";
  }

  function markManualSource() {
    localStorage.setItem(SOURCE_KEY, "manual");
  }

  /** Best-effort deep link into Apple Health / Google Fit / Health Connect. */
  function openHealthApp() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const candidates = isIOS
      ? ["x-apple-health://", "https://www.apple.com/ios/health/"]
      : isAndroid
        ? [
            "intent://fitness#Intent;scheme=https;package=com.google.android.apps.fitness;end",
            "market://details?id=com.google.android.apps.healthdata",
            "https://play.google.com/store/apps/details?id=com.google.android.apps.fitness",
          ]
        : ["https://www.apple.com/ios/health/"];
    for (const href of candidates) {
      try {
        window.location.href = href;
        return true;
      } catch {
        /* try next */
      }
    }
    return false;
  }

  /**
   * Build notification copy from a deficit plan-like object.
   */
  function deficitStepsMessage(plan) {
    if (!plan) return "Open FitBite to check your calorie deficit walk.";
    if (plan.hit) {
      return `Nice — you’re on track for −${plan.target} kcal (≈${plan.projected} so far).`;
    }
    const steps = plan.stepsStillNeeded || 0;
    const burn = plan.burnStillNeeded || 0;
    return `Still need ~${burn} kcal ≈ ${steps.toLocaleString()} steps to hit −${plan.target} kcal deficit.`;
  }

  async function notifyDeficitSteps(plan, reason = "reminder") {
    const prefs = loadNotifyPrefs();
    if (!prefs.enabled && reason === "schedule") return false;
    const title =
      reason === "last-meal"
        ? "FitBite · after your last meal"
        : reason === "schedule"
          ? "FitBite · 6pm deficit check"
          : "FitBite · steps for your deficit";
    const body = deficitStepsMessage(plan);
    const shown = await showLocalNotification(title, body, `fitbite-${reason}-${todayKey()}`);
    if (shown && reason === "schedule") {
      prefs.lastDay = todayKey();
      saveNotifyPrefs(prefs);
    }
    return shown;
  }

  let _timer = null;
  function scheduleSixPmReminder(getPlanFn) {
    if (_timer) clearTimeout(_timer);
    const prefs = loadNotifyPrefs();
    if (!prefs.enabled) return;
    const wait = msUntilNextHour(prefs.hour || 18);
    _timer = setTimeout(async () => {
      const prefsNow = loadNotifyPrefs();
      if (prefsNow.enabled && prefsNow.lastDay !== todayKey()) {
        const plan = typeof getPlanFn === "function" ? getPlanFn() : null;
        await notifyDeficitSteps(plan, "schedule");
      }
      scheduleSixPmReminder(getPlanFn);
    }, wait);
  }

  async function enableReminders(getPlanFn) {
    const ok = await ensurePermission();
    const prefs = loadNotifyPrefs();
    prefs.enabled = !!ok;
    saveNotifyPrefs(prefs);
    if (ok) scheduleSixPmReminder(getPlanFn);
    return ok;
  }

  function bootReminders(getPlanFn) {
    const prefs = loadNotifyPrefs();
    if (!prefs.enabled) return;
    if ("Notification" in window && Notification.permission === "granted") {
      // Catch-up if user opens app after 6pm and wasn’t notified
      const now = new Date();
      if (now.getHours() >= (prefs.hour || 18) && prefs.lastDay !== todayKey()) {
        const plan = typeof getPlanFn === "function" ? getPlanFn() : null;
        notifyDeficitSteps(plan, "schedule");
      }
      scheduleSixPmReminder(getPlanFn);
    }
  }

  window.FitBiteSteps = {
    syncFromHealth,
    isNative,
    stepsSource,
    markManualSource,
    openHealthApp,
    ensurePermission,
    enableReminders,
    bootReminders,
    notifyDeficitSteps,
    deficitStepsMessage,
    loadNotifyPrefs,
    saveNotifyPrefs,
  };
})();

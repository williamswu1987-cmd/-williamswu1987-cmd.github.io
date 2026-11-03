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

  /** Evening reminder slots: 18:00–21:00 every 30 minutes. */
  const REMINDER_SLOTS = [
    { hour: 18, minute: 0 },
    { hour: 18, minute: 30 },
    { hour: 19, minute: 0 },
    { hour: 19, minute: 30 },
    { hour: 20, minute: 0 },
    { hour: 20, minute: 30 },
    { hour: 21, minute: 0 },
  ];

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function slotValue({ hour, minute }) {
    return `${pad2(hour)}:${pad2(minute)}`;
  }

  function normalizeSlot(hour, minute) {
    const h = Math.round(Number(hour));
    let m = Math.round(Number(minute) || 0);
    if (m !== 0 && m !== 30) m = m < 15 ? 0 : m < 45 ? 30 : 0;
    const match = REMINDER_SLOTS.find((s) => s.hour === h && s.minute === m);
    return match || REMINDER_SLOTS[0];
  }

  function parseSlotValue(value) {
    const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return REMINDER_SLOTS[0];
    return normalizeSlot(Number(m[1]), Number(m[2]));
  }

  function formatSlotLabel(slot) {
    const s = normalizeSlot(slot.hour, slot.minute);
    return `${pad2(s.hour)}:${pad2(s.minute)}`;
  }

  function loadNotifyPrefs() {
    let raw = {};
    try {
      raw = JSON.parse(localStorage.getItem(NOTIFY_KEY) || "{}") || {};
    } catch {
      raw = {};
    }
    const slot = normalizeSlot(raw.hour ?? 18, raw.minute ?? 0);
    return {
      enabled: raw.enabled !== false,
      hour: slot.hour,
      minute: slot.minute,
      lastDay: raw.lastDay || null,
    };
  }

  function saveNotifyPrefs(p) {
    const slot = normalizeSlot(p?.hour ?? 18, p?.minute ?? 0);
    localStorage.setItem(
      NOTIFY_KEY,
      JSON.stringify({
        enabled: p?.enabled !== false,
        hour: slot.hour,
        minute: slot.minute,
        lastDay: p?.lastDay || null,
      })
    );
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function msUntilNextSlot(hour, minute) {
    const slot = normalizeSlot(hour, minute);
    const now = new Date();
    const next = new Date(now);
    next.setHours(slot.hour, slot.minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  function isPastOrAtSlot(prefs, now = new Date()) {
    const slot = normalizeSlot(prefs?.hour ?? 18, prefs?.minute ?? 0);
    const mins = now.getHours() * 60 + now.getMinutes();
    return mins >= slot.hour * 60 + slot.minute;
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
    const when = formatSlotLabel(prefs);
    const title =
      reason === "last-meal"
        ? "FitBite · after your last meal"
        : reason === "schedule"
          ? `FitBite · ${when} deficit check`
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
  function scheduleEveningReminder(getPlanFn) {
    if (_timer) clearTimeout(_timer);
    const prefs = loadNotifyPrefs();
    if (!prefs.enabled) return;
    const wait = msUntilNextSlot(prefs.hour, prefs.minute);
    _timer = setTimeout(async () => {
      const prefsNow = loadNotifyPrefs();
      if (prefsNow.enabled && prefsNow.lastDay !== todayKey()) {
        const plan = typeof getPlanFn === "function" ? getPlanFn() : null;
        await notifyDeficitSteps(plan, "schedule");
      }
      scheduleEveningReminder(getPlanFn);
    }, wait);
  }

  async function enableReminders(getPlanFn) {
    const ok = await ensurePermission();
    const prefs = loadNotifyPrefs();
    prefs.enabled = !!ok;
    saveNotifyPrefs(prefs);
    if (ok) scheduleEveningReminder(getPlanFn);
    return ok;
  }

  function setReminderSlot(value, getPlanFn) {
    const slot = typeof value === "string" ? parseSlotValue(value) : normalizeSlot(value?.hour, value?.minute);
    const prefs = loadNotifyPrefs();
    prefs.hour = slot.hour;
    prefs.minute = slot.minute;
    saveNotifyPrefs(prefs);
    if (prefs.enabled && "Notification" in window && Notification.permission === "granted") {
      scheduleEveningReminder(getPlanFn);
    }
    return prefs;
  }

  function bootReminders(getPlanFn) {
    const prefs = loadNotifyPrefs();
    if (!prefs.enabled) return;
    if ("Notification" in window && Notification.permission === "granted") {
      // Catch-up if user opens app after their chosen slot and wasn’t notified
      if (isPastOrAtSlot(prefs) && prefs.lastDay !== todayKey()) {
        const plan = typeof getPlanFn === "function" ? getPlanFn() : null;
        notifyDeficitSteps(plan, "schedule");
      }
      scheduleEveningReminder(getPlanFn);
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
    scheduleEveningReminder,
    setReminderSlot,
    notifyDeficitSteps,
    deficitStepsMessage,
    loadNotifyPrefs,
    saveNotifyPrefs,
    REMINDER_SLOTS,
    slotValue,
    formatSlotLabel,
    parseSlotValue,
  };
})();

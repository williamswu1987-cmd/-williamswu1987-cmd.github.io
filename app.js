(() => {
  const STORAGE_KEY = "protiva-goals-v1";
  const LOG_KEY = "protiva-log-v1";
  const MODE_KEY = "protiva-mode-v1";
  const PREF_KEY = "protiva-pref-v1";
  const WEIGH_KEY = "protiva-weighins-v1";

  const defaults = {
    sex: "male",
    age: 30,
    weightKg: 75,
    heightCm: 175,
    activity: "sometimes",
    mealsPerDay: 3,
    kcal: 2200,
    protein: 140,
    budget: 25,
    diet: "none",
    /** Daily calorie deficit target (kcal). Recommend 500–700; soft-cap 750. */
    deficitTarget: 600,
    /** Personal TDEE from weigh-in calibration; optional override of formula. */
    calibratedTdee: null,
    useCalibratedTdee: false,
  };

  const DEFICIT_MIN = 300;
  const DEFICIT_MAX = 750;
  const DEFICIT_RECOMMEND_LO = 500;
  const DEFICIT_RECOMMEND_HI = 700;

  /** tasty = default; value = 性价比 optional */
  const PREFS = ["tasty", "protein", "nearby", "value"];

  /** Active restaurant catalog — live GPS or Tivat demo seed */
  let catalog = null;
  let locating = false;
  /** Last kitchen-coach / trilingual ask payload for the open dish sheet */
  let lastCoach = null;
  let lastAsk = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function loadGoals() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
      return { ...defaults };
    }
  }

  function saveGoals(goals) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(goals));
  }

  function loadLog() {
    try {
      const all = JSON.parse(localStorage.getItem(LOG_KEY) || "{}");
      return all[todayKey()] || { kcal: 0, protein: 0, spent: 0, items: [], steps: 0 };
    } catch {
      return { kcal: 0, protein: 0, spent: 0, items: [], steps: 0 };
    }
  }

  function saveLog(log) {
    const all = JSON.parse(localStorage.getItem(LOG_KEY) || "{}");
    all[todayKey()] = log;
    localStorage.setItem(LOG_KEY, JSON.stringify(all));
  }

  function mid([lo, hi]) {
    return (lo + hi) / 2;
  }

  function proteinPerEuro(dish) {
    return mid(dish.protein) / dish.price;
  }

  function loadPref() {
    const p = localStorage.getItem(PREF_KEY) || "tasty";
    return PREFS.includes(p) ? p : "tasty";
  }

  function savePref(pref) {
    localStorage.setItem(PREF_KEY, pref);
  }

  /** Heuristic "好吃" score — not a star rating, just ranking signal */
  function tasteScore(dish) {
    if (typeof dish.tasty === "number") return dish.tasty;
    let s = 5;
    const name = dish.name || "";
    const tags = dish.tags || [];
    if (tags.includes("seafood")) s += 2.2;
    if (/octopus|salmon|steak|grill|shish|teriyaki|tandoori|ceviche|souvlaki|branzino|sea bass/i.test(name))
      s += 2;
    if (/chicken breast|chicken plate|grilled chicken/i.test(name)) s += 1.2;
    if (tags.includes("high-protein") && !tags.includes("budget")) s += 0.8;
    if (tags.includes("veg") && !/lentil|bean|cottage/i.test(name)) s += 0.6;
    if (/pizza|burger|mixed grill/i.test(name)) s += 0.8;
    if (/cottage cheese|lentil soup|white bean|egg white/i.test(name)) s -= 0.8;
    if (tags.includes("budget") && /soup|yogurt|bean/i.test(name)) s -= 0.5;
    return s;
  }

  /** Prefer lean protein density and not ultra-heavy plates */
  function healthScore(dish) {
    const k = mid(dish.kcal);
    const p = mid(dish.protein);
    let s = (p / Math.max(k, 1)) * 120;
    const tags = dish.tags || [];
    if (tags.includes("seafood") || tags.includes("poultry")) s += 2;
    if (tags.includes("veg")) s += 1;
    if (k > 650) s -= 3;
    if (k > 750) s -= 3;
    if (tags.includes("mixed") && k > 600) s -= 1.5;
    return s;
  }

  function loadWeighIns() {
    try {
      const list = JSON.parse(localStorage.getItem(WEIGH_KEY) || "[]");
      return Array.isArray(list)
        ? list
            .filter((w) => w && w.date && Number(w.kg) > 0)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        : [];
    } catch {
      return [];
    }
  }

  function saveWeighIns(list) {
    localStorage.setItem(WEIGH_KEY, JSON.stringify(list.slice(-40)));
  }

  function daysBetween(dateA, dateB) {
    const a = new Date(`${dateA}T12:00:00`);
    const b = new Date(`${dateB}T12:00:00`);
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  function loadAllLogs() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  /** Average logged intake between two dates (inclusive of start, exclusive of end day for meal period). */
  function avgIntakeBetween(startDate, endDate) {
    const all = loadAllLogs();
    const days = daysBetween(startDate, endDate);
    if (days <= 0) return { avg: 0, loggedDays: 0, days: 0 };
    let sum = 0;
    let loggedDays = 0;
    const cursor = new Date(`${startDate}T12:00:00`);
    for (let i = 0; i < days; i++) {
      const key = cursor.toISOString().slice(0, 10);
      const day = all[key];
      const k = Number(day?.kcal) || 0;
      if (k > 0) {
        sum += k;
        loggedDays += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    const avg = loggedDays > 0 ? sum / loggedDays : 0;
    return { avg, loggedDays, days, sum };
  }

  /**
   * Weigh-in calibration:
   * maintenance ≈ avgIntake + (Δkg × 7700) / days
   * Needs ≥2 weigh-ins spanning ≥10 days.
   */
  function computeCalibration(profile) {
    const formula = suggestNutritionFormula(profile);
    const weighIns = loadWeighIns();
    if (weighIns.length < 2) {
      return {
        ready: false,
        reason: "need-weighins",
        formulaTdee: formula.tdee,
        weighIns,
        message: `已记 ${weighIns.length} 次体重。再记一次（间隔约 10 天以上）即可校准。`,
      };
    }
    const first = weighIns[weighIns.length - 2];
    const last = weighIns[weighIns.length - 1];
    // Prefer earliest → latest spanning window if more history
    const start = weighIns[0];
    const end = weighIns[weighIns.length - 1];
    const useStart = daysBetween(start.date, end.date) >= 10 ? start : first;
    const useEnd = end;
    const days = daysBetween(useStart.date, useEnd.date);
    if (days < 10) {
      return {
        ready: false,
        reason: "too-soon",
        formulaTdee: formula.tdee,
        weighIns,
        days,
        message: `最近两次间隔 ${days} 天。建议至少约 10 天（更理想 14–21 天）再校准。`,
      };
    }
    const intake = avgIntakeBetween(useStart.date, useEnd.date);
    const fallbackIntake = Number(profile?.kcal) || formula.kcal + clampDeficit(profile?.deficitTarget);
    const avgIntake = intake.loggedDays >= Math.min(5, Math.ceil(days * 0.4))
      ? intake.avg
      : fallbackIntake;
    const usedFallback = avgIntake === fallbackIntake && intake.loggedDays < Math.min(5, Math.ceil(days * 0.4));
    const deltaKg = Number(useEnd.kg) - Number(useStart.kg);
    const raw = avgIntake + (deltaKg * 7700) / days;
    let tdee = Math.round(raw / 50) * 50;
    tdee = Math.min(4500, Math.max(1200, tdee));
    const weeklyRate = (deltaKg / days) * 7;
    return {
      ready: true,
      formulaTdee: formula.tdee,
      tdee,
      days,
      deltaKg: Math.round(deltaKg * 10) / 10,
      weeklyRate: Math.round(weeklyRate * 100) / 100,
      avgIntake: Math.round(avgIntake),
      loggedDays: intake.loggedDays,
      usedFallback,
      weighIns,
      start: useStart,
      end: useEnd,
      message: usedFallback
        ? `校准维持≈${tdee} kcal（体重 ${useStart.kg}→${useEnd.kg} kg / ${days} 天；吃饭记录偏少，摄入按档案估算）。`
        : `校准维持≈${tdee} kcal（体重 ${useStart.kg}→${useEnd.kg} kg / ${days} 天；日均摄入≈${Math.round(avgIntake)}）。`,
    };
  }

  /** Formula-only TDEE (ignores calibration flags). */
  function suggestNutritionFormula(profile) {
    const weight = Number(profile.weightKg) || defaults.weightKg;
    const height = Number(profile.heightCm) || defaults.heightCm;
    const age = Number(profile.age) || defaults.age;
    const sex = profile.sex || defaults.sex;
    const activity = profile.activity || defaults.activity;
    const deficit = clampDeficit(profile.deficitTarget ?? defaults.deficitTarget);

    let bmr;
    if (sex === "female") bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    else if (sex === "male") bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    else bmr = 10 * weight + 6.25 * height - 5 * age - 78;

    const mult = { rare: 1.2, sometimes: 1.375, often: 1.55, intense: 1.725 }[activity] || 1.375;
    const tdee = Math.round(bmr * mult);
    let kcal = Math.round((tdee - deficit) / 50) * 50;
    kcal = Math.min(4500, Math.max(1200, kcal));

    const pPerKg = { rare: 1.2, sometimes: 1.45, often: 1.8, intense: 2.05 }[activity] || 1.45;
    const ageBoost = age >= 50 ? 0.15 : age >= 40 ? 0.05 : 0;
    let protein = Math.round((weight * (pPerKg + ageBoost)) / 5) * 5;
    protein = Math.min(300, Math.max(50, protein));

    return { kcal, protein, bmr: Math.round(bmr), tdee, deficit, formulaTdee: tdee, calibrated: false };
  }

  /**
   * Mifflin–St Jeor BMR × activity → TDEE (maintenance), optionally overridden
   * by weigh-in calibration. Daily intake = TDEE − deficitTarget.
   */
  function suggestNutrition(profile) {
    const base = suggestNutritionFormula(profile);
    const deficit = base.deficit;
    const calibratedTdee = Number(profile.calibratedTdee);
    const useCalib =
      !!profile.useCalibratedTdee && Number.isFinite(calibratedTdee) && calibratedTdee >= 1200;
    const tdee = useCalib ? Math.round(calibratedTdee) : base.tdee;
    let kcal = Math.round((tdee - deficit) / 50) * 50;
    kcal = Math.min(4500, Math.max(1200, kcal));
    return {
      ...base,
      kcal,
      tdee,
      formulaTdee: base.tdee,
      calibrated: useCalib,
      deficit,
    };
  }

  function mealProteinTarget(remainProtein, goals, log) {
    if (remainProtein <= 0) return 0;
    const mealsPerDay = Number(goals?.mealsPerDay) || 3;
    const eaten = Array.isArray(log?.items) ? log.items.length : 0;
    const mealsLeft = Math.max(1, mealsPerDay - eaten);
    // Spread remaining protein across meals still ahead today.
    const perMeal = remainProtein / mealsLeft;
    return Math.min(55, Math.max(18, perMeal));
  }

  function mealKcalBudget(remainKcal, goals, log) {
    const mealsPerDay = Number(goals?.mealsPerDay) || 3;
    const eaten = Array.isArray(log?.items) ? log.items.length : 0;
    const mealsLeft = Math.max(1, mealsPerDay - eaten);
    return remainKcal / mealsLeft;
  }

  function clampDeficit(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return defaults.deficitTarget;
    return Math.min(DEFICIT_MAX, Math.max(DEFICIT_MIN, Math.round(v / 50) * 50));
  }

  /** ~0.0375 kcal/step at 75 kg — scales with body weight. */
  function kcalPerStep(weightKg) {
    return (Number(weightKg) || defaults.weightKg) * 0.0005;
  }

  function stepsBurnKcal(steps, weightKg) {
    return Math.round((Number(steps) || 0) * kcalPerStep(weightKg));
  }

  function stepsForKcal(kcalNeed, weightKg) {
    const per = kcalPerStep(weightKg);
    if (per <= 0) return 0;
    const need = Math.max(0, Number(kcalNeed) || 0);
    return Math.ceil(need / per / 100) * 100;
  }

  function mealsProgress(goals, log) {
    const mealsPerDay = Number(goals?.mealsPerDay) || 3;
    const eatenCount = Array.isArray(log?.items) ? log.items.length : 0;
    const mealsLeft = Math.max(0, mealsPerDay - eatenCount);
    return {
      mealsPerDay,
      eatenCount,
      mealsLeft,
      isLastMeal: mealsLeft === 1,
      isDone: mealsLeft === 0,
    };
  }

  /**
   * End-of-day deficit coach: maintenance (TDEE) + step burn − intake.
   * lastMealKcal = planned/selected last dish (0 when computing the meal cap).
   */
  function buildDeficitPlan(goals, log, lastMealKcal = 0) {
    const nutrition = suggestNutrition(goals);
    const maintenance = nutrition.tdee;
    const target = clampDeficit(goals.deficitTarget ?? defaults.deficitTarget);
    const steps = Math.max(0, Number(log?.steps) || 0);
    const stepBurn = stepsBurnKcal(steps, goals.weightKg);
    const eaten = Math.max(0, Number(log?.kcal) || 0);
    const mealK = Math.max(0, Number(lastMealKcal) || 0);
    const intake = eaten + mealK;
    const projected = Math.round(maintenance + stepBurn - intake);
    const burnStillNeeded = Math.max(0, target - projected);
    const stepsStillNeeded = stepsForKcal(burnStillNeeded, goals.weightKg);
    const lastMealCap = Math.max(0, Math.round(maintenance + stepBurn - eaten - target));
    const progress = mealsProgress(goals, log);
    return {
      maintenance,
      bmr: nutrition.bmr,
      target,
      steps,
      stepBurn,
      eaten,
      lastMealKcal: mealK,
      projected,
      burnStillNeeded,
      stepsStillNeeded,
      lastMealCap,
      hit: projected >= target,
      recommendLo: DEFICIT_RECOMMEND_LO,
      recommendHi: DEFICIT_RECOMMEND_HI,
      ...progress,
    };
  }

  function useSeedCatalog() {
    catalog = {
      ...window.PROTIVA_DATA,
      source: "seed",
      estimatedMenus: false,
      country: "Montenegro",
    };
    if (window.ProtivaTrust) {
      catalog = window.ProtivaTrust.mergeUserDishesIntoCatalog(catalog);
    }
    localStorage.setItem(MODE_KEY, "demo");
    updateLocationChip();
  }

  function refreshCatalogTrust() {
    if (!catalog || !window.ProtivaTrust) return;
    catalog = window.ProtivaTrust.mergeUserDishesIntoCatalog(catalog);
  }

  function flattenDishes() {
    if (!catalog?.restaurants) return [];
    const out = [];
    for (const r of catalog.restaurants) {
      for (const d of r.dishes) {
        out.push({ ...d, restaurant: r });
      }
    }
    return out;
  }

  function dietOk(dish, diet) {
    if (diet === "none") return true;
    if (diet === "no-pork") return !dish.tags.includes("pork") && !dish.tags.includes("mixed");
    if (diet === "pescatarian") {
      return dish.tags.includes("seafood") || dish.tags.includes("eggs") || dish.tags.includes("veg");
    }
    if (diet === "veg") return dish.tags.includes("veg") || dish.tags.includes("eggs");
    return true;
  }

  function rankDishes(goals, log, pref = loadPref()) {
    const deficit = buildDeficitPlan(goals, log, 0);
    let remainKcal = Math.max(0, goals.kcal - log.kcal);
    // Last meal: also respect deficit-aware cap so dinner doesn't wipe the heat gap.
    if (deficit.isLastMeal) {
      remainKcal = Math.min(remainKcal, deficit.lastMealCap);
    }
    const remainProtein = Math.max(0, goals.protein - log.protein);
    const remainBudget = Math.max(0, goals.budget - log.spent);
    const proteinNeed = mealProteinTarget(remainProtein, goals, log);
    const mealKcal = deficit.isLastMeal ? remainKcal : mealKcalBudget(remainKcal, goals, log);

    const enriched = flattenDishes()
      .filter((d) => dietOk(d, goals.diet))
      .filter((d) => d.price <= Math.max(remainBudget, goals.budget * 0.85))
      .filter((d) => !(window.ProtivaTrust && window.ProtivaTrust.isRejected(d.id)))
      .map((d) => {
        const p = mid(d.protein);
        const k = mid(d.kcal);
        const pp = proteinPerEuro(d);
        const userTaste = window.ProtivaTrust ? window.ProtivaTrust.tasteBoost(d.id) : 0;
        const confBoost = window.ProtivaTrust ? window.ProtivaTrust.confidenceBoost(d.id) : 0;
        const confirmed = window.ProtivaTrust && window.ProtivaTrust.isConfirmed(d.id);
        const taste = tasteScore(d) + userTaste + (d.fromUserMenu ? 2 : 0) + (confirmed ? 1.5 : 0);
        const health = healthScore(d);
        const confidence = Math.min(0.98, (d.confidence || 0.5) + confBoost + (d.fromUserMenu ? 0.3 : 0));
        // Hard constraints: within remaining day budget, and roughly one-meal sized
        const fitsKcal = k <= remainKcal + 25 && k <= mealKcal + 120;
        const fitsProtein = remainProtein <= 0 ? true : p >= proteinNeed - 3;
        const walk = d.restaurant.walkMin || 1;

        let score = 0;
        if (pref === "tasty") {
          // Default: delicious + healthy; real menu confirmations beat templates
          score =
            taste * 12 +
            health * 1.4 -
            walk * 0.25 +
            confidence * 6 +
            (d.fromUserMenu || confirmed ? 8 : 0);
        } else if (pref === "protein") {
          score = p * 2.2 + health * 0.6 + taste * 2 - walk * 0.2 + (confirmed ? 4 : 0);
        } else if (pref === "nearby") {
          score = 40 - walk * 3 + taste * 4 + health * 0.5;
        } else if (pref === "value") {
          // Optional 性价比 mode only
          score = pp * 14 + taste * 2 + (fitsProtein ? 4 : 0) + (confirmed ? 3 : 0);
        }

        return {
          ...d,
          pp,
          taste,
          health,
          confidence,
          confirmed: !!confirmed,
          fitsKcal,
          fitsProtein,
          score,
          proteinNeed,
          remainKcal,
          remainProtein,
          remainBudget,
        };
      });

    // Must: within calories + meet protein need. Soften only if too few results.
    let pool = enriched.filter((d) => d.fitsKcal && d.fitsProtein);
    if (pool.length < 3) {
      pool = enriched.filter((d) => d.fitsKcal && mid(d.protein) >= Math.min(18, proteinNeed));
    }
    if (pool.length < 3) {
      pool = enriched.filter((d) => d.fitsKcal);
    }
    if (pool.length < 3) {
      pool = enriched;
    }

    return pool.sort((a, b) => b.score - a.score).slice(0, 3);
  }

  function scoreBadge(d, pref) {
    if (pref === "value") {
      return { main: `${d.pp.toFixed(1)}`, sub: "g/€", fit: d.fitsKcal && d.fitsProtein ? "符合目标" : "勉强可吃" };
    }
    if (pref === "protein") {
      return {
        main: `${Math.round(mid(d.protein))}`,
        sub: "g 蛋白",
        fit: d.fitsProtein ? "蛋白够" : "蛋白偏低",
      };
    }
    if (pref === "nearby") {
      return { main: `${d.restaurant.walkMin}`, sub: "分钟", fit: d.fitsKcal ? "不超卡" : "略超卡" };
    }
    // tasty default
    return {
      main: d.taste >= 7 ? "很赞" : d.taste >= 5.5 ? "好吃" : "还行",
      sub: "",
      fit: d.fitsKcal && d.fitsProtein ? "不超卡 · 蛋白够" : d.fitsKcal ? "不超卡" : "需留意热量",
    };
  }

  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function updateLocationChip() {
    const placeCount = catalog?.restaurants?.length || 0;
    const dishCount = flattenDishes().length;
    const city = catalog?.city || "…";
    const live = catalog?.source && catalog.source !== "seed";

    $$(".loc-chip").forEach((el) => {
      el.innerHTML = live
        ? `<span class="dot"></span> ${city}`
        : `<span class="dot"></span> 演示 · ${city}`;
    });

    const meta = $("#placesMeta");
    if (meta) {
      meta.textContent = placeCount
        ? `${placeCount} 店 · ${dishCount} 菜`
        : locating
          ? "定位中…"
          : "等待定位";
    }

    const note = $("#dataNote");
    if (note) {
      note.textContent = live
        ? `基于你附近的 OpenStreetMap 餐厅；菜品与营养为按菜系估算（非真实菜单）。来源：${catalog.source}。`
        : "当前为 Tivat 演示菜单（人工录入）。点「用我的定位」可在任意城市使用。";
    }

    updatePlanUi();
  }

  function updatePlanUi() {
    const pro = window.ProtivaPay?.isPro?.();
    const planBtn = $("#btnPlan");
    if (planBtn) {
      planBtn.textContent = pro ? "Pro" : "Free";
      planBtn.classList.toggle("pro", !!pro);
    }
    const quota = $("#quotaLine");
    if (quota && window.ProtivaPay) {
      if (pro) {
        quota.textContent = "Protiva Pro · 无限定位查询";
      } else {
        const left = window.ProtivaPay.remainingLookups();
        quota.textContent = `今日免费定位查询还剩 ${left} / ${window.ProtivaPay.FREE_DAILY_LOOKUPS} 次`;
      }
    }
  }

  function openPaywall(reason) {
    const q = $("#paywallQuota");
    if (q) {
      q.textContent = reason || "免费版每天有查询次数上限。升级 Pro 不限次数。";
    }
    $("#paywall").classList.add("open");
  }

  function closePaywall() {
    $("#paywall").classList.remove("open");
  }

  function fillGoalsForm(goals) {
    $("#sex").value = goals.sex || defaults.sex;
    $("#age").value = goals.age ?? defaults.age;
    $("#weightKg").value = goals.weightKg;
    $("#heightCm").value = goals.heightCm ?? defaults.heightCm;
    $("#activity").value = goals.activity || defaults.activity;
    $("#mealsPerDay").value = String(goals.mealsPerDay || defaults.mealsPerDay);
    $("#kcal").value = goals.kcal;
    $("#protein").value = goals.protein;
    $("#budget").value = goals.budget;
    $("#diet").value = goals.diet;
    const defSelect = $("#deficitTarget");
    if (defSelect) {
      const d = String(clampDeficit(goals.deficitTarget ?? defaults.deficitTarget));
      if (![...defSelect.options].some((o) => o.value === d)) {
        const opt = document.createElement("option");
        opt.value = d;
        opt.textContent = `${d} kcal`;
        defSelect.appendChild(opt);
      }
      defSelect.value = d;
    }
    updateSuggestMeta(goals);
    updateDeficitHint();
    renderCalibPanel();
  }

  function readProfileFromForm() {
    return {
      sex: $("#sex").value || defaults.sex,
      age: Number($("#age").value) || defaults.age,
      weightKg: Number($("#weightKg").value) || defaults.weightKg,
      heightCm: Number($("#heightCm").value) || defaults.heightCm,
      activity: $("#activity").value || defaults.activity,
      mealsPerDay: Number($("#mealsPerDay").value) || defaults.mealsPerDay,
      budget: Number($("#budget").value) || defaults.budget,
      diet: $("#diet").value || "none",
      deficitTarget: clampDeficit($("#deficitTarget")?.value || defaults.deficitTarget),
    };
  }

  function readGoalsForm() {
    const saved = loadGoals();
    const profile = readProfileFromForm();
    return {
      ...profile,
      kcal: Number($("#kcal").value) || defaults.kcal,
      protein: Number($("#protein").value) || defaults.protein,
      deficitTarget: clampDeficit($("#deficitTarget")?.value || defaults.deficitTarget),
      calibratedTdee: saved.calibratedTdee ?? null,
      useCalibratedTdee: !!saved.useCalibratedTdee,
    };
  }

  function updateDeficitHint() {
    const el = $("#deficitHint");
    const sel = $("#deficitTarget");
    if (!el || !sel) return;
    const v = clampDeficit(sel.value);
    if (v > DEFICIT_RECOMMEND_HI) {
      el.textContent = `已选 ${v} kcal：接近上限，容易饿，不建议长期。推荐区间 ${DEFICIT_RECOMMEND_LO}–${DEFICIT_RECOMMEND_HI}。`;
    } else if (v < DEFICIT_RECOMMEND_LO) {
      el.textContent = `已选 ${v} kcal：偏温和。推荐 ${DEFICIT_RECOMMEND_LO}–${DEFICIT_RECOMMEND_HI}；上限勿超 ${DEFICIT_MAX}。`;
    } else {
      el.textContent = `建议 ${DEFICIT_RECOMMEND_LO}–${DEFICIT_RECOMMEND_HI} kcal。超过 ${DEFICIT_MAX} 不建议：会很饿、难坚持。最后一餐会按步数 + 已吃热量，算出还要再消耗多少 / 再走多少步。`;
    }
  }

  function activityLabel(activity) {
    return (
      {
        rare: "很少运动",
        sometimes: "偶尔运动",
        often: "经常健身",
        intense: "高强度训练",
      }[activity] || activity
    );
  }

  function updateSuggestMeta(profile) {
    const s = suggestNutrition({ ...loadGoals(), ...profile });
    const meals = profile.mealsPerDay || 3;
    const el = $("#suggestMeta");
    if (el) {
      const src = s.calibrated ? "校准维持" : "公式维持";
      el.textContent = `BMR≈${s.bmr} · ${src}≈${s.tdee} · 摄入≈${s.kcal}（差−${s.deficit}）· ${meals} 餐/天 · ${activityLabel(profile.activity)}`;
    }
  }

  function renderCalibPanel() {
    const goals = { ...loadGoals(), ...readProfileFromForm() };
    const calib = computeCalibration(goals);
    const meta = $("#calibMeta");
    const hint = $("#calibHint");
    const list = $("#weighInList");
    const applyBtn = $("#btnApplyCalib");
    const clearBtn = $("#btnClearCalib");
    const weighInput = $("#weighInKg");

    if (weighInput && document.activeElement !== weighInput) {
      weighInput.value = goals.weightKg || "";
    }

    if (list) {
      const recent = [...(calib.weighIns || [])].slice(-5).reverse();
      list.innerHTML = recent.length
        ? recent.map((w) => `<li><span>${w.date}</span><strong>${Number(w.kg).toFixed(1)} kg</strong></li>`).join("")
        : `<li class="empty-li">还没有体重记录</li>`;
    }

    if (meta) {
      if (goals.useCalibratedTdee && goals.calibratedTdee) {
        meta.textContent = `使用中 · ${goals.calibratedTdee} kcal`;
      } else if (calib.ready) {
        meta.textContent = `可校准 · ${calib.tdee} kcal`;
      } else {
        meta.textContent = "公式估算中";
      }
    }

    if (hint) hint.textContent = calib.message;

    if (applyBtn) {
      applyBtn.hidden = !calib.ready;
      applyBtn.dataset.tdee = calib.ready ? String(calib.tdee) : "";
    }
    if (clearBtn) {
      clearBtn.hidden = !goals.useCalibratedTdee;
    }
    return calib;
  }

  function applySuggestedNutrition({ toastMsg = true } = {}) {
    const saved = loadGoals();
    const profile = { ...saved, ...readProfileFromForm() };
    const s = suggestNutrition(profile);
    $("#kcal").value = s.kcal;
    $("#protein").value = s.protein;
    updateSuggestMeta(profile);
    renderCalibPanel();
    if (toastMsg) {
      const src = s.calibrated ? "校准" : "公式";
      toast(`已按资料估算：摄入 ${s.kcal} kcal（${src}维持 ${s.tdee} − 差 ${s.deficit}）/ ${s.protein}g 蛋白`);
    }
    return s;
  }

  function logWeighIn() {
    const kg = Number($("#weighInKg")?.value);
    if (!Number.isFinite(kg) || kg < 35 || kg > 200) {
      toast("请填写有效体重（kg）");
      return;
    }
    const date = todayKey();
    const list = loadWeighIns().filter((w) => w.date !== date);
    list.push({ date, kg: Math.round(kg * 10) / 10, at: Date.now() });
    saveWeighIns(list);
    if ($("#weightKg")) $("#weightKg").value = String(Math.round(kg * 10) / 10);
    const goals = loadGoals();
    goals.weightKg = Math.round(kg * 10) / 10;
    saveGoals(goals);
    renderCalibPanel();
    updateSuggestMeta({ ...goals, ...readProfileFromForm() });
    toast(`已记下 ${date} · ${kg.toFixed(1)} kg`);
  }

  function applyCalibration() {
    const calib = computeCalibration({ ...loadGoals(), ...readProfileFromForm() });
    if (!calib.ready) {
      toast(calib.message || "还不能校准");
      return;
    }
    const goals = loadGoals();
    goals.calibratedTdee = calib.tdee;
    goals.useCalibratedTdee = true;
    if (calib.end?.kg) goals.weightKg = Number(calib.end.kg);
    saveGoals(goals);
    if ($("#weightKg") && calib.end?.kg) $("#weightKg").value = String(calib.end.kg);
    applySuggestedNutrition({ toastMsg: false });
    // Persist intake fields into goals snapshot
    const next = readGoalsForm();
    next.calibratedTdee = calib.tdee;
    next.useCalibratedTdee = true;
    saveGoals(next);
    renderCalibPanel();
    toast(`已改用校准维持 ${calib.tdee} kcal，摄入已重算`);
  }

  function clearCalibration() {
    const goals = loadGoals();
    goals.useCalibratedTdee = false;
    goals.calibratedTdee = null;
    saveGoals(goals);
    applySuggestedNutrition({ toastMsg: false });
    const next = readGoalsForm();
    next.useCalibratedTdee = false;
    next.calibratedTdee = null;
    saveGoals(next);
    renderCalibPanel();
    toast("已改回公式维持热量");
  }

  function setRankLoading(msg) {
    $("#rankList").innerHTML = `<div class="empty">${msg}</div>`;
  }

  function renderDeficitPanel(goals, log) {
    const plan = buildDeficitPlan(goals, log, 0);
    const chip = $("#deficitTargetChip");
    const panel = $("#deficitPanel");
    const stepsInput = $("#todaySteps");
    const card = $("#deficitCard");
    if (chip) chip.textContent = `目标 −${plan.target}`;
    if (stepsInput && document.activeElement !== stepsInput) {
      stepsInput.value = plan.steps ? String(plan.steps) : "";
    }
    if (!panel) return plan;

    if (card) {
      card.classList.toggle("is-last", plan.isLastMeal);
      card.classList.toggle("is-done", plan.isDone);
    }

    const lines = [];
    lines.push(
      `<p class="deficit-meta">维持≈${plan.maintenance} · 已吃 ${Math.round(plan.eaten)} · 步数消耗≈${plan.stepBurn} kcal</p>`
    );

    if (plan.isDone) {
      const finalPlan = buildDeficitPlan(goals, log, 0);
      if (finalPlan.hit) {
        lines.push(
          `<p class="deficit-main ok">今日热量差约 <strong>−${finalPlan.projected}</strong> kcal，已达到目标 −${finalPlan.target}。</p>`
        );
      } else {
        lines.push(
          `<p class="deficit-main warn">今日热量差约 <strong>−${finalPlan.projected}</strong> kcal，距目标 −${finalPlan.target} 还差 <strong>${finalPlan.burnStillNeeded}</strong> kcal（约再走 <strong>${finalPlan.stepsStillNeeded.toLocaleString()}</strong> 步）。</p>`
        );
      }
    } else if (plan.isLastMeal) {
      lines.push(
        `<p class="deficit-main">最后一餐建议 ≤ <strong>${plan.lastMealCap}</strong> kcal，才能靠饮食压出 −${plan.target} 的热量差。</p>`
      );
      if (plan.lastMealCap === 0) {
        lines.push(
          `<p class="deficit-sub">已吃偏多：这餐尽量清淡，或再消耗 <strong>${Math.max(
            0,
            Math.round(plan.eaten + plan.target - plan.maintenance - plan.stepBurn)
          )}</strong> kcal / 约 <strong>${plan.stepsStillNeeded.toLocaleString()}</strong> 步。</p>`
        );
      } else {
        lines.push(
          `<p class="deficit-sub">若这餐按上限吃完，预计差约 −${plan.target}。吃得更少则差更大；超了就靠多走路补。</p>`
        );
      }
    } else {
      const remainMeals = plan.mealsLeft;
      lines.push(
        `<p class="deficit-main">还剩 ${remainMeals} 餐。先记下今日步数；到<strong>最后一餐</strong>会按「维持热量 + 步数消耗 − 已吃」算出：这餐最多吃多少，以及还要再消耗多少卡 / 再走多少步。</p>`
      );
      lines.push(
        `<p class="deficit-sub">目标热量差 −${plan.target} kcal（档案可改；建议 ${plan.recommendLo}–${plan.recommendHi}，勿超 ${DEFICIT_MAX}）。</p>`
      );
    }

    panel.innerHTML = lines.join("");
    return plan;
  }

  function renderHome() {
    const goals = loadGoals();
    const log = loadLog();
    const remainKcal = Math.max(0, Math.round(goals.kcal - log.kcal));
    const remainProtein = Math.max(0, Math.round(goals.protein - log.protein));
    const remainBudget = Math.max(0, (goals.budget - log.spent).toFixed(1));

    $("#remainKcal").textContent = remainKcal;
    $("#remainProtein").textContent = remainProtein;
    $("#remainBudget").textContent = remainBudget;

    const homeLede = $("#homeLede");
    if (homeLede) {
      const meals = goals.mealsPerDay || 3;
      const eaten = log.items?.length || 0;
      const left = Math.max(0, meals - eaten);
      const def = clampDeficit(goals.deficitTarget ?? defaults.deficitTarget);
      homeLede.textContent = `今日 ${meals} 餐制 · 已记 ${eaten} 餐 · 还剩 ${left} 餐 · 热量差目标 −${def} kcal。先满足：不超卡 · 蛋白够。`;
    }

    renderDeficitPanel(goals, log);

    updateLocationChip();

    if (locating) {
      setRankLoading("正在读取定位并搜索附近餐厅…");
      return;
    }

    if (!catalog?.restaurants?.length) {
      setRankLoading("附近暂时没有餐厅数据。请允许定位，或使用 Tivat 演示数据。");
      return;
    }

    const pref = loadPref();
    syncPrefButtons(pref);
    const top = rankDishes(goals, log, pref);
    const list = $("#rankList");
    if (!top.length) {
      list.innerHTML = `<div class="empty">今天额度里暂时没有合适推荐。调高预算，或先重置今日记录。</div>`;
      return;
    }

    list.innerHTML = top
      .map((d, i) => {
        const badge = scoreBadge(d, pref);
        return `
      <button class="rank-item" type="button" data-id="${d.id}" style="animation-delay:${0.05 + i * 0.07}s">
        <div class="rank-num">${i + 1}</div>
        <div class="rank-body">
          <strong>${d.name}</strong>
          <div class="meta">${d.restaurant.name} · €${d.price.toFixed(1)} · 走 ${d.restaurant.walkMin} 分钟${
            d.fromUserMenu || d.confirmed ? " · 已确认" : d.estimated ? " · 估" : ""
          }<br/>
          蛋白 ${d.protein[0]}–${d.protein[1]}g · ${d.kcal[0]}–${d.kcal[1]} kcal</div>
        </div>
        <div class="rank-score">
          <div class="pp">${badge.main}${badge.sub ? `<small> ${badge.sub}</small>` : ""}</div>
          <span class="fit ${d.fitsKcal && d.fitsProtein ? "" : "tight"}">${badge.fit}</span>
        </div>
      </button>`;
      })
      .join("");

    $$(".rank-item", list).forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.id));
    });
  }

  function syncPrefButtons(pref) {
    $$(".pref-row .pref-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pref === pref);
    });
  }

  let selected = null;

  function syncTrustButtons(dishId) {
    const fb = window.ProtivaTrust?.getFeedback(dishId) || {};
    $("#btnExistsYes")?.classList.toggle("active", fb.exists === "yes");
    $("#btnExistsNo")?.classList.toggle("active", fb.exists === "no");
    $("#btnTasteUp")?.classList.toggle("active", fb.taste === "up");
    $("#btnTasteDown")?.classList.toggle("active", fb.taste === "down");
    const st = $("#trustStatus");
    if (!st) return;
    const bits = [];
    if (fb.exists === "yes") bits.push("已标记：店里有");
    if (fb.exists === "no") bits.push("已标记：没有这道（将不再推荐）");
    if (fb.taste === "up") bits.push("你觉得好吃");
    if (fb.taste === "down") bits.push("你觉得不好吃");
    st.textContent = bits.length ? bits.join(" · ") : "还没反馈。你的标记会立刻影响排序。";
  }

  function openDetail(dishId) {
    refreshCatalogTrust();
    const dish = flattenDishes().find((d) => d.id === dishId);
    if (!dish) return;
    selected = dish;
    const pp = proteinPerEuro(dish);

    $("#sheetTitle").textContent = dish.name;
    $("#sheetPlace").textContent = `${dish.restaurant.name} · ${dish.restaurant.cuisine} · 走 ${dish.restaurant.walkMin} 分钟`;
    $("#statPrice").textContent = `€${dish.price.toFixed(1)}`;
    $("#statProtein").textContent = `${dish.protein[0]}–${dish.protein[1]}g`;
    $("#statKcal").textContent = `${dish.kcal[0]}–${dish.kcal[1]}`;
    $("#statPp").textContent = pp.toFixed(1);
    const t = tasteScore(dish) + (window.ProtivaTrust?.tasteBoost(dish.id) || 0);
    $("#statTaste").textContent = t >= 7 ? "很赞" : t >= 5.5 ? "好吃" : "还行";
    renderAskPhrase(dish);
    renderCoach(dish);
    renderSheetDeficit(dish);
    const conf = Math.round(
      Math.min(0.98, (dish.confidence || 0.5) + (window.ProtivaTrust?.confidenceBoost(dish.id) || 0)) * 100
    );
    if (dish.fromUserMenu) {
      $("#confidence").textContent = `来自你上传/确认的菜单，可信度约 ${conf}%。营养仍可能是粗估。`;
    } else if (dish.estimated) {
      $("#confidence").textContent = `模板估算菜（不是店家真实菜单），可信度约 ${conf}%。请用下方按钮纠正。`;
    } else {
      $("#confidence").textContent = `营养为估算区间，可信度 ${conf}%（不做假精确）`;
    }
    syncTrustButtons(dish.id);
    $("#overlay").classList.add("open");
  }

  function renderAskPhrase(dish) {
    const el = $("#askLocal");
    if (!el) return;
    if (window.ProtivaCoach?.buildAskTriple) {
      lastAsk = window.ProtivaCoach.buildAskTriple(dish, catalog);
      el.innerHTML = lastAsk.html;
      return;
    }
    lastAsk = null;
    el.textContent = dish.askLocal || "";
  }

  function renderSheetDeficit(dish) {
    const el = $("#sheetDeficit");
    if (!el) return;
    const goals = loadGoals();
    const log = loadLog();
    const progress = mealsProgress(goals, log);
    if (!progress.isLastMeal && !progress.isDone) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    const mealK = mid(dish.kcal);
    const plan = buildDeficitPlan(goals, log, progress.isDone ? 0 : mealK);
    el.hidden = false;
    if (progress.isDone) {
      el.innerHTML = plan.hit
        ? `<strong>热量差</strong> 今日约 −${plan.projected} kcal（目标 −${plan.target}）· 已达成`
        : `<strong>热量差</strong> 今日约 −${plan.projected} kcal · 还差 ${plan.burnStillNeeded} kcal ≈ 再走 ${plan.stepsStillNeeded.toLocaleString()} 步`;
      return;
    }
    if (plan.hit) {
      el.innerHTML = `<strong>最后一餐 · 热量差</strong> 吃这道后预计约 −${plan.projected} kcal（目标 −${plan.target}）· 已够，不必再强制多走`;
    } else {
      el.innerHTML = `<strong>最后一餐 · 热量差</strong> 吃这道（约 ${Math.round(
        mealK
      )} kcal）后，还需再消耗 <strong>${plan.burnStillNeeded}</strong> kcal，约再走 <strong>${plan.stepsStillNeeded.toLocaleString()}</strong> 步`;
    }
  }

  function renderCoach(dish) {
    const block = $("#coachBlock");
    const reasonsEl = $("#coachReasons");
    const linesEl = $("#coachLines");
    const flagsEl = $("#coachFlags");
    const langLabel = $("#coachLangLabel");
    if (!block || !window.ProtivaCoach) {
      lastCoach = null;
      if (block) block.hidden = true;
      return;
    }
    const coach = window.ProtivaCoach.buildCoach({
      dish,
      goals: loadGoals(),
      log: loadLog(),
      catalog,
    });
    lastCoach = coach;
    if (coach.ask) lastAsk = coach.ask;
    if (!coach.needed) {
      block.hidden = true;
      reasonsEl.innerHTML = "";
      linesEl.innerHTML = "";
      flagsEl.innerHTML = "";
      return;
    }
    block.hidden = false;
    const flags = [];
    if (coach.overKcal) flags.push(`<span class="coach-flag hot">热量偏高</span>`);
    if (coach.lowProtein) flags.push(`<span class="coach-flag cool">蛋白不够</span>`);
    flagsEl.innerHTML = flags.join("");
    reasonsEl.innerHTML = (coach.reasons || []).map((r) => `<li>${r}</li>`).join("");
    linesEl.innerHTML = (coach.triples || [])
      .map((t) => `<li class="coach-triple">${t.html}</li>`)
      .join("");
    langLabel.textContent = `请对厨师 / 服务员说（${coach.langLabel || coach.lang} · 英 · 中）`;
  }

  function closeDetail() {
    $("#overlay").classList.remove("open");
    selected = null;
    lastCoach = null;
    lastAsk = null;
  }

  function openMenuSheet() {
    if (!selected) return;
    $("#menuPlace").textContent = `${selected.restaurant.name} · 拍菜单后记下真实菜名`;
    $("#menuDishName").value = "";
    $("#menuDishPrice").value = "10";
    $("#menuDishNote").value = "";
    $("#menuPhoto").value = "";
    const prev = $("#menuPhotoPreview");
    if (prev) {
      prev.hidden = true;
      prev.innerHTML = "";
    }
    $("#menuOverlay").classList.add("open");
  }

  function closeMenuSheet() {
    $("#menuOverlay").classList.remove("open");
  }

  function recordTrust(patch) {
    if (!selected || !window.ProtivaTrust) return;
    const id = selected.id;
    window.ProtivaTrust.setFeedback(id, patch);
    window.ProtivaPay?.reportFeedback?.({
      dishId: id,
      restaurantId: selected.restaurant.id,
      ...patch,
    });
    if (patch.exists === "no") {
      toast("已记下：没有这道。下次不再推荐。");
      closeDetail();
      renderHome();
      return;
    }
    toast("感谢反馈，排序已更新");
    renderHome();
    openDetail(id);
  }

  function mapsUrl(r) {
    return `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}&travelmode=walking`;
  }

  function logSelectedMeal() {
    if (!selected) return;
    const name = selected.name;
    const log = loadLog();
    log.kcal += mid(selected.kcal);
    log.protein += mid(selected.protein);
    log.spent += selected.price;
    log.items.push({ id: selected.id, at: Date.now() });
    saveLog(log);
    closeDetail();
    renderHome();
    toast(`已记录：${name}。今日剩余已更新。`);
  }

  function resetToday() {
    const all = JSON.parse(localStorage.getItem(LOG_KEY) || "{}");
    delete all[todayKey()];
    localStorage.setItem(LOG_KEY, JSON.stringify(all));
    renderHome();
    toast("今日记录已清空");
  }

  function applyDemoPitch() {
    useSeedCatalog();
    const goals = {
      sex: "male",
      age: 30,
      weightKg: 75,
      heightCm: 175,
      activity: "often",
      mealsPerDay: 3,
      kcal: 2200,
      protein: 160,
      budget: 25,
      diet: "none",
      deficitTarget: 600,
    };
    saveGoals(goals);
    // Two meals logged → last-meal mode for deficit coach
    saveLog({
      kcal: 1600,
      protein: 95,
      spent: 18,
      steps: 5500,
      items: [
        { id: "demo-breakfast", at: Date.now() - 3600000 },
        { id: "demo-lunch", at: Date.now() - 1800000 },
      ],
    });
    renderHome();
    toast("演示：最后一餐 · 已吃 1600 · 5500 步 · 热量差目标 −600");
  }

  function saveTodaySteps(raw) {
    const log = loadLog();
    const steps = Math.max(0, Math.min(100000, Math.round(Number(raw) || 0)));
    log.steps = steps;
    if (!Array.isArray(log.items)) log.items = [];
    saveLog(log);
    return log;
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label || "操作"}超时`)), ms)
      ),
    ]);
  }

  async function locateAndLoad({ silent = false, countUsage = true } = {}) {
    if (countUsage && window.ProtivaPay && !silent) {
      await window.ProtivaPay.refreshStatus?.().catch(() => {});
      const gate = window.ProtivaPay.peekLookupAllowed();
      if (!gate.ok) {
        openPaywall("今天的免费定位次数用完了。升级 Pro 可继续无限刷新附近推荐。");
        return;
      }
    }

    locating = true;
    renderHome();
    if (!silent) toast("正在请求定位…");

    try {
      const pos = await withTimeout(window.ProtivaGeo.getPosition(), 12000, "定位");
      const { latitude, longitude } = pos.coords;
      if (!silent) toast("定位成功，正在搜附近餐厅…");
      catalog = await withTimeout(
        window.ProtivaGeo.buildLiveCatalog(latitude, longitude),
        18000,
        "搜索附近餐厅"
      );
      if (window.ProtivaTrust) {
        catalog = window.ProtivaTrust.mergeUserDishesIntoCatalog(catalog);
      }
      localStorage.setItem(MODE_KEY, "live");

      if (countUsage && window.ProtivaPay && !silent) {
        const used = await window.ProtivaPay.consumeLookup();
        if (!used.ok) {
          openPaywall("今天的免费定位次数用完了。升级 Pro 可继续无限刷新附近推荐。");
          locating = false;
          renderHome();
          return;
        }
      }

      if (!catalog.restaurants.length) {
        toast("附近地图数据很少，已切到 Tivat 演示菜单");
        useSeedCatalog();
      } else {
        toast(`已加载 ${catalog.city} 附近 ${catalog.restaurants.length} 家店`);
      }
    } catch (err) {
      console.warn(err);
      const msg =
        err?.code === 1
          ? "定位被拒绝。请在系统设置里打开定位，或先用演示数据。"
          : /超时|Failed to fetch|NetworkError|Load failed/i.test(String(err?.message || err))
            ? "当前网络访问地图服务受限（国内网络常见）。已切换演示菜单，可先体验完整流程。"
            : err?.message || "定位失败";
      toast(msg);
      if (!catalog || !catalog.restaurants?.length) useSeedCatalog();
    } finally {
      locating = false;
      renderHome();
    }
  }

  async function goHome({ tryLocate = false } = {}) {
    showScreen("screen-home");
    if (!catalog) useSeedCatalog();
    renderHome();
    if (tryLocate) await locateAndLoad();
  }

  function registerPwa() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW", err));
    });

    let deferredPrompt = null;
    const installBtn = $("#btnInstall");
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) installBtn.hidden = false;
    });
    installBtn?.addEventListener("click", async () => {
      if (!deferredPrompt) {
        toast("请用手机浏览器菜单里的「添加到主屏幕」");
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.hidden = true;
    });

    // Hide browser install hint when already running as installed PWA
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (isStandalone) {
      const hint = $("#installHint");
      if (hint) hint.hidden = true;
      if (installBtn) installBtn.hidden = true;
    }
  }

  function boot() {
    const goals = loadGoals();
    const hasSetup = localStorage.getItem(STORAGE_KEY);
    registerPwa();
    window.ProtivaPay?.boot?.().then(() => updatePlanUi()).catch(() => {});

    $("#btnStart").addEventListener("click", () => {
      fillGoalsForm(goals);
      showScreen("screen-goals");
      // First-time profile: auto-fill suggested targets from defaults/profile
      if (!localStorage.getItem(STORAGE_KEY)) applySuggestedNutrition({ toastMsg: false });
    });

    ["sex", "age", "weightKg", "heightCm", "activity", "mealsPerDay"].forEach((id) => {
      $(`#${id}`)?.addEventListener("change", () => {
        applySuggestedNutrition({ toastMsg: false });
      });
      $(`#${id}`)?.addEventListener("input", () => {
        updateSuggestMeta(readProfileFromForm());
      });
    });
    $("#btnRecalc")?.addEventListener("click", () => applySuggestedNutrition({ toastMsg: true }));
    $("#deficitTarget")?.addEventListener("change", () => {
      updateDeficitHint();
      applySuggestedNutrition({ toastMsg: false });
    });
    $("#btnLogWeighIn")?.addEventListener("click", logWeighIn);
    $("#btnApplyCalib")?.addEventListener("click", applyCalibration);
    $("#btnClearCalib")?.addEventListener("click", clearCalibration);

    const stepsInput = $("#todaySteps");
    const persistSteps = () => {
      saveTodaySteps(stepsInput?.value);
      renderHome();
    };
    stepsInput?.addEventListener("change", persistSteps);
    stepsInput?.addEventListener("blur", persistSteps);

    $("#btnSkipDemo").addEventListener("click", async () => {
      if (!localStorage.getItem(STORAGE_KEY)) saveGoals(defaults);
      await goHome({ tryLocate: true });
    });

    $("#btnLocateHero")?.addEventListener("click", async () => {
      if (!localStorage.getItem(STORAGE_KEY)) saveGoals(defaults);
      showScreen("screen-home");
      await locateAndLoad();
    });

    $("#goalsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      saveGoals(readGoalsForm());
      showScreen("screen-home");
      toast("目标已保存");
      await locateAndLoad();
    });

    $("#btnEditGoals").addEventListener("click", () => {
      fillGoalsForm(loadGoals());
      showScreen("screen-goals");
    });

    $("#btnResetToday").addEventListener("click", resetToday);
    $("#btnDemoPitch").addEventListener("click", applyDemoPitch);

    $$(".pref-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        savePref(btn.dataset.pref);
        syncPrefButtons(btn.dataset.pref);
        renderHome();
        const labels = { tasty: "好吃优先", protein: "蛋白优先", nearby: "最近", value: "性价比" };
        toast(`已切换：${labels[btn.dataset.pref] || btn.dataset.pref}`);
      });
    });
    $("#btnUseLocation").addEventListener("click", () => locateAndLoad({ countUsage: true }));
    $("#btnUseDemo").addEventListener("click", () => {
      locating = false;
      useSeedCatalog();
      renderHome();
      toast("已切换到 Tivat 演示菜单");
    });
    $("#btnOpenPro")?.addEventListener("click", () => openPaywall());
    $("#btnPlan")?.addEventListener("click", () => openPaywall());
    $("#btnClosePaywall")?.addEventListener("click", closePaywall);
    $("#paywall")?.addEventListener("click", (e) => {
      if (e.target.id === "paywall") closePaywall();
    });
    $("#btnBuyMonthly")?.addEventListener("click", async () => {
      try {
        await window.ProtivaPay.purchase("monthly");
        closePaywall();
        updatePlanUi();
        toast("已在服务器开通 Pro（测试）。本地改存储无效。");
      } catch {
        toast("开通失败：服务器不可用");
      }
    });
    $("#btnBuyYearly")?.addEventListener("click", async () => {
      try {
        await window.ProtivaPay.purchase("yearly");
        closePaywall();
        updatePlanUi();
        toast("已在服务器开通 Pro 年付（测试）。");
      } catch {
        toast("开通失败：服务器不可用");
      }
    });
    $("#btnRestore")?.addEventListener("click", async () => {
      const res = await window.ProtivaPay.restore();
      updatePlanUi();
      toast(res.ok ? "已从服务器恢复 Pro" : "没有找到可恢复的购买");
      if (res.ok) closePaywall();
    });
    $("#btnExistsYes")?.addEventListener("click", () => recordTrust({ exists: "yes" }));
    $("#btnExistsNo")?.addEventListener("click", () => recordTrust({ exists: "no" }));
    $("#btnTasteUp")?.addEventListener("click", () => recordTrust({ taste: "up" }));
    $("#btnTasteDown")?.addEventListener("click", () => recordTrust({ taste: "down" }));
    $("#btnAddMenu")?.addEventListener("click", openMenuSheet);
    $("#btnCloseMenu")?.addEventListener("click", closeMenuSheet);
    $("#menuOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "menuOverlay") closeMenuSheet();
    });
    $("#menuPhoto")?.addEventListener("change", () => {
      const file = $("#menuPhoto").files?.[0];
      const prev = $("#menuPhotoPreview");
      if (!file || !prev || !selected) return;
      const url = URL.createObjectURL(file);
      prev.hidden = false;
      prev.innerHTML = `<img src="${url}" alt="菜单照片预览" />`;
      window.ProtivaTrust?.saveMenuPhotoMeta(selected.restaurant.id, {
        name: file.name,
        size: file.size,
        type: file.type,
      });
    });
    $("#btnSaveMenuDish")?.addEventListener("click", () => {
      if (!selected || !window.ProtivaTrust) return;
      const name = ($("#menuDishName").value || "").trim();
      const price = Number($("#menuDishPrice").value) || 10;
      if (!name) {
        toast("请填写菜单上的菜名");
        return;
      }
      const est = window.ProtivaTrust.estimateFromName(name, price);
      window.ProtivaTrust.addUserDish(selected.restaurant.id, {
        name,
        price,
        protein: est.protein,
        kcal: est.kcal,
        tags: est.tags,
        askLocal: `I'd like the ${name}, please.`,
      });
      refreshCatalogTrust();
      closeMenuSheet();
      closeDetail();
      renderHome();
      toast(`已加入真实菜：${name}。下次会优先推荐已确认菜单。`);
    });
    $("#btnCloseSheet").addEventListener("click", closeDetail);
    $("#overlay").addEventListener("click", (e) => {
      if (e.target.id === "overlay") closeDetail();
    });
    $("#btnNavigate").addEventListener("click", () => {
      if (!selected) return;
      window.open(mapsUrl(selected.restaurant), "_blank", "noopener");
    });
    $("#btnCopyPhrase").addEventListener("click", async () => {
      if (!selected) return;
      const text =
        lastCoach?.needed && lastCoach.copyText
          ? lastCoach.copyText
          : lastAsk?.copyText || selected.askLocal;
      try {
        await navigator.clipboard.writeText(text);
        toast(
          lastCoach?.needed
            ? "已复制三语点餐句 + 厨房助手话术"
            : "已复制三语点餐句（当地 · 英 · 中）"
        );
      } catch {
        toast(text);
      }
    });
    $("#btnLogMeal").addEventListener("click", logSelectedMeal);

    if (!hasSetup) {
      showScreen("screen-hero");
    } else {
      showScreen("screen-home");
      const mode = localStorage.getItem(MODE_KEY);
      if (mode === "live") {
        locateAndLoad({ silent: true });
      } else {
        useSeedCatalog();
        renderHome();
      }
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

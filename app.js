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

  /** tasty = default; local = regional specialties; value = Best value optional */
  const PREFS = ["tasty", "local", "protein", "nearby", "value"];

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

  /** Heuristic "tasty" score — not a star rating, just ranking signal */
  function tasteScore(dish) {
    if (typeof dish.tasty === "number") return dish.tasty;
    let s = 5;
    const name = dish.name || "";
    const tags = dish.tags || [];
    if (tags.includes("seafood")) s += 2.2;
    if (/octopus|salmon|steak|grill|shish|teriyaki|tandoori|ceviche|souvlaki|branzino|sea bass|buzara|risotto|lamb|ćevap|cevapi|pljeskavica/i.test(name))
      s += 2;
    if (/chicken breast|chicken plate|grilled chicken/i.test(name)) s += 1.2;
    if (tags.includes("high-protein") && !tags.includes("budget")) s += 0.8;
    if (tags.includes("local") || tags.includes("specialty")) s += 1.4;
    if (tags.includes("veg") && !/lentil|bean|cottage/i.test(name)) s += 0.6;
    if (/pizza|burger|mixed grill/i.test(name)) s += 0.8;
    if (/cottage cheese|lentil soup|white bean|egg white/i.test(name)) s -= 0.8;
    if (tags.includes("budget") && /soup|yogurt|bean/i.test(name)) s -= 0.5;
    return s;
  }

  /**
   * Local specialty signal — Adriatic / Montenegrin / Balkan dishes and konoba-style cuisine.
   * Used by the "Local first" sort so visitors see regional food ahead of generic cafe bowls.
   */
  function localSpecialtyScore(dish) {
    if (typeof dish.localScore === "number") return dish.localScore;
    let s = 0;
    const name = `${dish.name || ""} ${dish.nameLocal || ""}`;
    const cuisine = `${dish.restaurant?.cuisine || ""} ${dish.cuisineKey || ""}`;
    const tags = dish.tags || [];

    if (tags.includes("local") || tags.includes("specialty")) s += 6;
    if (tags.includes("seafood") && /montenegrin|mediterranean|seafood|balkan|konoba/i.test(cuisine)) s += 2.5;

    if (
      /njeguš|njegusi|pršut|prsut|kačamak|kacamak|cicvara|raštan|rastan|jagnjetina|brudet|buzara|hobotnica|pastrmka|škripavac|skripavac|kajmak|pljeskavica|ćevap|cevapi|black risotto|crni rižoto|rižoto|lignje|škampi|skampi|brancin|orada|gilthead|sea bass|octopus|mussels|trout|lamb|veal|ribarski|fisherman|boka|adriatic/i.test(
        name
      )
    ) {
      s += 5;
    }
    if (/montenegrin|balkan|konoba|mediterranean|seafood|dalmat|adriatic/i.test(cuisine)) s += 3.5;
    if (/grill|mesnica|taverna/i.test(cuisine) && tags.includes("pork")) s += 1.5;
    if (/bowl|wrap|pizza|burger|omelette|yogurt|quinoa|tofu|sandwich|toast|shakshuka/i.test(name)) s -= 2.5;
    if (tags.includes("budget") && !tags.includes("local")) s -= 1;
    if (dish.estimated && !tags.includes("local")) s -= 0.8;
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
        message: `Logged ${weighIns.length} weigh-in(s). Add another (~10+ days apart) to calibrate.`,
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
        message: `Only ${days} days apart. Wait ~10 days (ideally 14–21) before calibrating.`,
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
        ? `Calibrated maintenance ≈${tdee} kcal (weight ${useStart.kg}→${useEnd.kg} kg / ${days} days; sparse meal logs — intake estimated from profile).`
        : `Calibrated maintenance ≈${tdee} kcal (weight ${useStart.kg}→${useEnd.kg} kg / ${days} days; avg intake ≈${Math.round(avgIntake)}).`,
    };
  }

  /**
   * Protein dosing weight: if BMI is high, don't multiply by total mass
   * (extra fat tissue doesn't need that much protein). Use adjusted BW:
   * ideal(BMI≈22) + 25% of excess.
   */
  function proteinDosingWeight(weightKg, heightCm) {
    const weight = Number(weightKg) || defaults.weightKg;
    const heightM = (Number(heightCm) || defaults.heightCm) / 100;
    if (heightM <= 0) return weight;
    const bmi = weight / (heightM * heightM);
    if (bmi <= 25) {
      return { kg: weight, bmi, adjusted: false };
    }
    const ideal = 22 * heightM * heightM;
    const adjusted = ideal + 0.25 * (weight - ideal);
    return { kg: Math.round(adjusted * 10) / 10, bmi, adjusted: true, ideal: Math.round(ideal * 10) / 10 };
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

    // Mainstream ranges: ~1.2 sedentary → ~1.8 hard training (per dosing kg)
    const pPerKg = { rare: 1.2, sometimes: 1.4, often: 1.6, intense: 1.8 }[activity] || 1.4;
    const ageBoost = age >= 50 ? 0.1 : age >= 40 ? 0.05 : 0;
    // Slight bump while cutting to help spare muscle
    const cutBoost = deficit >= 500 ? 0.15 : 0;
    const dosing = proteinDosingWeight(weight, height);
    const rate = pPerKg + ageBoost + cutBoost;
    let protein = Math.round((dosing.kg * rate) / 5) * 5;
    protein = Math.min(220, Math.max(50, protein));

    return {
      kcal,
      protein,
      bmr: Math.round(bmr),
      tdee,
      deficit,
      formulaTdee: tdee,
      calibrated: false,
      proteinRate: Math.round(rate * 100) / 100,
      proteinKg: dosing.kg,
      proteinAdjusted: dosing.adjusted,
    };
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

  /** How many dish options to show for the next meal (not “meals per day”). */
  function recommendCount(goals, log) {
    const { mealsLeft, isDone } = mealsProgress(goals, log);
    if (isDone) return 0;
    // One meal left → one best pick; otherwise up to 5 tasty / local options.
    if (mealsLeft === 1) return 1;
    return Math.min(5, Math.max(3, mealsLeft + 2));
  }

  function rankDishes(goals, log, pref = loadPref()) {
    const topN = recommendCount(goals, log);
    if (topN <= 0) return [];

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
        const local = localSpecialtyScore(d) + (confirmed ? 1 : 0) + (d.fromUserMenu ? 1.5 : 0);
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
        } else if (pref === "local") {
          // Regional specialties first, still edible for today’s calories / protein
          score =
            local * 14 +
            taste * 3 +
            health * 0.8 -
            walk * 0.15 +
            confidence * 4 +
            (fitsProtein ? 3 : 0) +
            (d.fromUserMenu || confirmed ? 6 : 0);
        } else if (pref === "protein") {
          score = p * 2.2 + health * 0.6 + taste * 2 - walk * 0.2 + (confirmed ? 4 : 0);
        } else if (pref === "nearby") {
          score = 40 - walk * 3 + taste * 4 + health * 0.5;
        } else if (pref === "value") {
          // Optional Best value mode only
          score = pp * 14 + taste * 2 + (fitsProtein ? 4 : 0) + (confirmed ? 3 : 0);
        }

        return {
          ...d,
          pp,
          taste,
          local,
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
    if (pool.length < topN) {
      pool = enriched.filter((d) => d.fitsKcal && mid(d.protein) >= Math.min(18, proteinNeed));
    }
    if (pool.length < topN) {
      pool = enriched.filter((d) => d.fitsKcal);
    }
    if (pool.length < topN) {
      pool = enriched;
    }

    return pool.sort((a, b) => b.score - a.score).slice(0, topN);
  }

  function scoreBadge(d, pref) {
    if (pref === "value") {
      return { main: `${d.pp.toFixed(1)}`, sub: "g/€", fit: d.fitsKcal && d.fitsProtein ? "Fits goals" : "Stretch" };
    }
    if (pref === "protein") {
      return {
        main: `${Math.round(mid(d.protein))}`,
        sub: "g protein",
        fit: d.fitsProtein ? "Protein OK" : "Low protein",
      };
    }
    if (pref === "nearby") {
      return { main: `${d.restaurant.walkMin}`, sub: "min", fit: d.fitsKcal ? "On calories" : "Slightly over" };
    }
    if (pref === "local") {
      return {
        main: d.local >= 8 ? "Local" : d.local >= 4 ? "Regional" : "Nearby",
        sub: "",
        fit: d.fitsKcal && d.fitsProtein ? "On calories · Protein OK" : d.fitsKcal ? "On calories" : "Watch calories",
      };
    }
    // tasty default
    return {
      main: d.taste >= 7 ? "Great" : d.taste >= 5.5 ? "Tasty" : "OK",
      sub: "",
      fit: d.fitsKcal && d.fitsProtein ? "On calories · Protein OK" : d.fitsKcal ? "On calories" : "Watch calories",
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
        : `<span class="dot"></span> Demo · ${city}`;
    });

    const meta = $("#placesMeta");
    if (meta) {
      meta.textContent = placeCount
        ? `${placeCount} place${placeCount === 1 ? "" : "s"} nearby`
        : locating
          ? "Locating…"
          : "Waiting for GPS";
    }

    const note = $("#dataNote");
    if (note) {
      note.textContent = live
        ? `Nearby OpenStreetMap places; dishes/nutrition estimated by cuisine (not real menus). Source: ${catalog.source}.`
        : "Tivat demo menu (hand-curated). Tap “Refresh with my location” to use any city.";
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
        quota.textContent = "FitBite Pro · unlimited lookups";
      } else {
        const left = window.ProtivaPay.remainingLookups();
        quota.textContent = `Free lookups left today: ${left} / ${window.ProtivaPay.FREE_DAILY_LOOKUPS}`;
      }
    }
  }

  function openPaywall(reason) {
    const q = $("#paywallQuota");
    if (q) {
      q.textContent = reason || "Free plan has a daily lookup limit. Pro is unlimited.";
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
      el.textContent = `Selected ${v} kcal: near the max — gets hungry; not for long-term. Recommended ${DEFICIT_RECOMMEND_LO}–${DEFICIT_RECOMMEND_HI}.`;
    } else if (v < DEFICIT_RECOMMEND_LO) {
      el.textContent = `Selected ${v} kcal: mild. Recommended ${DEFICIT_RECOMMEND_LO}–${DEFICIT_RECOMMEND_HI}; don’t exceed ${DEFICIT_MAX}.`;
    } else {
      el.textContent = `Aim for ${DEFICIT_RECOMMEND_LO}–${DEFICIT_RECOMMEND_HI} kcal. Over ${DEFICIT_MAX} not recommended — too hungry. On the last meal we use steps + intake to estimate burn / walking still needed.`;
    }
  }

  function activityLabel(activity) {
    return (
      {
        rare: "Rarely active",
        sometimes: "Sometimes active",
        often: "Often training",
        intense: "Intense training",
      }[activity] || activity
    );
  }

  function updateSuggestMeta(profile) {
    const s = suggestNutrition({ ...loadGoals(), ...profile });
    const meals = profile.mealsPerDay || 3;
    const el = $("#suggestMeta");
    if (el) {
      const src = s.calibrated ? "Calibrated maint." : "Formula maint.";
      const pNote = s.proteinAdjusted
        ? `Protein ≈${s.protein}g (adjusted ${s.proteinKg}kg × ${s.proteinRate})`
        : `Protein ≈${s.protein}g (${s.proteinKg}kg × ${s.proteinRate})`;
      el.textContent = `BMR≈${s.bmr} · ${src}≈${s.tdee} · intake≈${s.kcal} (deficit −${s.deficit}) · ${pNote} · ${meals} meals/day · ${activityLabel(profile.activity)}`;
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
        : `<li class="empty-li">No weigh-ins yet</li>`;
    }

    if (meta) {
      if (goals.useCalibratedTdee && goals.calibratedTdee) {
        meta.textContent = `Active · ${goals.calibratedTdee} kcal`;
      } else if (calib.ready) {
        meta.textContent = `Ready · ${calib.tdee} kcal`;
      } else {
        meta.textContent = "Using formula";
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
      const src = s.calibrated ? "calibrated" : "formula";
      toast(`Estimated: intake ${s.kcal} kcal (${src} maint. ${s.tdee} − deficit ${s.deficit}) / ${s.protein}g protein`);
    }
    return s;
  }

  function logWeighIn() {
    const kg = Number($("#weighInKg")?.value);
    if (!Number.isFinite(kg) || kg < 35 || kg > 200) {
      toast("Enter a valid weight (kg)");
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
    toast(`Saved ${date} · ${kg.toFixed(1)} kg`);
  }

  function applyCalibration() {
    const calib = computeCalibration({ ...loadGoals(), ...readProfileFromForm() });
    if (!calib.ready) {
      toast(calib.message || "Not ready to calibrate yet");
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
    toast(`Using calibrated maintenance ${calib.tdee} kcal — intake recalculated`);
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
    toast("Back to formula maintenance");
  }

  function setRankLoading(msg) {
    $("#rankList").innerHTML = `<div class="empty">${msg}</div>`;
  }

  function currentDeficitPlan() {
    return buildDeficitPlan(loadGoals(), loadLog(), 0);
  }

  function updateStepsSourceLabel() {
    const el = $("#stepsSourceLabel");
    if (!el) return;
    const src = window.FitBiteSteps?.stepsSource?.() || "manual";
    const map = {
      health: "Source: Apple Health / Google Fit (live)",
      manual: "Source: manual entry",
      web: "Source: web · Health sync needs the native app",
    };
    el.textContent = map[src] || `Source: ${src}`;
  }

  function renderWalkNeed(plan) {
    const box = $("#deficitWalkNeed");
    const stepsEl = $("#deficitWalkSteps");
    const kcalEl = $("#deficitWalkKcal");
    if (!box || !stepsEl || !kcalEl) return;
    box.hidden = false;
    if (plan.hit) {
      box.classList.add("is-hit");
      stepsEl.textContent = "On track";
      kcalEl.textContent = `≈ −${plan.projected} / −${plan.target} kcal`;
    } else {
      box.classList.remove("is-hit");
      stepsEl.textContent = `${plan.stepsStillNeeded.toLocaleString()} steps`;
      kcalEl.textContent = `≈ ${plan.burnStillNeeded} kcal still to burn`;
    }
  }

  function renderDeficitPanel(goals, log) {
    const plan = buildDeficitPlan(goals, log, 0);
    const chip = $("#deficitTargetChip");
    const panel = $("#deficitPanel");
    const stepsInput = $("#todaySteps");
    const card = $("#deficitCard");
    if (chip) chip.textContent = `Target −${plan.target}`;
    if (stepsInput && document.activeElement !== stepsInput) {
      stepsInput.value = plan.steps ? String(plan.steps) : "";
    }
    updateStepsSourceLabel();
    renderWalkNeed(plan);
    if (!panel) return plan;

    if (card) {
      card.classList.toggle("is-last", plan.isLastMeal);
      card.classList.toggle("is-done", plan.isDone);
    }

    const lines = [];
    lines.push(
      `<p class="deficit-meta">Maint.≈${plan.maintenance} · eaten ${Math.round(plan.eaten)} · steps ${plan.steps.toLocaleString()} ≈${plan.stepBurn} kcal</p>`
    );

    if (plan.isDone) {
      const finalPlan = buildDeficitPlan(goals, log, 0);
      if (finalPlan.hit) {
        lines.push(
          `<p class="deficit-main ok">Today’s deficit ≈ <strong>−${finalPlan.projected}</strong> kcal — hit target −${finalPlan.target}.</p>`
        );
      } else {
        lines.push(
          `<p class="deficit-main warn">Deficit ≈ <strong>−${finalPlan.projected}</strong> kcal — walk <strong>${finalPlan.stepsStillNeeded.toLocaleString()}</strong> more steps (~${finalPlan.burnStillNeeded} kcal) to hit −${finalPlan.target}.</p>`
        );
      }
    } else if (plan.isLastMeal) {
      lines.push(
        `<p class="deficit-main">Last meal ≤ <strong>${plan.lastMealCap}</strong> kcal to hit a −${plan.target} deficit from food alone.</p>`
      );
      if (plan.lastMealCap === 0) {
        lines.push(
          `<p class="deficit-sub">Already high intake: keep this meal light, or burn <strong>${Math.max(0, Math.round(plan.eaten + plan.target - plan.maintenance - plan.stepBurn))}</strong> kcal / ~ <strong>${plan.stepsStillNeeded.toLocaleString()}</strong> steps.</p>`
        );
      } else {
        lines.push(
          `<p class="deficit-sub">Eat up to that cap for ~−${plan.target}. Eat less → bigger deficit; go over → walk it off. We’ll notify at your evening time / after this meal.</p>`
        );
      }
    } else {
      const remainMeals = plan.mealsLeft;
      lines.push(
        `<p class="deficit-main">${remainMeals} meals left. Sync Health steps now; on your <strong>last meal</strong> (or at your evening remind time) we’ll tell you exactly how many steps close the −${plan.target} gap.</p>`
      );
      lines.push(
        `<p class="deficit-sub">Deficit target −${plan.target} kcal (editable; aim ${plan.recommendLo}–${plan.recommendHi}, max ${DEFICIT_MAX}).</p>`
      );
    }

    panel.innerHTML = lines.join("");
    return plan;
  }

  async function syncHealthSteps({ silent = false } = {}) {
    if (!window.FitBiteSteps) {
      if (!silent) toast("Steps module not loaded");
      return null;
    }
    const res = await window.FitBiteSteps.syncFromHealth();
    if (res.ok && res.steps != null) {
      saveTodaySteps(res.steps);
      renderHome();
      if (!silent) toast(res.message || `Synced ${res.steps.toLocaleString()} steps`);
      return res;
    }
    if (!silent) toast(res?.message || "Could not sync Health steps");
    updateStepsSourceLabel();
    return res;
  }

  async function maybeNotifyAfterLastMeal(beforeProgress, afterLog) {
    if (!window.FitBiteSteps) return;
    const goals = loadGoals();
    const after = mealsProgress(goals, afterLog);
    // Fire when the user just finished their last meal of the day
    if (!beforeProgress?.isLastMeal || !after?.isDone) return;
    const plan = buildDeficitPlan(goals, afterLog, 0);
    await window.FitBiteSteps.notifyDeficitSteps(plan, "last-meal");
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
    const meals = goals.mealsPerDay || 3;
    const eaten = log.items?.length || 0;
    const left = Math.max(0, meals - eaten);
    const def = clampDeficit(goals.deficitTarget ?? defaults.deficitTarget);
    if (homeLede) {
      const mealWord = meals === 1 ? "meal" : "meals";
      const leftWord = left === 1 ? "meal" : "meals";
      homeLede.textContent = `Today: ${meals} ${mealWord} · logged ${eaten} · ${left} ${leftWord} left · deficit −${def} kcal. Priorities: on calories · enough protein.`;
    }

    renderDeficitPanel(goals, log);

    updateLocationChip();

    const sectionTitle = document.querySelector("#screen-home .section-label h3");
    const topN = recommendCount(goals, log);
    if (sectionTitle) {
      sectionTitle.textContent =
        topN <= 0 ? "Today’s meals" : topN === 1 ? "Best pick for this meal" : `Top ${topN} for this meal`;
    }

    if (locating) {
      setRankLoading("Getting location and searching nearby…");
      return;
    }

    if (!catalog?.restaurants?.length) {
      setRankLoading("No nearby places yet. Allow location, or use the Tivat demo.");
      return;
    }

    const pref = loadPref();
    syncPrefButtons(pref);
    const top = rankDishes(goals, log, pref);
    const list = $("#rankList");
    const meta = $("#placesMeta");
    if (meta && catalog?.restaurants?.length) {
      const placeCount = catalog.restaurants.length;
      if (topN <= 0) {
        meta.textContent = "All meals logged";
      } else {
        meta.textContent = `${top.length} pick${top.length === 1 ? "" : "s"} · ${placeCount} place${placeCount === 1 ? "" : "s"}`;
      }
    }
    if (!top.length) {
      list.innerHTML =
        topN <= 0
          ? `<div class="empty">You’ve logged all meals for today. Reset today’s log to pick again.</div>`
          : `<div class="empty">Nothing fits today’s budget. Raise budget or reset today’s log.</div>`;
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
          <div class="meta">${d.restaurant.name} · €${d.price.toFixed(1)} · ${d.restaurant.walkMin} min walk${
            d.fromUserMenu || d.confirmed ? " · confirmed" : d.estimated ? " · est." : ""
          }<br/>
          Protein ${d.protein[0]}–${d.protein[1]}g · ${d.kcal[0]}–${d.kcal[1]} kcal</div>
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
    if (fb.exists === "yes") bits.push("Marked: they have it");
    if (fb.exists === "no") bits.push("Marked: not on menu (won’t recommend)");
    if (fb.taste === "up") bits.push("You liked it");
    if (fb.taste === "down") bits.push("You didn’t like it");
    st.textContent = bits.length ? bits.join(" · ") : "No feedback yet. Your tags change ranking immediately.";
  }

  function openDetail(dishId) {
    refreshCatalogTrust();
    const dish = flattenDishes().find((d) => d.id === dishId);
    if (!dish) return;
    selected = dish;
    const pp = proteinPerEuro(dish);

    $("#sheetTitle").textContent = dish.name;
    $("#sheetPlace").textContent = `${dish.restaurant.name} · ${dish.restaurant.cuisine} · ${dish.restaurant.walkMin} min walk`;
    $("#statPrice").textContent = `€${dish.price.toFixed(1)}`;
    $("#statProtein").textContent = `${dish.protein[0]}–${dish.protein[1]}g`;
    $("#statKcal").textContent = `${dish.kcal[0]}–${dish.kcal[1]}`;
    $("#statPp").textContent = pp.toFixed(1);
    const t = tasteScore(dish) + (window.ProtivaTrust?.tasteBoost(dish.id) || 0);
    $("#statTaste").textContent = t >= 7 ? "Great" : t >= 5.5 ? "Tasty" : "OK";
    renderAskPhrase(dish);
    renderCoach(dish);
    renderSheetDeficit(dish);
    const conf = Math.round(
      Math.min(0.98, (dish.confidence || 0.5) + (window.ProtivaTrust?.confidenceBoost(dish.id) || 0)) * 100
    );
    if (dish.fromUserMenu) {
      $("#confidence").textContent = `From your uploaded/confirmed menu (~${conf}% confidence). Nutrition may still be estimated.`;
    } else if (dish.estimated) {
      $("#confidence").textContent = `Template estimate (not the real menu) · ~${conf}% confidence. Correct with the buttons below.`;
    } else {
      $("#confidence").textContent = `Nutrition is an estimated range · ${conf}% confidence (not false precision)`;
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
        ? `<strong>Deficit</strong> today ≈ −${plan.projected} kcal (target −${plan.target}) · hit`
        : `<strong>Deficit</strong> today ≈ −${plan.projected} kcal · still need ${plan.burnStillNeeded} kcal ≈ ${plan.stepsStillNeeded.toLocaleString()} steps`;
      return;
    }
    if (plan.hit) {
      el.innerHTML = `<strong>Last meal · deficit</strong> After this dish ≈ −${plan.projected} kcal (target −${plan.target}) · enough, no forced extra walk`;
    } else {
      el.innerHTML = `<strong>Last meal · deficit</strong> After this dish (~${Math.round(
        mealK
      )} kcal), still burn <strong>${plan.burnStillNeeded}</strong> kcal ≈ <strong>${plan.stepsStillNeeded.toLocaleString()}</strong> steps`;
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
    if (coach.overKcal) flags.push(`<span class="coach-flag hot">High calories</span>`);
    if (coach.lowProtein) flags.push(`<span class="coach-flag cool">Low protein</span>`);
    flagsEl.innerHTML = flags.join("");
    reasonsEl.innerHTML = (coach.reasons || []).map((r) => `<li>${r}</li>`).join("");
    linesEl.innerHTML = (coach.triples || [])
      .map((t) => `<li class="coach-triple">${t.html}</li>`)
      .join("");
    langLabel.textContent = `Tell chef / waiter (${coach.langLabel || coach.lang} · EN · ZH)`;
  }

  function closeDetail() {
    $("#overlay").classList.remove("open");
    selected = null;
    lastCoach = null;
    lastAsk = null;
  }

  function openMenuSheet() {
    if (!selected) return;
    $("#menuPlace").textContent = `${selected.restaurant.name} · snap the menu, then type real dish names`;
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
      toast("Noted: not on the menu. Won’t recommend next time.");
      closeDetail();
      renderHome();
      return;
    }
    toast("Thanks — ranking updated");
    renderHome();
    openDetail(id);
  }

  function mapsUrl(r) {
    return `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}&travelmode=walking`;
  }

  function logSelectedMeal() {
    if (!selected) return;
    const name = selected.name;
    const goals = loadGoals();
    const log = loadLog();
    const beforeProgress = mealsProgress(goals, log);
    log.kcal += mid(selected.kcal);
    log.protein += mid(selected.protein);
    log.spent += selected.price;
    log.items.push({ id: selected.id, at: Date.now() });
    saveLog(log);
    closeDetail();
    renderHome();
    toast(`Logged: ${name}. Today’s remaining updated.`);
    maybeNotifyAfterLastMeal(beforeProgress, log).catch(() => {});
  }

  function resetToday() {
    const all = JSON.parse(localStorage.getItem(LOG_KEY) || "{}");
    delete all[todayKey()];
    localStorage.setItem(LOG_KEY, JSON.stringify(all));
    renderHome();
    toast("Today’s log cleared");
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
    toast("Demo: last meal · eaten 1600 · 5500 steps · deficit −600");
  }

  function saveTodaySteps(raw) {
    const log = loadLog();
    const steps = Math.max(0, Math.min(100000, Math.round(Number(raw) || 0)));
    log.steps = steps;
    if (!Array.isArray(log.items)) log.items = [];
    saveLog(log);
    return log;
  }

  function wireStepsControls() {
    const stepsInput = $("#todaySteps");
    const persistSteps = () => {
      window.FitBiteSteps?.markManualSource?.();
      saveTodaySteps(stepsInput?.value);
      renderHome();
    };
    stepsInput?.addEventListener("change", persistSteps);
    stepsInput?.addEventListener("blur", persistSteps);

    $("#btnSyncHealth")?.addEventListener("click", () => syncHealthSteps({ silent: false }));
    $("#btnOpenHealth")?.addEventListener("click", () => {
      const ok = window.FitBiteSteps?.openHealthApp?.();
      if (!ok) toast("Open Apple Health or Google Fit, then tap Sync Health here");
    });

    const chk = $("#chkStepNotify");
    const timeSelect = $("#notifyTime");
    if (window.FitBiteSteps) {
      const prefs = window.FitBiteSteps.loadNotifyPrefs();
      if (chk) chk.checked = !!prefs.enabled;
      if (timeSelect) {
        timeSelect.value = window.FitBiteSteps.slotValue(prefs);
        timeSelect.disabled = !prefs.enabled;
      }
      chk?.addEventListener("change", async () => {
        if (chk.checked) {
          if (timeSelect) {
            window.FitBiteSteps.setReminderSlot(timeSelect.value, currentDeficitPlan);
          }
          const ok = await window.FitBiteSteps.enableReminders(currentDeficitPlan);
          chk.checked = ok;
          if (timeSelect) timeSelect.disabled = !ok;
          const when = window.FitBiteSteps.formatSlotLabel(window.FitBiteSteps.loadNotifyPrefs());
          toast(ok ? `Alerts on · ${when} + after last meal` : "Notification permission denied");
        } else {
          const prefsNow = window.FitBiteSteps.loadNotifyPrefs();
          prefsNow.enabled = false;
          window.FitBiteSteps.saveNotifyPrefs(prefsNow);
          if (timeSelect) timeSelect.disabled = true;
          toast("Deficit step alerts off");
        }
      });
      timeSelect?.addEventListener("change", () => {
        const prefs = window.FitBiteSteps.setReminderSlot(timeSelect.value, currentDeficitPlan);
        const when = window.FitBiteSteps.formatSlotLabel(prefs);
        toast(prefs.enabled ? `Evening remind set to ${when}` : `Saved ${when} — enable alerts to notify`);
      });
    }

    // Re-sync when returning from Health / Fit on native shells
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (!window.FitBiteSteps?.isNative?.()) return;
      if (window.FitBiteSteps.stepsSource() !== "health") return;
      syncHealthSteps({ silent: true }).catch(() => {});
    });
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label || "Operation"} timed out`)), ms)
      ),
    ]);
  }

  async function locateAndLoad({ silent = false, countUsage = true } = {}) {
    if (countUsage && window.ProtivaPay && !silent) {
      await window.ProtivaPay.refreshStatus?.().catch(() => {});
      const gate = window.ProtivaPay.peekLookupAllowed();
      if (!gate.ok) {
        openPaywall("Out of free location lookups today. Upgrade to Pro for unlimited nearby picks.");
        return;
      }
    }

    locating = true;
    renderHome();
    if (!silent) toast("Requesting location…");

    try {
      const pos = await withTimeout(window.ProtivaGeo.getPosition(), 12000, "Location");
      const { latitude, longitude } = pos.coords;
      if (!silent) toast("Location OK — searching nearby…");
      catalog = await withTimeout(
        window.ProtivaGeo.buildLiveCatalog(latitude, longitude),
        18000,
        "Search nearby restaurants"
      );
      if (window.ProtivaTrust) {
        catalog = window.ProtivaTrust.mergeUserDishesIntoCatalog(catalog);
      }
      localStorage.setItem(MODE_KEY, "live");

      if (countUsage && window.ProtivaPay && !silent) {
        const used = await window.ProtivaPay.consumeLookup();
        if (!used.ok) {
          openPaywall("Out of free location lookups today. Upgrade to Pro for unlimited nearby picks.");
          locating = false;
          renderHome();
          return;
        }
      }

      if (!catalog.restaurants.length) {
        toast("Sparse map data nearby — switched to Tivat demo menu");
        useSeedCatalog();
      } else {
        toast(`Loaded ${catalog.restaurants.length} places near ${catalog.city}`);
      }
    } catch (err) {
      console.warn(err);
      const msg =
        err?.code === 1
          ? "Location denied. Enable GPS in settings, or use the demo."
          : /timed out|超时|Failed to fetch|NetworkError|Load failed/i.test(String(err?.message || err))
            ? "Map services are blocked on this network. Switched to demo so you can still try the full flow."
            : err?.message || "Location failed";
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
        toast("Use your browser menu → Add to Home Screen");
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

    wireStepsControls();
    window.FitBiteSteps?.bootReminders?.(currentDeficitPlan);
    // Prefer live Health steps when the native shell is available
    if (window.FitBiteSteps?.isNative?.()) {
      syncHealthSteps({ silent: true }).catch(() => {});
    }

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
      toast("Goals saved");
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
        const labels = {
          tasty: "Tasty first",
          local: "Local specialty",
          protein: "Protein first",
          nearby: "Nearest",
          value: "Best value",
        };
        toast(`Switched: ${labels[btn.dataset.pref] || btn.dataset.pref}`);
      });
    });
    $("#btnUseLocation").addEventListener("click", () => locateAndLoad({ countUsage: true }));
    $("#btnUseDemo").addEventListener("click", () => {
      locating = false;
      useSeedCatalog();
      renderHome();
      toast("Switched to Tivat demo menu");
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
        toast("Pro unlocked on server (test). Editing local storage won’t work.");
      } catch {
        toast("Couldn’t unlock: server unavailable");
      }
    });
    $("#btnBuyYearly")?.addEventListener("click", async () => {
      try {
        await window.ProtivaPay.purchase("yearly");
        closePaywall();
        updatePlanUi();
        toast("Pro yearly unlocked on server (test).");
      } catch {
        toast("Couldn’t unlock: server unavailable");
      }
    });
    $("#btnRestore")?.addEventListener("click", async () => {
      const res = await window.ProtivaPay.restore();
      updatePlanUi();
      toast(res.ok ? "Pro restored from server" : "No purchase to restore");
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
      prev.innerHTML = `<img src="${url}" alt="Menu photo preview" />`;
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
        toast("Enter the dish name from the menu");
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
      toast(`Added real dish: ${name}. Confirmed menu items rank higher next time.`);
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
            ? "Copied trilingual order + kitchen coach lines"
            : "Copied trilingual order lines (local · EN · ZH)"
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

(() => {
  const STORAGE_KEY = "protiva-goals-v1";
  const LOG_KEY = "protiva-log-v1";
  const MODE_KEY = "protiva-mode-v1";
  const PREF_KEY = "protiva-pref-v1";

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
  };

  /** tasty = default; value = 性价比 optional */
  const PREFS = ["tasty", "protein", "nearby", "value"];

  /** Active restaurant catalog — live GPS or Tivat demo seed */
  let catalog = null;
  let locating = false;

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
      return all[todayKey()] || { kcal: 0, protein: 0, spent: 0, items: [] };
    } catch {
      return { kcal: 0, protein: 0, spent: 0, items: [] };
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

  /**
   * Mifflin–St Jeor BMR × activity → daily kcal; protein by g/kg × activity.
   * Not medical advice — a practical default users can edit.
   */
  function suggestNutrition(profile) {
    const weight = Number(profile.weightKg) || defaults.weightKg;
    const height = Number(profile.heightCm) || defaults.heightCm;
    const age = Number(profile.age) || defaults.age;
    const sex = profile.sex || defaults.sex;
    const activity = profile.activity || defaults.activity;

    let bmr;
    if (sex === "female") bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    else if (sex === "male") bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    else bmr = 10 * weight + 6.25 * height - 5 * age - 78;

    const mult = { rare: 1.2, sometimes: 1.375, often: 1.55, intense: 1.725 }[activity] || 1.375;
    let kcal = Math.round((bmr * mult) / 50) * 50;
    kcal = Math.min(4500, Math.max(1200, kcal));

    const pPerKg = { rare: 1.2, sometimes: 1.45, often: 1.8, intense: 2.05 }[activity] || 1.45;
    const ageBoost = age >= 50 ? 0.15 : age >= 40 ? 0.05 : 0;
    let protein = Math.round((weight * (pPerKg + ageBoost)) / 5) * 5;
    protein = Math.min(300, Math.max(50, protein));

    return { kcal, protein, bmr: Math.round(bmr), tdee: Math.round(bmr * mult) };
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

  function useSeedCatalog() {
    catalog = {
      ...window.PROTIVA_DATA,
      source: "seed",
      estimatedMenus: false,
      country: "Montenegro",
    };
    localStorage.setItem(MODE_KEY, "demo");
    updateLocationChip();
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
    const remainKcal = Math.max(0, goals.kcal - log.kcal);
    const remainProtein = Math.max(0, goals.protein - log.protein);
    const remainBudget = Math.max(0, goals.budget - log.spent);
    const proteinNeed = mealProteinTarget(remainProtein, goals, log);
    const mealKcal = mealKcalBudget(remainKcal, goals, log);

    const enriched = flattenDishes()
      .filter((d) => dietOk(d, goals.diet))
      .filter((d) => d.price <= Math.max(remainBudget, goals.budget * 0.85))
      .map((d) => {
        const p = mid(d.protein);
        const k = mid(d.kcal);
        const pp = proteinPerEuro(d);
        const taste = tasteScore(d);
        const health = healthScore(d);
        // Hard constraints: within remaining day budget, and roughly one-meal sized
        const fitsKcal = k <= remainKcal + 25 && k <= mealKcal + 120;
        const fitsProtein = remainProtein <= 0 ? true : p >= proteinNeed - 3;
        const walk = d.restaurant.walkMin || 1;

        let score = 0;
        if (pref === "tasty") {
          // Default: delicious + healthy, among dishes that already fit kcal & protein
          score = taste * 12 + health * 1.4 - walk * 0.25 + (d.confidence || 0.5) * 2;
        } else if (pref === "protein") {
          score = p * 2.2 + health * 0.6 + taste * 2 - walk * 0.2;
        } else if (pref === "nearby") {
          score = 40 - walk * 3 + taste * 4 + health * 0.5;
        } else if (pref === "value") {
          // Optional 性价比 mode only
          score = pp * 14 + taste * 2 + (fitsProtein ? 4 : 0);
        }

        return {
          ...d,
          pp,
          taste,
          health,
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
    updateSuggestMeta(goals);
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
    };
  }

  function readGoalsForm() {
    const profile = readProfileFromForm();
    return {
      ...profile,
      kcal: Number($("#kcal").value) || defaults.kcal,
      protein: Number($("#protein").value) || defaults.protein,
    };
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
    const s = suggestNutrition(profile);
    const meals = profile.mealsPerDay || 3;
    const el = $("#suggestMeta");
    if (el) {
      el.textContent = `BMR≈${s.bmr} · 维持≈${s.tdee} kcal · ${meals} 餐/天 · ${activityLabel(profile.activity)}`;
    }
  }

  function applySuggestedNutrition({ toastMsg = true } = {}) {
    const profile = readProfileFromForm();
    const s = suggestNutrition(profile);
    $("#kcal").value = s.kcal;
    $("#protein").value = s.protein;
    updateSuggestMeta(profile);
    if (toastMsg) toast(`已按资料估算：${s.kcal} kcal / ${s.protein}g 蛋白`);
    return s;
  }

  function setRankLoading(msg) {
    $("#rankList").innerHTML = `<div class="empty">${msg}</div>`;
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
      homeLede.textContent = `今日 ${meals} 餐制 · 已记 ${eaten} 餐 · 还剩 ${left} 餐额度。先满足：不超卡 · 蛋白够；偏好可切换。`;
    }

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
            d.estimated ? " · 估" : ""
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
    $$(".pref-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pref === pref);
    });
  }

  let selected = null;

  function openDetail(dishId) {
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
    const t = tasteScore(dish);
    $("#statTaste").textContent = t >= 7 ? "很赞" : t >= 5.5 ? "好吃" : "还行";
    $("#askLocal").textContent = dish.askLocal;
    const conf = Math.round(dish.confidence * 100);
    $("#confidence").textContent = dish.estimated
      ? `菜品与营养为按「${dish.cuisineKey || dish.restaurant.cuisine}」菜系估算，可信度约 ${conf}%（不是店家真实菜单）。`
      : `营养为估算区间，可信度 ${conf}%（不做假精确）`;
    $("#overlay").classList.add("open");
  }

  function closeDetail() {
    $("#overlay").classList.remove("open");
    selected = null;
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
    };
    saveGoals(goals);
    saveLog({
      kcal: 1150,
      protein: 40,
      spent: 8,
      items: [{ id: "demo-breakfast", at: Date.now() }],
    });
    renderHome();
    toast("演示额度已就绪：1050 卡 / 120g 蛋白（Tivat 菜单）");
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
      localStorage.setItem(MODE_KEY, "live");

      if (countUsage && window.ProtivaPay && !silent) {
        window.ProtivaPay.consumeLookup();
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
      await window.ProtivaPay.purchase("monthly");
      closePaywall();
      updatePlanUi();
      toast("已开通 Pro（测试模拟）。上架后将走 App Store 支付。");
    });
    $("#btnBuyYearly")?.addEventListener("click", async () => {
      await window.ProtivaPay.purchase("yearly");
      closePaywall();
      updatePlanUi();
      toast("已开通 Pro 年付（测试模拟）。上架后将走 App Store 支付。");
    });
    $("#btnRestore")?.addEventListener("click", async () => {
      const res = await window.ProtivaPay.restore();
      updatePlanUi();
      toast(res.ok ? "已恢复 Pro 权益" : "没有找到可恢复的购买");
      if (res.ok) closePaywall();
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
      try {
        await navigator.clipboard.writeText(selected.askLocal);
        toast("点餐句已复制，给服务员看就行");
      } catch {
        toast(selected.askLocal);
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

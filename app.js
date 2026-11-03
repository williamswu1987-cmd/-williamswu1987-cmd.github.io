(() => {
  const STORAGE_KEY = "protiva-goals-v1";
  const LOG_KEY = "protiva-log-v1";
  const MODE_KEY = "protiva-mode-v1";

  const defaults = {
    weightKg: 75,
    kcal: 2200,
    protein: 140,
    budget: 25,
    diet: "none",
  };

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

  function rankDishes(goals, log) {
    const remainKcal = Math.max(0, goals.kcal - log.kcal);
    const remainProtein = Math.max(0, goals.protein - log.protein);
    const remainBudget = Math.max(0, goals.budget - log.spent);

    return flattenDishes()
      .filter((d) => dietOk(d, goals.diet))
      .filter((d) => d.price <= Math.max(remainBudget, goals.budget * 0.6))
      .map((d) => {
        const p = mid(d.protein);
        const k = mid(d.kcal);
        const pp = proteinPerEuro(d);
        const fitsKcal = k <= remainKcal + 40;
        const fitsProteinNeed = remainProtein > 0 ? p >= Math.min(25, remainProtein * 0.35) : true;
        const score =
          pp * 10 +
          (fitsKcal ? 8 : -20) +
          (fitsProteinNeed ? 6 : 0) +
          d.confidence * 4 -
          d.restaurant.walkMin * 0.15;
        return { ...d, pp, fitsKcal, score, remainKcal, remainProtein, remainBudget };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
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
  }

  function fillGoalsForm(goals) {
    $("#weightKg").value = goals.weightKg;
    $("#kcal").value = goals.kcal;
    $("#protein").value = goals.protein;
    $("#budget").value = goals.budget;
    $("#diet").value = goals.diet;
  }

  function readGoalsForm() {
    return {
      weightKg: Number($("#weightKg").value) || defaults.weightKg,
      kcal: Number($("#kcal").value) || defaults.kcal,
      protein: Number($("#protein").value) || defaults.protein,
      budget: Number($("#budget").value) || defaults.budget,
      diet: $("#diet").value || "none",
    };
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
    updateLocationChip();

    if (locating) {
      setRankLoading("正在读取定位并搜索附近餐厅…");
      return;
    }

    if (!catalog?.restaurants?.length) {
      setRankLoading("附近暂时没有餐厅数据。请允许定位，或使用 Tivat 演示数据。");
      return;
    }

    const top = rankDishes(goals, log);
    const list = $("#rankList");
    if (!top.length) {
      list.innerHTML = `<div class="empty">今天额度里暂时没有合适推荐。调高预算，或先重置今日记录。</div>`;
      return;
    }

    list.innerHTML = top
      .map(
        (d, i) => `
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
          <div class="pp">${d.pp.toFixed(1)}<small> g/€</small></div>
          <span class="fit ${d.fitsKcal ? "" : "tight"}">${d.fitsKcal ? "卡路里合适" : "略超今日剩余"}</span>
        </div>
      </button>`
      )
      .join("");

    $$(".rank-item", list).forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.id));
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
      weightKg: 75,
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

  async function locateAndLoad({ silent = false } = {}) {
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

  function boot() {
    const goals = loadGoals();
    const hasSetup = localStorage.getItem(STORAGE_KEY);

    $("#btnStart").addEventListener("click", () => {
      fillGoalsForm(goals);
      showScreen("screen-goals");
    });

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
    $("#btnUseLocation").addEventListener("click", () => locateAndLoad());
    $("#btnUseDemo").addEventListener("click", () => {
      locating = false;
      useSeedCatalog();
      renderHome();
      toast("已切换到 Tivat 演示菜单");
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

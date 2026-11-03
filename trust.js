(() => {
  const FEEDBACK_KEY = "protiva-feedback-v1";
  const USER_DISHES_KEY = "protiva-user-dishes-v1";
  const MENU_PHOTOS_KEY = "protiva-menu-photos-v1";

  function loadJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function dishKey(dishId) {
    return String(dishId);
  }

  /** @returns {{ exists?: 'yes'|'no', taste?: 'up'|'down', at?: number }} */
  function getFeedback(dishId) {
    const all = loadJson(FEEDBACK_KEY, {});
    return all[dishKey(dishId)] || {};
  }

  function setFeedback(dishId, patch) {
    const all = loadJson(FEEDBACK_KEY, {});
    const key = dishKey(dishId);
    all[key] = { ...all[key], ...patch, at: Date.now() };
    saveJson(FEEDBACK_KEY, all);
    return all[key];
  }

  function tasteBoost(dishId) {
    const f = getFeedback(dishId);
    if (f.taste === "up") return 3.5;
    if (f.taste === "down") return -4;
    return 0;
  }

  function isRejected(dishId) {
    return getFeedback(dishId).exists === "no";
  }

  function isConfirmed(dishId) {
    return getFeedback(dishId).exists === "yes";
  }

  function confidenceBoost(dishId) {
    if (isConfirmed(dishId)) return 0.25;
    if (isRejected(dishId)) return -1;
    return 0;
  }

  /** User-added dishes from a real menu photo/entry */
  function listUserDishes(restaurantId) {
    const all = loadJson(USER_DISHES_KEY, {});
    return all[restaurantId] || [];
  }

  function addUserDish(restaurantId, dish) {
    const all = loadJson(USER_DISHES_KEY, {});
    const list = all[restaurantId] || [];
    const id = dish.id || `user-${restaurantId}-${Date.now()}`;
    const row = {
      id,
      name: dish.name,
      price: Number(dish.price) || 10,
      protein: dish.protein || [25, 35],
      kcal: dish.kcal || [400, 550],
      confidence: 0.9,
      tags: dish.tags || ["high-protein"],
      askLocal: dish.askLocal || `I'd like the ${dish.name}, please.`,
      estimated: false,
      fromUserMenu: true,
      cuisineKey: dish.cuisineKey || "default",
    };
    list.push(row);
    all[restaurantId] = list;
    saveJson(USER_DISHES_KEY, all);
    setFeedback(id, { exists: "yes", taste: "up" });
    return row;
  }

  function mergeUserDishesIntoCatalog(catalog) {
    if (!catalog?.restaurants) return catalog;
    for (const r of catalog.restaurants) {
      const extras = listUserDishes(r.id);
      if (!extras.length) continue;
      const have = new Set(r.dishes.map((d) => d.id));
      for (const d of extras) {
        if (!have.has(d.id)) r.dishes.push({ ...d });
      }
    }
    return catalog;
  }

  function saveMenuPhotoMeta(restaurantId, meta) {
    const all = loadJson(MENU_PHOTOS_KEY, {});
    const list = all[restaurantId] || [];
    list.unshift({ ...meta, at: Date.now() });
    all[restaurantId] = list.slice(0, 8);
    saveJson(MENU_PHOTOS_KEY, all);
  }

  function listMenuPhotos(restaurantId) {
    return loadJson(MENU_PHOTOS_KEY, {})[restaurantId] || [];
  }

  /**
   * Rough nutrition guess from dish name keywords when user only types a name+price.
   */
  function estimateFromName(name, price) {
    const n = (name || "").toLowerCase();
    let protein = [24, 32];
    let kcal = [420, 560];
    let tags = ["high-protein"];
    if (/chicken|鸡|pile|pollo|poulet/.test(n)) {
      protein = [34, 44];
      tags = ["poultry", "high-protein"];
    } else if (/beef|steak|牛|goved|carne/.test(n)) {
      protein = [32, 42];
      tags = ["beef", "high-protein"];
    } else if (/fish|salmon|tuna|鱼|hobot|octopus|shrimp|lignje/.test(n)) {
      protein = [28, 38];
      kcal = [320, 460];
      tags = ["seafood", "high-protein"];
    } else if (/egg|omelet|蛋|jaj/.test(n)) {
      protein = [20, 28];
      kcal = [280, 400];
      tags = ["eggs"];
    } else if (/salad|沙拉|salat/.test(n)) {
      protein = [12, 22];
      kcal = [220, 380];
      tags = ["veg"];
    } else if (/tofu|豆/.test(n)) {
      protein = [18, 26];
      tags = ["veg"];
    }
    const p = Number(price) || 10;
    if (p < 7) kcal = [kcal[0] - 40, kcal[1] - 40];
    return { protein, kcal, tags };
  }

  window.ProtivaTrust = {
    getFeedback,
    setFeedback,
    tasteBoost,
    isRejected,
    isConfirmed,
    confidenceBoost,
    listUserDishes,
    addUserDish,
    mergeUserDishesIntoCatalog,
    saveMenuPhotoMeta,
    listMenuPhotos,
    estimateFromName,
  };
})();

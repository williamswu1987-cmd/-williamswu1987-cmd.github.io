(() => {
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  const PHOTON = "https://photon.komoot.io/api/";
  const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function walkMinutes(meters) {
    return Math.max(1, Math.round(meters / 80));
  }

  function detectCuisineKey(name, cuisineTag, amenity) {
    const blob = `${name || ""} ${cuisineTag || ""} ${amenity || ""}`;
    for (const { re, key } of window.PROTIVA_CUISINE_ALIASES) {
      if (re.test(blob)) return key;
    }
    if (amenity === "cafe") return "cafe";
    if (amenity === "fast_food") return "burger";
    return "default";
  }

  function priceFactorForCountry(country) {
    const c = (country || "").toLowerCase();
    if (/united states|usa|canada|australia|norway|switzerland|iceland/.test(c)) return 1.35;
    if (/united kingdom|uk|england|sweden|denmark|ireland/.test(c)) return 1.2;
    if (/germany|france|netherlands|austria|belgium|finland|italy|spain/.test(c)) return 1.05;
    if (/montenegro|serbia|bosnia|albania|north macedonia|croatia|romania|bulgaria|poland|hungary|turkey|中国|china/.test(c))
      return 0.75;
    if (/india|vietnam|thailand|indonesia|philippines/.test(c)) return 0.45;
    return 1;
  }

  function dishesForPlace(place, factor) {
    const key = detectCuisineKey(place.name, place.cuisine, place.amenity);
    const templates = window.PROTIVA_TEMPLATES[key] || window.PROTIVA_TEMPLATES.default;
    return templates.map((t, i) => ({
      id: `${place.id}-d${i}`,
      name: t.name,
      nameLocal: t.name,
      price: Math.max(3, Math.round(t.price * factor * 2) / 2),
      protein: t.protein,
      kcal: t.kcal,
      confidence: 0.55,
      tags: t.tags,
      askLocal: t.ask,
      estimated: true,
      cuisineKey: key,
    }));
  }

  function uniquePlaces(list) {
    const seen = new Set();
    const out = [];
    for (const p of list) {
      const key = `${(p.name || "").toLowerCase()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
      if (seen.has(key) || !p.name) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  async function fetchWithTimeout(url, options = {}, ms = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchOverpass(lat, lng, radiusM) {
    const query = `[out:json][timeout:12];
(
  node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radiusM},${lat},${lng});
  way["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radiusM},${lat},${lng});
);
out center tags 40;`;

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: `data=${encodeURIComponent(query)}`,
          },
          7000
        );
        if (!res.ok) continue;
        const data = await res.json();
        const places = [];
        for (const el of data.elements || []) {
          const tags = el.tags || {};
          const name = tags.name || tags["name:en"];
          if (!name) continue;
          const plat = el.lat ?? el.center?.lat;
          const plng = el.lon ?? el.center?.lon;
          if (plat == null || plng == null) continue;
          const dist = haversineM(lat, lng, plat, plng);
          places.push({
            id: `osm-${el.type}-${el.id}`,
            name,
            cuisine: tags.cuisine || "",
            amenity: tags.amenity || "",
            lat: plat,
            lng: plng,
            distM: dist,
            walkMin: walkMinutes(dist),
            source: "overpass",
          });
        }
        if (places.length) return places;
      } catch {
        /* try next mirror */
      }
    }
    return [];
  }

  async function fetchPhoton(lat, lng, radiusM) {
    const queries = ["restaurant", "cafe", "fast food", "pizza", "grill", "kebab", "sushi"];
    const chunks = await Promise.all(
      queries.map(async (q) => {
        try {
          const url = `${PHOTON}?q=${encodeURIComponent(q)}&lat=${lat}&lon=${lng}&limit=18`;
          const res = await fetchWithTimeout(url, {}, 8000);
          if (!res.ok) return [];
          const data = await res.json();
          const places = [];
          for (const f of data.features || []) {
            const p = f.properties || {};
            const name = p.name;
            if (!name) continue;
            const [plng, plat] = f.geometry.coordinates;
            const dist = haversineM(lat, lng, plat, plng);
            if (dist > radiusM) continue;
            places.push({
              id: `photon-${p.osm_type || "n"}-${p.osm_id || `${plat}-${plng}`}`,
              name,
              cuisine: "",
              amenity: p.osm_value || "",
              lat: plat,
              lng: plng,
              distM: dist,
              walkMin: walkMinutes(dist),
              city: p.city || p.town || p.village || "",
              country: p.country || "",
              source: "photon",
            });
          }
          return places;
        } catch {
          return [];
        }
      })
    );
    return chunks.flat();
  }

  async function reverseGeocode(lat, lng) {
    try {
      const res = await fetchWithTimeout(
        `${PHOTON}?lat=${lat}&lon=${lng}&limit=1`,
        {},
        6000
      );
      if (res.ok) {
        const data = await res.json();
        const p = data.features?.[0]?.properties || {};
        const label = p.city || p.town || p.village || p.county || p.state || "Current location";
        if (label) {
          return {
            label,
            country: p.country || "",
            countryCode: (p.countrycode || "").toUpperCase(),
          };
        }
      }
    } catch {
      /* fall through */
    }

    try {
      const url = `${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`;
      const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 6000);
      if (!res.ok) throw new Error("reverse failed");
      const data = await res.json();
      const a = data.address || {};
      return {
        label:
          a.city || a.town || a.village || a.municipality || a.suburb || a.county || "Current location",
        country: a.country || "",
        countryCode: (a.country_code || "").toUpperCase(),
      };
    } catch {
      return { label: "Current location", country: "", countryCode: "" };
    }
  }

  async function buildLiveCatalog(lat, lng) {
    const wherePromise = reverseGeocode(lat, lng);

    // Race: Photon is usually faster/more available; Overpass is richer when it works.
    const [overpassPlaces, photonNear, photonWide, where] = await Promise.all([
      fetchOverpass(lat, lng, 1600),
      fetchPhoton(lat, lng, 2200),
      fetchPhoton(lat, lng, 5000),
      wherePromise,
    ]);

    let raw = uniquePlaces([...overpassPlaces, ...photonNear]);
    let source = overpassPlaces.length ? (photonNear.length ? "mixed" : "overpass") : "photon";
    if (raw.length < 4) {
      raw = uniquePlaces([...raw, ...photonWide]);
      source = overpassPlaces.length ? "mixed" : "photon";
    }

    raw.sort((a, b) => a.distM - b.distM);
    const factor = priceFactorForCountry(where.country);
    const topPlaces = raw.slice(0, 14);
    const restaurants = topPlaces.map((p) => ({
      id: p.id,
      name: p.name,
      nameLocal: p.name,
      cuisine: p.cuisine || detectCuisineKey(p.name, p.cuisine, p.amenity),
      lat: p.lat,
      lng: p.lng,
      walkMin: p.walkMin,
      distM: Math.round(p.distM),
      dishes: dishesForPlace(p, factor),
    }));

    // Prefer a city label from nearby hits if reverse geocode is generic
    const cityFromHits = topPlaces.find((p) => p.city)?.city;
    return {
      city: where.label && where.label !== "Current location" ? where.label : cityFromHits || where.label,
      country: where.country || topPlaces.find((p) => p.country)?.country || "",
      cityCenter: { lat, lng },
      source,
      estimatedMenus: true,
      restaurants,
    };
  }

  function getPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("This device does not support geolocation"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 120000,
        ...options,
      });
    });
  }

  window.ProtivaGeo = {
    haversineM,
    walkMinutes,
    getPosition,
    buildLiveCatalog,
    reverseGeocode,
  };
})();

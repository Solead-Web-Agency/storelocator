/* ==========================================================================
   Store locator PCS — application
   Tout ce qui est susceptible de changer (URLs, textes, zooms) est dans CONFIG.
   ========================================================================== */
(() => {
  "use strict";

  const CONFIG = {
    dataUrl: "data/stores.json",
    // Fond de carte clair, gratuit et sans clé (OpenFreeMap, style "positron").
    mapStyle: "https://tiles.openfreemap.org/styles/positron",
    // Géocodeur adresses France (Géoplateforme IGN) + repli sur l'ancienne API BAN.
    geocoders: [
      "https://data.geopf.fr/geocodage/search",
      "https://api-adresse.data.gouv.fr/search/",
    ],
    openAccountUrl: "https://www.mypcs.com/",
    // true : molette = défilement de la page, Ctrl/⌘ + molette = zoom ; deux doigts sur mobile.
    // Recommandé en iframe pour ne pas bloquer le défilement de la page Webflow.
    cooperativeGestures: true,
    initialCenter: [2.5, 46.6],
    initialZoom: 5.2,
    maxZoom: 18,
    listMinZoom: 9,          // en dessous, on invite à zoomer / chercher
    pageSize: 40,            // cartes affichées avant "Afficher plus"
    zoomByPlaceType: { municipality: 12, locality: 14, street: 14, housenumber: 15, default: 13 },
    geolocZoom: 13,
    pins: { 1: "#7a7a7a", 2: "#e3262b" },
    clusterColor: "#2b2b2b",
    labels: {
      loading: "Chargement des points de vente…",
      loadError: "Impossible de charger les points de vente. Réessayez plus tard.",
      hint: (total) => `${total} points de vente en France. Recherchez une ville ou zoomez sur la carte.`,
      inView: (n) => n === 0 ? "Aucun point de vente dans cette zone." : `${n} point${n > 1 ? "s" : ""} de vente dans cette zone.`,
      nearOrigin: (n) => `${n} point${n > 1 ? "s" : ""} de vente autour de votre recherche.`,
      noFilter: "Sélectionnez un service dans la légende.",
      notFound: "Adresse introuvable. Essayez une ville ou un code postal.",
      geocodeError: "Le service de recherche est indisponible. Réessayez.",
      geolocDenied: "Géolocalisation refusée. Saisissez une ville ou une adresse.",
      geolocError: "Position indisponible. Saisissez une ville ou une adresse.",
      copied: "Adresse copiée",
      copy: "Copier l'adresse",
      route: "Itinéraire",
    },
  };

  // ---------- DOM ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"), form: $("search-form"), input: $("search-input"), suggest: $("suggestions"),
    geoloc: $("geoloc-btn"), status: $("status"), list: $("list"), more: $("more"),
    legend: $("legend"), tpl: $("tpl-card"), openAccount: $("open-account"),
  };
  el.openAccount.href = CONFIG.openAccountUrl;

  // ---------- État -----------------------------------------------------------
  const state = {
    stores: [],            // {id, type, address, cp, city, lng, lat}
    byId: new Map(),
    types: {},             // {1: "Recharge", 2: "..."}
    filter: { 1: true, 2: true },
    origin: null,          // [lng, lat] de la recherche / géoloc
    selectedId: null,
    visible: [],           // résultats courants (triés)
    shown: 0,              // nb de cartes rendues
    mapReady: false,
  };

  let map, popup, originMarker;

  const nf = new Intl.NumberFormat("fr-FR");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const setStatus = (msg, isError = false) => { el.status.textContent = msg; el.status.classList.toggle("is-error", isError); };

  // ---------- Données --------------------------------------------------------
  async function loadData() {
    const res = await fetch(CONFIG.dataUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    state.types = json.types || { 1: "Recharge", 2: "Recharge, Vente de carte" };
    state.stores = json.stores.map(([id, type, address, cp, city, lng, lat]) => ({ id, type, address, cp, city, lng, lat }));
    state.byId = new Map(state.stores.map((s) => [s.id, s]));
  }

  function toGeoJSON(stores) {
    return {
      type: "FeatureCollection",
      features: stores.map((s) => ({
        type: "Feature",
        id: s.id,
        properties: { id: s.id, type: s.type },
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      })),
    };
  }

  const filteredStores = () => state.stores.filter((s) => state.filter[s.type]);
  const servicesOf = (s) => state.types[s.type] || "";
  const servicesLines = (s) => servicesOf(s).split(",").map((x) => x.trim()).filter(Boolean);
  const routeUrl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
  const fullAddress = (s) => `${s.address}, ${s.cp} ${s.city}`;

  // ---------- Distance -------------------------------------------------------
  function distanceKm([lng1, lat1], [lng2, lat2]) {
    const R = 6371, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const fmtDist = (km) => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace(".", ",")} km`;

  // ---------- Carte ----------------------------------------------------------
  function pinSvg(color) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 1C6.8 1 1 6.7 1 13.8 1 23.5 14 35 14 35s13-11.5 13-21.2C27 6.7 21.2 1 14 1z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="5" fill="#fff"/></svg>`;
  }
  function loadImage(svg, w, h) {
    return new Promise((resolve, reject) => {
      const img = new Image(w * 2, h * 2);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }

  async function initMap() {
    map = new maplibregl.Map({
      container: "map",
      style: CONFIG.mapStyle,
      center: CONFIG.initialCenter,
      zoom: CONFIG.initialZoom,
      maxZoom: CONFIG.maxZoom,
      attributionControl: { compact: true },
      cooperativeGestures: CONFIG.cooperativeGestures,
      locale: {
        "NavigationControl.ZoomIn": "Zoom avant",
        "NavigationControl.ZoomOut": "Zoom arrière",
        "AttributionControl.ToggleAttribution": "Afficher les sources",
        "Popup.Close": "Fermer",
        "CooperativeGesturesHandler.WindowsHelpText": "Utilisez Ctrl + molette pour zoomer la carte",
        "CooperativeGesturesHandler.MacHelpText": "Utilisez ⌘ + molette pour zoomer la carte",
        "CooperativeGesturesHandler.MobileHelpText": "Utilisez deux doigts pour déplacer la carte",
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.touchPitch.disable();
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    await new Promise((r) => map.once("load", r));

    for (const [type, color] of Object.entries(CONFIG.pins)) {
      map.addImage(`pin-${type}`, await loadImage(pinSvg(color), 28, 36), { pixelRatio: 2 });
    }

    map.addSource("stores", {
      type: "geojson",
      data: toGeoJSON(filteredStores()),
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 48,
    });

    map.addLayer({
      id: "clusters", type: "circle", source: "stores", filter: ["has", "point_count"],
      paint: {
        "circle-color": CONFIG.clusterColor,
        "circle-radius": ["step", ["get", "point_count"], 16, 50, 20, 500, 25, 5000, 30],
        "circle-stroke-width": 3,
        "circle-stroke-color": "rgba(255,255,255,0.9)",
      },
    });
    map.addLayer({
      id: "cluster-count", type: "symbol", source: "stores", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] },
      paint: { "text-color": "#fff" },
    });
    map.addLayer({
      id: "points", type: "symbol", source: "stores", filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["concat", "pin-", ["to-string", ["get", "type"]]],
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": 1,
        // Les pins "vente de carte" passent au-dessus des pins gris.
        "symbol-sort-key": ["case", ["==", ["to-number", ["get", "type"]], 2], 1, 0],
      },
    });
    applySelectedStyle();

    map.on("click", "clusters", async (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      if (!f) return;
      const zoom = await map.getSource("stores").getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom + 0.5, CONFIG.maxZoom) });
    });
    map.on("click", "points", (e) => {
      const f = e.features && e.features[0];
      if (f) select(f.properties.id, { fromMap: true });
    });
    for (const layer of ["clusters", "points"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    map.on("moveend", refreshList);

    state.mapReady = true;
  }

  function applySelectedStyle() {
    if (!map || !map.getLayer("points")) return;
    const sel = state.selectedId ?? -1;
    const isSel = ["==", ["to-number", ["get", "id"]], sel];
    const isCard = ["==", ["to-number", ["get", "type"]], 2];
    map.setLayoutProperty("points", "icon-size", ["case", isSel, 1.3, 1]);
    map.setLayoutProperty("points", "symbol-sort-key", ["case", isSel, 2, isCard, 1, 0]);
  }

  function updateMapData() {
    if (!state.mapReady) return;
    map.getSource("stores").setData(toGeoJSON(filteredStores()));
  }

  // ---------- Liste ----------------------------------------------------------
  function refreshList() {
    if (!state.mapReady) return;
    if (!state.filter[1] && !state.filter[2]) {
      state.visible = []; renderList(true); setStatus(CONFIG.labels.noFilter); return;
    }
    const zoom = map.getZoom();
    if (zoom < CONFIG.listMinZoom && !state.origin) {
      state.visible = []; renderList(true);
      setStatus(CONFIG.labels.hint(nf.format(state.stores.length)));
      return;
    }

    const b = map.getBounds();
    const originInView = state.origin && b.contains(state.origin);
    const c = map.getCenter();
    const ref = originInView ? state.origin : [c.lng, c.lat];

    const inView = [];
    for (const s of state.stores) {
      if (!state.filter[s.type]) continue;
      if (s.lng < b.getWest() || s.lng > b.getEast() || s.lat < b.getSouth() || s.lat > b.getNorth()) continue;
      s.dist = distanceKm(ref, [s.lng, s.lat]);
      inView.push(s);
    }
    inView.sort((a, b2) => a.dist - b2.dist);
    state.visible = inView;
    setStatus(originInView ? CONFIG.labels.nearOrigin(nf.format(inView.length)) : CONFIG.labels.inView(nf.format(inView.length)));
    renderList(true);
  }

  function renderList(reset) {
    if (reset) { el.list.innerHTML = ""; state.shown = 0; }
    const slice = state.visible.slice(state.shown, state.shown + CONFIG.pageSize);
    const frag = document.createDocumentFragment();
    for (const s of slice) frag.appendChild(buildCard(s));
    el.list.appendChild(frag);
    state.shown += slice.length;
    el.more.hidden = state.shown >= state.visible.length;
    highlightCard();
  }

  function buildCard(s) {
    const node = el.tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = s.id;
    node.dataset.type = s.type;
    node.querySelector(".sl-card__title").textContent = "PCS Store";
    node.querySelector(".sl-card__addr").innerHTML = `${esc(s.address)}<br>${esc(s.cp)} ${esc(s.city)}`;
    node.querySelector(".sl-card__services").innerHTML = servicesLines(s).map(esc).join("<br>");
    node.querySelector(".sl-card__dist").textContent = s.dist != null ? `à ${fmtDist(s.dist)}` : "";
    node.querySelector('[data-action="route"]').href = routeUrl(s);
    return node;
  }

  function highlightCard() {
    for (const li of el.list.children) li.classList.toggle("is-selected", Number(li.dataset.id) === state.selectedId);
  }

  el.list.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="show"]');
    if (!btn) return;
    const id = Number(btn.closest(".sl-card").dataset.id);
    setView("map");
    select(id, { fly: true });
  });
  el.more.addEventListener("click", () => renderList(false));

  // ---------- Sélection + popup ---------------------------------------------
  function select(id, { fromMap = false, fly = false } = {}) {
    const s = state.byId.get(id);
    if (!s) return;
    state.selectedId = id;
    applySelectedStyle();
    highlightCard();

    if (fromMap) {
      // La carte n'est peut-être pas dans la liste (pagination) : on l'ajoute en tête.
      let li = el.list.querySelector(`[data-id="${id}"]`);
      if (!li) { li = buildCard(s); el.list.prepend(li); li.classList.add("is-selected"); }
      li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    openPopup(s);
    if (fly) {
      map.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 15), speed: 1.4 });
    }
  }

  function openPopup(s) {
    if (popup) popup.remove();
    const html = `
      <div class="sl-pop">
        <h3>PCS Store</h3>
        <p>${esc(s.address)}<br>${esc(s.cp)} ${esc(s.city)}</p>
        <p class="sl-pop__services">${esc(servicesOf(s))}</p>
        <div class="sl-pop__actions">
          <a class="sl-btn" href="${routeUrl(s)}" target="_blank" rel="noopener">${esc(CONFIG.labels.route)}</a>
          <button type="button" class="sl-btn" data-action="copy">${esc(CONFIG.labels.copy)}</button>
        </div>
      </div>`;
    popup = new maplibregl.Popup({ offset: [0, -36], maxWidth: "280px", focusAfterOpen: false })
      .setLngLat([s.lng, s.lat])
      .setHTML(html)
      .addTo(map);
    popup.getElement().querySelector('[data-action="copy"]').addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText(fullAddress(s)); e.target.textContent = CONFIG.labels.copied; }
      catch { /* presse-papiers indisponible (http, permissions) */ }
    });
    popup.on("close", () => {
      if (state.selectedId === s.id) { state.selectedId = null; applySelectedStyle(); highlightCard(); }
    });
  }

  // ---------- Recherche (géocodage) -----------------------------------------
  async function geocode(q, { autocomplete = false, limit = 1 } = {}) {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (autocomplete) params.set("autocomplete", "1");
    let lastErr;
    for (const base of CONFIG.geocoders) {
      try {
        const res = await fetch(`${base}?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return json.features || [];
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  function setOrigin(lngLat) {
    state.origin = lngLat;
    if (!originMarker) {
      const dot = document.createElement("div");
      dot.style.cssText = "width:14px;height:14px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 2px rgba(26,115,232,.35)";
      originMarker = new maplibregl.Marker({ element: dot });
    }
    originMarker.setLngLat(lngLat).addTo(map);
  }

  async function search(q) {
    q = q.trim();
    if (q.length < 2) return;
    hideSuggestions();
    setStatus("Recherche…");
    try {
      const [f] = await geocode(q, { limit: 1 });
      if (!f) { setStatus(CONFIG.labels.notFound, true); return; }
      goToPlace(f);
    } catch {
      setStatus(CONFIG.labels.geocodeError, true);
    }
  }

  function goToPlace(feature) {
    const [lng, lat] = feature.geometry.coordinates;
    const zoom = CONFIG.zoomByPlaceType[feature.properties.type] ?? CONFIG.zoomByPlaceType.default;
    setOrigin([lng, lat]);
    state.selectedId = null; if (popup) popup.remove();
    map.flyTo({ center: [lng, lat], zoom, speed: 1.6, essential: true });
    // refreshList est déclenché par "moveend".
  }

  // Suggestions
  let debounceTimer, activeIndex = -1, suggestions = [];
  el.input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = el.input.value.trim();
    if (q.length < 3) { hideSuggestions(); return; }
    debounceTimer = setTimeout(async () => {
      try {
        suggestions = await geocode(q, { autocomplete: true, limit: 5 });
        showSuggestions();
      } catch { hideSuggestions(); }
    }, 250);
  });

  function showSuggestions() {
    activeIndex = -1;
    if (!suggestions.length) { hideSuggestions(); return; }
    el.suggest.innerHTML = suggestions.map((f, i) => {
      const p = f.properties;
      const main = p.type === "municipality" ? `${p.city} (${p.postcode})` : p.name;
      const sub = p.type === "municipality" ? p.context : `${p.postcode} ${p.city}`;
      return `<li role="option" data-i="${i}" aria-selected="false">${esc(main)}<small>${esc(sub)}</small></li>`;
    }).join("");
    el.suggest.hidden = false;
    el.input.setAttribute("aria-expanded", "true");
  }
  function hideSuggestions() {
    el.suggest.hidden = true; el.suggest.innerHTML = ""; activeIndex = -1;
    el.input.setAttribute("aria-expanded", "false");
  }
  function pickSuggestion(i) {
    const f = suggestions[i];
    if (!f) return;
    el.input.value = f.properties.label;
    hideSuggestions();
    goToPlace(f);
  }
  el.suggest.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); pickSuggestion(Number(li.dataset.i)); }
  });
  el.input.addEventListener("keydown", (e) => {
    if (el.suggest.hidden) return;
    const items = [...el.suggest.children];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.setAttribute("aria-selected", String(i === activeIndex)));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault(); pickSuggestion(activeIndex);
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  });
  el.input.addEventListener("blur", () => setTimeout(hideSuggestions, 150));
  el.form.addEventListener("submit", (e) => { e.preventDefault(); search(el.input.value); });

  // ---------- Géolocalisation ------------------------------------------------
  el.geoloc.addEventListener("click", () => {
    if (!navigator.geolocation) { setStatus(CONFIG.labels.geolocError, true); return; }
    el.geoloc.classList.add("is-busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        el.geoloc.classList.remove("is-busy");
        const lngLat = [pos.coords.longitude, pos.coords.latitude];
        el.input.value = "";
        setOrigin(lngLat);
        state.selectedId = null; if (popup) popup.remove();
        map.flyTo({ center: lngLat, zoom: CONFIG.geolocZoom, speed: 1.6, essential: true });
      },
      (err) => {
        el.geoloc.classList.remove("is-busy");
        setStatus(err.code === err.PERMISSION_DENIED ? CONFIG.labels.geolocDenied : CONFIG.labels.geolocError, true);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });

  // ---------- Légende = filtre ----------------------------------------------
  // Clic sur un service : n'afficher que celui-ci ; re-clic : tout réafficher.
  el.legend.addEventListener("click", (e) => {
    const btn = e.target.closest(".sl-legend__item");
    if (!btn) return;
    const t = Number(btn.dataset.type), other = t === 1 ? 2 : 1;
    if (state.filter[t] && !state.filter[other]) { state.filter[1] = state.filter[2] = true; }
    else { state.filter[t] = true; state.filter[other] = false; }
    for (const b of el.legend.querySelectorAll(".sl-legend__item")) {
      b.setAttribute("aria-pressed", String(state.filter[Number(b.dataset.type)]));
    }
    if (state.selectedId && !state.filter[state.byId.get(state.selectedId).type]) {
      state.selectedId = null; if (popup) popup.remove();
    }
    updateMapData();
    refreshList();
  });

  // ---------- Onglets mobile -------------------------------------------------
  function setView(view) {
    el.app.dataset.view = view;
    for (const b of el.app.querySelectorAll(".sl-tabs [role=tab]")) b.setAttribute("aria-selected", String(b.dataset.view === view));
    if (map) requestAnimationFrame(() => map.resize());
  }
  el.app.querySelector(".sl-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) setView(b.dataset.view);
  });
  window.addEventListener("resize", () => map && map.resize());

  // ---------- Démarrage ------------------------------------------------------
  (async () => {
    try {
      setStatus(CONFIG.labels.loading);
      await Promise.all([loadData(), initMap()]);
      updateMapData();
      refreshList();
      // Petite API publique (debug, ou pilotage depuis la page parente via postMessage si besoin).
      window.storeLocator = { map, search, select, state, CONFIG };
      const q = new URLSearchParams(location.search).get("q");
      if (q) { el.input.value = q; search(q); }
    } catch (e) {
      console.error(e);
      setStatus(CONFIG.labels.loadError, true);
    }
  })();
})();

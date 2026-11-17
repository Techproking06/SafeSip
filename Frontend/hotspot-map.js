/* SafeSip district atlas.
   Real Assam district geometry (generated from public WGS84 boundaries) with a
   data-driven heat layer, glowing markers, pan/zoom and glass popovers. */
(function () {
  const geo = window.ASSAM_GEO;
  if (!geo) return;

  const NS = "http://www.w3.org/2000/svg";
  const MONITORED = new Set(geo.monitored);
  const LENSES = {
    composite: { label: "Composite risk", title: "Composite risk index" },
    cases: { label: "Case burden", title: "Cases in selection" },
    flood: { label: "Flood exposure", title: "Flood-exposed records" },
    stagnant: { label: "Stagnant water", title: "High stagnant-water records" }
  };

  const HEAT = [
    [12, 79, 91],
    [26, 135, 140],
    [201, 151, 67],
    [226, 91, 63]
  ];

  /* Sonar nodes are keyed to the risk band, not the interpolated heat. */
  const BAND_COLOR = {
    Low: "#2dd4bf",
    Medium: "#e8b84b",
    High: "#f4633a"
  };

  let container = null;
  let svg = null;
  let pan = null;
  let districtLayer = null;
  let markerLayer = null;
  let popover = null;
  let tooltip = null;
  let getRows = () => [];
  let getState = () => ({ district: "all", disease: "ALL" });
  let onFilter = null;
  let onHover = null;
  let lens = "composite";
  let selected = null;
  let transform = { k: 1, x: 0, y: 0 };
  let dragging = null;
  let dragged = false;
  let riskByName = new Map();
  let pathByName = new Map();
  let markerByName = new Map();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    if (attrs) {
      Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    }
    return node;
  }

  function colorFor(t) {
    const value = clamp(t, 0, 1);
    const scaled = value * (HEAT.length - 1);
    const index = Math.min(HEAT.length - 2, Math.floor(scaled));
    const mix = scaled - index;
    const from = HEAT[index];
    const to = HEAT[index + 1];
    const rgb = from.map((channel, i) => Math.round(channel + (to[i] - channel) * mix));
    return {
      rgb,
      fill: `rgba(${rgb.join(", ")}, ${(0.22 + value * 0.55).toFixed(2)})`,
      stroke: `rgba(${rgb.join(", ")}, ${(0.45 + value * 0.45).toFixed(2)})`,
      solid: `rgb(${rgb.join(", ")})`
    };
  }

  function metric(district, key) {
    if (!district) return 0;
    if (key === "cases") return district.diseaseCases;
    if (key === "flood") return district.floodShare;
    if (key === "stagnant") return district.stagnantShare;
    return district.index;
  }

  function buildSvg() {
    svg = svgEl("svg", {
      class: "map-svg",
      viewBox: geo.viewBox,
      role: "img",
      "aria-label": `District risk atlas of Assam. ${geo.monitored.length} monitored districts. Use the district markers for details.`
    });

    const defs = svgEl("defs");
    defs.innerHTML = `
      <radialGradient id="map-vignette" cx="50%" cy="42%" r="62%">
        <stop offset="0%" stop-color="#0b3a45" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#04141c" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="hotspot-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fff8ec" stop-opacity="0.9"/>
        <stop offset="28%" stop-color="#ffffff" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="map-sheen" x1="0" y1="0" x2="0.65" y2="1">
        <stop offset="0%" stop-color="#eaf7f8" stop-opacity="0.14"/>
        <stop offset="46%" stop-color="#eaf7f8" stop-opacity="0"/>
      </linearGradient>`;
    svg.appendChild(defs);

    const backdrop = svgEl("rect", {
      x: 0,
      y: 0,
      width: 640,
      height: 620,
      class: "map-backdrop",
      fill: "url(#map-vignette)"
    });
    backdrop.addEventListener("click", () => select(null));
    svg.appendChild(backdrop);

    pan = svgEl("g", { class: "map-pan" });

    const graticule = svgEl("g", { class: "map-graticule", "aria-hidden": "true" });
    for (let x = 80; x < 640; x += 96) {
      graticule.appendChild(svgEl("line", { x1: x, y1: 0, x2: x, y2: 620 }));
    }
    for (let y = 70; y < 620; y += 96) {
      graticule.appendChild(svgEl("line", { x1: 0, y1: y, x2: 640, y2: y }));
    }
    pan.appendChild(graticule);

    districtLayer = svgEl("g", { class: "map-districts" });
    geo.districts.forEach((district) => {
      const monitored = MONITORED.has(district.name);
      const path = svgEl("path", {
        d: district.d,
        class: `map-district${monitored ? " is-monitored" : " is-context"}`,
        "data-district": district.name,
        "aria-hidden": "true"
      });
      if (monitored) {
        path.addEventListener("click", (event) => {
          if (dragged) return;
          event.stopPropagation();
          select(district.name, true);
        });
        path.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select(district.name, true);
          }
        });
        path.addEventListener("pointerenter", (event) => {
          showTooltip(district.name, event);
          onHover?.(district.name);
        });
        path.addEventListener("pointerleave", () => {
          hideTooltip();
          onHover?.(null);
        });
      }
      pathByName.set(district.name, path);
      districtLayer.appendChild(path);
    });
    pan.appendChild(districtLayer);

    markerLayer = svgEl("g", { class: "map-markers" });
    geo.districts
      .filter((district) => MONITORED.has(district.name))
      .forEach((district, index) => {
        const group = svgEl("g", {
          class: "hotspot",
          "data-district": district.name,
          tabindex: "0",
          role: "button",
          "aria-label": `${district.name} hotspot marker. Activate for details.`
        });
        const halo = svgEl("circle", {
          class: "hotspot-halo",
          cx: district.cx,
          cy: district.cy,
          r: 18,
          fill: "url(#hotspot-glow)"
        });
        halo.style.animationDelay = `${(index * 0.45).toFixed(2)}s`;
        const ring = svgEl("circle", {
          class: "hotspot-ring",
          cx: district.cx,
          cy: district.cy,
          r: 12
        });
        ring.style.animationDelay = `${(index * 0.45).toFixed(2)}s`;
        const core = svgEl("circle", {
          class: "hotspot-core",
          cx: district.cx,
          cy: district.cy,
          r: 4.2
        });
        const hit = svgEl("circle", {
          class: "hotspot-hit",
          cx: district.cx,
          cy: district.cy,
          r: 24
        });
        group.append(halo, ring, core, hit);
        group.addEventListener("pointerenter", (event) => {
          showTooltip(district.name, event);
          onHover?.(district.name);
        });
        group.addEventListener("pointerleave", () => {
          if (selected !== district.name) hideTooltip();
          onHover?.(null);
        });
        group.addEventListener("focus", () => showTooltip(district.name));
        group.addEventListener("blur", () => {
          if (selected !== district.name) hideTooltip();
        });
        group.addEventListener("click", (event) => {
          if (dragged) return;
          event.stopPropagation();
          select(district.name, true);
        });
        group.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select(district.name, true);
          }
        });
        markerByName.set(district.name, { group, halo, ring, core });
        markerLayer.appendChild(group);
      });
    pan.appendChild(markerLayer);
    svg.appendChild(pan);

    const sheen = svgEl("rect", {
      x: 0,
      y: 0,
      width: 640,
      height: 620,
      fill: "url(#map-sheen)",
      "pointer-events": "none"
    });
    svg.appendChild(sheen);
    container.prepend(svg);
  }

  function buildOverlays() {
    tooltip = el("div", "map-tooltip");
    tooltip.hidden = true;
    tooltip.setAttribute("aria-hidden", "true");
    container.appendChild(tooltip);

    popover = el("div", "map-popover");
    popover.hidden = true;
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "District risk details");
    popover.innerHTML = `
      <div class="map-popover-head">
        <div>
          <p class="map-popover-kicker">District signal</p>
          <h4 class="map-popover-title"></h4>
        </div>
        <button class="map-popover-close" type="button" aria-label="Close district details">×</button>
      </div>
      <div class="map-popover-score">
        <strong class="map-popover-index"></strong>
        <span class="map-popover-band"></span>
      </div>
      <dl class="map-popover-grid"></dl>
      <div class="map-popover-actions">
        <button class="map-action map-action--primary" type="button" data-action="filter">Filter charts</button>
        <button class="map-action" type="button" data-action="focus">Zoom to district</button>
      </div>
      <p class="map-popover-note">Composite of historical case burden, flood exposure, stagnant-water risk and rainfall. Descriptive, not predictive.</p>
    `;
    container.appendChild(popover);
    popover.querySelector(".map-popover-close").addEventListener("click", () => select(null));
    popover.querySelector('[data-action="filter"]').addEventListener("click", () => {
      if (!selected || !onFilter) return;
      onFilter(selected);
    });
    popover.querySelector('[data-action="focus"]').addEventListener("click", () => {
      if (selected) focusDistrict(selected);
    });
  }

  function showTooltip(name, event) {
    const district = riskByName.get(name);
    const marker = markerByName.get(name);
    if (!district || !marker || !tooltip) return;
    const rect = container.getBoundingClientRect();
    const targetRect = marker.group.getBoundingClientRect();
    tooltip.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <em class="map-hud-score">${district.index}<small>/100 · ${escapeHtml(district.band)} band</small></em>
      <span class="map-hud-row"><i>Composite risk</i><b>${district.index}</b></span>
      <span class="map-hud-row"><i>Flood vulnerability</i><b>${district.floodShare.toFixed(1)}%</b></span>
      <span class="map-hud-row"><i>Stagnant-water score</i><b>${district.stagnantShare.toFixed(1)}%</b></span>`;
    tooltip.hidden = false;
    const width = 208;
    let left = targetRect.left - rect.left + targetRect.width / 2 - width / 2;
    left = clamp(left, 10, rect.width - width - 10);
    let top = targetRect.top - rect.top - 52;
    if (top < 8) top = targetRect.bottom - rect.top + 10;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  function select(name, open = false) {
    selected = name;
    markerByName.forEach((marker, key) => {
      marker.group.classList.toggle("is-selected", key === name);
    });
    pathByName.forEach((path, key) => {
      path.classList.toggle("is-selected", key === name);
    });
    if (!name) {
      if (popover) popover.hidden = true;
      hideTooltip();
      return;
    }
    if (open) openPopover(name);
  }

  /* List rows can push a district onto the map (neon aura + sonar boost). */
  function highlight(name) {
    pathByName.forEach((path, key) => path.classList.toggle("is-hover", key === name));
    markerByName.forEach((marker, key) => marker.group.classList.toggle("is-hover", key === name));
  }

  function openPopover(name) {
    const district = riskByName.get(name);
    const marker = markerByName.get(name);
    if (!district || !marker || !popover) return;
    const state = getState();
    popover.querySelector(".map-popover-title").textContent = district.name;
    popover.querySelector(".map-popover-index").textContent = district.index;
    const band = popover.querySelector(".map-popover-band");
    band.textContent = `${district.band} band`;
    band.dataset.band = district.band;
    const rows = [
      ["Cases · selection", `${format(district.diseaseCases)} ${SafeSipAnalytics.diseaseLabel(state.disease).toLowerCase()}`],
      ["Diarrhea cases", format(district.diarrhea)],
      ["Mean rainfall", `${district.rain.toFixed(1)} mm`],
      ["Flood-exposed", `${district.floodShare.toFixed(1)}%`],
      ["High stagnant risk", `${district.stagnantShare.toFixed(1)}%`],
      ["Top block", district.topBlock],
      ["Records", format(district.records)]
    ];
    const grid = popover.querySelector(".map-popover-grid");
    grid.replaceChildren(
      ...rows.map(([label, value]) => {
        const wrap = el("div");
        const dt = el("dt");
        const dd = el("dd");
        dt.textContent = label;
        dd.textContent = value;
        wrap.append(dt, dd);
        return wrap;
      })
    );
    popover.hidden = false;
    hideTooltip();
    placePopover(marker);
  }

  function placePopover(marker) {
    if (!popover || popover.hidden) return;
    const rect = container.getBoundingClientRect();
    const target = marker.group.getBoundingClientRect();
    const width = Math.min(310, rect.width - 24);
    let left = target.left - rect.left + target.width + 16;
    if (left + width > rect.width - 10) {
      left = target.left - rect.left - width - 16;
    }
    left = clamp(left, 10, Math.max(10, rect.width - width - 10));
    let top = target.top - rect.top - 20;
    top = clamp(top, 10, Math.max(10, rect.height - 260));
    popover.style.width = `${width}px`;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function format(value) {
    return Number(value || 0).toLocaleString("en-IN");
  }

  function applyTransform(animate = true) {
    if (!pan) return;
    const maxX = 320 * (transform.k - 1);
    const maxY = 310 * (transform.k - 1);
    transform.x = clamp(transform.x, -maxX, maxX);
    transform.y = clamp(transform.y, -maxY, maxY);
    pan.style.transition = animate ? "transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)" : "none";
    pan.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`;
    const selectedMarker = selected ? markerByName.get(selected) : null;
    if (selectedMarker) placePopover(selectedMarker);
  }

  function zoomBy(factor, animate = true) {
    transform.k = clamp(transform.k * factor, 1, 4.2);
    if (transform.k === 1) {
      transform.x = 0;
      transform.y = 0;
    }
    applyTransform(animate);
  }

  function focusDistrict(name) {
    const path = pathByName.get(name);
    if (!path) return;
    const box = path.getBBox();
    transform.k = 2.35;
    transform.x = -((box.x + box.width / 2) - 320) * (transform.k - 1);
    transform.y = -((box.y + box.height / 2) - 310) * (transform.k - 1);
    applyTransform(true);
  }

  function resetView() {
    transform = { k: 1, x: 0, y: 0 };
    applyTransform(true);
  }

  function setupZoom() {
    container.querySelectorAll("[data-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.zoom;
        if (action === "in") zoomBy(1.32);
        else if (action === "out") zoomBy(1 / 1.32);
        else resetView();
      });
    });

    svg.addEventListener(
      "wheel",
      (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        event.stopPropagation(); // keep Lenis/page scroll out of map zoom
        zoomBy(event.deltaY < 0 ? 1.09 : 0.92, false);
      },
      { passive: false }
    );

    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".hotspot")) return;
      dragging = { x: event.clientX, y: event.clientY, ox: transform.x, oy: transform.y };
      dragged = false;
      svg.setPointerCapture(event.pointerId);
      container.classList.add("is-panning");
    });
    svg.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      const scale = 640 / rect.width;
      const dx = (event.clientX - dragging.x) * scale;
      const dy = (event.clientY - dragging.y) * scale;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
      transform.x = dragging.ox + dx;
      transform.y = dragging.oy + dy;
      applyTransform(false);
    });
    const endDrag = (event) => {
      if (!dragging) return;
      dragging = null;
      container.classList.remove("is-panning");
      if (event && svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      window.setTimeout(() => {
        dragged = false;
      }, 0);
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);
    svg.addEventListener("pointerleave", (event) => {
      if (dragging && event.buttons === 0) endDrag(event);
    });
    svg.addEventListener("click", (event) => {
      if (event.target === svg || event.target.classList.contains("map-district")) {
        if (!event.target.classList.contains("is-monitored")) select(null);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && popover && !popover.hidden) select(null);
    });
  }

  function setupLens() {
    const lensBar = container.querySelector(".map-lens");
    let pill = null;
    if (lensBar) {
      pill = el("span", "map-lens__pill");
      pill.setAttribute("aria-hidden", "true");
      lensBar.prepend(pill);
    }
    const positionPill = () => {
      if (!lensBar || !pill) return;
      const active = lensBar.querySelector(".map-lens button.is-active");
      if (!active) return;
      pill.style.left = `${active.offsetLeft}px`;
      pill.style.width = `${active.offsetWidth}px`;
    };
    container.querySelectorAll("[data-lens]").forEach((button) => {
      button.addEventListener("click", () => {
        lens = button.dataset.lens;
        container.querySelectorAll("[data-lens]").forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", active ? "true" : "false");
        });
        positionPill();
        render();
      });
    });
    positionPill();
    window.addEventListener("resize", positionPill, { passive: true });
    window.setTimeout(positionPill, 300); // after fonts/layout settle
  }

  function render() {
    if (!svg) return;
    const rows = getRows() || [];
    const state = getState();
    const risk = SafeSipAnalytics.districtRisk(rows, state.disease);
    riskByName = new Map(risk.map((district) => [district.name, district]));

    const values = risk.map((district) => metric(district, lens));
    const max = Math.max(...values, 1);

    pathByName.forEach((path, name) => {
      path.classList.remove("is-hot", "is-dim");
      if (!MONITORED.has(name)) return;
      const district = riskByName.get(name);
      if (!district) {
        path.style.fill = "rgba(110, 201, 195, 0.05)";
        path.style.stroke = "rgba(150, 220, 212, 0.16)";
        return;
      }
      const value = metric(district, lens);
      const t = lens === "composite" ? value / 100 : value / max;
      const color = colorFor(t);
      path.style.fill = color.fill;
      path.style.stroke = color.stroke;
      path.dataset.value = String(value);
      path.classList.toggle("is-hot", lens === "composite" ? district.band === "High" : t > 0.72);
      if (state.district !== "all" && state.district !== name) path.classList.add("is-dim");
    });

    markerByName.forEach((marker, name) => {
      const district = riskByName.get(name);
      if (!district) {
        marker.group.style.opacity = "0";
        return;
      }
      marker.group.style.opacity = "1";
      const value = metric(district, lens);
      const t = lens === "composite" ? value / 100 : value / max;
      const bandColor = BAND_COLOR[district.band] || BAND_COLOR.Low;
      marker.core.style.fill = bandColor;
      marker.core.style.setProperty("--hotspot-color", bandColor);
      marker.ring.style.stroke = bandColor;
      marker.halo.style.opacity = String(0.28 + t * 0.55);
      marker.halo.setAttribute("r", String(14 + t * 16));
      marker.core.setAttribute("r", String(3.4 + t * 3.4));
      marker.ring.setAttribute("r", String(10 + t * 7));
      marker.group.dataset.band = district.band;
      marker.group.classList.toggle("is-hot", district.band === "High");
      marker.group.classList.toggle("is-dim", state.district !== "all" && state.district !== name);
      marker.group.setAttribute(
        "aria-label",
        `${name}, ${LENSES[lens].label} ${lens === "flood" || lens === "stagnant" ? `${value.toFixed(1)} percent` : Math.round(value)}, ${district.band} band. Activate for details.`
      );
    });

    const monitored = risk.length;
    const meta = document.getElementById("mapMeta");
    if (meta) meta.textContent = `${monitored} districts · ${format(rows.length)} records`;
    const period = document.getElementById("mapPeriod");
    if (period) period.textContent = `${state.from}—${state.to}`;

    const legendTitle = document.getElementById("mapLegendTitle");
    const legendMin = document.getElementById("mapLegendMin");
    const legendMax = document.getElementById("mapLegendMax");
    if (legendTitle) legendTitle.textContent = LENSES[lens].title;
    if (legendMin) legendMin.textContent = lens === "composite" ? "0" : "0";
    if (legendMax) {
      legendMax.textContent =
        lens === "composite"
          ? "100"
          : lens === "cases"
            ? format(Math.round(max))
            : `${max.toFixed(1)}%`;
    }

    container.classList.toggle("is-empty", !rows.length || !monitored);
    const empty = container.querySelector(".map-empty");
    if (empty) empty.hidden = Boolean(rows.length && monitored);

    if (selected) {
      if (!riskByName.has(selected)) {
        select(null);
      } else if (popover && !popover.hidden) {
        openPopover(selected);
      }
    }
  }

  function init(options) {
    container = options.container;
    getRows = options.getRows || getRows;
    getState = options.getState || getState;
    onFilter = options.onFilter || null;
    onHover = typeof options.onHover === "function" ? options.onHover : null;
    if (!container) return null;

    container.classList.add("map-ready");
    buildSvg();
    buildOverlays();
    setupZoom();
    setupLens();
    render();

    window.addEventListener("resize", () => {
      const marker = selected ? markerByName.get(selected) : null;
      if (marker) placePopover(marker);
    });

    return {
      render,
      select,
      resetView,
      highlight,
      setLens(next) {
        lens = LENSES[next] ? next : "composite";
        render();
      }
    };
  }

  window.SafeSipMap = { init };
})();

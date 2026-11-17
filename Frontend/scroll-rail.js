/* SafeSip scroll rail.
   A thin semicircular progress arc on the right viewport edge with tiny
   section markers. The native scrollbar is hidden only once this has mounted
   and measured the document. */
(function () {
  const LABELS = {
    top: "Top",
    submit: "Report",
    iot: "Sensors",
    dashboard: "Analytics",
    education: "Prevention",
    how: "How it works",
    team: "Team",
    workspace: "Workspace",
    signals: "Signals",
    burden: "Burden"
  };

  const NS = "http://www.w3.org/2000/svg";
  const W = 148;
  const H = 280;
  const CX = 146;
  const CY = 140;
  const R = 132;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const sections = [...document.querySelectorAll("main section[id]")].filter((section) => {
    const rect = section.getBoundingClientRect();
    return rect.height > 120;
  });
  if (!sections.length) return;

  const nav = document.createElement("nav");
  nav.className = "scroll-rail";
  nav.setAttribute("aria-label", "Page scroll progress and section navigation");
  nav.innerHTML = `
    <svg class="scroll-rail__arc" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="rail-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#35c4b5"/>
          <stop offset="55%" stop-color="#17a897"/>
          <stop offset="100%" stop-color="#c9973e"/>
        </linearGradient>
      </defs>
      <path class="rail-track" pathLength="1"></path>
      <path class="rail-progress" pathLength="1"></path>
    </svg>
    <div class="scroll-rail__markers"></div>
    <div class="scroll-rail__thumb" aria-hidden="true"></div>
  `;
  document.body.appendChild(nav);

  function pointAt(p) {
    const angle = (-90 - p * 180) * (Math.PI / 180);
    return [CX + R * Math.cos(angle), CY + R * Math.sin(angle)];
  }

  const d = Array.from({ length: 81 }, (_, i) => {
    const [x, y] = pointAt(i / 80);
    return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  nav.querySelectorAll(".rail-track, .rail-progress").forEach((path) => path.setAttribute("d", d));

  const markersHost = nav.querySelector(".scroll-rail__markers");
  const progressPath = nav.querySelector(".rail-progress");
  const thumb = nav.querySelector(".scroll-rail__thumb");
  const markerItems = [];
  let maxScroll = 1;
  let progress = 0;
  let ticking = false;
  let activeId = null;
  let positions = [];

  function setPercent(node, x, y) {
    node.style.left = `${(x / W) * 100}%`;
    node.style.top = `${(y / H) * 100}%`;
  }

  sections.forEach((section) => {
    const id = section.id;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rail-marker";
    button.dataset.target = id;
    button.setAttribute("aria-label", `Go to ${LABELS[id] || id}`);
    button.innerHTML = `<span class="rail-marker__dot" aria-hidden="true"></span><span class="rail-label" aria-hidden="true">${LABELS[id] || id}</span>`;
    button.addEventListener("click", () => {
      // Route through Lenis when active — native scrollIntoView gets reverted.
      const lenis = window.SafeSipLenis;
      if (lenis) lenis.scrollTo(section, { offset: -72, lerp: reduced ? 1 : 0.08 });
      else section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      section.setAttribute("tabindex", "-1");
      section.focus({ preventScroll: true });
    });
    markersHost.appendChild(button);
    markerItems.push({ id, button, section });
  });

  function measure() {
    maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    positions = markerItems.map(({ id, section, button }) => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      const p = clamp((top - 84) / maxScroll, 0.015, 0.985);
      const [x, y] = pointAt(p);
      setPercent(button, x, y);
      return { id, p, section, button };
    });
    const [tx, ty] = pointAt(progress);
    setPercent(thumb, tx, ty);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function activeSection() {
    let current = positions.length ? positions[0].id : null;
    for (const item of positions) {
      if (item.section.getBoundingClientRect().top <= 140) current = item.id;
    }
    return current;
  }

  function update() {
    ticking = false;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    progress = clamp(scrollTop / maxScroll, 0, 1);
    progressPath.style.strokeDasharray = "1 1";
    progressPath.style.strokeDashoffset = String(1 - progress);
    const [x, y] = pointAt(progress);
    setPercent(thumb, x, y);

    const nextActive = activeSection();
    if (nextActive !== activeId) {
      activeId = nextActive;
      markerItems.forEach((item) => {
        const isActive = item.id === activeId;
        item.button.classList.toggle("is-active", isActive);
        if (isActive) item.button.setAttribute("aria-current", "location");
        else item.button.removeAttribute("aria-current");
      });
    }
    nav.style.setProperty("--rail-progress", progress.toFixed(4));
  }

  function requestTick() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  function remeasure() {
    measure();
    requestTick();
  }

  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", remeasure, { passive: true });

  const wide = window.matchMedia("(min-width: 1024px)");
  const syncScrollbar = () => {
    document.documentElement.classList.toggle("has-scroll-rail", wide.matches);
  };
  if (wide.addEventListener) wide.addEventListener("change", syncScrollbar);
  else wide.addListener(syncScrollbar);

  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => remeasure());
    ro.observe(document.body);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(remeasure).catch(() => {});
  }

  // Only remove the native scrollbar after the custom rail has measured.
  measure();
  update();
  requestAnimationFrame(() => {
    measure();
    update();
    syncScrollbar();
    nav.classList.add("is-ready");
  });

  window.SafeSipScrollRail = {
    refresh: remeasure,
    get progress() {
      return progress;
    }
  };
})();

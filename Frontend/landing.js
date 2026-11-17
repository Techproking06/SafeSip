// Frontend/landing.js
// Landing-page behaviour. All data still comes from the same-origin API:
// /api/data, /api/stats, /api/predict and /api/send-alert.

const API_BASE_URL = "";

const DISEASE_COLUMNS = [
  "Cases_Diarrhea_ADD",
  "Cases_Dysentery",
  "Cases_Cholera",
  "Cases_Typhoid",
  "Cases_Hepatitis",
  "Cases_Giardiasis",
  "Cases_Skin_Infection",
  "Cases_Malaria",
  "Cases_JE_AES",
  "Cases_Dengue"
];

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// -------- Dataset --------

async function fetchDataset() {
  const res = await fetch(`${API_BASE_URL}/api/data`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchStats() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/stats`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Could not fetch /api/stats:", err);
    return null;
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function setApiStatus(isLive) {
  const chip = document.getElementById("heroApiStatus");
  if (!chip) return;
  chip.classList.toggle("is-offline", !isLive);
  chip.innerHTML = isLive
    ? '<span class="dot" aria-hidden="true"></span> API live'
    : '<span class="dot" aria-hidden="true"></span> API offline';
}

function renderDatasetTable(data, total) {
  const thead = document.getElementById("datasetTableHead");
  const tbody = document.getElementById("datasetTableBody");
  const errEl = document.getElementById("datasetError");
  const countEl = document.getElementById("datasetRowCount");
  if (!thead || !tbody) return;

  thead.textContent = "";
  tbody.textContent = "";
  if (errEl) {
    errEl.classList.add("hidden");
    errEl.textContent = "";
  }

  if (!Array.isArray(data) || !data.length) {
    if (errEl) {
      errEl.textContent = "No records match the selected filters.";
      errEl.classList.remove("hidden");
    }
    if (countEl) countEl.textContent = "No records match the selected filters";
    return;
  }

  const headers = Object.keys(data[0]);
  const headerRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const maxRows = 50;
  data.slice(0, maxRows).forEach((row) => {
    const tr = document.createElement("tr");
    headers.forEach((header) => {
      const td = document.createElement("td");
      td.textContent =
        row[header] === undefined || row[header] === null ? "—" : String(row[header]);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  if (countEl) {
    const scope =
      data.length === total ? `${formatNumber(total)} records` : `${formatNumber(data.length)} filtered`;
    countEl.textContent = `Showing ${Math.min(maxRows, data.length)} of ${scope}`;
  }
}

// -------- Hero snapshot --------

function averageRainfall(data) {
  let sum = 0;
  let count = 0;
  data.forEach((row) => {
    const rain = Number(row.Rainfall_mm);
    if (!Number.isNaN(rain)) {
      sum += rain;
      count += 1;
    }
  });
  return count ? sum / count : null;
}

function renderRainProfile(data) {
  const container = document.getElementById("heroRainBars");
  if (!container) return;

  const months = new Map();
  data.forEach((row) => {
    const key = row.Date ? String(row.Date).slice(0, 7) : "";
    const rain = Number(row.Rainfall_mm);
    if (!key || Number.isNaN(rain)) return;
    const entry = months.get(key) || { sum: 0, count: 0 };
    entry.sum += rain;
    entry.count += 1;
    months.set(key, entry);
  });

  const entries = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-24);
  if (!entries.length) return;

  const values = entries.map(([, value]) => value.sum / value.count);
  const max = Math.max(...values, 1);
  const bars = entries.map(([key, value], index) => {
    const bar = document.createElement("span");
    const mean = value.sum / value.count;
    bar.style.height = `${Math.max(6, (mean / max) * 100)}%`;
    bar.style.animationDelay = `${index * 18}ms`;
    bar.title = `${key}: ${mean.toFixed(1)} mm mean`;
    return bar;
  });
  container.replaceChildren(...bars);
}

function fillHeroSnapshot(data, stats) {
  const records = stats?.totalRecords ?? data.length;
  const avgRain = stats?.averageRainfall ?? averageRainfall(data);
  const diarrhea =
    stats?.totalDiarrheaCases ??
    data.reduce((sum, row) => sum + (Number(row.Cases_Diarrhea_ADD) || 0), 0);
  const districts = new Set(data.map((row) => row.District).filter(Boolean)).size;
  const blocks = new Set(data.map((row) => row.Block).filter(Boolean)).size;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set("heroRecords", formatNumber(records));
  set("statRecords", formatNumber(records));
  set("heroAvgRain", avgRain === null ? "—" : Number(avgRain).toFixed(1));
  set("heroDiarrhea", formatNumber(diarrhea));
  set("heroDistricts", districts);
  set("statDistricts", districts);
  set("statBlocks", blocks);
  set("statDiseases", DISEASE_COLUMNS.length);

  renderRainProfile(data);
  setApiStatus(true);
}

// -------- Hardware risk form --------

function setupHardwareRiskForm() {
  const form = document.getElementById("hardwareRiskForm");
  if (!form) return;

  const rainfallEl = document.getElementById("hardwareRainfall");
  const floodEl = document.getElementById("hardwareFloodStatus");
  const stagnantEl = document.getElementById("hardwareStagnantRisk");
  const resultBox = document.getElementById("hardwareResult");
  const resultText = document.getElementById("hardwareResultText");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      Rainfall_mm: rainfallEl?.value,
      Flood_Status: floodEl?.value,
      Stagnant_Water_Risk: stagnantEl?.value
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data = await res.json();
      if (resultBox && resultText) {
        const { riskScore, riskLevel } = data;
        let extra = "";
        if (riskLevel === "High") {
          extra =
            " Escalate alerts, investigate water sources and raise medical readiness.";
        } else if (riskLevel === "Medium") {
          extra = " Keep this area on the watchlist and increase sampling frequency.";
        } else if (riskLevel === "Low") {
          extra = " Continue routine monitoring and hygiene promotion.";
        }
        resultText.textContent = `Risk score ${riskScore} · ${riskLevel}.${extra}`;
        resultBox.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Error calling /api/predict:", err);
      if (resultBox && resultText) {
        resultText.textContent =
          "Could not reach /api/predict. Ensure the Node.js server is running.";
        resultBox.classList.remove("hidden");
      }
    }
  });
}

// -------- Risk assessment --------

const SOURCE_RISK = {
  "Municipal Tap": 0.03,
  "Hand Pump": 0.08,
  Borewell: 0.07,
  Tanker: 0.14,
  River: 0.2
};

const SYMPTOM_RISK = {
  diarrhea: 0.26,
  vomiting: 0.18,
  fever: 0.12,
  stomach: 0.12,
  nausea: 0.09,
  fatigue: 0.05
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function assessRisk(report) {
  let score = 0.05;

  report.symptoms.forEach((symptom) => {
    score += SYMPTOM_RISK[symptom] || 0;
  });
  if (report.symptoms.length >= 3) score += 0.06;

  score += SOURCE_RISK[report.waterSource] ?? 0.08;
  score += ((10 - report.hygiene) / 10) * 0.18;
  if (report.concerns) score += 0.08;

  score = clamp(score, 0.05, 0.98);

  let level = "Low";
  if (score >= 0.7) level = "High";
  else if (score >= 0.4) level = "Medium";

  return { score, level };
}

function setSessionId() {
  const el = document.getElementById("sessionId");
  if (!el) return;
  const id = Math.floor(Math.random() * 9000) + 1000;
  el.textContent = `HI25-${id}`;
}

function renderRisk(report, assessment) {
  const badge = document.getElementById("riskBadge");
  const title = document.getElementById("riskTitle");
  const subtitle = document.getElementById("riskSubtitle");
  const scoreEl = document.getElementById("riskScore");
  const factorsEl = document.getElementById("riskFactors");

  if (badge) {
    badge.className = "risk-badge";
    if (assessment.level === "Medium") badge.classList.add("is-medium");
    if (assessment.level === "High") badge.classList.add("is-high");
    badge.textContent = assessment.level.toUpperCase();
  }

  if (title) {
    title.textContent =
      assessment.level === "High"
        ? "High risk signal detected."
        : assessment.level === "Medium"
          ? "Medium risk — keep watching."
          : "Low risk — routine monitoring.";
  }

  if (subtitle) {
    const symptoms = report.symptoms.length
      ? report.symptoms.join(", ")
      : "no symptoms selected";
    subtitle.textContent = `${report.area || "Area not given"} · ${
      report.waterSource || "water source unknown"
    } · ${symptoms}.`;
  }

  if (scoreEl) scoreEl.textContent = assessment.score.toFixed(2);

  if (factorsEl) {
    const factors = [];
    if (report.symptoms.length) {
      factors.push(
        `${report.symptoms.length} symptom${
          report.symptoms.length === 1 ? "" : "s"
        } reported: ${report.symptoms.join(", ")}.`
      );
    }
    factors.push(`Water source: ${report.waterSource || "not specified"}.`);
    if (report.hygiene <= 4) {
      factors.push(`Low hygiene rating (${report.hygiene}/10) raises exposure risk.`);
    } else if (report.hygiene <= 6) {
      factors.push(`Moderate hygiene rating (${report.hygiene}/10).`);
    }
    if (report.concerns) factors.push("Water-quality concerns were described.");
    if (!report.symptoms.length && report.hygiene > 6 && !report.concerns) {
      factors.push("No elevated risk factors were identified.");
    }

    factorsEl.replaceChildren(
      ...factors.slice(0, 4).map((factor) => {
        const li = document.createElement("li");
        li.textContent = factor;
        return li;
      })
    );
  }
}

// -------- Alert pipeline --------

function setChannelStatus(channel, state, label) {
  const el = document.getElementById(`${channel}Status`);
  if (!el) return;
  el.dataset.state = state;
  const names = { sms: "SMS", email: "Email", control: "Control room" };
  el.textContent = `${names[channel] || channel} · ${label}`;
}

function addAlertLog(message) {
  const list = document.getElementById("alertLogList");
  if (!list) return;
  document.getElementById("alertEmptyState")?.remove();

  const li = document.createElement("li");
  const time = new Date().toLocaleTimeString("en-IN", { hour12: false });
  li.textContent = `${time} — ${message}`;
  list.prepend(li);
  while (list.children.length > 6) list.lastElementChild.remove();
}

function showAlertStatus(message) {
  const el = document.getElementById("alertStatusText");
  if (el) el.textContent = message;
}

function setAlertPreview(payload) {
  const el = document.getElementById("alertPreview");
  if (el) el.textContent = JSON.stringify(payload, null, 2);
}

async function handleAlertDispatch(payload, { test = false } = {}) {
  setAlertPreview(payload);
  setChannelStatus("sms", "sending", "Sending");
  setChannelStatus(
    "email",
    payload.email ? "sending" : "idle",
    payload.email ? "Sending" : "Not requested"
  );
  setChannelStatus("control", "logged", "Logged");

  try {
    const res = await fetch(`${API_BASE_URL}/api/send-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));

    if (res.status === 503 && body.code === "ALERTS_DISABLED") {
      setChannelStatus("sms", "disabled", "Disabled");
      setChannelStatus(
        "email",
        payload.email ? "disabled" : "idle",
        payload.email ? "Disabled" : "Not requested"
      );
      showAlertStatus(
        "Alert dispatch is disabled in this deployment. The report was assessed and logged in the browser only — no SMS or email was sent."
      );
      addAlertLog("Dispatch blocked by server · ALERTS_DISABLED.");
      return;
    }

    if (res.status === 401) {
      setChannelStatus("sms", "failed", "Auth required");
      setChannelStatus("email", payload.email ? "failed" : "idle", payload.email ? "Auth required" : "Not requested");
      showAlertStatus(
        "The server requires an x-alert-key header for real delivery. This public demo cannot send alerts."
      );
      addAlertLog("Dispatch rejected · ALERT_AUTH_REQUIRED.");
      return;
    }

    if (!res.ok) {
      setChannelStatus("sms", "failed", "Failed");
      setChannelStatus("email", payload.email ? "failed" : "idle", payload.email ? "Failed" : "Not requested");
      showAlertStatus(body.error || `Alert request failed (HTTP ${res.status}).`);
      addAlertLog(`Dispatch failed · ${body.error || `HTTP ${res.status}`}.`);
      return;
    }

    const channels = body.channels || {};
    setChannelStatus(
      "sms",
      channels.sms === "sent" ? "sent" : channels.sms === "failed" ? "failed" : "idle",
      channels.sms === "sent" ? "Sent" : channels.sms === "failed" ? "Failed" : "Not requested"
    );
    setChannelStatus(
      "email",
      channels.email === "sent" ? "sent" : channels.email === "failed" ? "failed" : "idle",
      channels.email === "sent" ? "Sent" : channels.email === "failed" ? "Failed" : "Not requested"
    );
    showAlertStatus(body.message || (test ? "Test alert dispatched." : "Alert dispatched."));
    addAlertLog(body.message || "Alert dispatched.");
  } catch (err) {
    console.error("Error calling /api/send-alert:", err);
    setChannelStatus("sms", "failed", "Unreachable");
    setChannelStatus("email", payload.email ? "failed" : "idle", payload.email ? "Unreachable" : "Not requested");
    showAlertStatus(
      "Could not reach /api/send-alert. The report stays in this browser; nothing was delivered."
    );
    addAlertLog("Dispatch unreachable · backend offline.");
  }
}

function buildAlertPayload(report, assessment) {
  return {
    name: report.name,
    area: report.area,
    phone: report.phone,
    email: report.email,
    riskLevel: assessment.level.toUpperCase(),
    riskScore: assessment.score.toFixed(2),
    symptoms: report.symptoms
  };
}

function collectReport() {
  const form = document.getElementById("healthForm");
  if (!form) return null;
  const data = new FormData(form);
  return {
    name: String(data.get("name") || "").trim(),
    age: String(data.get("age") || "").trim(),
    area: String(data.get("area") || "").trim(),
    phone: String(data.get("phone") || "").trim(),
    email: String(data.get("email") || "").trim(),
    waterSource: String(data.get("waterSource") || "").trim(),
    hygiene: Number(data.get("hygiene") || 5),
    symptoms: data.getAll("symptoms").map(String),
    concerns: String(data.get("concerns") || "").trim()
  };
}

function addReportRow(report, level) {
  const tbody = document.getElementById("reportsTable");
  if (!tbody) return;

  const tr = document.createElement("tr");
  const cells = [
    report.name || "Anonymous",
    report.area || "Unknown",
    report.waterSource || "Unknown",
    report.symptoms.length ? report.symptoms.join(", ") : "None reported"
  ];

  cells.forEach((value) => {
    const td = document.createElement("td");
    td.textContent = value;
    tr.appendChild(td);
  });

  const riskTd = document.createElement("td");
  const tag = document.createElement("span");
  tag.className = `risk-tag risk-tag--${level.toLowerCase()}`;
  tag.textContent = level;
  riskTd.appendChild(tag);
  tr.appendChild(riskTd);

  tbody.prepend(tr);
  while (tbody.children.length > 8) tbody.lastElementChild.remove();
}

function seedReports() {
  const reports = [
    ["Anjali Das", "Kaveri Nagar", "Hand Pump", "Diarrhea, fever", "Medium"],
    ["Rahul Bora", "Beltola", "Municipal Tap", "Nausea", "Low"],
    ["Mina Sheikh", "Dibrugarh", "River", "Diarrhea, vomiting", "High"]
  ];
  reports.reverse().forEach(([name, area, source, symptoms, level]) => {
    addReportRow(
      { name, area, waterSource: source, symptoms: symptoms.split(", ") },
      level
    );
  });
}

function setupHealthForm() {
  const form = document.getElementById("healthForm");
  if (!form) return;

  const hygiene = document.getElementById("hygiene");
  const hygieneValue = document.getElementById("hygieneValue");
  hygiene?.addEventListener("input", () => {
    if (hygieneValue) hygieneValue.textContent = `${hygiene.value} / 10`;
    hygiene.style.setProperty("--pct", `${(Number(hygiene.value) / 10) * 100}%`);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const report = collectReport();
    if (!report) return;

    const assessment = assessRisk(report);
    setSessionId();
    renderRisk(report, assessment);
    addReportRow(report, assessment.level);
    addAlertLog(
      `Report assessed · ${assessment.level.toUpperCase()} (${assessment.score.toFixed(2)}).`
    );

    await handleAlertDispatch(buildAlertPayload(report, assessment));
  });
}

function setupTestAlert() {
  const button = document.getElementById("testAlertBtn");
  if (!button) return;

  button.addEventListener("click", () => {
    const payload = {
      name: "Pipeline test",
      area: "Kaveri Nagar",
      phone: "9999999999",
      email: "",
      riskLevel: "LOW",
      riskScore: "0.12",
      symptoms: ["test"]
    };
    addAlertLog("Test dispatch requested.");
    handleAlertDispatch(payload, { test: true });
  });
}

// -------- Navigation and calls to action --------

function scrollToSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const lenis = window.SafeSipLenis;
  if (lenis) {
    lenis.scrollTo(target, { offset: -72, lerp: REDUCED_MOTION ? 1 : 0.08 });
    return;
  }
  target.scrollIntoView({
    behavior: REDUCED_MOTION ? "auto" : "smooth",
    block: "start"
  });
}

function setupNavigation() {
  const toggle = document.getElementById("navToggle");
  const menu = document.getElementById("mobileMenu");
  if (!toggle || !menu) return;

  const closeMenu = () => {
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
  };

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      closeMenu();
      return;
    }
    menu.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation");
  });

  menu.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) closeMenu();
  });

  // the menu lives inside the sticky header, so keep it from pinning open over the page
  window.addEventListener(
    "scroll",
    () => {
      if (menu.classList.contains("is-open")) closeMenu();
    },
    { passive: true }
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

function setupSignature() {
  document.querySelectorAll(".mark-sig").forEach((mark) => {
    mark.addEventListener("click", () => mark.focus());
  });
}

/* Pointer-driven light across the creator wordmark. Fine pointers aim it at the
   cursor; coarse pointers sweep it with scroll. Reduced motion keeps the static
   CSS gradient instead of running this. */
function setupWordmark() {
  const type = document.querySelector("[data-wordmark]");
  if (!type || REDUCED_MOTION) return;

  const section = type.closest(".wordmark") || type;
  const fine = window.matchMedia("(pointer: fine)");
  const pos = { x: 50, y: 50 };
  const goal = { x: 50, y: 50 };
  let running = false;
  let visible = false;
  let pointing = false;

  const aim = (clientX, clientY) => {
    const rect = type.getBoundingClientRect();
    goal.x = Math.min(120, Math.max(-20, ((clientX - rect.left) / rect.width) * 100));
    goal.y = Math.min(160, Math.max(-60, ((clientY - rect.top) / rect.height) * 100));
    start();
  };

  const sweep = () => {
    if (pointing) return;
    const rect = section.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight + rect.height)));
    goal.x = 12 + t * 76;
    goal.y = 50;
  };

  const tick = () => {
    if (!fine.matches) sweep();
    pos.x += (goal.x - pos.x) * 0.09;
    pos.y += (goal.y - pos.y) * 0.09;
    type.style.setProperty("--wx", `${pos.x.toFixed(2)}%`);
    type.style.setProperty("--wy", `${pos.y.toFixed(2)}%`);
    const settled = Math.abs(goal.x - pos.x) < 0.05 && Math.abs(goal.y - pos.y) < 0.05;
    if (visible && !(settled && fine.matches)) requestAnimationFrame(tick);
    else running = false;
  };

  function start() {
    if (running || !visible) return;
    running = true;
    requestAnimationFrame(tick);
  }

  section.addEventListener("pointermove", (event) => {
    pointing = event.pointerType !== "mouse" || fine.matches;
    aim(event.clientX, event.clientY);
  }, { passive: true });

  section.addEventListener("pointerleave", () => {
    pointing = false;
    goal.x = 50;
    goal.y = 50;
    start();
  });

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) {
      sweep();
      start();
    }
  }, { threshold: 0 }).observe(section);
}

/* Buttery momentum scroll via Lenis (CDN). Skipped for reduced motion or when
   the CDN is unreachable — native scrolling still works everywhere. */
function setupSmoothScroll() {
  if (REDUCED_MOTION || !window.Lenis) return;
  try {
    const lenis = new window.Lenis({ lerp: 0.115, smoothWheel: true, wheelMultiplier: 1.0 });
    // Lenis owns the scroll position, so native keyboard scrolling gets
    // reverted. Re-implement the page keys against lenis.scrollTo.
    document.addEventListener("keydown", (event) => {
      const tag = (event.target.tagName || "").toLowerCase();
      const editable = ["input", "textarea", "select"].includes(tag) || event.target.isContentEditable;
      if (editable || event.metaKey || event.ctrlKey || event.altKey) return;
      const page = window.innerHeight * 0.85;
      let target = null;
      if (event.key === "PageDown") target = window.scrollY + page;
      else if (event.key === "PageUp") target = window.scrollY - page;
      else if (event.key === " ") {
        // Space activates links/buttons — only hijack it elsewhere.
        if (["a", "button"].includes(tag)) return;
        target = window.scrollY + (event.shiftKey ? -page : page);
      } else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = document.documentElement.scrollHeight;
      if (target === null) return;
      event.preventDefault();
      lenis.scrollTo(target, { lerp: 0.115 });
    });
    const raf = (time) => {
      lenis.raf(time);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    window.SafeSipLenis = lenis;
  } catch (err) {
    console.warn("Lenis unavailable; using native scrolling.", err);
  }
}

/* Replay the donut sweep + count-up the center metric when it scrolls into view. */
function setupDonutReplay() {
  const canvas = document.getElementById("riskDonutChart");
  if (!canvas || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      const total = document.getElementById("donutTotal");
      const chart = window.Chart?.getChart(canvas);
      if (chart && !REDUCED_MOTION) {
        chart.reset();
        chart.update();
      }
      if (total) {
        const final = Number(total.textContent.replace(/[^\d.]/g, "")) || 6;
        total.textContent = "0";
        countUp(total, final);
      }
    });
  }, { threshold: 0.35 });
  io.observe(canvas);
}

function setupReveals() {
  if (REDUCED_MOTION || !("IntersectionObserver" in window)) return;

  const items = document.querySelectorAll(
    ".section-head, .panel, .chart-card, .prevention, .step, .person, .sensor-card, .sensor-panel, .iot-chart-panel, .readout, .dash-chart, .kpi, .provenance, .dash-section-head, .footer-main"
  );
  if (!items.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      io.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });

  items.forEach((el, index) => {
    el.setAttribute("data-reveal", "");
    el.style.setProperty("--d", `${(index % 4) * 70}ms`);
    io.observe(el);
  });
}

function setupCallsToAction() {
  const actions = [
    ["scrollToFormBtn", "submit"],
    ["primaryCtaBtn", "submit"],
    ["dashboardCtaBtn", "dashboard"],
    ["mobileFormBtn", "submit"]
  ];

  actions.forEach(([id, target]) => {
    document.getElementById(id)?.addEventListener("click", () => scrollToSection(target));
  });
}

// -------- District risk panel --------

let atlasMap = null;
let lastRiskDistricts = [];
let lastRiskState = null;

const COUNT_DURATION = 750;

function countUp(el, to) {
  if (!el) return;
  const target = Number(to) || 0;
  if (REDUCED_MOTION) {
    el.textContent = String(Math.round(target));
    return;
  }
  const start = Number(el.textContent.replace(/[^\d.]/g, "")) || 0;
  const delta = target - start;
  if (!delta) {
    el.textContent = String(Math.round(target));
    return;
  }
  const t0 = performance.now();
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / COUNT_DURATION);
    const ease = 1 - Math.pow(2, -10 * p); // easeOutExpo
    el.textContent = String(Math.round(start + delta * (p === 1 ? 1 : ease)));
    if (p < 1 && el.isConnected) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* Composite-risk legend tick tracks the hovered/selected district. */
function updateLegendTick(name) {
  const tick = document.getElementById("mapLegendTick");
  const readout = document.getElementById("mapLegendReadout");
  if (!tick) return;
  const focusName = name || (lastRiskState && lastRiskState.district !== "all" ? lastRiskState.district : null);
  const district = lastRiskDistricts.find((entry) => entry.name === focusName);
  if (!district) {
    tick.classList.remove("is-visible");
    if (readout) readout.hidden = true;
    return;
  }
  tick.style.left = `${Math.min(99, Math.max(1, district.index))}%`;
  tick.classList.add("is-visible");
  if (readout) {
    readout.hidden = false;
    readout.textContent = `${district.name} · Composite ${district.index}/100 · ${district.band} band`;
  }
}

/* Map → telemetry list cross-highlight (the reverse is wired per-row). */
function hostHighlightRow(name) {
  document.querySelectorAll("#districtRank .district-rank__item").forEach((el) => {
    el.classList.toggle("is-hot", Boolean(name) && el.dataset.district === name);
  });
}

function renderRiskPanel(aggregate, state) {
  const host = document.getElementById("districtRank");
  if (!host) return;
  const districts = aggregate?.riskDistricts || [];
  lastRiskDistricts = districts;
  lastRiskState = state || null;

  host.replaceChildren(
    ...districts.map((district, index) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "district-rank__item";
      button.dataset.band = district.band;
      button.dataset.district = district.name;
      button.style.setProperty("--d", `${(index % 6) * 70}ms`);
      button.setAttribute("aria-pressed", String(state.district === district.name));
      button.setAttribute(
        "aria-label",
        `${district.name}: composite burden ${district.index} of 100, ${district.band} band. ${
          state.district === district.name ? "Clear filter" : "Filter charts"
        }.`
      );

      const head = document.createElement("span");
      head.className = "district-rank__head";
      const name = document.createElement("span");
      name.className = "district-rank__name";
      name.textContent = district.name;
      const band = document.createElement("span");
      band.className = "district-rank__band";
      band.textContent = district.band;
      head.append(name, band);

      const value = document.createElement("span");
      value.className = "district-rank__value";
      value.textContent = "0";

      const meta = document.createElement("span");
      meta.className = "district-rank__meta";
      meta.textContent = `${Math.round(district.diseaseCases).toLocaleString("en-IN")} cases · flood ${district.floodShare.toFixed(
        0
      )}% · stagnant ${district.stagnantShare.toFixed(0)}%`;

      const bar = document.createElement("i");
      bar.className = "district-rank__bar";
      const fill = document.createElement("b");
      fill.style.width = "0%";
      bar.appendChild(fill);

      button.append(head, value, meta, bar);
      button.addEventListener("click", () => {
        SafeSipAnalytics.setState({
          district: state.district === district.name ? "all" : district.name
        });
      });
      button.addEventListener("pointerenter", () => {
        atlasMap?.highlight(district.name);
        updateLegendTick(district.name);
      });
      button.addEventListener("pointerleave", () => {
        atlasMap?.highlight(null);
        updateLegendTick(null);
      });
      button.addEventListener("focus", () => {
        atlasMap?.highlight(district.name);
        updateLegendTick(district.name);
      });
      button.addEventListener("blur", () => {
        atlasMap?.highlight(null);
        updateLegendTick(null);
      });
      li.appendChild(button);
      // Defer the bar fill so the transition replays on every re-render.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fill.style.width = `${district.index}%`;
        });
      });
      return li;
    })
  );

  // Kick off count-ups after insertion.
  host.querySelectorAll(".district-rank__item").forEach((buttonEl, i) => {
    const target = districts[i];
    countUp(buttonEl.querySelector(".district-rank__value"), target.index);
  });
  updateLegendTick(null);
}

// -------- Initialise --------

async function initLanding() {
  setupNavigation();
  setupSignature();
  setupWordmark();
  setupReveals();
  setupSmoothScroll();
  setupDonutReplay();
  setupCallsToAction();
  setupHealthForm();
  setupHardwareRiskForm();
  setupTestAlert();
  setSessionId();
  seedReports();

  let map = null;
  const filters = document.getElementById("analyticsFilters");
  SafeSipAnalytics.setStatus("loading", "Loading surveillance records…");

  try {
    const [data, stats] = await Promise.all([fetchDataset(), fetchStats()]);
    if (!Array.isArray(data) || !data.length) throw new Error("The dataset is empty.");

    fillHeroSnapshot(data, stats);

    SafeSipAnalytics.init({
      rows: data,
      theme: "light",
      controls: filters,
      onChange: ({ rows, aggregate, state }) => {
        renderDatasetTable(rows, data.length);
        renderRiskPanel(aggregate, state);
        map?.render();
        updateLegendTick(null);
      }
    });

    map = window.SafeSipMap?.init({
      container: document.getElementById("hotspotMap"),
      getRows: SafeSipAnalytics.getFilteredRows,
      getState: SafeSipAnalytics.getState,
      onFilter: (district) => SafeSipAnalytics.setState({ district }),
      onHover: (name) => {
        updateLegendTick(name);
        hostHighlightRow(name);
      }
    });
    atlasMap = map;
  } catch (err) {
    console.error("Error loading landing analytics:", err);
    setApiStatus(false);
    SafeSipAnalytics.setStatus(
      "error",
      'Could not load /api/data. Start the server with "npm start" and reload.'
    );
    const errEl = document.getElementById("datasetError");
    if (errEl) {
      errEl.textContent =
        'Could not load the dataset from /api/data. Start the server with "npm start" and reload.';
      errEl.classList.remove("hidden");
    }
    const countEl = document.getElementById("datasetRowCount");
    if (countEl) countEl.textContent = "No records loaded";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLanding);
} else {
  initLanding();
}

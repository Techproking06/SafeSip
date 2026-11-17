// Frontend/script.js
// Dashboard behaviour. Data comes from the same-origin API; charts, filters and
// interactions live in the shared SafeSipAnalytics engine.

const API_BASE_URL = "";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function fetchDataset() {
  const res = await fetch(`${API_BASE_URL}/api/data`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function setApiStatus(isLive) {
  const pill = document.getElementById("apiStatus");
  if (!pill) return;
  pill.classList.toggle("is-offline", !isLive);
  pill.textContent = isLive ? "API live" : "API offline";
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

function populateKpis(rows) {
  const rainValues = rows
    .map((row) => Number(row.Rainfall_mm))
    .filter((value) => Number.isFinite(value));
  const rain = rainValues.length
    ? rainValues.reduce((sum, value) => sum + value, 0) / rainValues.length
    : null;
  const diarrhea = rows.reduce(
    (sum, row) => sum + (Number(row.Cases_Diarrhea_ADD) || 0),
    0
  );

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set("kpiRecords", formatNumber(rows.length));
  set("kpiDistricts", new Set(rows.map((row) => row.District).filter(Boolean)).size);
  set("kpiBlocks", new Set(rows.map((row) => row.Block).filter(Boolean)).size);
  set("kpiRain", rain === null ? "—" : rain.toFixed(1));
  set("kpiDiarrhea", formatNumber(diarrhea));
}

// -------- Risk model --------

function setupHardwareForm() {
  const form = document.getElementById("hardwareRiskForm");
  if (!form) return;

  const rainfallEl = document.getElementById("hardwareRainfall");
  const floodEl = document.getElementById("hardwareFloodStatus");
  const stagnantEl = document.getElementById("hardwareStagnantRisk");
  const resultBox = document.getElementById("hardwareResult");
  const resultText = document.getElementById("hardwareResultText");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const payload = {
      Rainfall_mm: rainfallEl?.value,
      Flood_Status: floodEl?.value,
      Stagnant_Water_Risk: stagnantEl?.value
    };

    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch(`${API_BASE_URL}/api/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      const { riskScore, riskLevel } = body;
      let extra = "";
      if (riskLevel === "High") {
        extra = " Escalate alerts, investigate water sources and raise medical readiness.";
      } else if (riskLevel === "Medium") {
        extra = " Keep this area on the watchlist and increase sampling frequency.";
      } else if (riskLevel === "Low") {
        extra = " Continue routine monitoring and hygiene promotion.";
      }

      if (resultBox && resultText) {
        resultText.textContent = `Risk score ${riskScore} · ${riskLevel}.${extra}`;
        resultBox.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Error calling /api/predict:", err);
      if (resultBox && resultText) {
        resultText.textContent = `Prediction failed: ${err.message}. Ensure the Node.js server is running.`;
        resultBox.classList.remove("hidden");
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// -------- Presentation --------

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

// -------- Init --------

document.addEventListener("DOMContentLoaded", async () => {
  if (!document.getElementById("datasetTableHead")) return;

  setupHardwareForm();
  setupSignature();
  setupWordmark();
  setupReveals();
  SafeSipAnalytics.setStatus("loading", "Loading surveillance records…");

  try {
    const data = await fetchDataset();
    if (!Array.isArray(data) || !data.length) throw new Error("The dataset is empty.");

    setApiStatus(true);
    SafeSipAnalytics.init({
      rows: data,
      theme: "dark",
      controls: document.getElementById("analyticsFilters"),
      onChange: ({ rows }) => {
        renderDatasetTable(rows, data.length);
        populateKpis(rows);
      }
    });
  } catch (err) {
    console.error("Error loading dashboard:", err);
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
});

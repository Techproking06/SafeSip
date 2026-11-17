/* SafeSip sensor layer — DOM wiring for the deterministic simulation.
   Every reading, badge, meter, counter, tooltip and the rolling chart all
   derive from window.SafeSipSensorSim's shared state. */
(function () {
  const sim = window.SafeSipSensorSim;
  if (!sim) return;

  const $ = (id) => document.getElementById(id);
  const canvas = $("iotChart");
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const T = sim.config.thresholds;

  const elements = {
    turbidityValue: $("turbidityValue"),
    phValue: $("phValue"),
    tdsValue: $("tdsValue"),
    spikeCount: $("spikeCount"),
    turbidityStatus: $("turbidityStatus"),
    phStatus: $("phStatus"),
    tdsStatus: $("tdsStatus"),
    spikeStatus: $("spikeStatus"),
    turbidityBar: $("turbidityBar"),
    tdsGauge: $("tdsGauge"),
    phBlocks: $("phBlocks"),
    spikeBlocks: $("spikeBlocks"),
    simClock: $("simClock"),
    sensorAlert: $("sensorAlert"),
    panel: document.querySelector(".sensor-panel"),
    toggle: $("sensorToggle"),
    reset: $("sensorReset"),
    cards: [...document.querySelectorAll(".sensor-card[data-sensor]")]
  };

  let chart = null;
  let running = true;
  let isolated = null;

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function setBadge(el, level, labels) {
    if (!el) return;
    el.classList.toggle("is-warn", level === 1);
    el.classList.toggle("is-alert", level === 2);
    el.textContent = labels[level];
  }

  function setBlocks(container, lit, total = 3) {
    if (!container) return;
    [...container.children].slice(0, total).forEach((block, i) => {
      block.classList.toggle("is-on", i < lit);
    });
  }

  function makeChart(snapshot) {
    if (!canvas || !window.Chart) return null;

    const labels = snapshot.history.map((sample) => sample.label);
    const datasetRows = {
      turbidity: snapshot.history.map((sample) => sample.turbidity),
      ph: snapshot.history.map((sample) => sample.ph),
      tds: snapshot.history.map((sample) => sample.tds)
    };
    const alertLine = new Array(labels.length).fill(T.turbidity.alert);

    return new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Turbidity",
            data: datasetRows.turbidity,
            borderColor: "#62e0cd",
            backgroundColor: "rgba(98, 224, 205, 0.1)",
            fill: true,
            borderWidth: 1.6,
            tension: 0.38,
            pointRadius: 0,
            yAxisID: "yTurbidity"
          },
          {
            label: "pH",
            data: datasetRows.ph,
            borderColor: "#6fd3a4",
            borderWidth: 1.2,
            tension: 0.38,
            pointRadius: 0,
            yAxisID: "yPh"
          },
          {
            label: "TDS",
            data: datasetRows.tds,
            borderColor: "#e0b878",
            borderWidth: 1.2,
            tension: 0.38,
            pointRadius: 0,
            yAxisID: "yTds"
          },
          {
            label: "Turbidity alert level",
            data: alertLine,
            borderColor: "rgba(232, 174, 154, 0.55)",
            borderDash: [5, 5],
            borderWidth: 1,
            pointRadius: 0,
            fill: false,
            yAxisID: "yTurbidity"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: REDUCED_MOTION ? false : { duration: 450, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#04141c",
            titleColor: "#f8f5ee",
            bodyColor: "rgba(248, 245, 238, 0.78)",
            borderColor: "rgba(248, 245, 238, 0.08)",
            borderWidth: 1,
            padding: 10,
            cornerRadius: 6,
            titleFont: { family: '"Instrument Sans", sans-serif', size: 11, weight: "600" },
            bodyFont: { family: '"IBM Plex Mono", monospace', size: 10 },
            callbacks: {
              title: (items) => `Simulated ${items[0].label}`,
              label: (ctx) => {
                if (ctx.dataset.label === "Turbidity alert level") return " Alert level: 4.5 NTU";
                const units = { Turbidity: "NTU", pH: "", TDS: "ppm" };
                const unit = units[ctx.dataset.label] || "";
                return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(ctx.dataset.label === "pH" ? 2 : 1)}${unit ? ` ${unit}` : ""}`;
              }
            }
          }
        },
        scales: {
          x: { display: false },
          yTurbidity: { display: false, min: 0, max: 6.5 },
          yPh: { display: false, min: 5.8, max: 8.6 },
          yTds: { display: false, min: 0, max: 620 }
        }
      }
    });
  }

  function applyIsolation() {
    elements.cards.forEach((card) => {
      const active = isolated === card.dataset.sensor;
      card.classList.toggle("is-isolated", active);
      card.setAttribute("aria-pressed", String(active));
    });
    if (!chart) return;
    const map = { turbidity: 0, ph: 1, tds: 2 };
    [0, 1, 2].forEach((index) => {
      const key = Object.keys(map)[index];
      chart.setDatasetVisibility(index, !isolated || isolated === key);
    });
    chart.setDatasetVisibility(3, isolated === null || isolated === "turbidity");
    chart.update("none");
  }

  function renderChart(snapshot) {
    if (!chart) return;
    chart.data.labels = snapshot.history.map((sample) => sample.label);
    chart.data.datasets[0].data = snapshot.history.map((sample) => sample.turbidity);
    chart.data.datasets[1].data = snapshot.history.map((sample) => sample.ph);
    chart.data.datasets[2].data = snapshot.history.map((sample) => sample.tds);
    chart.data.datasets[3].data = new Array(snapshot.history.length).fill(T.turbidity.alert);
    if (REDUCED_MOTION) chart.update("none");
    else chart.update();
  }

  function render() {
    const snapshot = sim.snapshot();
    const [{ current, status, spikeCount, clock }] = [snapshot];

    if (elements.turbidityValue) elements.turbidityValue.textContent = current.turbidity.toFixed(1);
    if (elements.phValue) elements.phValue.textContent = current.ph.toFixed(2);
    if (elements.tdsValue) elements.tdsValue.textContent = String(Math.round(current.tds));
    if (elements.spikeCount) elements.spikeCount.textContent = String(spikeCount);
    if (elements.simClock) elements.simClock.textContent = `Sim ${clock}`;

    if (elements.turbidityBar) elements.turbidityBar.style.width = `${Math.round(clamp01(current.turbidity / T.turbidity.meterMax) * 100)}%`;
    if (elements.tdsGauge) elements.tdsGauge.style.width = `${Math.round(clamp01(current.tds / T.tds.meterMax) * 100)}%`;

    setBadge(elements.turbidityStatus, status.turbidity === "clear" ? 0 : status.turbidity === "warn" ? 1 : 2, ["Clear", "Watch", "Spike"]);
    setBadge(elements.phStatus, status.ph === "neutral" ? 0 : status.ph === "warn" ? 1 : 2, ["Neutral", "Watch", "Critical"]);
    setBadge(elements.tdsStatus, status.tds === "normal" ? 0 : status.tds === "warn" ? 1 : 2, ["Within limits", "Elevated", "High"]);
    setBadge(elements.spikeStatus, spikeCount === 0 ? 0 : spikeCount <= 2 ? 1 : 2, ["Stable", "Watch", "Alert"]);

    const ideal = 7.1;
    const phDistance = Math.abs(current.ph - ideal);
    const phLit = phDistance < 0.25 ? 3 : phDistance < 0.5 ? 2 : phDistance < 1 ? 1 : 0;
    setBlocks(elements.phBlocks, phLit);

    const spikeLit = Math.min(3, spikeCount);
    setBlocks(elements.spikeBlocks, spikeLit);

    elements.cards.forEach((card) => {
      const key = card.dataset.sensor;
      const level = status[key];
      const inAlert = key === "spike" ? spikeCount > 0 : level === "warn" || level === "alert";
      card.classList.toggle("is-warn", inAlert && level !== "alert");
      card.classList.toggle("is-anomaly", inAlert && (level === "alert" || key === "spike"));
    });
    elements.panel?.classList.toggle("is-anomaly", status.spike);

    renderChart(snapshot);
  }

  function announce(transition) {
    const el = elements.sensorAlert;
    if (!el) return;
    if (transition === "anomaly") {
      const snap = sim.snapshot();
      el.textContent = `Simulated anomaly at ${snap.clock}: turbidity ${snap.current.turbidity.toFixed(1)} NTU — alert raised for Kaveri Nagar (simulated).`;
      el.classList.add("is-live");
    } else if (transition === "recovered") {
      el.textContent = "Readings recovered to within simulated limits.";
      el.classList.remove("is-live");
    }
  }

  function tick() {
    if (!running) return;
    const transition = sim.advance();
    render();
    announce(transition);
  }

  function setRunning(next) {
    running = next;
    if (elements.toggle) {
      elements.toggle.setAttribute("aria-pressed", String(!next));
      elements.toggle.textContent = next ? "Pause" : "Resume";
    }
    if (elements.sensorAlert && !running) {
      elements.sensorAlert.textContent = "Simulation paused — readings are frozen.";
      elements.sensorAlert.classList.remove("is-live");
    }
  }

  function init() {
    const snapshot = sim.snapshot();
    chart = makeChart(snapshot);
    render();

    elements.cards.forEach((card) => {
      const toggleIsolate = () => {
        isolated = isolated === card.dataset.sensor ? null : card.dataset.sensor;
        applyIsolation();
      };
      card.addEventListener("click", toggleIsolate);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleIsolate();
        }
      });
    });

    elements.toggle?.addEventListener("click", () => setRunning(!running));
    elements.reset?.addEventListener("click", () => {
      sim.reset();
      isolated = null;
      render();
      applyIsolation();
      if (elements.sensorAlert) elements.sensorAlert.textContent = "Simulation reset to seed kav-01 — reproducible series restored.";
    });

    window.setInterval(tick, sim.config.intervalMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SafeSipSensorLive = { render, reset: () => elements.reset?.click() };
})();

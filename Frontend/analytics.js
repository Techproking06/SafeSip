/* Shared SafeSip analytics engine.
   One dataset, one filter state, one set of chart builders. The landing page and
   the dashboard both mount this so filters, tooltips and interactions stay in
   sync with the same CSV-backed rows. */
(function () {
  const COLUMNS = [
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

  const LABELS = {
    Cases_Diarrhea_ADD: "Diarrhea (ADD)",
    Cases_Dysentery: "Dysentery",
    Cases_Cholera: "Cholera",
    Cases_Typhoid: "Typhoid",
    Cases_Hepatitis: "Hepatitis",
    Cases_Giardiasis: "Giardiasis",
    Cases_Skin_Infection: "Skin infection",
    Cases_Malaria: "Malaria",
    Cases_JE_AES: "JE / AES",
    Cases_Dengue: "Dengue"
  };

  const ALL = "ALL";

  const THEMES = {
    light: {
      text: "#5b6b68",
      strong: "#0a2328",
      grid: "rgba(10, 35, 40, 0.07)",
      aqua: "#0a766e",
      aquaSoft: "rgba(10, 118, 110, 0.13)",
      mint: "#2f8b6d",
      mintSoft: "rgba(47, 139, 109, 0.55)",
      signal: "#c85a3d",
      signalSoft: "rgba(200, 90, 61, 0.5)",
      amber: "#b67b25",
      sky: "#5b96a6",
      slate: "#93a09b",
      paper: "#f8f4ec",
      tooltip: "#0a2328",
      tooltipLine: "rgba(248, 245, 238, 0.1)",
      point: "rgba(10, 118, 110, 0.36)",
      pointHover: "#0a766e"
    },
    dark: {
      text: "#93a9ac",
      strong: "#e9f2f5",
      grid: "rgba(203, 234, 238, 0.09)",
      aqua: "#63c9c2",
      aquaSoft: "rgba(99, 201, 194, 0.13)",
      mint: "#3f9c8d",
      mintSoft: "rgba(63, 156, 141, 0.55)",
      signal: "#d0764f",
      signalSoft: "rgba(208, 118, 79, 0.58)",
      amber: "#c9973e",
      sky: "#79b4c2",
      slate: "#8e9b98",
      paper: "#082531",
      tooltip: "#04141c",
      tooltipLine: "rgba(248, 245, 238, 0.08)",
      point: "rgba(126, 210, 204, 0.34)",
      pointHover: "#a7e5df"
    }
  };

  const state = {
    from: null,
    to: null,
    district: "all",
    disease: ALL
  };

  let rows = [];
  let theme = THEMES.light;
  let host = null;
  let summaryEl = null;
  let lastAggregate = null;
  const subscribers = new Set();
  let pageOnChange = null;

  const fmt = (value) => Number(value || 0).toLocaleString("en-IN");
  const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

  function diseaseLabel(key) {
    return key === ALL ? "All diseases" : LABELS[key] || key.replace("Cases_", "").replace(/_/g, " ");
  }

  function sumDiseaseRow(row) {
    return COLUMNS.reduce((sum, col) => {
      const value = Number(row[col]);
      return sum + (Number.isNaN(value) ? 0 : value);
    }, 0);
  }

  function caseValue(row, disease) {
    if (disease === ALL) return sumDiseaseRow(row);
    const value = Number(row[disease]);
    return Number.isNaN(value) ? 0 : value;
  }

  function yearOf(row) {
    const year = Number(row.Year);
    if (year) return year;
    const match = String(row.Date || "").match(/(\d{4})/);
    return match ? Number(match[1]) : null;
  }

  function monthKey(row) {
    const date = String(row.Date || "");
    const match = date.match(/^(\d{4})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;
    const year = yearOf(row);
    const month = Number(row.Month);
    return year && month ? `${year}-${String(month).padStart(2, "0")}` : "";
  }

  function formatMonth(key) {
    const [year, month] = String(key).split("-");
    if (!year || !month) return key;
    return new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-IN", {
      month: "short",
      year: "2-digit"
    });
  }

  function mean(values) {
    const valid = values.filter((value) => Number.isFinite(value));
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  }

  function getRows() {
    return rows;
  }

  function getState() {
    return { ...state };
  }

  function filteredRows() {
    return rows.filter((row) => {
      const year = yearOf(row);
      if (state.from && year && year < state.from) return false;
      if (state.to && year && year > state.to) return false;
      if (state.district !== "all" && String(row.District) !== state.district) return false;
      return true;
    });
  }

  function monthSeries(source) {
    const months = new Map();
    source.forEach((row) => {
      const key = monthKey(row);
      if (!key) return;
      const entry = months.get(key) || {
        key,
        rainSum: 0,
        rainCount: 0,
        cases: 0,
        diarrhea: 0,
        records: 0,
        flood: 0,
        severe: 0,
        stagnant: 0
      };
      const rain = Number(row.Rainfall_mm);
      if (Number.isFinite(rain)) {
        entry.rainSum += rain;
        entry.rainCount += 1;
      }
      entry.cases += caseValue(row, state.disease);
      entry.diarrhea += Number(row.Cases_Diarrhea_ADD) || 0;
      entry.records += 1;
      const flood = String(row.Flood_Status || "").toLowerCase();
      if (flood && flood !== "no" && flood !== "unknown") entry.flood += 1;
      if (flood === "severe") entry.severe += 1;
      if (String(row.Stagnant_Water_Risk || "").toLowerCase() === "high") entry.stagnant += 1;
      months.set(key, entry);
    });
    return [...months.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => ({
        ...entry,
        rain: entry.rainCount ? entry.rainSum / entry.rainCount : 0,
        floodShare: entry.records ? (entry.flood / entry.records) * 100 : 0,
        severeShare: entry.records ? (entry.severe / entry.records) * 100 : 0,
        stagnantShare: entry.records ? (entry.stagnant / entry.records) * 100 : 0
      }));
  }

  function group(source, keyFn, disease) {
    const map = new Map();
    source.forEach((row) => {
      const key = keyFn(row) || "Unknown";
      const entry = map.get(key) || { key, cases: 0, diarrhea: 0, records: 0, rain: 0, rainCount: 0 };
      entry.cases += caseValue(row, disease);
      entry.diarrhea += Number(row.Cases_Diarrhea_ADD) || 0;
      entry.records += 1;
      const rain = Number(row.Rainfall_mm);
      if (Number.isFinite(rain)) {
        entry.rain += rain;
        entry.rainCount += 1;
      }
      map.set(key, entry);
    });
    return [...map.values()].map((entry) => ({
      ...entry,
      rain: entry.rainCount ? entry.rain / entry.rainCount : 0
    }));
  }

  function districtForBlock(block) {
    const row = rows.find((item) => String(item.Block) === String(block));
    return row ? String(row.District) : null;
  }

  /* Transparent, descriptive composite. It ranks historical burden — it is not
     an outbreak forecast. Weights are shown in the map legend note. */
  function districtRisk(source, disease) {
    const byDistrict = group(source, (row) => row.District, ALL);
    const byBlock = group(source, (row) => row.Block, ALL);
    const byDiseaseDistrict = group(source, (row) => row.District, disease);
    if (!byDistrict.length) return [];

    const maxCases = Math.max(...byDistrict.map((item) => item.cases), 1);
    const maxRain = Math.max(...byDistrict.map((item) => item.rain), 1);
    const maxDisease = Math.max(...byDiseaseDistrict.map((item) => item.cases), 1);

    return byDistrict
      .map((item) => {
        const districtRows = source.filter((row) => String(row.District) === item.key);
        const flood = districtRows.filter((row) => {
          const status = String(row.Flood_Status || "").toLowerCase();
          return status && status !== "no" && status !== "unknown";
        }).length;
        const severe = districtRows.filter(
          (row) => String(row.Flood_Status || "").toLowerCase() === "severe"
        ).length;
        const stagnant = districtRows.filter(
          (row) => String(row.Stagnant_Water_Risk || "").toLowerCase() === "high"
        ).length;
        const floodShare = item.records ? (flood / item.records) * 100 : 0;
        const stagnantShare = item.records ? (stagnant / item.records) * 100 : 0;
        const selected = byDiseaseDistrict.find((entry) => entry.key === item.key);
        const diseaseCases = selected ? selected.cases : 0;
        const index = Math.round(
          (0.45 * (item.cases / maxCases) +
            0.25 * (floodShare / 100) +
            0.15 * (stagnantShare / 100) +
            0.15 * (item.rain / maxRain)) *
            100
        );
        const blockRows = byBlock
          .filter((block) => districtForBlock(block.key) === item.key)
          .sort((a, b) => b.cases - a.cases);
        return {
          name: item.key,
          index,
          band: index >= 68 ? "High" : index >= 42 ? "Medium" : "Low",
          cases: item.cases,
          diseaseCases,
          diseaseNorm: diseaseCases / maxDisease,
          diarrhea: item.diarrhea,
          rain: item.rain,
          records: item.records,
          blocks: blockRows.length,
          floodShare,
          severeShare: item.records ? (severe / item.records) * 100 : 0,
          stagnantShare,
          topBlock: blockRows[0] ? blockRows[0].key : "—"
        };
      })
      .sort((a, b) => b.index - a.index);
  }

  function aggregate(source) {
    const months = monthSeries(source);
    const districts = new Set();
    const blocks = new Set();
    let rainSum = 0;
    let rainCount = 0;
    let diarrhea = 0;
    let cases = 0;
    const diseaseTotals = COLUMNS.map((column) => ({ column, label: LABELS[column], value: 0 }));
    const flood = {};
    const stagnant = {};

    source.forEach((row) => {
      if (row.District) districts.add(String(row.District));
      if (row.Block) blocks.add(String(row.Block));
      const rain = Number(row.Rainfall_mm);
      if (Number.isFinite(rain)) {
        rainSum += rain;
        rainCount += 1;
      }
      diarrhea += Number(row.Cases_Diarrhea_ADD) || 0;
      cases += caseValue(row, state.disease);
      COLUMNS.forEach((column, index) => {
        const value = Number(row[column]);
        if (Number.isFinite(value)) diseaseTotals[index].value += value;
      });
      const floodKey = String(row.Flood_Status || "Unknown");
      flood[floodKey] = (flood[floodKey] || 0) + 1;
      const stagnantKey = String(row.Stagnant_Water_Risk || "Unknown");
      stagnant[stagnantKey] = (stagnant[stagnantKey] || 0) + 1;
    });

    return {
      records: source.length,
      districts: districts.size,
      blocks: blocks.size,
      rain: rainCount ? rainSum / rainCount : 0,
      diarrhea,
      cases,
      months,
      diseaseTotals,
      flood,
      stagnant,
      byDistrict: group(source, (row) => row.District, state.disease),
      byBlock: group(source, (row) => row.Block, state.disease),
      byGeo: group(source, (row) => String(row.Geo_Type || "Unknown").replace(/_/g, " "), state.disease),
      riskDistricts: districtRisk(source, state.disease)
    };
  }

  // -------- Chart theme --------

  function applyDefaults(themeName) {
    if (!window.Chart) return;
    theme = THEMES[themeName] || THEMES.light;
    Chart.defaults.font.family = '"Instrument Sans", "Segoe UI", sans-serif';
    Chart.defaults.font.size = 10.5;
    Chart.defaults.font.weight = "500";
    Chart.defaults.color = theme.text;
    Chart.defaults.borderColor = theme.grid;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = "circle";
    Chart.defaults.plugins.legend.labels.boxWidth = 6;
    Chart.defaults.plugins.legend.labels.boxHeight = 6;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.animation = false;
  }

  function tooltipOptions() {
    return {
      backgroundColor: theme.tooltip,
      titleColor: "#f8f5ee",
      bodyColor: "rgba(248, 245, 238, 0.82)",
      borderColor: theme.tooltipLine,
      borderWidth: 1,
      padding: 11,
      cornerRadius: 8,
      titleFont: { family: '"Instrument Sans", sans-serif', size: 11, weight: "600" },
      bodyFont: { family: '"IBM Plex Mono", monospace', size: 10 },
      displayColors: true,
      boxPadding: 3
    };
  }

  function legend(display) {
    return {
      display,
      position: "bottom",
      labels: {
        color: theme.text,
        usePointStyle: true,
        pointStyle: "circle",
        boxWidth: 6,
        boxHeight: 6,
        padding: 12,
        font: { size: 9.5 }
      }
    };
  }

  function scale(xTitle, yTitle, { beginAtZero = true, percent = false } = {}) {
    return {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: theme.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, padding: 6 },
        title: xTitle
          ? { display: true, text: xTitle, color: theme.text, font: { size: 9 } }
          : { display: false }
      },
      y: {
        beginAtZero,
        grid: { color: theme.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: theme.text,
          padding: 7,
          maxTicksLimit: 5,
          callback: (value) => (percent ? `${value}%` : fmt(value))
        },
        title: yTitle
          ? { display: true, text: yTitle, color: theme.text, font: { size: 9 } }
          : { display: false }
      }
    };
  }

  // -------- Chart lifecycle --------

  function draw(id, type, data, options) {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return null;
    // Rebuild instead of mutating a live config: Chart.js keeps event handlers and
    // animation state from the original config, which breaks repeat filtering.
    Chart.getChart(canvas)?.destroy();
    return new Chart(canvas, { type, data, options });
  }

  function baseOptions(extra) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      ...extra
    };
  }

  function frameState(id, status, message) {
    const canvas = document.getElementById(id);
    const frame = canvas ? canvas.closest(".chart-frame") : null;
    if (!frame) return;
    frame.dataset.state = status;
    if (message) frame.dataset.message = message;
  }

  function pointerOnClick(handler) {
    return (event, elements, chart) => {
      if (!elements.length) return;
      const element = elements[0];
      // Defer: the handler rebuilds charts, which must not happen inside Chart.js's
      // own event dispatch or its afterEvent hooks see a destroyed instance.
      queueMicrotask(() => handler(element, chart));
    };
  }

  function hoverCursor(event, elements) {
    if (event.native && event.native.target) {
      event.native.target.style.cursor = elements.length ? "pointer" : "default";
    }
  }

  // -------- Chart renderers --------

  function drawCasesChart(agg) {
    const series = agg.months;
    const meta = document.getElementById("casesMeta");
    if (meta) meta.textContent = `${series.length} months · ${diseaseLabel(state.disease)}`;
    frameState("casesChart", series.length ? "ready" : "empty", "No monthly cases in this selection");
    if (!series.length) return;
    draw(
      "casesChart",
      "line",
      {
        labels: series.map((point) => formatMonth(point.key)),
        datasets: [
          {
            label: diseaseLabel(state.disease),
            data: series.map((point) => point.cases),
            borderColor: theme.aqua,
            backgroundColor: theme.aquaSoft,
            fill: true,
            borderWidth: 1.7,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 10
          }
        ]
      },
      baseOptions({
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOptions(),
            callbacks: { label: (ctx) => ` ${fmt(ctx.parsed.y)} cases` }
          }
        },
        scales: scale()
      })
    );
  }

  function drawFloodTrendChart(agg) {
    const series = agg.months;
    const meta = document.getElementById("waterTrendMeta");
    if (meta) meta.textContent = `${series.length} months · share of records`;
    frameState("waterTrendChart", series.length ? "ready" : "empty", "No monthly flood records");
    if (!series.length) return;
    draw(
      "waterTrendChart",
      "line",
      {
        labels: series.map((point) => formatMonth(point.key)),
        datasets: [
          {
            label: "Flood-affected records",
            data: series.map((point) => Number(point.floodShare.toFixed(1))),
            borderColor: theme.amber,
            backgroundColor: "rgba(182, 123, 37, 0.12)",
            fill: true,
            borderWidth: 1.5,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4
          }
        ]
      },
      baseOptions({
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOptions(),
            callbacks: { label: (ctx) => ` ${pct(ctx.parsed.y)} of records` }
          }
        },
        scales: scale("", "", { percent: true })
      })
    );
  }

  function drawDiseaseTotals(agg) {
    const totals = agg.diseaseTotals.slice().sort((a, b) => b.value - a.value);
    const meta = document.getElementById("diseaseMeta");
    if (meta) {
      meta.textContent =
        state.disease === ALL ? "Click a bar to focus" : `Focused · ${diseaseLabel(state.disease)}`;
    }
    frameState("diseaseTotalChart", totals.some((item) => item.value) ? "ready" : "empty", "No cases in this selection");
    if (!totals.some((item) => item.value)) return;
    draw(
      "diseaseTotalChart",
      "bar",
      {
        labels: totals.map((item) => item.label),
        datasets: [
          {
            label: "Total cases",
            data: totals.map((item) => item.value),
            backgroundColor: totals.map((item) =>
              item.column === state.disease ? theme.signal : theme.mintSoft
            ),
            hoverBackgroundColor: totals.map((item) =>
              item.column === state.disease ? theme.signal : theme.mint
            ),
            borderRadius: 3,
            maxBarThickness: 28
          }
        ]
      },
      baseOptions({
        onClick: pointerOnClick((element) => {
          const item = totals[element.index];
          if (!item) return;
          setState({ disease: state.disease === item.column ? ALL : item.column });
        }),
        onHover: hoverCursor,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOptions(),
            callbacks: {
              label: (ctx) => ` ${fmt(ctx.parsed.y)} cases`,
              afterLabel: () => " Click to focus this disease"
            }
          }
        },
        scales: {
          ...scale(),
          x: {
            ...scale().x,
            ticks: {
              ...scale().x.ticks,
              maxRotation: 42,
              minRotation: 42,
              autoSkip: false,
              font: { size: 9 }
            }
          }
        }
      })
    );
  }

  function drawDistrictTotals(agg) {
    const all = agg.byDistrict.slice().sort((a, b) => b.cases - a.cases).slice(0, 10);
    const meta = document.getElementById("districtMeta");
    if (meta) {
      meta.textContent = state.district === "all" ? "Click a bar to filter" : `Focused · ${state.district}`;
    }
    frameState("districtTotalCasesChart", all.some((item) => item.cases) ? "ready" : "empty", "No district cases in this selection");
    if (!all.some((item) => item.cases)) return;
    draw(
      "districtTotalCasesChart",
      "bar",
      {
        labels: all.map((item) => item.key),
        datasets: [
          {
            label: "Cases",
            data: all.map((item) => item.cases),
            backgroundColor: all.map((item) =>
              item.key === state.district ? theme.signalSoft : theme.mintSoft
            ),
            hoverBackgroundColor: all.map((item) =>
              item.key === state.district ? theme.signal : theme.mint
            ),
            borderRadius: 3,
            maxBarThickness: 17
          }
        ]
      },
      baseOptions({
        indexAxis: "y",
        onClick: pointerOnClick((element) => {
          const item = all[element.index];
          if (!item) return;
          setState({ district: state.district === item.key ? "all" : item.key });
        }),
        onHover: hoverCursor,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOptions(),
            callbacks: {
              label: (ctx) => ` ${fmt(ctx.parsed.x)} ${diseaseLabel(state.disease).toLowerCase()} cases`,
              afterLabel: () => " Click to filter by district"
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: theme.grid, drawTicks: false },
            border: { display: false },
            ticks: { color: theme.text, maxTicksLimit: 5, padding: 6, callback: (value) => fmt(value) }
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: theme.strong, autoSkip: false, padding: 6, font: { size: 9.5 } }
          }
        }
      })
    );
  }

  function drawBlockTotals(agg) {
    let source = agg.byBlock;
    if (state.district !== "all") {
      source = source.filter((item) => districtForBlock(item.key) === state.district);
    }
    const top = source.slice().sort((a, b) => b.cases - a.cases).slice(0, 10);
    const meta = document.getElementById("blockMeta");
    if (meta) {
      meta.textContent =
        state.district === "all"
          ? "Top 10 across Assam"
          : `${state.district} · all blocks`;
    }
    frameState("blockTotalCasesChart", top.some((item) => item.cases) ? "ready" : "empty", "No block cases in this selection");
    if (!top.some((item) => item.cases)) return;
    draw(
      "blockTotalCasesChart",
      "bar",
      {
        labels: top.map((item) => item.key),
        datasets: [
          {
            label: "Cases",
            data: top.map((item) => item.cases),
            backgroundColor: theme.aquaSoft,
            hoverBackgroundColor: theme.aqua,
            borderRadius: 3,
            maxBarThickness: 17
          }
        ]
      },
      baseOptions({
        indexAxis: "y",
        onClick: pointerOnClick((element) => {
          const item = top[element.index];
          const district = item ? districtForBlock(item.key) : null;
          if (district) setState({ district });
        }),
        onHover: hoverCursor,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOptions(),
            callbacks: {
              label: (ctx) => ` ${fmt(ctx.parsed.x)} cases`,
              afterLabel: (ctx) => {
                const district = districtForBlock(top[ctx.dataIndex]?.key);
                return district ? ` ${district} · click to filter district` : "";
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: theme.grid, drawTicks: false },
            border: { display: false },
            ticks: { color: theme.text, maxTicksLimit: 5, padding: 6, callback: (value) => fmt(value) }
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: theme.strong, autoSkip: false, padding: 6, font: { size: 9.5 } }
          }
        }
      })
    );
  }

  function drawGeoType(agg) {
    const entries = agg.byGeo.slice().sort((a, b) => (state.disease === ALL ? b.records - a.records : b.cases - a.cases));
    const value = (item) => (state.disease === ALL ? item.records : item.cases);
    const total = entries.reduce((sum, item) => sum + value(item), 0);
    const meta = document.getElementById("geoMeta");
    if (meta) meta.textContent = state.disease === ALL ? "Record share" : `${diseaseLabel(state.disease)} case share`;
    frameState("geoTypeChart", total ? "ready" : "empty", "No geography records in this selection");
    if (!total) return;
    const palette = [theme.aqua, theme.mint, theme.amber, theme.signal, theme.sky, theme.slate];
    draw(
      "geoTypeChart",
      "doughnut",
      {
        labels: entries.map((item) => item.key),
        datasets: [
          {
            data: entries.map(value),
            backgroundColor: entries.map((_, index) => palette[index % palette.length]),
            borderColor: theme.paper,
            borderWidth: 3,
            hoverOffset: 4
          }
        ]
      },
      baseOptions({
        cutout: "62%",
        plugins: {
          legend: legend(true),
          tooltip: {
            ...tooltipOptions(),
            callbacks: {
              label: (ctx) =>
                ` ${ctx.label}: ${fmt(ctx.parsed)} ${state.disease === ALL ? "records" : "cases"} (${pct((ctx.parsed / total) * 100)})`
            }
          }
        }
      })
    );
  }

  function drawRainfallVsCases(agg) {
    const series = agg.months;
    const meta = document.getElementById("rainCasesMeta");
    if (meta) meta.textContent = `${diseaseLabel(state.disease)} · monthly aggregate`;
    frameState("rainfallVsTotalCasesChart", series.length ? "ready" : "empty", "No monthly records in this selection");
    if (!series.length) return;
    draw(
      "rainfallVsTotalCasesChart",
      "line",
      {
        labels: series.map((point) => formatMonth(point.key)),
        datasets: [
          {
            label: "Mean rainfall (mm)",
            data: series.map((point) => Number(point.rain.toFixed(1))),
            borderColor: theme.aqua,
            backgroundColor: theme.aquaSoft,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.7,
            yAxisID: "yRain"
          },
          {
            label: `${diseaseLabel(state.disease)} cases`,
            data: series.map((point) => point.cases),
            borderColor: theme.signal,
            backgroundColor: "transparent",
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.5,
            yAxisID: "yCases"
          }
        ]
      },
      baseOptions({
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: legend(true),
          tooltip: {
            ...tooltipOptions(),
            callbacks: {
              title: (items) => items[0]?.label || "",
              label: (ctx) =>
                ctx.dataset.yAxisID === "yCases"
                  ? ` ${fmt(ctx.parsed.y)} cases`
                  : ` ${ctx.parsed.y} mm mean`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: theme.text, maxTicksLimit: 5, autoSkip: true, maxRotation: 0, padding: 6 }
          },
          yRain: {
            position: "left",
            beginAtZero: true,
            grid: { color: theme.grid, drawTicks: false },
            border: { display: false },
            ticks: { color: theme.text, maxTicksLimit: 5, padding: 6 },
            title: { display: true, text: "Rainfall (mm)", color: theme.text, font: { size: 9 } }
          },
          yCases: {
            position: "right",
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            border: { display: false },
            ticks: { color: theme.text, maxTicksLimit: 5, padding: 6, callback: (value) => fmt(value) },
            title: { display: true, text: "Cases", color: theme.text, font: { size: 9 } }
          }
        }
      })
    );
  }

  function drawRainfallChart(agg) {
    const series = agg.months;
    const meta = document.getElementById("rainfallMeta");
    if (meta) meta.textContent = `${state.district === "all" ? "All districts" : state.district} · monthly mean`;
    frameState("rainfallChart", series.length ? "ready" : "empty", "No rainfall records in this selection");
    if (!series.length) return;
    draw(
      "rainfallChart",
      "line",
      {
        labels: series.map((point) => formatMonth(point.key)),
        datasets: [
          {
            label: "Mean rainfall (mm)",
            data: series.map((point) => Number(point.rain.toFixed(1))),
            borderColor: theme.aqua,
            backgroundColor: theme.aquaSoft,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.7
          }
        ]
      },
      baseOptions({
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOptions(),
            callbacks: { label: (ctx) => ` ${ctx.parsed.y} mm mean` }
          }
        },
        scales: scale()
      })
    );
  }

  function drawDistributionChart(id, metaId, counts, labels, colors, total) {
    const entries = Object.entries(counts);
    frameState(id, entries.length ? "ready" : "empty", "No records in this selection");
    if (metaId) {
      const meta = document.getElementById(metaId);
      if (meta) meta.textContent = `${fmt(total)} records`;
    }
    if (!entries.length) return;
    draw(
      id,
      "doughnut",
      {
        labels: entries.map(([label]) => labels[label] || label),
        datasets: [
          {
            data: entries.map(([, value]) => value),
            backgroundColor: entries.map(([label]) => colors[label] || theme.slate),
            borderColor: theme.paper,
            borderWidth: 2,
            hoverOffset: 4
          }
        ]
      },
      baseOptions({
        cutout: "62%",
        plugins: {
          legend: legend(true),
          tooltip: {
            ...tooltipOptions(),
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${fmt(ctx.parsed)} records (${pct((ctx.parsed / total) * 100)})`
            }
          }
        }
      })
    );
  }

  function drawScatterChart(agg) {
    const source = filteredRows();
    const points = [];
    source.forEach((row) => {
      const rain = Number(row.Rainfall_mm);
      const cases = caseValue(row, state.disease);
      if (!Number.isFinite(rain) || !Number.isFinite(cases)) return;
      points.push({
        x: rain,
        y: cases,
        district: String(row.District || "Unknown"),
        block: String(row.Block || "Unknown"),
        date: String(row.Date || ""),
        flood: String(row.Flood_Status || "Unknown")
      });
    });
    const meta = document.getElementById("scatterMeta");
    if (meta) meta.textContent = `${diseaseLabel(state.disease)} · ${fmt(points.length)} rows`;
    frameState("diarrheaScatterChart", points.length ? "ready" : "empty", "No district-month points in this selection");
    if (!points.length) return;
    draw(
      "diarrheaScatterChart",
      "scatter",
      {
        datasets: [
          {
            label: diseaseLabel(state.disease),
            data: points,
            backgroundColor: points.map((point) =>
              point.flood.toLowerCase() === "severe" ? theme.signalSoft : theme.point
            ),
            pointRadius: 2,
            pointHoverRadius: 5,
            pointHitRadius: 7
          }
        ]
      },
      baseOptions({
        onClick: pointerOnClick((element) => {
          const point = points[element.index];
          if (point) setState({ district: state.district === point.district ? "all" : point.district });
        }),
        onHover: hoverCursor,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOptions(),
            callbacks: {
              title: (items) => {
                const point = items[0]?.raw;
                return point ? `${point.district} · ${point.block}` : "";
              },
              label: (ctx) => [
                ` Rainfall: ${ctx.parsed.x} mm`,
                ` ${diseaseLabel(state.disease)}: ${fmt(ctx.parsed.y)} cases`,
                ` Flood: ${ctx.raw.flood} · click to filter`
              ]
            }
          }
        },
        scales: {
          ...scale("Rainfall (mm)", "Cases"),
          y: { ...scale().y, ticks: { ...scale().y.ticks, callback: (value) => fmt(value) } }
        }
      })
    );
  }

  function updateChartMetaTotals(agg) {
    const meta = document.getElementById("riskDonutMeta");
    if (meta) meta.textContent = `${agg.riskDistricts.length} districts`;
  }

  function renderCharts(agg) {
    if (document.getElementById("casesChart")) drawCasesChart(agg);
    if (document.getElementById("waterTrendChart")) drawFloodTrendChart(agg);
    if (document.getElementById("diseaseTotalChart")) drawDiseaseTotals(agg);
    if (document.getElementById("districtTotalCasesChart")) drawDistrictTotals(agg);
    if (document.getElementById("blockTotalCasesChart")) drawBlockTotals(agg);
    if (document.getElementById("geoTypeChart")) drawGeoType(agg);
    if (document.getElementById("rainfallVsTotalCasesChart")) drawRainfallVsCases(agg);
    if (document.getElementById("rainfallChart")) drawRainfallChart(agg);
    if (document.getElementById("floodStatusChart")) {
      drawDistributionChart(
        "floodStatusChart",
        "floodMeta",
        agg.flood,
        { No: "No flood", Moderate: "Moderate", Severe: "Severe", Unknown: "Unknown" },
        { No: theme.mint, Moderate: theme.amber, Severe: theme.signal, Unknown: theme.slate },
        agg.records
      );
    }
    if (document.getElementById("stagnantRiskChart")) {
      drawDistributionChart(
        "stagnantRiskChart",
        "stagnantMeta",
        agg.stagnant,
        { No: "No risk", Low: "Low", Medium: "Medium", High: "High", Unknown: "Unknown" },
        { No: theme.mint, Low: theme.mint, Medium: theme.amber, High: theme.signal, Unknown: theme.slate },
        agg.records
      );
    }
    if (document.getElementById("diarrheaScatterChart")) drawScatterChart(agg);
    if (document.getElementById("riskDonutChart")) drawRiskDonut(agg);
    updateChartMetaTotals(agg);
  }

  function drawRiskDonut(agg) {
    const counts = { Low: 0, Medium: 0, High: 0 };
    agg.riskDistricts.forEach((district) => {
      counts[district.band] += 1;
    });
    const total = agg.riskDistricts.length;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set("donutLow", counts.Low);
    set("donutMedium", counts.Medium);
    set("donutHigh", counts.High);
    set("donutTotal", total);
    frameState("riskDonutChart", total ? "ready" : "empty", "No districts in this selection");
    if (!total) return;
    draw(
      "riskDonutChart",
      "doughnut",
      {
        labels: ["Low", "Medium", "High"],
        datasets: [
          {
            data: [counts.Low, counts.Medium, counts.High],
            backgroundColor: [theme.mint, theme.amber, theme.signal],
            borderColor: theme.paper,
            borderWidth: 3,
            hoverOffset: 5
          }
        ]
      },
      baseOptions({
        cutout: "66%",
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipOptions(),
            callbacks: {
              label: (ctx) =>
                ` ${ctx.label} band: ${ctx.parsed} district${ctx.parsed === 1 ? "" : "s"} (${pct((ctx.parsed / total) * 100)})`
            }
          }
        }
      })
    );
  }

  // -------- Filter controls --------

  function buildControls() {
    if (!host) return;
    host.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "filter-bar";

    const years = [...new Set(rows.map(yearOf).filter(Boolean))].sort((a, b) => a - b);
    const districts = [...new Set(rows.map((row) => String(row.District)).filter(Boolean))].sort();
    if (!years.length) return;

    state.from = years[0];
    state.to = years[years.length - 1];

    const makeField = (labelText, id, options, value) => {
      const field = document.createElement("label");
      field.className = "filter-field";
      const label = document.createElement("span");
      label.textContent = labelText;
      const select = document.createElement("select");
      select.className = "filter-select";
      select.id = id;
      options.forEach(({ value: optionValue, label }) => {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = label;
        select.appendChild(option);
      });
      select.value = value;
      field.append(label, select);
      return { field, select };
    };

    const from = makeField(
      "From",
      "analyticsFrom",
      years.map((year) => ({ value: String(year), label: String(year) })),
      String(state.from)
    );
    const to = makeField(
      "To",
      "analyticsTo",
      years.map((year) => ({ value: String(year), label: String(year) })),
      String(state.to)
    );
    const district = makeField(
      "District",
      "analyticsDistrict",
      [{ value: "all", label: "All districts" }, ...districts.map((name) => ({ value: name, label: name }))],
      "all"
    );
    const disease = makeField(
      "Disease focus",
      "analyticsDisease",
      [{ value: ALL, label: "All diseases" }, ...COLUMNS.map((column) => ({ value: column, label: LABELS[column] }))],
      ALL
    );

    const reset = document.createElement("button");
    reset.className = "filter-reset";
    reset.type = "button";
    reset.textContent = "Reset";

    const summary = document.createElement("p");
    summary.className = "filter-summary";
    summary.id = "filterSummary";
    summary.setAttribute("aria-live", "polite");
    summaryEl = summary;

    const controls = document.createElement("div");
    controls.className = "filter-controls";
    controls.append(from.field, to.field, district.field, disease.field, reset);
    wrap.append(controls, summary);
    host.appendChild(wrap);

    host.classList.add("is-mounted");

    from.select.addEventListener("change", () => {
      state.from = Number(from.select.value);
      if (state.from > state.to) {
        state.to = state.from;
        to.select.value = String(state.to);
      }
      update();
    });
    to.select.addEventListener("change", () => {
      state.to = Number(to.select.value);
      if (state.to < state.from) {
        state.from = state.to;
        from.select.value = String(state.from);
      }
      update();
    });
    district.select.addEventListener("change", () => {
      state.district = district.select.value;
      update();
    });
    disease.select.addEventListener("change", () => {
      state.disease = disease.select.value;
      update();
    });
    reset.addEventListener("click", () => {
      state.from = years[0];
      state.to = years[years.length - 1];
      state.district = "all";
      state.disease = ALL;
      from.select.value = String(state.from);
      to.select.value = String(state.to);
      district.select.value = "all";
      disease.select.value = ALL;
      update();
    });

    host.dataset.state = "ready";
    delete host.dataset.message;
  }

  function syncControls() {
    if (!host) return;
    const from = host.querySelector("#analyticsFrom");
    const to = host.querySelector("#analyticsTo");
    const district = host.querySelector("#analyticsDistrict");
    const disease = host.querySelector("#analyticsDisease");
    if (from) from.value = String(state.from);
    if (to) to.value = String(state.to);
    if (district) district.value = state.district;
    if (disease) disease.value = state.disease;
    const reset = host.querySelector(".filter-reset");
    const defaultState =
      state.district === "all" &&
      state.disease === ALL &&
      state.from === Number(from?.options[0]?.value) &&
      state.to === Number(to?.options[to.options.length - 1]?.value);
    host.classList.toggle("is-filtered", !defaultState);
    if (reset) reset.disabled = defaultState;
  }

  function update({ silent = false } = {}) {
    const source = filteredRows();
    const agg = aggregate(source);
    lastAggregate = agg;
    syncControls();
    if (summaryEl) {
      summaryEl.textContent = `${fmt(source.length)} of ${fmt(rows.length)} records · ${diseaseLabel(state.disease)}`;
    }
    if (!source.length) {
      document.querySelectorAll(".chart-frame").forEach((frame) => {
        frame.dataset.state = "empty";
        frame.dataset.message = "No records match the selected filters";
      });
    } else {
      renderCharts(agg);
    }
    const payload = { rows: source, aggregate: agg, state: getState() };
    if (pageOnChange) pageOnChange(payload);
    if (!silent) subscribers.forEach((callback) => callback(payload));
  }

  function setState(patch) {
    Object.assign(state, patch);
    update();
  }

  function subscribe(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  function init(options) {
    rows = Array.isArray(options.rows) ? options.rows : [];
    host = options.controls || null;
    pageOnChange = options.onChange || null;
    applyDefaults(options.theme || "light");
    buildControls();
    update({ silent: true });
    return api;
  }

  function setStatus(status, message) {
    document.querySelectorAll(".chart-frame").forEach((frame) => {
      frame.dataset.state = status;
      if (message) frame.dataset.message = message;
    });
    const hostEl = host || document.querySelector(".analytics-filters");
    if (hostEl) {
      hostEl.dataset.state = status;
      if (message) hostEl.dataset.message = message;
      else delete hostEl.dataset.message;
    }
  }

  const api = {
    COLUMNS,
    ALL,
    diseaseLabel,
    init,
    update,
    setState,
    subscribe,
    getState,
    getFilteredRows: filteredRows,
    getAllRows: getRows,
    aggregate: () => lastAggregate,
    districtRisk,
    setStatus,
    formatNumber: fmt
  };

  window.SafeSipAnalytics = api;
})();

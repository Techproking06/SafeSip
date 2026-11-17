/* SafeSip sensor-layer simulation.
   Deterministic, seed-driven, browser-side feed for the 24-hour water trace.
   It is not connected to live field hardware, MQTT or HTTP ingestion. */
(function (root) {
  "use strict";

  const CONFIG = {
    seed: "KAV-01-20261117",
    intervalMs: 1500,
    sampleMinutes: 10,
    historyLength: 144,
    startMinute: 6 * 60,
    baseline: { turbidity: 1.35, ph: 7.1, tds: 208 },
    thresholds: {
      turbidity: { warn: 2.8, alert: 4.5, meterMax: 6 },
      ph: { lowWarn: 6.9, highWarn: 7.4, lowAlert: 6.6, highAlert: 8.0 },
      tds: { warn: 280, alert: 340, meterMax: 600 }
    }
  };

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function round(v, decimals) {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
  }

  function clockLabel(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const min = String(m % 60).padStart(2, "0");
    return `${h}:${min}`;
  }

  /* Generate one sample from the current generator state. The diurnal
     component is a pure function of the sample index; all randomness flows
     through the seeded RNG, so the whole series replays identically. */
  function generateSample(tick, rng, event) {
    const hourWave = Math.sin((tick / CONFIG.historyLength) * Math.PI * 2 + 0.7);

    let turbBoost = 0;
    let tdsBoost = 0;
    let phDip = 0;
    if (event) {
      const p = event.progress;
      const shape = Math.sin(clamp(p, 0, 1) * Math.PI);
      turbBoost = event.turbBoost * shape;
      tdsBoost = event.tdsBoost * shape;
      phDip = event.phDip * shape;
      event.progress += 1 / event.duration;
      if (event.progress >= 1) event.done = true;
    }

    const turbidity = round(CONFIG.baseline.turbidity + 0.3 * hourWave + (rng() - 0.5) * 0.42 + turbBoost, 2);
    const tds = round(CONFIG.baseline.tds + 9 * Math.sin((tick / CONFIG.historyLength) * Math.PI * 2 - 0.4) + (rng() - 0.5) * 14 + tdsBoost, 1);
    const ph = round(CONFIG.baseline.ph + 0.09 * Math.sin((tick / CONFIG.historyLength) * Math.PI * 2 - 1.1) + (rng() - 0.5) * 0.075 - phDip, 3);

    return { t: CONFIG.startMinute + tick * CONFIG.sampleMinutes, turbidity, ph, tds, eventId: event ? event.id : null };
  }

  function initState() {
    const rng = mulberry32(hashSeed(CONFIG.seed));
    const state = {
      rng,
      tick: 0,
      event: null,
      eventSeq: 0,
      history: []
    };

    for (let i = 0; i < CONFIG.historyLength; i += 1) {
      step(state, true);
    }
    return state;
  }

  function step(state, fastForward) {
    if (!state.event && state.rng() < 0.016) {
      state.eventSeq += 1;
      state.event = {
        id: state.eventSeq,
        progress: 0,
        duration: 3 + Math.floor(state.rng() * 4),
        turbBoost: 2.6 + state.rng() * 3.2,
        tdsBoost: 55 + state.rng() * 150,
        phDip: 0.22 + state.rng() * 0.45
      };
    }

    const sample = generateSample(state.tick, state.rng, state.event);
    if (state.event && state.event.done) state.event = null;
    state.tick += 1;
    state.history.push(sample);
    if (state.history.length > CONFIG.historyLength) state.history.shift();
    return sample;
  }

  function statuses(sample) {
    const t = CONFIG.thresholds;
    let turbidity = "clear";
    if (sample.turbidity >= t.turbidity.alert) turbidity = "alert";
    else if (sample.turbidity >= t.turbidity.warn) turbidity = "warn";

    let ph = "neutral";
    if (sample.ph <= t.ph.lowAlert || sample.ph >= t.ph.highAlert) ph = "alert";
    else if (sample.ph <= t.ph.lowWarn || sample.ph >= t.ph.highWarn) ph = "warn";

    let tds = "normal";
    if (sample.tds >= t.tds.alert) tds = "alert";
    else if (sample.tds >= t.tds.warn) tds = "warn";

    const spike = turbidity === "alert" || tds === "alert" || ph === "alert";
    return { turbidity, ph, tds, spike };
  }

  function countSpikeEpisodes(history) {
    let episodes = 0;
    let inSpike = false;
    for (const sample of history) {
      const spike = statuses(sample).spike;
      if (spike && !inSpike) episodes += 1;
      inSpike = spike;
    }
    return episodes;
  }

  const SafeSipSensorSim = {
    config: CONFIG,

    snapshot() {
      if (!this._state) this._state = initState();
      const latest = this._state.history[this._state.history.length - 1];
      const status = statuses(latest);
      return {
        clock: clockLabel(latest.t),
        current: latest,
        status,
        spikeCount: countSpikeEpisodes(this._state.history),
        running: this._running !== false,
        history: this._state.history.map((sample) => ({ ...sample, label: clockLabel(sample.t) }))
      };
    },

    advance() {
      if (!this._state) this._state = initState();
      const previous = this._state.history[this._state.history.length - 1];
      step(this._state, false);
      const latest = this._state.history[this._state.history.length - 1];
      const prevSpike = statuses(previous).spike;
      const spikeNow = statuses(latest).spike;
      this._lastTransition = spikeNow && !prevSpike ? "anomaly" : !spikeNow && prevSpike ? "recovered" : null;
      return this._lastTransition;
    },

    reset() {
      this._state = initState();
      this._lastTransition = null;
      return this.snapshot();
    },

    _selfCheck() {
      const a = initState();
      const b = initState();
      const same = a.history.length === b.history.length &&
        a.history.every((sample, i) =>
          sample.turbidity === b.history[i].turbidity &&
          sample.ph === b.history[i].ph &&
          sample.tds === b.history[i].tds);
      if (!same) throw new Error("Sensor simulation is not deterministic for the configured seed.");
      return true;
    }
  };

  SafeSipSensorSim._selfCheck();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SafeSipSensorSim;
  } else {
    root.SafeSipSensorSim = SafeSipSensorSim;
  }
})(typeof window !== "undefined" ? window : globalThis);

/* Concrete Maturity Meter — dashboard logic
 *
 * Sections of this file:
 *   1. Helpers & icons
 *   2. Settings (saved in localStorage)
 *   3. State + maturity maths (Nurse-Saul)
 *   4. Data sources  <-- the ONLY place that knows where readings come from
 *   5. Charts (small dependency-free SVG line chart)
 *   6. Rendering
 *   7. Events
 *
 * To connect real hardware, pick "ESP32 over HTTP" in Settings (see README.md).
 * Everything downstream calls addSample(temp, t, wall, source) and nothing else.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Helpers & icons
   * ------------------------------------------------------------------ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const ICONS = {
    logo: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M12 22V12"/><path d="m3 7 9 5 9-5"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    layout: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    thermo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
  };

  function icon(name, size) {
    return '<svg class="icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') + '</svg>';
  }
  function hydrateIcons() {
    $$('[data-icon]').forEach(function (el) {
      el.innerHTML = icon(el.dataset.icon, parseInt(el.dataset.size || '18', 10));
    });
  }

  function minus(s) { return s.replace(/^-/, '−'); }
  function fmtNum(n, d) {
    if (!Number.isFinite(n)) return '--';
    d = d == null ? 1 : d;
    return minus(n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
  }
  function fmtDuration(h) {
    if (!Number.isFinite(h)) return '--';
    const totalMin = Math.round(h * 60);
    if (totalMin < 60) return totalMin + ' min';
    if (h < 48) {
      const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
      return mm ? hh + ' h ' + mm + ' m' : hh + ' h';
    }
    let d = Math.floor(h / 24), hh = Math.round(h - d * 24);
    if (hh === 24) { d += 1; hh = 0; }
    return d + ' d ' + hh + ' h';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function downsample(arr, max) {
    if (arr.length <= max) return arr;
    const step = arr.length / max, out = [];
    for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
    out[out.length - 1] = arr[arr.length - 1];
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 2. Settings
   * ------------------------------------------------------------------ */
  const SETTINGS_KEY = 'cmm.settings.v1';
  const DEFAULTS = {
    datum: -10,          // Nurse-Saul datum temperature T0 (°C)
    refTemp: 20,         // reference temperature for equivalent age (°C)
    mode: 'sim',         // 'sim' | 'esp'
    speed: 600,          // simulation speed multiplier
    endpoint: 'http://192.168.4.1/api/latest',
    pollSec: 2,
    calA: null,          // strength = a + b * ln(M)
    calB: null,
    calDemo: false
  };
  const DEMO_CAL = { a: -40, b: 12 }; // placeholders only — NOT validated for any mix

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* storage unavailable: use defaults */ }
    return Object.assign({}, DEFAULTS);
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }
  const settings = loadSettings();
  if (settings.mode !== 'sim' && settings.mode !== 'esp') settings.mode = 'sim';

  /* ------------------------------------------------------------------ *
   * 3. State + maturity maths
   * ------------------------------------------------------------------ */
  const state = {
    samples: [],        // { t: hours since start, temp: °C, wall: ms epoch, m: °C·h, src }
    running: false,
    status: 'offline',  // for ESP mode: 'connecting' | 'connected' | 'offline'
    lastError: null
  };

  /* Nurse-Saul: M = Σ (Ta − T0) · Δt, counting only intervals where Ta > T0.
   * Ta is the average of the two readings that bound the interval (trapezoid rule),
   * Δt is the elapsed (simulated) time between them in hours. */
  function maturityIncrement(prev, cur) {
    const dt = cur.t - prev.t;
    if (!(dt > 0)) return 0;
    const avg = (cur.temp + prev.temp) / 2;
    return Math.max(avg - settings.datum, 0) * dt;
  }
  function addSample(temp, t, wall, src) {
    const S = state.samples;
    const s = { t: t, temp: temp, wall: wall, m: 0, src: src };
    if (S.length) s.m = S[S.length - 1].m + maturityIncrement(S[S.length - 1], s);
    S.push(s);
  }
  function recomputeMaturity() {
    const S = state.samples;
    for (let i = 0; i < S.length; i++) {
      S[i].m = i === 0 ? 0 : S[i - 1].m + maturityIncrement(S[i - 1], S[i]);
    }
  }
  function equivalentAge(M) {
    const span = settings.refTemp - settings.datum;
    return span > 0 ? M / span : NaN;
  }
  function calibrated() {
    return Number.isFinite(settings.calA) && Number.isFinite(settings.calB);
  }
  function strengthFor(M) {
    if (!calibrated() || !(M > 0)) return null;
    return Math.max(0, settings.calA + settings.calB * Math.log(M));
  }

  /* ------------------------------------------------------------------ *
   * 4. Data sources
   * ------------------------------------------------------------------ */
  let timer = null;
  let simT = 0, lastPerf = 0;
  let pollAbort = null, runStartPerf = 0, runBaseT = 0;

  /* --- Simulation: plausible curing curve --------------------------- */
  function simTemperature(t) {
    const ambient = 25 + 3 * Math.sin(2 * Math.PI * (t - 8) / 24);     // day/night swing
    const hydration = 13 * (t / 9) * Math.exp(1 - t / 9);               // heat of hydration, peaks at 9 h
    const noise = (Math.random() - 0.5) * 0.3;
    const v = ambient + hydration + noise;
    return Math.round(v / 0.0625) * 0.0625;                             // DS18B20 12-bit resolution
  }
  function simTick() {
    const now = performance.now();
    // Cap the step so a sleeping laptop / background tab doesn't jump the curve.
    const dtReal = Math.min((now - lastPerf) / 1000, 5);
    lastPerf = now;
    simT += dtReal * settings.speed / 3600;                             // simulated hours elapsed
    addSample(simTemperature(simT), simT, Date.now(), 'Simulated');
    render();
  }

  /* --- ESP32 (or FastAPI) over HTTP --------------------------------- */
  function parseTemperature(data) {
    const keys = ['temperature_c', 'temperature', 'temp'];
    let v;
    for (let i = 0; i < keys.length; i++) {
      if (data && typeof data[keys[i]] === 'number') { v = data[keys[i]]; break; }
    }
    if (!Number.isFinite(v)) throw new Error('Response has no "temperature_c" number');
    if (v === -127 || v < -55 || v > 125) throw new Error('Sensor fault (value ' + v + ' °C)');
    return v;
  }
  async function pollOnce() {
    if (!state.running || settings.mode !== 'esp') return;
    const ctrl = new AbortController();
    pollAbort = ctrl;
    const to = setTimeout(function () { ctrl.abort(); }, 4000);
    try {
      const res = await fetch(settings.endpoint, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('Device answered HTTP ' + res.status);
      const temp = parseTemperature(await res.json());
      // Time axis: continue from where the last run ended, advance by real elapsed time.
      const t = runBaseT + (performance.now() - runStartPerf) / 3.6e6;
      addSample(temp, t, Date.now(), 'ESP32');
      state.status = 'connected';
      state.lastError = null;
    } catch (err) {
      if (!state.running) return;
      state.status = 'offline';
      state.lastError = err.name === 'AbortError' ? 'Request timed out'
        : err instanceof TypeError ? 'Cannot reach device (check URL, Wi-Fi and CORS)'
        : err.message || 'Request failed';
    } finally {
      clearTimeout(to);
    }
    if (state.running && settings.mode === 'esp') {
      render();
      timer = setTimeout(pollOnce, settings.pollSec * 1000);
    }
  }

  /* --- Start / stop -------------------------------------------------- */
  function lastT() {
    const S = state.samples;
    return S.length ? S[S.length - 1].t : 0;
  }
  function start() {
    if (state.running) return;
    state.running = true;
    state.lastError = null;
    if (settings.mode === 'sim') {
      simT = lastT();
      lastPerf = performance.now();
      if (!state.samples.length) addSample(simTemperature(0), 0, Date.now(), 'Simulated');
      timer = setInterval(simTick, 1000);
    } else {
      state.status = 'connecting';
      runBaseT = lastT();
      runStartPerf = performance.now();
      pollOnce();
    }
    render();
  }
  function stop() {
    state.running = false;
    clearInterval(timer);
    clearTimeout(timer);
    timer = null;
    if (pollAbort) { pollAbort.abort(); pollAbort = null; }
    state.status = 'offline';
    render();
  }
  function resetData() {
    stop();
    state.samples = [];
    state.lastError = null;
    render();
  }

  /* ------------------------------------------------------------------ *
   * 5. Charts
   * ------------------------------------------------------------------ */
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / (count - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return { lo: lo, hi: hi, ticks: ticks };
  }
  function timeTicks(x0, x1) {
    const steps = [1 / 60, 5 / 60, 10 / 60, 0.25, 0.5, 1, 2, 3, 4, 6, 12, 24, 48, 72, 168, 336, 720];
    const range = x1 - x0;
    let step = steps[steps.length - 1];
    for (let i = 0; i < steps.length; i++) { if (range / steps[i] <= 6) { step = steps[i]; break; } }
    const ticks = [];
    for (let v = Math.ceil(x0 / step - 1e-9) * step; v <= x1 + 1e-9; v += step) ticks.push(v);
    return { ticks: ticks, step: step };
  }
  function tickLabel(h, step) {
    if (Math.abs(h) < 1e-9) return '0';
    if (step < 1) return Math.round(h * 60) + ' min';
    if (step < 24) return +h.toFixed(2) + ' h';
    return +(h / 24).toFixed(2) + ' d';
  }
  function yLabel(v) {
    return minus(Number.isInteger(v) ? v.toLocaleString('en-IN') : String(+v.toFixed(2)));
  }

  class LineChart {
    constructor(el, opts) {
      this.el = el;
      this.o = Object.assign({ height: 300, decimals: 1, unit: '', color: '#2f5bea', zero: false, name: 'Chart' }, opts);
      this.points = [];
      this.geo = null;
      this.hoverX = null;
      el.classList.add('chart');
      el.style.height = this.o.height + 'px';
      el.innerHTML = '<div class="chart-svg"></div><div class="chart-empty">No readings yet. Start the acquisition to see data.</div><div class="tooltip" role="presentation"></div>';
      this.host = el.querySelector('.chart-svg');
      this.empty = el.querySelector('.chart-empty');
      this.tip = el.querySelector('.tooltip');
      const self = this;
      el.addEventListener('pointermove', function (e) {
        self.hoverX = e.clientX - self.el.getBoundingClientRect().left;
        self.drawHover();
      });
      el.addEventListener('pointerleave', function () { self.hoverX = null; self.drawHover(); });
      if (window.ResizeObserver) new ResizeObserver(function () { self.render(); }).observe(el);
    }

    setData(points) { this.points = points; this.render(); }

    render() {
      const w = this.el.clientWidth, h = this.o.height;
      const pts = downsample(this.points, 400);
      if (!w) return;
      if (!pts.length) {
        this.host.innerHTML = '';
        this.empty.style.display = 'flex';
        this.geo = null;
        this.drawHover();
        return;
      }
      this.empty.style.display = 'none';

      const m = { t: 14, r: 18, b: 30, l: 54 };
      const xs = pts.map(function (p) { return p.x; });
      const ys = pts.map(function (p) { return p.y; });
      let x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      if (x1 - x0 < 1e-9) x1 = x0 + 1;
      let yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
      const pad = (yMax - yMin) * 0.08 || 0.5;
      yMin = this.o.zero ? 0 : yMin - pad;
      yMax = yMax + pad;
      const yt = niceTicks(yMin, yMax, 5);
      const xt = timeTicks(x0, x1);

      const sx = function (x) { return m.l + (x - x0) / (x1 - x0) * (w - m.l - m.r); };
      const sy = function (y) { return m.t + (1 - (y - yt.lo) / (yt.hi - yt.lo)) * (h - m.t - m.b); };
      const base = h - m.b;
      const c = this.o.color;

      let s = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(this.o.name) + ' chart">';
      yt.ticks.forEach(function (t) {
        const y = sy(t).toFixed(1);
        s += '<line class="grid" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y + '" y2="' + y + '"/>' +
             '<text x="' + (m.l - 10) + '" y="' + (+y + 4) + '" text-anchor="end">' + yLabel(t) + '</text>';
      });
      s += '<line class="axis-line" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + base + '" y2="' + base + '"/>';
      xt.ticks.forEach(function (v) {
        const x = sx(v).toFixed(1);
        s += '<line class="axis-line" x1="' + x + '" x2="' + x + '" y1="' + base + '" y2="' + (base + 4) + '"/>' +
             '<text x="' + x + '" y="' + (h - 8) + '" text-anchor="middle">' + tickLabel(v, xt.step) + '</text>';
      });

      let d = '';
      pts.forEach(function (p, i) { d += (i ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1); });
      const area = d + 'L' + sx(pts[pts.length - 1].x).toFixed(1) + ' ' + base + 'L' + sx(pts[0].x).toFixed(1) + ' ' + base + 'Z';
      s += '<path d="' + area + '" fill="' + c + '" fill-opacity="0.08"/>';
      s += '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';

      const lp = pts[pts.length - 1];
      s += '<circle cx="' + sx(lp.x).toFixed(1) + '" cy="' + sy(lp.y).toFixed(1) + '" r="8" fill="' + c + '" fill-opacity="0.15"/>' +
           '<circle cx="' + sx(lp.x).toFixed(1) + '" cy="' + sy(lp.y).toFixed(1) + '" r="4" fill="' + c + '" stroke="#fff" stroke-width="2"/>';

      s += '<g class="hover" style="display:none"><line class="hline" y1="' + m.t + '" y2="' + base + '"/>' +
           '<circle r="4.5" fill="#fff" stroke="' + c + '" stroke-width="2"/></g></svg>';
      this.host.innerHTML = s;
      this.geo = { m: m, w: w, pts: pts, sx: sx, sy: sy };
      this.drawHover();
    }

    drawHover() {
      const g = this.host.querySelector('.hover');
      if (!g || !this.geo || this.hoverX == null) {
        if (g) g.style.display = 'none';
        this.tip.style.opacity = 0;
        return;
      }
      const geo = this.geo, pts = geo.pts;
      let best = 0, bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dd = Math.abs(geo.sx(pts[i].x) - this.hoverX);
        if (dd < bd) { bd = dd; best = i; }
      }
      const p = pts[best], px = geo.sx(p.x), py = geo.sy(p.y);
      g.style.display = '';
      const line = g.querySelector('line'), dot = g.querySelector('circle');
      line.setAttribute('x1', px); line.setAttribute('x2', px);
      dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      this.tip.innerHTML = '<div class="tt-label">Elapsed ' + fmtDuration(p.x) + '</div>' +
        '<div class="tt-value">' + fmtNum(p.y, this.o.decimals) + ' ' + esc(this.o.unit) + '</div>';
      this.tip.style.left = px + 'px';
      this.tip.style.top = py + 'px';
      this.tip.classList.toggle('flip', px > geo.w * 0.6);
      this.tip.style.opacity = 1;
    }
  }

  function sparkline(vals, color) {
    if (vals.length < 2) return '';
    vals = downsample(vals, 50);
    const w = 110, h = 36, p = 3;
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 1e-9) { hi = lo + 1; }
    let d = '';
    vals.forEach(function (v, i) {
      const x = p + i / (vals.length - 1) * (w - 2 * p);
      const y = p + (1 - (v - lo) / (hi - lo)) * (h - 2 * p);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  const tempChart = new LineChart($('#chartTemp'), { height: 300, decimals: 2, unit: '°C', color: '#2f5bea', name: 'Temperature' });
  const matChart = new LineChart($('#chartMat'), { height: 300, decimals: 1, unit: '°C·h', color: '#0e7490', name: 'Maturity', zero: true });

  /* ------------------------------------------------------------------ *
   * 6. Rendering
   * ------------------------------------------------------------------ */
  function statusInfo() {
    const S = state.samples, last = S.length ? S[S.length - 1] : null;
    if (!state.running) {
      return { key: 'offline', label: 'Offline', detail: S.length ? 'Acquisition stopped' : 'No data acquired yet' };
    }
    if (settings.mode === 'sim') {
      return { key: 'simulated', label: 'Simulated', detail: 'Software model, no hardware attached' };
    }
    if (state.status === 'connected' && last) {
      const age = Math.max(0, Math.round((Date.now() - last.wall) / 1000));
      return { key: 'connected', label: 'Connected', detail: 'ESP32 · last reading ' + age + ' s ago' };
    }
    if (state.status === 'connecting') {
      return { key: 'connecting', label: 'Connecting', detail: 'Contacting device…' };
    }
    return { key: 'offline', label: 'Offline', detail: state.lastError || 'Device unreachable' };
  }

  const CHIP_BY_STATUS = { simulated: 'chip--blue', connected: 'chip--green', offline: 'chip--gray', connecting: 'chip--amber' };

  function renderSensor() {
    const info = statusInfo();
    $('#connPill').className = 'pill pill--' + info.key + (state.running ? ' is-running' : '');
    $('#connText').textContent = 'Sensor · ' + info.label;
    $('#valSensor').textContent = info.label;
    $('#sensorDetail').textContent = info.detail;
    $('#sensorChip').className = 'chip ' + CHIP_BY_STATUS[info.key];
  }

  function render() {
    const S = state.samples, n = S.length;
    const last = n ? S[n - 1] : null, prev = n > 1 ? S[n - 2] : null;
    const isSim = settings.mode === 'sim';

    renderSensor();
    $('#notice').classList.toggle('is-hidden', !isSim);
    $('#sbDatum').textContent = fmtNum(settings.datum, 1).replace('.0', '') + ' °C';
    $('#sbSource').textContent = isSim ? 'Simulated' : 'ESP32 (HTTP)';

    /* metric cards */
    $('#valTemp').textContent = last ? fmtNum(last.temp, 1) : '--';
    if (prev) {
      const diff = last.temp - prev.temp;
      $('#tempDelta').textContent = (diff >= 0 ? '+' : '−') + Math.abs(diff).toFixed(2) + ' °C vs previous';
    } else {
      $('#tempDelta').textContent = 'Waiting for data';
    }
    const recent = S.slice(-60);
    $('#sparkTemp').innerHTML = sparkline(recent.map(function (s) { return s.temp; }), '#2f5bea');
    $('#sparkMat').innerHTML = sparkline(recent.map(function (s) { return s.m; }), '#0e7490');

    const M = last ? last.m : NaN;
    $('#valMat').textContent = last ? fmtNum(M, 1) : '--';
    $('#matEq').textContent = last
      ? 'Equivalent age ' + fmtDuration(equivalentAge(M)) + ' @ ' + fmtNum(settings.refTemp, 0) + ' °C'
      : 'Equivalent age —';

    const strengthWrap = $('#strengthWrap');
    if (!calibrated()) {
      strengthWrap.classList.add('value--text');
      $('#valStrength').textContent = 'Calibration required';
      $('#strengthUnit').classList.add('is-hidden');
      $('#strengthDetail').textContent = 'Set coefficients in Settings';
    } else {
      strengthWrap.classList.remove('value--text');
      $('#strengthUnit').classList.remove('is-hidden');
      const sv = last ? strengthFor(M) : null;
      $('#valStrength').textContent = sv == null ? '--' : fmtNum(sv, 1);
      $('#strengthDetail').textContent = settings.calDemo ? 'Demo values · not validated' : 'User calibration · S = a + b·ln(M)';
    }

    /* chart badges + data */
    $$('#badgeTemp, #badgeMat').forEach(function (b) {
      b.textContent = isSim ? 'SIMULATED' : 'LIVE';
      b.className = 'badge ' + (isSim ? 'badge--sim' : 'badge--live');
    });
    const view = downsample(S, 400);
    tempChart.setData(view.map(function (s) { return { x: s.t, y: s.temp }; }));
    matChart.setData(view.map(function (s) { return { x: s.t, y: s.m }; }));

    renderLive(last, prev, isSim);
    renderHistory(S);
  }

  function renderLive(last, prev, isSim) {
    const running = state.running;
    $('#runIndicator').classList.toggle('is-running', running);
    $('#runText').textContent = isSim
      ? (running ? 'Simulation running · ' + settings.speed + '×' : 'Simulation stopped')
      : (running ? 'Monitoring ESP32' : 'Monitoring stopped');
    $('#startLabel').textContent = isSim ? 'Start Simulation' : 'Start Monitoring';
    $('#stopLabel').textContent = isSim ? 'Stop Simulation' : 'Stop Monitoring';
    $('#btnStart').disabled = running;
    $('#btnStop').disabled = !running;
    $('#ctlTitle').textContent = isSim ? 'Simulation control' : 'Device monitoring';
    $('#ctlSub').textContent = isSim ? 'Generates a realistic curing temperature curve.' : 'Polls your ESP32 for live temperature readings.';
    $('#speedField').classList.toggle('is-hidden', !isSim);
    $$('#speedSeg button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(parseInt(b.dataset.speed, 10) === settings.speed));
    });
    $('#speedNote').textContent = isSim
      ? '1 s of real time = ' + fmtNum(settings.speed / 60, 0) + ' min of simulated curing time.'
      : 'Polling ' + settings.endpoint + ' every ' + settings.pollSec + ' s.';
    $('#elapsedLabel').textContent = isSim ? 'Simulated curing time' : 'Elapsed time';
    $('#liveElapsed').textContent = last ? fmtDuration(last.t) : '0 min';
    $('#liveSamples').textContent = state.samples.length.toLocaleString('en-IN');
    $('#liveLast').textContent = last ? new Date(last.wall).toLocaleTimeString('en-GB') : '—';

    /* step-by-step Nurse-Saul breakdown */
    const T0 = settings.datum;
    $('#kvT0').textContent = fmtNum(T0, 1) + ' °C';
    $('#kvTeLabel').textContent = 'Equivalent age @ ' + fmtNum(settings.refTemp, 0) + ' °C';
    if (last) {
      const avg = prev ? (last.temp + prev.temp) / 2 : last.temp;
      const dt = prev ? last.t - prev.t : 0;
      $('#kvTa').textContent = fmtNum(avg, 2) + ' °C';
      $('#kvEff').textContent = fmtNum(Math.max(avg - T0, 0), 2) + ' °C';
      $('#kvDt').textContent = prev ? fmtNum(dt * 60, 1) + ' min' : '—';
      $('#kvInc').textContent = prev ? fmtNum(last.m - prev.m, 2) + ' °C·h' : '—';
      $('#kvM').textContent = fmtNum(last.m, 1) + ' °C·h';
      $('#kvTe').textContent = fmtDuration(equivalentAge(last.m));
    } else {
      ['#kvTa', '#kvEff', '#kvDt', '#kvInc', '#kvM', '#kvTe'].forEach(function (id) { $(id).textContent = '—'; });
    }
  }

  function renderHistory(S) {
    const n = S.length;
    if (n) {
      let mn = Infinity, mx = -Infinity, sum = 0;
      for (let i = 0; i < n; i++) { const v = S[i].temp; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
      $('#stMin').textContent = fmtNum(mn, 1) + ' °C';
      $('#stMax').textContent = fmtNum(mx, 1) + ' °C';
      $('#stAvg').textContent = fmtNum(sum / n, 1) + ' °C';
    } else {
      $('#stMin').textContent = $('#stMax').textContent = $('#stAvg').textContent = '—';
    }
    $('#stN').textContent = n.toLocaleString('en-IN');

    const body = $('#histBody');
    if (!n) {
      body.innerHTML = '<tr><td class="empty" colspan="5">No readings yet. Start the acquisition to collect data.</td></tr>';
      return;
    }
    let rows = '';
    for (let i = n - 1, k = 0; i >= 0 && k < 12; i--, k++) {
      const s = S[i];
      rows += '<tr><td>' + fmtDuration(s.t) + '</td>' +
        '<td>' + new Date(s.wall).toLocaleTimeString('en-GB') + '</td>' +
        '<td class="num">' + fmtNum(s.temp, 2) + ' °C</td>' +
        '<td class="num">' + fmtNum(s.m, 1) + ' °C·h</td>' +
        '<td><span class="src-tag' + (s.src === 'Simulated' ? '' : ' src-tag--live') + '">' + esc(s.src.toUpperCase()) + '</span></td></tr>';
    }
    body.innerHTML = rows;
  }

  function tickClock() {
    const now = new Date();
    $('#clock').textContent =
      now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) +
      ' · ' + now.toLocaleTimeString('en-GB');
    renderSensor(); // keeps "last reading N s ago" fresh between polls
  }

  /* ------------------------------------------------------------------ *
   * 7. Events
   * ------------------------------------------------------------------ */
  function exportCsv() {
    const S = state.samples;
    let csv = 'elapsed_h,timestamp_iso,temperature_c,maturity_c_h,source\n';
    S.forEach(function (s) {
      csv += [s.t.toFixed(5), new Date(s.wall).toISOString(), s.temp.toFixed(4), s.m.toFixed(3), s.src].join(',') + '\n';
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'concrete-maturity-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  let msgTimer = null;
  function flash(msg) {
    const el = $('#setMsg');
    el.textContent = msg;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { el.textContent = ''; }, 5000);
  }

  function syncSettingsInputs() {
    $('#setDatum').value = settings.datum;
    $('#setRef').value = settings.refTemp;
    $('#setMode').value = settings.mode;
    $('#setEndpoint').value = settings.endpoint;
    $('#setPoll').value = settings.pollSec;
    $('#setCalA').value = settings.calA == null ? '' : settings.calA;
    $('#setCalB').value = settings.calB == null ? '' : settings.calB;
    $('#fieldEndpoint').classList.toggle('is-hidden', settings.mode !== 'esp');
    $('#fieldPoll').classList.toggle('is-hidden', settings.mode !== 'esp');
  }

  function bindEvents() {
    $('#btnStart').addEventListener('click', start);
    $('#btnStop').addEventListener('click', stop);
    $('#btnExport').addEventListener('click', exportCsv);
    $('#btnExport2').addEventListener('click', exportCsv);
    $('#btnReset').addEventListener('click', function () {
      if (!state.samples.length || confirm('Clear all readings and restart maturity from zero?')) resetData();
    });

    $$('#speedSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        settings.speed = parseInt(b.dataset.speed, 10);
        saveSettings();
        render();
      });
    });

    $('#setDatum').addEventListener('change', function (e) {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v) || v < -30 || v > 15) { flash('Datum temperature must be between −30 and 15 °C.'); syncSettingsInputs(); return; }
      if (settings.refTemp - v < 1) { flash('Datum must be at least 1 °C below the reference temperature.'); syncSettingsInputs(); return; }
      settings.datum = v; saveSettings(); recomputeMaturity(); render();
    });
    $('#setRef').addEventListener('change', function (e) {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v) || v < 5 || v > 40) { flash('Reference temperature must be between 5 and 40 °C.'); syncSettingsInputs(); return; }
      if (v - settings.datum < 1) { flash('Reference temperature must be at least 1 °C above the datum.'); syncSettingsInputs(); return; }
      settings.refTemp = v; saveSettings(); render();
    });
    $('#setMode').addEventListener('change', function (e) {
      const next = e.target.value;
      if (next === settings.mode) return;
      if (state.samples.length && !confirm('Switching source clears the current readings. Continue?')) { syncSettingsInputs(); return; }
      resetData();
      settings.mode = next;
      saveSettings();
      syncSettingsInputs();
      render();
    });
    $('#setEndpoint').addEventListener('change', function (e) {
      const v = e.target.value.trim();
      if (!/^https?:\/\/\S+$/i.test(v)) { flash('Endpoint must start with http:// or https://'); syncSettingsInputs(); return; }
      settings.endpoint = v; saveSettings(); render();
    });
    $('#setPoll').addEventListener('change', function (e) {
      const v = parseInt(e.target.value, 10);
      if (!Number.isFinite(v) || v < 1 || v > 60) { flash('Poll interval must be between 1 and 60 seconds.'); syncSettingsInputs(); return; }
      settings.pollSec = v; saveSettings(); render();
    });

    function readCal() {
      const a = parseFloat($('#setCalA').value), b = parseFloat($('#setCalB').value);
      settings.calA = Number.isFinite(a) ? a : null;
      settings.calB = Number.isFinite(b) ? b : null;
      settings.calDemo = false;
      saveSettings(); render();
    }
    $('#setCalA').addEventListener('change', readCal);
    $('#setCalB').addEventListener('change', readCal);
    $('#btnDemoCal').addEventListener('click', function () {
      settings.calA = DEMO_CAL.a; settings.calB = DEMO_CAL.b; settings.calDemo = true;
      saveSettings(); syncSettingsInputs(); render();
    });
    $('#btnClearCal').addEventListener('click', function () {
      settings.calA = null; settings.calB = null; settings.calDemo = false;
      saveSettings(); syncSettingsInputs(); render();
    });

    /* sidebar: highlight the section in view */
    const links = $$('.nav-link');
    function setActive(id) {
      links.forEach(function (l) { l.classList.toggle('active', l.dataset.target === id); });
    }
    links.forEach(function (l) { l.addEventListener('click', function () { setActive(l.dataset.target); }); });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) setActive(en.target.id); });
      }, { rootMargin: '-30% 0px -60% 0px' });
      ['overview', 'live', 'history', 'settings'].forEach(function (id) { io.observe($('#' + id)); });
    }
  }

  /* ---------- boot ---------- */
  hydrateIcons();
  syncSettingsInputs();
  bindEvents();
  tickClock();
  setInterval(tickClock, 1000);
  render();

  // Small read-only handle for debugging / automated checks from the browser console.
  window.cmm = { state: state, settings: settings, start: start, stop: stop };
})();

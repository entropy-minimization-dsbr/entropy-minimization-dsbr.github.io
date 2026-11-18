// Interactive demo: share of the total weight per predicted class, live.
// Drawing is incremental: each new batch is painted once into a cached stream
// image, and the weight chart's SVG is built once and only updated, so the demo
// stays light on phones.
(() => {
  const L = window.DSBRLab, M = window.LAB_MODELS;
  const $ = (s, r = document) => r.querySelector(s);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = { ink: css("--ink") || "#272727", muted: css("--muted") || "#5f5f66", line: css("--line") || "#e2e2e6", em: css("--em") || "#b64342" };
  // Class hues from the Nature figure palette (blue, teal, green, rose, violet, grey).
  const CLS = ["#3775ba", "#42949e", "#8bcf8b", "#e9a6a1", "#9a4d8e", "#8c8c8c"];
  const LETTER = "ABCDEF";
  const N = 1200, SMOOTH = 10, EVERY = 10, COLLAPSE = 0.95, ALPHA = 0.9, W_MAX = 5, RATE = 30;
  // Per class count: a shift where Entropy Minimization collapses within the run.
  const DEFAULT_SHIFT = { 2: 0.85, 3: 0.85, 6: 0.9 };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
  // Canvas fonts use plain weights and a generic family, which every browser's canvas accepts.
  const font = (px, bold) => `${bold ? "bold " : ""}${px}px Helvetica, Arial, sans-serif`;
  const M_L = 36, M_R = 6, M_T = 6, M_B = 22;

  const st = { K: 6, B: 32, shift: DEFAULT_SHIFT[6], playing: !reduced, hover: null };
  const panels = ["EM", "DSBR"].map((method) => {
    const el = $(`.panel[data-method=${method}]`);
    return { method, el, stream: $("[data-stream]", el), weights: $("[data-weights]", el), status: $("[data-status]", el), readout: $("[data-readout]", el), cache: document.createElement("canvas"), bars: null, painted: 0 };
  });
  let run;

  function seg(host, values, value, onChange) {
    host.textContent = "";
    const btns = values.map((v) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.textContent = v; b.dataset.value = v;
      host.appendChild(b);
      return b;
    });
    const set = (v) => btns.forEach((b) => { const on = b.dataset.value === String(v); b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
    btns.forEach((b, i) => {
      b.addEventListener("click", () => { set(b.dataset.value); onChange(+b.dataset.value); });
      b.addEventListener("keydown", (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const n = btns[(i + d + btns.length) % btns.length];
        n.focus(); set(n.dataset.value); onChange(+n.dataset.value);
      });
    });
    set(value);
    return set;
  }

  /* ---------- Simulation ---------- */
  function predShare(ad) {
    const c = new Array(ad.K).fill(0);
    run.ev.forEach((x) => { c[ad.model.forward(x).pred]++; });
    return c.map((v) => v / run.ev.length);
  }
  function reset() {
    const w = M[String(st.K)];
    run = {
      t: 0,
      rand: L.rng(3),
      ev: L.sample(st.K, 400, st.shift, L.rng(11)).xs,
      m: panels.map((p) => ({ ad: new L.Adapter(w, st.K, p.method, ALPHA), buf: [], hist: [], collapsedAt: null, collapsedShare: 0, collapsedClass: 0, predShare: null })),
    };
    run.m.forEach((m) => { m.predShare = predShare(m.ad); });
    $("#truth").textContent = `True class distribution: balanced. Each of the ${st.K} classes makes up about ${pct(1 / st.K, 1)} of the samples, so any class predicted more often than that is over-predicted.`;
    panels.forEach((p) => { p.painted = 0; p.bars = null; });
    layout();
  }
  function step() {
    if (run.t >= N) return;
    const xs = L.sample(st.K, st.B, st.shift, run.rand).xs;
    run.t++;
    run.m.forEach((m) => {
      const res = m.ad.step(xs);
      m.buf.push(res.weightShare);
      if (m.buf.length > SMOOTH) m.buf.shift();
      const avg = new Array(st.K).fill(0);
      m.buf.forEach((r) => r.forEach((v, i) => { avg[i] += v / m.buf.length; }));
      m.hist.push(avg);
      if (run.t % EVERY === 0) {
        m.predShare = predShare(m.ad);
        const top = Math.max(...m.predShare);
        if (m.collapsedAt === null && top >= COLLAPSE) {
          m.collapsedAt = run.t; m.collapsedShare = top; m.collapsedClass = m.predShare.indexOf(top);
        }
      }
    });
    if (run.t >= N) { st.playing = false; syncPlay(); }
  }

  /* ---------- Stream: cached bands plus a light overlay ---------- */
  function sizeCanvas(cv, W, H, dpr) {
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }
  function geom(p) {
    const W = p.stream.clientWidth, H = p.stream.clientHeight, pw = W - M_L - M_R, ph = H - M_T - M_B;
    return { W, H, pw, ph, X: (t) => M_L + (t / N) * pw, Y: (v) => M_T + (1 - v) * ph };
  }
  function paintColumns(p, m) {
    const { X, Y, W, H } = geom(p), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const g = sizeCanvas(p.cache, W, H, dpr);
    if (p.painted === 0) {
      g.clearRect(0, 0, W, H);
      g.fillStyle = "#f6f6f8"; g.fillRect(M_L, M_T, W - M_L - M_R, H - M_T - M_B);
    }
    for (let i = p.painted; i < m.hist.length; i++) {
      const x0 = Math.floor(X(i)), x1 = Math.max(x0 + 1, Math.ceil(X(i + 1)));
      let c = 0;
      m.hist[i].forEach((v, k) => {
        const y0 = Y(c + v), y1 = Y(c);
        g.fillStyle = CLS[k];
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        c += v;
      });
    }
    p.painted = m.hist.length;
  }
  function drawStream(p, m) {
    const { W, H, pw, ph, X, Y } = geom(p), dpr = Math.min(window.devicePixelRatio || 1, 2), K = st.K;
    if (W === 0) return;
    paintColumns(p, m);
    const g = sizeCanvas(p.stream, W, H, dpr);
    g.clearRect(0, 0, W, H);
    g.drawImage(p.cache, 0, 0, W, H);
    // Axes and the even-split reference.
    g.fillStyle = C.muted; g.font = font(11); g.textAlign = "left"; g.textBaseline = "alphabetic";
    [0, 0.5, 1].forEach((v) => { g.fillText(pct(v), 0, Y(v) + 4); });
    (pw < 420 ? [0, 600, 1200] : [0, 300, 600, 900, 1200]).forEach((t) => {
      g.textAlign = t === 0 ? "left" : t === N ? "right" : "center";
      g.fillText(t === N ? "1,200 batches" : String(t), X(t), H - 5);
    });
    g.textAlign = "left";
    g.strokeStyle = "rgba(39,39,39,.55)"; g.setLineDash([3, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(M_L, Y(1 / K)); g.lineTo(M_L + pw, Y(1 / K)); g.stroke(); g.setLineDash([]);
    // Band labels at the current edge.
    const h = m.hist;
    if (h.length) {
      const last = h[h.length - 1];
      let cum = 0;
      g.font = font(11.5, true);
      last.forEach((v, k) => {
        if (v > 0.09) {
          const txt = `${LETTER[k]} ${pct(v)}`, tw = g.measureText(txt).width;
          const tx = Math.min(Math.max(M_L + 4, X(h.length) - tw - 10), M_L + pw - tw - 8), ty = Y(cum + v / 2);
          g.fillStyle = "rgba(255,255,255,.94)"; g.fillRect(tx - 4, ty - 9, tw + 8, 18);
          g.fillStyle = C.ink; g.fillText(txt, tx, ty + 4);
        }
        cum += v;
      });
    }
    // Collapse marker.
    if (m.collapsedAt !== null) {
      const x = X(m.collapsedAt), label = `Model collapsed at batch ${m.collapsedAt}`;
      g.strokeStyle = C.em; g.lineWidth = 2; g.beginPath(); g.moveTo(x, M_T); g.lineTo(x, M_T + ph); g.stroke();
      g.font = font(12, true);
      const tw = g.measureText(label).width, lx = Math.max(M_L + 4, Math.min(x + 6, M_L + pw - tw - 12));
      g.fillStyle = C.em; g.fillRect(lx - 5, M_T + 6, tw + 10, 20);
      g.fillStyle = "#ffffff"; g.fillText(label, lx, M_T + 20);
    }
    // Hover crosshair and readout.
    let i = h.length - 1;
    if (st.hover !== null && h.length) {
      i = Math.max(0, Math.min(h.length - 1, Math.round(st.hover * N) - 1));
      g.strokeStyle = C.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(X(i + 1), M_T); g.lineTo(X(i + 1), M_T + ph); g.stroke();
    }
    const even = `An even split is ${pct(1 / K, 1)} per class (dashed line).`;
    if (i >= 0 && h[i]) {
      const top = h[i].map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]).slice(0, 3);
      p.readout.textContent = `Batch ${(i + 1).toLocaleString()}: ${top.map(([v, k]) => `${LETTER[k]} ${pct(v)}`).join(", ")}. ${even}`;
    } else p.readout.textContent = even;
  }

  /* ---------- Weight chart: fixed 0 to 5 axis, built once, then updated ---------- */
  const SVG = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs, parent) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  function buildWeights(p) {
    const el = p.weights, W = el.clientWidth || 400, H = el.clientHeight || 150, ml = 36, mr = 6, mt = 16, mb = 20;
    el.setAttribute("viewBox", `0 0 ${W} ${H}`);
    el.textContent = "";
    const pw = W - ml - mr, ph = H - mt - mb, Y = (v) => mt + (1 - Math.min(v, W_MAX) / W_MAX) * ph;
    for (let v = 0; v <= W_MAX; v++) {
      svg("line", { x1: ml, x2: ml + pw, y1: Y(v), y2: Y(v), stroke: v === 0 ? "#8d8d95" : C.line, "stroke-width": 1 }, el);
      svg("text", { x: ml - 8, y: Y(v) + 4, "text-anchor": "end", class: "tick" }, el).textContent = v;
    }
    svg("line", { x1: ml, x2: ml + pw, y1: Y(1), y2: Y(1), stroke: C.ink, "stroke-dasharray": "4 4", "stroke-width": 1 }, el);
    const K = st.K, slot = pw / K, bw = Math.min(46, slot * 0.62);
    p.bars = Array.from({ length: K }, (_, k) => {
      const x = ml + slot * k + (slot - bw) / 2;
      const rect = svg("rect", { x, width: bw, rx: 3, fill: CLS[k] }, el);
      const cut = svg("path", { d: "", fill: "none", stroke: "#ffffff", "stroke-width": 2 }, el);
      const val = svg("text", { x: x + bw / 2, "text-anchor": "middle", class: "val" }, el);
      svg("text", { x: x + bw / 2, y: H - 4, "text-anchor": "middle", class: "tick" }, el).textContent = LETTER[k];
      return { rect, cut, val, x, bw };
    });
    p.Y = Y;
  }
  function drawWeights(p, m) {
    if (!p.bars) buildWeights(p);
    const Y = p.Y, y0 = Y(0);
    p.bars.forEach((b, k) => {
      const w = m.ad.weightOf(k), off = w > W_MAX, y = Y(w);
      b.rect.setAttribute("y", y);
      b.rect.setAttribute("height", Math.max(1, y0 - y));
      // A bar taller than the axis is clipped, marked with a break, and labelled inside.
      b.cut.setAttribute("d", off ? `M${b.x} ${y + 9}l${b.bw} -5M${b.x} ${y + 14}l${b.bw} -5` : "");
      b.val.setAttribute("y", off ? y + 30 : y - 5);
      b.val.textContent = off ? w.toFixed(1) : w.toFixed(2);
    });
  }

  function drawStatus(p, m) {
    const s = p.status, top = Math.max(...m.predShare);
    if (m.collapsedAt !== null) {
      s.className = "status collapsed";
      s.textContent = `Model collapsed at batch ${m.collapsedAt}: ${pct(m.collapsedShare)} predicted as ${LETTER[m.collapsedClass]}`;
    } else if (run.t >= N) {
      s.className = "status balanced";
      s.textContent = `No model collapse in ${N.toLocaleString()} batches`;
    } else {
      s.className = "status";
      s.textContent = `Largest class: ${pct(top)} of predictions`;
    }
  }

  function draw() {
    panels.forEach((p, i) => { drawStream(p, run.m[i]); drawWeights(p, run.m[i]); drawStatus(p, run.m[i]); });
    $("#batch").textContent = run.t.toLocaleString();
    $("#progress-fill").style.width = `${(run.t / N) * 100}%`;
    const [e, d] = run.m, insight = $("#insight");
    insight.textContent = "";
    const add = (txt, b) => { const n = document.createElement(b ? "b" : "span"); n.textContent = txt; insight.appendChild(n); };
    if (!e.hist.length) { add("Press play to start the adaptation."); return; }
    const le = e.hist[e.hist.length - 1], ld = d.hist[d.hist.length - 1];
    add(`An even split would give each class ${pct(1 / st.K, 1)} of the weight. `);
    add(`Entropy Minimization gives its largest class ${pct(Math.max(...le))}`, true);
    add(", while ");
    add(`DSBR gives its largest class ${pct(Math.max(...ld))}`, true);
    add(".");
    if (e.collapsedAt !== null && d.collapsedAt === null) add(" The model collapsed under Entropy Minimization but not under DSBR.");
  }
  // Full redraw after a reset or resize; cached bands are repainted from history.
  function layout() {
    panels.forEach((p) => { p.painted = 0; p.bars = null; });
    draw();
  }

  /* ---------- Controls ---------- */
  const playBtn = $("#play"), icon = $("#play-icon"), live = $("#live");
  function syncPlay() {
    icon.setAttribute("d", st.playing ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z");
    playBtn.setAttribute("aria-label", st.playing ? "Pause" : run && run.t >= N ? "Replay" : "Play");
    live.classList.toggle("on", st.playing);
  }
  playBtn.addEventListener("click", () => {
    if (run.t >= N) reset();
    st.playing = !st.playing;
    syncPlay();
  });
  $("#restart").addEventListener("click", () => { reset(); st.playing = true; syncPlay(); });
  const shift = $("#shift"), shiftOut = $("#shift-out");
  const syncShift = () => { shift.value = st.shift; shiftOut.textContent = st.shift.toFixed(2); };
  shift.addEventListener("input", () => { st.shift = +shift.value; shiftOut.textContent = st.shift.toFixed(2); reset(); });
  seg($("#k"), [2, 3, 6], st.K, (v) => { st.K = v; st.shift = DEFAULT_SHIFT[v]; syncShift(); reset(); });
  seg($("#b"), [16, 32], st.B, (v) => { st.B = v; reset(); });
  panels.forEach((p) => {
    p.stream.addEventListener("pointermove", (e) => {
      const b = p.stream.getBoundingClientRect(), pw = b.width - M_L - M_R;
      st.hover = Math.max(0, Math.min(1, (e.clientX - b.left - M_L) / pw));
      draw();
    });
    p.stream.addEventListener("pointerleave", () => { st.hover = null; draw(); });
  });
  syncShift();
  reset();
  // Optional ?warmup=N pre-runs N batches, for screenshots.
  const warm = +new URLSearchParams(location.search).get("warmup");
  if (warm > 0) { for (let i = 0; i < Math.min(warm, N); i++) step(); st.playing = false; draw(); }
  syncPlay();

  // Fixed-rate stepping: 30 batches per second while the panels are on screen.
  let acc = 0, last = 0, visible = true;
  if ("IntersectionObserver" in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe($(".panels"));
  function tick(now) {
    const dt = Math.min(100, now - (last || now)); last = now;
    if (st.playing && visible) {
      acc += dt;
      let n = 0;
      while (acc >= 1000 / RATE && n < 4) { step(); acc -= 1000 / RATE; n++; }
      if (n) draw();
    } else acc = 0;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  let lastW = 0;
  new ResizeObserver(() => { const w = $(".panels").clientWidth; if (w !== lastW) { lastW = w; layout(); } }).observe($(".panels"));
})();

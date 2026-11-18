// Interactive demo: share of the total weight per predicted class, live.
(() => {
  const L = window.DSBRLab, M = window.LAB_MODELS;
  const $ = (s, r = document) => r.querySelector(s);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = { ink: css("--ink"), muted: css("--muted"), line: css("--line"), em: css("--em"), ds: css("--ds") };
  // Class hues from the Nature figure palette (blue, teal, green, rose, violet, grey).
  const CLS = ["#3775ba", "#42949e", "#8bcf8b", "#e9a6a1", "#9a4d8e", "#8c8c8c"];
  const LETTER = "ABCDEF";
  const N = 1200, SMOOTH = 10, EVERY = 10, COLLAPSE = 0.95, ALPHA = 0.9, W_MAX = 4;
  // Per class count: a shift where Entropy Minimization collapses within the run.
  const DEFAULT_SHIFT = { 2: 0.85, 3: 0.85, 6: 0.9 };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
  const font = (px, w = 400) => `${w} ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

  const st = { K: 6, B: 32, shift: DEFAULT_SHIFT[6], playing: !reduced, hover: null };
  const panels = ["EM", "DSBR"].map((method) => {
    const el = $(`.panel[data-method=${method}]`);
    return { method, el, stream: $("[data-stream]", el), weights: $("[data-weights]", el), status: $("[data-status]", el), readout: $("[data-readout]", el), caption: $("[data-caption]", el) };
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

  function reset() {
    const w = M[String(st.K)];
    run = {
      t: 0,
      rand: L.rng(3),
      ev: L.sample(st.K, 400, st.shift, L.rng(11)).xs,
      m: panels.map((p) => ({ ad: new L.Adapter(w, st.K, p.method, ALPHA), buf: [], hist: [], collapsedAt: null, collapsedShare: 0, predShare: null })),
    };
    run.m.forEach((m) => { m.predShare = predShare(m.ad); });
    draw();
  }

  function predShare(ad) {
    const c = new Array(ad.K).fill(0);
    run.ev.forEach((x) => c[ad.model.forward(x).pred]++);
    return c.map((v) => v / run.ev.length);
  }

  function step() {
    if (run.t >= N) return;
    const xs = L.sample(st.K, st.B, st.shift, run.rand).xs;
    run.t++;
    run.m.forEach((m) => {
      const res = m.ad.step(xs);
      m.buf.push(res.weightShare); if (m.buf.length > SMOOTH) m.buf.shift();
      const avg = new Array(st.K).fill(0);
      m.buf.forEach((r) => r.forEach((v, i) => { avg[i] += v / m.buf.length; }));
      m.hist.push(avg);
      if (run.t % EVERY === 0) {
        m.predShare = predShare(m.ad);
        const top = Math.max(...m.predShare);
        if (m.collapsedAt === null && top >= COLLAPSE) { m.collapsedAt = run.t; m.collapsedShare = top; }
      }
    });
    if (run.t >= N) { st.playing = false; syncPlay(); }
  }

  function fit(cv) {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    return { g, W, H };
  }

  function drawStream(p, m) {
    const { g, W, H } = fit(p.stream), ml = 36, mr = 6, mt = 6, mb = 22, pw = W - ml - mr, ph = H - mt - mb;
    const X = (t) => ml + (t / N) * pw, Y = (v) => mt + (1 - v) * ph;
    g.fillStyle = "#f6f6f8"; g.fillRect(ml, mt, pw, ph);
    const h = m.hist, K = st.K;
    for (let k = K - 1; k >= 0; k--) {
      if (!h.length) break;
      g.beginPath();
      h.forEach((r, i) => { let c = 0; for (let j = 0; j <= k; j++) c += r[j]; i ? g.lineTo(X(i + 1), Y(c)) : g.moveTo(X(i + 1), Y(c)); });
      g.lineTo(X(h.length), Y(0)); g.lineTo(X(1), Y(0)); g.closePath();
      g.fillStyle = CLS[k]; g.fill();
    }
    if (h.length) for (let k = 1; k < K; k++) {
      g.strokeStyle = "#fff"; g.lineWidth = 1; g.beginPath();
      h.forEach((r, i) => { let c = 0; for (let j = 0; j < k; j++) c += r[j]; i ? g.lineTo(X(i + 1), Y(c)) : g.moveTo(X(i + 1), Y(c)); });
      g.stroke();
    }
    // Axes.
    g.fillStyle = C.muted; g.font = font(11);
    [0, 0.5, 1].forEach((v) => { g.fillText(pct(v), 0, Y(v) + 4); });
    g.strokeStyle = "#9a9aa2"; g.setLineDash([3, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(ml, Y(1 / K)); g.lineTo(ml + pw, Y(1 / K)); g.stroke(); g.setLineDash([]);
    [0, 300, 600, 900, 1200].forEach((t) => {
      g.fillStyle = C.muted; g.textAlign = t === 0 ? "left" : t === N ? "right" : "center";
      g.fillText(t === N ? "1,200 batches" : String(t), X(t), H - 5);
    });
    g.textAlign = "left";
    // Band labels at the current edge.
    if (h.length) {
      const last = h[h.length - 1];
      let cum = 0;
      last.forEach((v, k) => {
        if (v > 0.09) {
          const txt = `${LETTER[k]} ${pct(v)}`, tw = g.measureText(txt).width;
          const tx = Math.min(Math.max(ml + 4, X(h.length) - tw - 10), ml + pw - tw - 8), ty = Y(cum + v / 2);
          g.font = font(11.5, 650);
          g.fillStyle = "rgba(255,255,255,.92)"; g.fillRect(tx - 4, ty - 9, tw + 10, 18);
          g.fillStyle = C.ink; g.fillText(txt, tx, ty + 4);
          g.font = font(11);
        }
        cum += v;
      });
    }
    // Collapse marker.
    if (m.collapsedAt !== null) {
      const x = X(m.collapsedAt);
      g.strokeStyle = C.em; g.lineWidth = 2; g.beginPath(); g.moveTo(x, mt); g.lineTo(x, mt + ph); g.stroke();
      const label = `Collapse at batch ${m.collapsedAt}`;
      g.font = font(12, 700);
      const tw = g.measureText(label).width, lx = Math.min(x + 6, ml + pw - tw - 10);
      g.fillStyle = C.em; g.fillRect(lx - 4, mt + 6, tw + 10, 20);
      g.fillStyle = "#fff"; g.fillText(label, lx + 1, mt + 20);
    }
    // Hover crosshair.
    let i = h.length - 1;
    if (st.hover !== null && h.length) {
      i = Math.max(0, Math.min(h.length - 1, Math.round(st.hover * N) - 1));
      g.strokeStyle = C.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(X(i + 1), mt); g.lineTo(X(i + 1), mt + ph); g.stroke();
    }
    if (i >= 0 && h[i]) {
      const r = h[i], order = r.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]).slice(0, 3);
      p.readout.textContent = `Batch ${i + 1}: ` + order.map(([v, k]) => `${LETTER[k]} ${pct(v)}`).join(", ") + (st.K > 3 ? " and the rest" : "") + `. Even split: ${pct(1 / st.K, 1)} each (dashed line).`;
    } else p.readout.textContent = `Even split: ${pct(1 / st.K, 1)} each (dashed line).`;
  }

  const SVG = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs, parent) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  function drawWeights(p, m) {
    const el = p.weights, W = el.clientWidth || 400, H = el.clientHeight || 150, ml = 36, mr = 6, mt = 16, mb = 20;
    el.setAttribute("viewBox", `0 0 ${W} ${H}`);
    el.textContent = "";
    const top = Math.max(W_MAX, Math.ceil(Math.max(...Array.from({ length: st.K }, (_, k) => m.ad.weightOf(k))))), tick = top > 8 ? 2 : 1;
    const pw = W - ml - mr, ph = H - mt - mb, Y = (v) => mt + (1 - v / top) * ph;
    for (let v = 0; v <= top; v += tick) {
      svg("line", { x1: ml, x2: ml + pw, y1: Y(v), y2: Y(v), stroke: v === 0 ? "#9a9aa2" : C.line }, el);
      svg("text", { x: ml - 8, y: Y(v) + 4, "text-anchor": "end" }, el).textContent = v;
    }
    svg("line", { x1: ml, x2: ml + pw, y1: Y(1), y2: Y(1), stroke: C.ink, "stroke-dasharray": "4 4" }, el);
    const K = st.K, slot = pw / K, bw = Math.min(46, slot * 0.6);
    for (let k = 0; k < K; k++) {
      const w = m.ad.weightOf(k), x = ml + slot * k + (slot - bw) / 2;
      svg("rect", { x, y: Y(w), width: bw, height: Math.max(1, Y(0) - Y(w)), rx: 3, fill: CLS[k] }, el);
      svg("text", { x: x + bw / 2, y: Y(w) - 5, "text-anchor": "middle", class: "val" }, el).textContent = w.toFixed(2);
      svg("text", { x: x + bw / 2, y: H - 4, "text-anchor": "middle" }, el).textContent = LETTER[k];
    }
  }

  function drawStatus(p, m) {
    const s = p.status, top = Math.max(...m.predShare), cls = LETTER[m.predShare.indexOf(top)];
    if (m.collapsedAt !== null) {
      s.className = "status collapsed";
      s.textContent = `Collapsed at batch ${m.collapsedAt}: ${pct(m.collapsedShare)} predicted ${cls}`;
    } else if (run.t >= N) {
      s.className = "status balanced";
      s.textContent = `No collapse in ${N.toLocaleString()} batches`;
    } else {
      s.className = "status";
      s.textContent = `Largest class: ${pct(top)} of predictions`;
    }
    p.caption.textContent = p.method === "EM"
      ? "Every sample has weight 1, whatever its class. The weight share simply follows the predictions."
      : "A tall bar is a class the model rarely predicts right now. DSBR raises its weight so it is not drowned out.";
  }

  function draw() {
    panels.forEach((p, i) => { drawStream(p, run.m[i]); drawWeights(p, run.m[i]); drawStatus(p, run.m[i]); });
    $("#batch").textContent = run.t.toLocaleString();
    $("#progress-fill").style.width = `${(run.t / N) * 100}%`;
    const [e, d] = run.m, insight = $("#insight");
    insight.textContent = "";
    const add = (txt, b) => { const n = document.createElement(b ? "b" : "span"); n.textContent = txt; insight.appendChild(n); };
    if (!e.hist.length) { add("Press play to start adaptation."); return; }
    const le = e.hist[e.hist.length - 1], ld = d.hist[d.hist.length - 1];
    add(`An even split gives each class ${pct(1 / st.K, 1)} of the weight. `);
    add(`Entropy Minimization gives its largest class ${pct(Math.max(...le))}`, true);
    add(" and ");
    add(`DSBR gives ${pct(Math.max(...ld))}`, true);
    add(". ");
    if (e.collapsedAt !== null && d.collapsedAt === null) add("Entropy Minimization has collapsed; DSBR has not.");
  }

  const playBtn = $("#play"), icon = $("#play-icon");
  function syncPlay() {
    icon.setAttribute("d", st.playing ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z");
    playBtn.setAttribute("aria-label", st.playing ? "Pause" : run && run.t >= N ? "Replay" : "Play");
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
  seg($("#b"), [8, 16, 32], st.B, (v) => { st.B = v; reset(); });
  panels.forEach((p) => {
    p.stream.addEventListener("pointermove", (e) => {
      const b = p.stream.getBoundingClientRect(), ml = 36, pw = b.width - ml - 6;
      st.hover = Math.max(0, Math.min(1, (e.clientX - b.left - ml) / pw));
      draw();
    });
    p.stream.addEventListener("pointerleave", () => { st.hover = null; draw(); });
  });
  syncShift();
  reset();
  // Optional ?warmup=N pre-runs N batches (useful for screenshots).
  const warm = +new URLSearchParams(location.search).get("warmup");
  if (warm > 0) { for (let i = 0; i < Math.min(warm, N); i++) step(); st.playing = false; draw(); }
  syncPlay();

  // Fixed-rate stepping: 60 batches per second while visible.
  let acc = 0, last = 0, visible = true;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe($(".panels"));
  function tick(now) {
    const dt = Math.min(100, now - (last || now)); last = now;
    if (st.playing && visible) {
      acc += dt;
      let n = 0;
      while (acc >= 1000 / 60 && n < 6) { step(); acc -= 1000 / 60; n++; }
      if (n) draw();
    } else acc = 0;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  new ResizeObserver(draw).observe($(".panels"));
})();

// Browser engine for the interactive lab: the synthetic model from
// toy-experiment/common.py, adapted live with Entropy Minimization or DSBR.
// Only the LayerNorm affine parameters adapt, with Adam, as in the repository's
// Tent and DSBR classes (domainbed/adapt_algorithms.py).
(function (root) {
  "use strict";

  const H = 32;

  // Exact GELU via erf (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7).
  function erf(x) {
    const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  }
  const gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));
  const dgelu = (x) => 0.5 * (1 + erf(x / Math.SQRT2)) + x * Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

  function rng(seed) {
    let s = seed >>> 0 || 1;
    const next = () => {
      s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    let spare = null;
    next.normal = () => {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u, v, q;
      do { u = 2 * next() - 1; v = 2 * next() - 1; q = u * u + v * v; } while (q >= 1 || q === 0);
      const f = Math.sqrt(-2 * Math.log(q) / q);
      spare = v * f;
      return u * f;
    };
    return next;
  }

  // Class means on a ring; `shift` pulls every mean toward one point, merging clusters.
  function centers(K) {
    return Array.from({ length: K }, (_, k) => {
      const a = (2 * Math.PI * k) / K + Math.PI / 4;
      return [3 * Math.cos(a), 3 * Math.sin(a)];
    });
  }
  function sample(K, n, shift, rand, sigma = 0.55) {
    const c = centers(K), xs = [], ys = [];
    for (let i = 0; i < n; i++) {
      const y = i % K;
      xs.push([c[y][0] * (1 - shift) + 1.5 * shift + sigma * rand.normal(), c[y][1] * (1 - shift) + sigma * rand.normal()]);
      ys.push(y);
    }
    return { xs, ys };
  }

  function Model(w, K) {
    this.K = K;
    this.W1 = w.W1; this.b1 = w.b1; this.W2 = w.W2; this.b2 = w.b2; this.Wc = w.Wc; this.bc = w.bc;
    this.g = Float64Array.from(w.g); this.be = Float64Array.from(w.be);
  }

  // Forward one input; returns everything the backward pass needs.
  Model.prototype.forward = function (x) {
    const K = this.K, a1 = new Float64Array(H);
    let mu = 0;
    for (let j = 0; j < H; j++) {
      a1[j] = gelu(this.W1[2 * j] * x[0] + this.W1[2 * j + 1] * x[1] + this.b1[j]);
      mu += a1[j];
    }
    mu /= H;
    let v = 0;
    for (let j = 0; j < H; j++) v += (a1[j] - mu) ** 2;
    const inv = 1 / Math.sqrt(v / H + 1e-5), n = new Float64Array(H), y = new Float64Array(H), z = [this.b2[0], this.b2[1]];
    for (let j = 0; j < H; j++) {
      n[j] = (a1[j] - mu) * inv;
      y[j] = this.g[j] * n[j] + this.be[j];
      const a2 = gelu(y[j]);
      z[0] += this.W2[j] * a2;
      z[1] += this.W2[H + j] * a2;
    }
    const l = new Float64Array(K);
    let mx = -Infinity;
    for (let k = 0; k < K; k++) { l[k] = this.Wc[2 * k] * z[0] + this.Wc[2 * k + 1] * z[1] + this.bc[k]; mx = Math.max(mx, l[k]); }
    let s = 0;
    const p = new Float64Array(K);
    for (let k = 0; k < K; k++) { p[k] = Math.exp(l[k] - mx); s += p[k]; }
    let ent = 0, pred = 0;
    for (let k = 0; k < K; k++) {
      p[k] /= s;
      if (p[k] > 0) ent -= p[k] * Math.log(p[k]);
      if (p[k] > p[pred]) pred = k;
    }
    return { n, y, z, p, ent, pred };
  };

  // Gradient of the entropy wrt the 2D feature z, and wrt the logits.
  Model.prototype.entropyGrad = function (f) {
    const K = this.K, dl = new Float64Array(K);
    for (let k = 0; k < K; k++) dl[k] = f.p[k] > 0 ? -f.p[k] * (Math.log(f.p[k]) + f.ent) : 0;
    const dz = [0, 0];
    for (let k = 0; k < K; k++) { dz[0] += this.Wc[2 * k] * dl[k]; dz[1] += this.Wc[2 * k + 1] * dl[k]; }
    return dz;
  };

  // One adapter: Entropy Minimization when method is "EM", DSBR otherwise.
  function Adapter(weights, K, method, alpha, lr = 0.01) {
    this.model = new Model(weights, K);
    this.K = K; this.method = method; this.alpha = alpha; this.lr = lr;
    this.P = new Float64Array(K).fill(1 / K);
    this.mg = new Float64Array(H); this.vg = new Float64Array(H);
    this.mb = new Float64Array(H); this.vb = new Float64Array(H);
    this.t = 0;
  }

  // One adaptation step on a batch. Returns per-sample weights and per-class update shares.
  Adapter.prototype.step = function (xs) {
    const K = this.K, B = xs.length, m = this.model;
    const fs = xs.map((x) => m.forward(x));
    const counts = new Float64Array(K);
    fs.forEach((f) => counts[f.pred]++);
    if (this.method !== "EM") for (let k = 0; k < K; k++) this.P[k] = this.alpha * this.P[k] + (1 - this.alpha) * counts[k] / B;
    const w = fs.map((f) => (this.method === "EM" ? 1 : 1 / (K * this.P[f.pred])));
    const gg = new Float64Array(H), gb = new Float64Array(H);
    const perClass = Array.from({ length: K }, () => ({ g: new Float64Array(H), b: new Float64Array(H) }));
    fs.forEach((f, i) => {
      const dz = m.entropyGrad(f), c = perClass[f.pred], scale = w[i] / B;
      for (let j = 0; j < H; j++) {
        const dy = (m.W2[j] * dz[0] + m.W2[H + j] * dz[1]) * dgelu(f.y[j]) * scale;
        gg[j] += dy * f.n[j]; gb[j] += dy;
        c.g[j] += dy * f.n[j]; c.b[j] += dy;
      }
    });
    // Adam with PyTorch defaults (betas 0.9 / 0.999, eps 1e-8).
    this.t++;
    const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** this.t, c2 = 1 - b2 ** this.t;
    for (let j = 0; j < H; j++) {
      this.mg[j] = b1 * this.mg[j] + (1 - b1) * gg[j]; this.vg[j] = b2 * this.vg[j] + (1 - b2) * gg[j] * gg[j];
      this.mb[j] = b1 * this.mb[j] + (1 - b1) * gb[j]; this.vb[j] = b2 * this.vb[j] + (1 - b2) * gb[j] * gb[j];
      m.g[j] -= this.lr * (this.mg[j] / c1) / (Math.sqrt(this.vg[j] / c2) + 1e-8);
      m.be[j] -= this.lr * (this.mb[j] / c1) / (Math.sqrt(this.vb[j] / c2) + 1e-8);
    }
    const norms = perClass.map((c) => Math.hypot(...c.g, ...c.b));
    const tot = norms.reduce((a, b) => a + b, 0) || 1;
    const wsum = new Float64Array(K);
    fs.forEach((f, i) => { wsum[f.pred] += w[i]; });
    const wt = wsum.reduce((a, b) => a + b, 0) || 1;
    return { preds: fs.map((f) => f.pred), w, counts, pull: norms.map((v) => v / tot), weightShare: Array.from(wsum, (v) => v / wt) };
  };

  // Current weight a sample predicted as class k would get.
  Adapter.prototype.weightOf = function (k) {
    return this.method === "EM" ? 1 : 1 / (this.K * this.P[k]);
  };

  const api = { erf, gelu, rng, centers, sample, Model, Adapter, H };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSBRLab = api;
})(typeof window !== "undefined" ? window : globalThis);

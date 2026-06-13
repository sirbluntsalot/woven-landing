/* ===================================================================
   Woven landing page — interactions & canvas animations
   Light palette: ink #323131, blue #4169E1, teal #0E9F8F,
   coral #E0524D, amber #D97706
   =================================================================== */

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ?capture — used by headless screenshot tooling: skip smooth scroll + reveals
if (new URLSearchParams(location.search).has("capture")) {
  document.documentElement.classList.add("capture");
}

/* ===================================================================
   1. Nav — solidify on scroll · dot-grid parallax on white sections
   =================================================================== */
const nav = document.getElementById("nav");
const rootStyle = document.documentElement.style;
const onScroll = () => {
  nav.classList.toggle("scrolled", window.scrollY > 24);
  // dots drift at 0.4× scroll speed; modulo the 22px tile keeps the value tiny
  if (!REDUCED_MOTION) {
    rootStyle.setProperty("--dotY", `${(window.scrollY * 0.4) % 22}px`);
  }
};
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* ===================================================================
   2. Scroll reveal
   =================================================================== */
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        revealObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
);
document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

/* ===================================================================
   3. Shifting-sands dot grid (hero only) — a regular dot grid with
   two layers of motion: dots drift a few px on overlapping sine
   waves, and broad waves of opacity travel diagonally through the
   field, so patches of dots brighten and dim like wind over sand.
   =================================================================== */
function dotGrid(canvas, { maxAlpha = 0.34, spacing = 22, amp = 3.4 } = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const DOT_R = 1.3;
  let w = 0, h = 0;

  function resize() {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let startT = null;

  function draw(ts) {
    if (startT === null) startT = ts;
    const t = (ts - startT) * 0.0025; // scaled time — bump factor to speed the whole field up

    ctx.clearRect(0, 0, w, h);

    const margin = 2; // extra rows/cols so drifting dots never reveal an edge
    const cols = Math.ceil(w / spacing) + margin * 2;
    const rows = Math.ceil(h / spacing) + margin * 2;

    for (let ri = 0; ri < rows; ri++) {
      for (let ci = 0; ci < cols; ci++) {
        const gx = (ci - margin) * spacing;
        const gy = (ri - margin) * spacing;

        // positional drift — two offset sine waves per axis
        const phase = ci * 0.37 + ri * 0.21;
        const dx = amp * (Math.sin(phase + t * 0.5) * 0.62 + Math.sin(ci * 0.16 + t * 0.3 + 1.5) * 0.38);
        const dy = amp * (Math.cos(phase + t * 0.4 + 0.9) * 0.62 + Math.cos(ri * 0.19 + t * 0.24 + 2.3) * 0.38);

        const x = gx + dx;
        const y = gy + dy;

        // shimmer — two broad opacity waves traveling through the grid;
        // this is what reads as "shifting sands" at a glance
        const w1 = Math.sin(ci * 0.28 + ri * 0.17 - t * 1.1);
        const w2 = Math.sin(ri * 0.24 - ci * 0.12 + t * 0.8 + 2.0);
        const shimmer = 0.3 + 0.7 * Math.pow(0.5 + 0.25 * (w1 + w2), 1.7);

        const alpha = maxAlpha * shimmer;

        ctx.fillStyle = `rgba(50,49,49,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!REDUCED_MOTION) requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  // reduced motion: draw(ts) runs once and stays static
  requestAnimationFrame(draw);
}

dotGrid(document.getElementById("hero-canvas"));

/* ===================================================================
   4. Domain tabs — glider + panel swap, auto-rotates until touched
   =================================================================== */
const tabs = [...document.querySelectorAll(".domain-tab")];
const panels = [...document.querySelectorAll(".domain-panel")];
const glider = document.querySelector(".tab-glider");
let activeDomain = "digital";
let autoRotate;

function positionGlider() {
  const tab = tabs.find((t) => t.dataset.domain === activeDomain);
  if (!tab) return;
  glider.style.left = `${tab.offsetLeft}px`;
  glider.style.width = `${tab.offsetWidth}px`;
}

function switchDomain(domain) {
  activeDomain = domain;
  tabs.forEach((t) => {
    const on = t.dataset.domain === domain;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
  });
  panels.forEach((p) => p.classList.toggle("active", p.dataset.domain === domain));
  positionGlider();
  document.dispatchEvent(new CustomEvent("domainswitch", { detail: domain }));
}

tabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    clearInterval(autoRotate);
    switchDomain(tab.dataset.domain);
  })
);

const DOMAIN_ORDER = ["digital", "canvas", "rhetorical"];
autoRotate = setInterval(() => {
  if (REDUCED_MOTION) return;
  const next = DOMAIN_ORDER[(DOMAIN_ORDER.indexOf(activeDomain) + 1) % DOMAIN_ORDER.length];
  switchDomain(next);
}, 6000);

window.addEventListener("resize", positionGlider);
// fonts shift widths once Geist loads
document.fonts?.ready.then(positionGlider);
positionGlider();

/* ===================================================================
   5. Digital viz — simplified 2D ⇄ 3D creator map
   Each creator has (ideology, gender-code, politicization) scores like
   the real app. 2D = orthographic ideology × gender scatter with the
   app's hollow cultural-cloud outlines; 3D = politicization becomes
   depth, the cloud orbits, outlines cross-fade to volumetric blobs.
   One eased parameter (t) morphs between the two projections. Drag to
   orbit in 3D; hover any node for its name pill.
   =================================================================== */
const dmStage = document.getElementById("dm-stage");
if (dmStage) {
  const DM_CLUSTERS = {
    left: { label: "NEW LEFT MEDIA", color: "#8b5cf6" },
    pod: { label: "MASCULINE PODCASTERS", color: "#0e9f8f" },
    life: { label: "LIFESTYLE", color: "#d97706" },
  };
  // i: ideology 0=left→1=right · g: 0=feminine→1=masculine · p: politicization
  // scores tuned so the three clusters stay spatially separated in 2D
  const DM_CREATORS = [
    { name: "Hasan Piker", file: "Hasan Piker.jpg", i: 0.10, g: 0.62, p: 0.93, s: 44, c: "left" },
    { name: "ContraPoints", file: "ContraPoints.jpeg", i: 0.12, g: 0.28, p: 0.80, s: 38, c: "left" },
    { name: "Ana Kasparian", file: "Ana Kasparian.jpeg", i: 0.20, g: 0.40, p: 0.88, s: 34, c: "left" },
    { name: "Brian Tyler Cohen", file: "Brian Tyler Cohen.jpg", i: 0.18, g: 0.55, p: 0.92, s: 36, c: "left" },
    { name: "Alice Cappelle", file: "Alice Cappelle.jpg", i: 0.24, g: 0.22, p: 0.60, s: 28, c: "left" },
    { name: "Joe Rogan", file: "Rogan.jpg", i: 0.60, g: 0.82, p: 0.55, s: 46, c: "pod" },
    { name: "Jordan Peterson", file: "Jordan B Peterson.jpg", i: 0.78, g: 0.72, p: 0.74, s: 40, c: "pod" },
    { name: "Ben Shapiro", file: "Ben_Shapiro_December_2025_(cropped).jpg", i: 0.88, g: 0.66, p: 0.95, s: 40, c: "pod" },
    { name: "Theo Von", file: "Theovon.jpg", i: 0.55, g: 0.75, p: 0.32, s: 38, c: "pod" },
    { name: "Andrew Schulz", file: "Andrew_Schulz.jpeg", i: 0.58, g: 0.85, p: 0.40, s: 36, c: "pod" },
    { name: "Emma Chamberlain", file: "emma chamberlain.jpg", i: 0.42, g: 0.15, p: 0.06, s: 40, c: "life" },
    { name: "Alix Earle", file: "Alix Earle.jpg", i: 0.46, g: 0.10, p: 0.05, s: 34, c: "life" },
    { name: "Bretman Rock", file: "Bretman Rock.jpg", i: 0.38, g: 0.30, p: 0.10, s: 34, c: "life" },
    { name: "Adley Kinsman", file: "Adley Kinsman.jpg", i: 0.52, g: 0.28, p: 0.04, s: 30, c: "life" },
    { name: "Ballerina Farm", file: "Ballerina Farm.jpg", i: 0.66, g: 0.08, p: 0.20, s: 30, c: "life" },
  ];
  const dmX2 = (i) => 9 + i * 82; // flat 2D projection (percent)
  const dmY2 = (g) => 16 + (1 - g) * 68;
  const dmLerp = (a, b, k) => a + (b - a) * k;

  // nodes
  const dmPill = document.getElementById("dm-pill");
  let dmHovered = null;
  const dmNodes = DM_CREATORS.map((c) => {
    const el = document.createElement("div");
    el.className = "dm-node";
    el.style.borderColor = DM_CLUSTERS[c.c].color;
    el.style.width = el.style.height = `${c.s}px`;
    const img = document.createElement("img");
    img.src = `/Profile Pictures/${c.file}`;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    el.appendChild(img);
    el.addEventListener("pointerenter", () => {
      dmHovered = c;
      dmPill.textContent = c.name;
      dmPill.hidden = false;
    });
    el.addEventListener("pointerleave", () => {
      if (dmHovered === c) dmHovered = null;
      dmPill.hidden = true;
    });
    dmStage.appendChild(el);
    // 3D proximity name label — fades in as the creator orbits toward camera
    const nameEl = document.createElement("span");
    nameEl.className = "dm-name";
    nameEl.textContent = c.name;
    dmStage.appendChild(nameEl);
    return { ...c, el, nameEl };
  });

  // hollow 2D cloud outlines — organic blob around each cluster's members
  const dmSvg = document.getElementById("dm-clouds");
  const dmClusterMeta = Object.entries(DM_CLUSTERS).map(([id, meta]) => {
    const pts = DM_CREATORS.filter((c) => c.c === id).map((c) => ({ x: dmX2(c.i), y: dmY2(c.g) }));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    // support-function ring → radius smoothing pass → gentle jitter.
    // Smoothing kills the kinks sparse spiky rings used to produce.
    const K = 14;
    const radii = [];
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      let r = 0;
      for (const p of pts) r = Math.max(r, (p.x - cx) * dx + (p.y - cy) * dy);
      radii.push(r + 9 + 2 * Math.sin(k * 4.7 + cx));
    }
    const smooth = radii.map((r, k) => {
      const prev = radii[(k + K - 1) % K], next = radii[(k + 1) % K];
      return (prev + 2 * r + next) / 4;
    });
    const ring = smooth.map((r, k) => {
      const a = (k / K) * Math.PI * 2;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 1.12 };
    });
    let d = "";
    for (let k = 0; k < K; k++) {
      const p = ring[k], n = ring[(k + 1) % K];
      const mx = (p.x + n.x) / 2, my = (p.y + n.y) / 2;
      d += k === 0 ? `M ${mx.toFixed(2)} ${my.toFixed(2)}` : ` Q ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    }
    const p0 = ring[0], pl = ring[K - 1];
    d += ` Q ${pl.x.toFixed(2)} ${pl.y.toFixed(2)} ${((pl.x + p0.x) / 2).toFixed(2)} ${((pl.y + p0.y) / 2).toFixed(2)} Z`;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", meta.color);
    dmSvg.appendChild(path);

    // volumetric 3D blob + 2D label
    const blob = document.createElement("div");
    blob.className = "dm-blob";
    blob.style.background = `radial-gradient(ellipse, ${meta.color}55, transparent 68%)`;
    dmStage.insertBefore(blob, dmStage.firstChild);
    // label sits above the outline's own top edge so the curve never crosses it
    const label = document.createElement("span");
    label.className = "dm-cluster-label";
    label.textContent = meta.label;
    label.style.color = meta.color;
    label.style.left = `${Math.min(Math.max(cx, 14), 86)}%`;
    label.style.top = `${Math.max(Math.min(...ring.map((p) => p.y)) - 5, 6)}%`;
    dmStage.appendChild(label);

    const members = DM_CREATORS.filter((c) => c.c === id);
    const mi = members.reduce((s, c) => s + c.i, 0) / members.length;
    const mg = members.reduce((s, c) => s + c.g, 0) / members.length;
    const mp = members.reduce((s, c) => s + c.p, 0) / members.length;
    return { path, blob, label, mi, mg, mp };
  });

  // ── state ──────────────────────────────────────────────────────────
  let dmT = 0, dmTTarget = 0; // 0 = 2D · 1 = 3D
  let dmYaw = 0.55;
  let dmUserLed = false;
  let dmDragging = false;
  let dmDemoStart = null;
  let dmLastTs = null;
  let dmRaf = null;

  function dmProject(i, g, p, t, yaw) {
    const cx = i - 0.5, cz = p - 0.5;
    const rx = cx * Math.cos(yaw) - cz * Math.sin(yaw);
    const rz = cx * Math.sin(yaw) + cz * Math.cos(yaw);
    return {
      x: dmLerp(dmX2(i), 50 + rx * 72, t),
      y: dmLerp(dmY2(g), 50 - (g - 0.5) * 50 + rz * 11, t),
      rz,
    };
  }

  function dmRender() {
    for (const n of dmNodes) {
      const pr = dmProject(n.i, n.g, n.p, dmT, dmYaw);
      const near = Math.max(0, Math.min(1, (pr.rz + 0.75) / 1.5));
      let scale = 1 + dmT * (near - 0.5) * 0.8;
      if (dmHovered === n) scale *= 1.18;
      n.el.style.left = `${pr.x}%`;
      n.el.style.top = `${pr.y}%`;
      n.el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      n.el.style.opacity = dmLerp(1, 0.45 + 0.55 * near, dmT).toFixed(3);
      n.el.style.zIndex = 100 + Math.round(dmT * pr.rz * 60);
      // 3D proximity name — fades in over the near arc of the orbit
      const ns = Math.max(0, Math.min(1, (near - 0.6) / 0.22));
      n.nameEl.style.opacity = (dmT * ns * ns * (3 - 2 * ns)).toFixed(3);
      n.nameEl.style.left = `${pr.x}%`;
      n.nameEl.style.top = `calc(${pr.y}% + ${((n.s / 2) * scale + 7).toFixed(1)}px)`;
      n.nameEl.style.zIndex = 151 + Math.round(dmT * pr.rz * 60);
      if (dmHovered === n) {
        dmPill.style.left = `${pr.x}%`;
        dmPill.style.top = `calc(${pr.y}% - ${(n.s / 2) * scale + 7}px)`;
        dmPill.style.zIndex = 300;
      }
    }
    dmSvg.style.opacity = (1 - dmT).toFixed(3);
    for (const cl of dmClusterMeta) {
      cl.label.style.opacity = (1 - dmT).toFixed(3);
      const pr = dmProject(cl.mi, cl.mg, cl.mp, 1, dmYaw);
      cl.blob.style.left = `${pr.x}%`;
      cl.blob.style.top = `${pr.y}%`;
      cl.blob.style.opacity = (dmT * 0.58).toFixed(3);
      cl.blob.style.transform = `translate(-50%, -50%) scale(${(1 + pr.rz * 0.4).toFixed(3)})`;
    }
    dmStage.classList.toggle("dm-grab", dmT > 0.5 && !dmDragging);
  }

  function dmFrame(ts) {
    const dt = dmLastTs === null ? 16 : Math.min(ts - dmLastTs, 50);
    dmLastTs = ts;
    // auto demo until the user takes over: 2D beat → 3D orbit → back
    if (!dmUserLed && !REDUCED_MOTION) {
      if (dmDemoStart === null) dmDemoStart = ts;
      const clock = (ts - dmDemoStart) % 11000;
      dmTTarget = clock > 1600 && clock < 8200 ? 1 : 0;
      dmModeButtons.forEach((b) =>
        b.classList.toggle("active", (b.dataset.mode === "3d") === (dmTTarget === 1))
      );
    }
    dmT = REDUCED_MOTION ? dmTTarget : dmLerp(dmT, dmTTarget, 1 - Math.pow(0.992, dt));
    if (!dmDragging && !REDUCED_MOTION) dmYaw += 0.00028 * dt * dmT; // slow orbit, 3D only
    dmRender();
    dmRaf = requestAnimationFrame(dmFrame);
  }

  // 2D/3D segmented toggle
  const dmModeButtons = [...document.querySelectorAll(".dm-mode")];
  dmModeButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      dmUserLed = true;
      dmTTarget = btn.dataset.mode === "3d" ? 1 : 0;
      dmModeButtons.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on);
      });
    })
  );

  // drag to orbit (3D)
  dmStage.addEventListener("pointerdown", (e) => {
    if (dmT < 0.5) return;
    dmDragging = true;
    dmStage.classList.add("dm-dragging");
    dmStage.setPointerCapture(e.pointerId);
    let lastX = e.clientX;
    const move = (ev) => {
      dmYaw += (ev.clientX - lastX) * 0.008;
      lastX = ev.clientX;
    };
    const up = (ev) => {
      dmDragging = false;
      dmStage.classList.remove("dm-dragging");
      dmStage.removeEventListener("pointermove", move);
      dmStage.removeEventListener("pointerup", up);
      dmStage.removeEventListener("pointercancel", up);
    };
    dmStage.addEventListener("pointermove", move);
    dmStage.addEventListener("pointerup", up);
    dmStage.addEventListener("pointercancel", up);
  });

  // run only while on screen; restart the demo when the tab activates
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && dmRaf === null) {
      dmLastTs = null;
      dmRaf = requestAnimationFrame(dmFrame);
    } else if (!entry.isIntersecting && dmRaf !== null) {
      cancelAnimationFrame(dmRaf);
      dmRaf = null;
    }
  }).observe(dmStage);
  document.addEventListener("domainswitch", (e) => {
    if (e.detail === "digital" && !dmUserLed) dmDemoStart = null;
  });
  // screenshot tooling: ?capture&mode=3d pins the 3D projection
  if (new URLSearchParams(location.search).get("mode") === "3d") {
    dmUserLed = true;
    dmT = dmTTarget = 1;
    dmModeButtons.forEach((b) => b.classList.toggle("active", b.dataset.mode === "3d"));
  }
  dmRender(); // static first paint (capture mode / pre-observer)
}

/* ===================================================================
   6. Canvas viz — 360° message builder
   Ported from src/framer/Canvasdomain.tsx: four connector paths draw
   in sequence (1s each) when scrolled into view, flip to the app's
   neon green (#77FFB2) as each connection lands, and reset off-screen.
   =================================================================== */
const fcStage = document.getElementById("fc-stage");
if (fcStage) {
  const fcScene = document.getElementById("fc-scene");
  const FC_SPEED = 1.0; // seconds per connection draw
  const FC_ZOOM = 1.15;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  const fcPaths = ["fc-p1a", "fc-p1b", "fc-p2a", "fc-p2b"].map((id) => {
    const el = document.getElementById(id);
    const len = el.getTotalLength();
    el.style.strokeDasharray = len;
    el.style.strokeDashoffset = len;
    return { el, len };
  });
  // card whose border goes green when the matching path completes
  const fcCards = ["fc-n2", "fc-n3", "fc-n4", "fc-n5"].map((id) => document.getElementById(id));
  const fcSock1 = document.getElementById("fc-s1");
  const fcSock2 = document.getElementById("fc-s2");

  const setFcScale = () => {
    const scale = (fcStage.clientWidth / 1000) * FC_ZOOM;
    fcScene.style.setProperty("--fc-scale", scale.toFixed(4));
  };
  new ResizeObserver(setFcScale).observe(fcStage);
  setFcScale();

  function fcRender(progress) {
    const ps = [clamp01(progress), clamp01(progress - 1), clamp01(progress - 2), clamp01(progress - 3)];
    // each path appears only once its predecessor has fully connected
    const vis = [progress > 0, ps[0] >= 1, ps[1] >= 1, ps[2] >= 1];
    fcPaths.forEach((p, i) => {
      const done = ps[i] >= 1;
      p.el.classList.toggle("fc-live", vis[i]);
      p.el.classList.toggle("fc-done", done);
      p.el.style.strokeDashoffset = p.len * (1 - ps[i]);
      if (ps[i] >= 0.95) {
        p.el.setAttribute("marker-end", done ? "url(#fc-arrow-green)" : "url(#fc-arrow-grey)");
      } else {
        p.el.removeAttribute("marker-end");
      }
      fcCards[i].classList.toggle("fc-on", done);
    });
    fcSock1.classList.toggle("fc-on", ps[1] >= 1);
    fcSock2.classList.toggle("fc-on", ps[3] >= 1);
    fcSock1.classList.toggle("fc-pulse", progress > 0 && progress < 2);
    fcSock2.classList.toggle("fc-pulse", progress >= 2 && progress < 4);
  }

  let fcRaf = null;
  let fcRunning = false;
  function fcStart() {
    if (fcRunning) return;
    fcRunning = true;
    if (REDUCED_MOTION) {
      fcRender(4);
      return;
    }
    let startT = null;
    const tick = (ts) => {
      if (startT === null) startT = ts;
      const progress = Math.min((ts - startT) / 1000 / FC_SPEED, 4);
      fcRender(progress);
      if (progress < 4) fcRaf = requestAnimationFrame(tick);
    };
    fcRaf = requestAnimationFrame(tick);
  }
  function fcReset() {
    if (fcRaf) cancelAnimationFrame(fcRaf);
    fcRaf = null;
    fcRunning = false;
    fcRender(0);
  }

  if (document.documentElement.classList.contains("capture")) {
    fcRender(4); // screenshot tooling: show the connected end state
  } else {
    new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? fcStart() : fcReset()),
      { threshold: 0 }
    ).observe(fcStage);
    // replay the draw each time the Canvas tab is activated
    document.addEventListener("domainswitch", (e) => {
      if (e.detail === "canvas") {
        fcReset();
        fcStart();
      }
    });
  }
}

/* ===================================================================
   6b. Rhetorical viz — policy matchup carousel
   Ported from src/framer/Rhetoricaldoman.tsx: your policy cards cycle
   every 3s with springy tossed-card entrances against a fixed
   opponent card. Cards behind the active one wait on their incoming
   track; passed cards rest on their outgoing track.
   =================================================================== */
const rhStage = document.getElementById("rh-stage");
if (rhStage) {
  const rhScene = document.getElementById("rh-scene");
  const rhCards = [...rhStage.querySelectorAll(".rh-policy")];

  // same scale formula as the canvas scene so cards render at equal size
  const setRhScale = () => {
    const scale = (rhStage.clientWidth / 1000) * 1.15;
    rhScene.style.setProperty("--rh-scale", scale.toFixed(4));
  };
  new ResizeObserver(setRhScale).observe(rhStage);
  setRhScale();

  let rhIndex = 0;
  function rhRender() {
    rhCards.forEach((card, i) => {
      card.classList.toggle("rh-active", i === rhIndex);
      card.classList.toggle("rh-incoming", i > rhIndex);
    });
  }
  rhRender();
  if (!REDUCED_MOTION) {
    setInterval(() => {
      rhIndex = (rhIndex + 1) % rhCards.length;
      rhRender();
    }, 3000);
  }
}

/* ===================================================================
   7. Rabbit hole tracer — a simplified cut of the app's
   RabbitHoleEngine. Audience flow is a weighted directed graph over
   archetype nodes (x = politicization); picking a starting audience
   traces the likeliest route hop by hop toward a political attractor,
   then marks the hop-one intercept window.
   =================================================================== */
const rabFrame = document.getElementById("rab-frame");
if (rabFrame) {
  const RAB_NS = "http://www.w3.org/2000/svg";
  const rabSvg = document.getElementById("rab-svg");
  const rabReadout = document.getElementById("rab-readout");
  const rabChips = [...document.querySelectorAll(".rab-chip")];

  const RAB_NODES = {
    fit: { x: 11, y: 16, label: "fitness & lifting", start: true },
    crime: { x: 9, y: 50, label: "true crime", start: true },
    game: { x: 12, y: 84, label: "gaming streams", start: true },
    selfimp: { x: 37, y: 12, label: "self-improvement" },
    comedy: { x: 35, y: 46, label: "comedy podcasts" },
    drama: { x: 36, y: 80, label: "internet commentary" },
    antiest: { x: 62, y: 30, label: "anti-establishment talk" },
    culture: { x: 64, y: 66, label: "culture-war commentary" },
    mano: { x: 86, y: 16, label: "manosphere punditry", attractor: true },
    pundit: { x: 85, y: 56, label: "hyper-political punditry", attractor: true },
  };
  const RAB_ROUTES = {
    fit: { hops: ["fit", "selfimp", "antiest", "mano"], w: [68, 54, 61] },
    crime: { hops: ["crime", "comedy", "antiest", "pundit"], w: [57, 49, 63] },
    game: { hops: ["game", "drama", "culture", "pundit"], w: [64, 58, 66] },
  };
  // faint always-on web: every edge the routes use, plus cross-links
  const RAB_WEB = [
    ["fit", "selfimp"], ["selfimp", "antiest"], ["antiest", "mano"],
    ["crime", "comedy"], ["comedy", "antiest"], ["antiest", "pundit"],
    ["game", "drama"], ["drama", "culture"], ["culture", "pundit"],
    ["fit", "comedy"], ["crime", "drama"], ["selfimp", "mano"],
    ["comedy", "culture"], ["culture", "mano"],
  ];

  for (const [id, n] of Object.entries(RAB_NODES)) {
    const el = document.createElement("div");
    el.className =
      "rab-node" + (n.start ? " rab-start" : "") + (n.attractor ? " rab-attractor" : "");
    el.style.left = `${n.x}%`;
    el.style.top = `${n.y}%`;
    el.innerHTML = `<span class="rab-dot"></span><span class="rab-label mono">${n.label}</span>`;
    rabFrame.appendChild(el);
    n.el = el;
  }

  const rabWebG = document.createElementNS(RAB_NS, "g");
  const rabRouteG = document.createElementNS(RAB_NS, "g");
  const rabPulse = document.createElementNS(RAB_NS, "circle");
  rabPulse.setAttribute("class", "rab-pulse");
  rabPulse.setAttribute("r", "4");
  rabSvg.append(rabWebG, rabRouteG, rabPulse);

  const rabIntercept = document.createElement("div");
  rabIntercept.className = "rab-intercept";
  rabIntercept.innerHTML =
    `<span class="rab-int-ring"></span><span class="rab-int-pill mono">INTERCEPT WINDOW</span>`;
  rabFrame.appendChild(rabIntercept);

  const rabPx = (id) => ({
    x: (RAB_NODES[id].x / 100) * rabFrame.clientWidth,
    y: (RAB_NODES[id].y / 100) * rabFrame.clientHeight,
  });

  // one curve function for web + route so the lit path overlays its edge
  function rabEdgeD(a, b) {
    const p1 = rabPx(a), p2 = rabPx(b);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const sign = RAB_NODES[a].y <= RAB_NODES[b].y ? -1 : 1;
    const bow = len * 0.12 * sign;
    const cx = (p1.x + p2.x) / 2 + (-dy / len) * bow;
    const cy = (p1.y + p2.y) / 2 + (dx / len) * bow;
    return `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  function rabDrawWeb() {
    rabWebG.replaceChildren();
    for (const [a, b] of RAB_WEB) {
      const path = document.createElementNS(RAB_NS, "path");
      path.setAttribute("class", "rab-edge");
      path.setAttribute("d", rabEdgeD(a, b));
      rabWebG.appendChild(path);
    }
  }

  let rabToken = 0;
  let rabCurrent = null;
  let rabUserLed = false;
  const rabWait = (ms) => new Promise((res) => setTimeout(res, ms));

  function rabReset() {
    rabRouteG.replaceChildren();
    rabPulse.style.opacity = 0;
    rabFrame.querySelectorAll(".rab-weight").forEach((el) => el.remove());
    for (const n of Object.values(RAB_NODES)) n.el.classList.remove("rab-on", "rab-hit");
    rabIntercept.classList.remove("rab-show");
  }

  async function rabTrace(routeId, instant = false) {
    const token = ++rabToken;
    const { hops, w } = RAB_ROUTES[routeId];
    rabCurrent = routeId;
    if (REDUCED_MOTION) instant = true;
    rabChips.forEach((b) => b.classList.toggle("active", b.dataset.route === routeId));
    rabReset();
    RAB_NODES[hops[0]].el.classList.add("rab-on");

    for (let i = 0; i < hops.length - 1; i++) {
      const a = hops[i], b = hops[i + 1];
      const path = document.createElementNS(RAB_NS, "path");
      path.setAttribute(
        "class",
        "rab-route" + (i === hops.length - 2 ? " rab-route-final" : "")
      );
      path.setAttribute("d", rabEdgeD(a, b));
      rabRouteG.appendChild(path);
      const len = path.getTotalLength();

      if (!instant) {
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        rabPulse.style.opacity = 1;
        rabReadout.textContent =
          `hop ${i + 1} · ${RAB_NODES[a].label} → ${RAB_NODES[b].label} · ${w[i]}% of audience flow`;
        await new Promise((res) => {
          const t0 = performance.now();
          const DUR = 700;
          const frame = (now) => {
            if (token !== rabToken) return res();
            const t = Math.min((now - t0) / DUR, 1);
            const e = 1 - Math.pow(1 - t, 3);
            path.style.strokeDashoffset = len * (1 - e);
            const pt = path.getPointAtLength(len * e);
            rabPulse.setAttribute("cx", pt.x);
            rabPulse.setAttribute("cy", pt.y);
            t < 1 ? requestAnimationFrame(frame) : res();
          };
          requestAnimationFrame(frame);
        });
        if (token !== rabToken) return;
      }

      RAB_NODES[b].el.classList.add("rab-on");
      const mid = path.getPointAtLength(len * 0.5);
      const tag = document.createElement("span");
      tag.className = "rab-weight";
      tag.textContent = `${w[i]}%`;
      tag.style.left = `${mid.x}px`;
      tag.style.top = `${mid.y}px`;
      rabFrame.appendChild(tag);
      if (!instant) {
        await rabWait(260);
        if (token !== rabToken) return;
      }
    }

    rabPulse.style.opacity = 0;
    RAB_NODES[hops[hops.length - 1]].el.classList.add("rab-hit");
    const gate = RAB_NODES[hops[1]];
    rabIntercept.style.left = `${gate.x}%`;
    rabIntercept.style.top = `${gate.y}%`;
    rabIntercept.classList.add("rab-show");
    rabReadout.textContent =
      `${RAB_NODES[hops[0]].label} → ${hops.length - 1} hops → ${RAB_NODES[hops[hops.length - 1]].label} · intercept at hop 1, while they're still persuadable`;
  }

  rabChips.forEach((btn) =>
    btn.addEventListener("click", () => {
      rabUserLed = true;
      clearInterval(rabAuto);
      rabTrace(btn.dataset.route);
    })
  );

  // edges live in pixel space — rebuild on resize, snap route to done
  new ResizeObserver(() => {
    rabDrawWeb();
    if (rabCurrent) rabTrace(rabCurrent, true);
  }).observe(rabFrame);
  rabDrawWeb();

  const RAB_ORDER = ["fit", "crime", "game"];
  let rabAuto = null;
  if (document.documentElement.classList.contains("capture")) {
    rabTrace("fit", true); // screenshot tooling: show the landed route
  } else {
    new IntersectionObserver(([entry], obs) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      rabTrace("fit");
      // cycle start audiences until the user takes over
      if (!REDUCED_MOTION) {
        rabAuto = setInterval(() => {
          if (rabUserLed) return;
          const next = RAB_ORDER[(RAB_ORDER.indexOf(rabCurrent) + 1) % RAB_ORDER.length];
          rabTrace(next);
        }, 7000);
      }
    }, { threshold: 0.35 }).observe(rabFrame);
  }
}

/* ===================================================================
   8. Counters — ease-out count-up on view
   =================================================================== */
function animateCounter(el) {
  const target = parseInt(el.dataset.count, 10);
  const prefix = el.dataset.prefix || "";
  const suffix = el.dataset.suffix || "";
  const start = performance.now();
  const DURATION = 1800;

  function frame(now) {
    const t = Math.min((now - start) / DURATION, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = `${prefix}${Math.round(target * eased).toLocaleString("en-US")}${suffix}`;
    if (t < 1) requestAnimationFrame(frame);
  }
  if (REDUCED_MOTION) {
    el.textContent = `${prefix}${target.toLocaleString("en-US")}${suffix}`;
  } else {
    requestAnimationFrame(frame);
  }
}

const counterObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.6 }
);
document.querySelectorAll(".num[data-count]").forEach((el) => counterObserver.observe(el));

/* ===================================================================
   9. Daily Brief — lines type in one after another
   =================================================================== */
const briefLines = [...document.querySelectorAll(".brief-line")];

function typeLine(line, onDone) {
  const tag = document.createElement("span");
  tag.className = `brief-tag ${line.dataset.tagclass}`;
  tag.textContent = line.dataset.tag;

  const text = document.createElement("span");
  text.className = "brief-text";
  const caret = document.createElement("i");
  caret.className = "caret";
  text.appendChild(caret);

  line.append(tag, text);
  line.classList.add("shown");

  const full = line.dataset.text;
  if (REDUCED_MOTION) {
    caret.remove();
    text.textContent = full;
    onDone();
    return;
  }
  let idx = 0;
  const tick = () => {
    idx = Math.min(idx + 2 + Math.floor(Math.random() * 2), full.length);
    text.textContent = full.slice(0, idx);
    if (idx < full.length) {
      text.appendChild(caret);
      setTimeout(tick, 14 + Math.random() * 26);
    } else {
      onDone();
    }
  };
  tick();
}

function runBrief(i = 0) {
  if (i >= briefLines.length) return;
  typeLine(briefLines[i], () => setTimeout(() => runBrief(i + 1), 220));
}

const briefObserver = new IntersectionObserver(
  (entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      briefObserver.disconnect();
      runBrief();
    }
  },
  { threshold: 0.4 }
);
const briefBox = document.getElementById("brief-lines");
if (briefBox) briefObserver.observe(briefBox);

/* ===================================================================
   10. Magnetic buttons — primary CTAs lean toward the cursor
   =================================================================== */
if (!REDUCED_MOTION) {
  document.querySelectorAll(".btn-magnetic").forEach((btn) => {
    btn.addEventListener("pointermove", (e) => {
      const rect = btn.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      btn.style.transform = `translate(${dx * 0.18}px, ${dy * 0.3}px)`;
    });
    btn.addEventListener("pointerleave", () => {
      btn.style.transform = "";
    });
  });
}

/* ===================================================================
   11. Tilt cards (problem section) — subtle 3D lean
   =================================================================== */
if (!REDUCED_MOTION) {
  document.querySelectorAll(".tilt").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(700px) rotateY(${px * 6}deg) rotateX(${py * -6}deg) translateY(-3px)`;
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  });
}

/* ===================================================================
   12. CTA form — stub submit
   =================================================================== */
const ctaForm = document.getElementById("cta-form");
const ctaFine = document.getElementById("cta-fine");
ctaForm?.addEventListener("submit", (e) => {
  e.preventDefault(); // STUB: no backend — demo-request wiring comes later
  ctaFine.textContent = "✓ You're on the list — we'll reach out within one business day.";
  ctaFine.classList.add("success");
  ctaForm.querySelector("input").value = "";
});

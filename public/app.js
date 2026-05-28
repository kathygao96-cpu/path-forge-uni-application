async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.error || `HTTP_${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function track(name, props = {}) {
  try {
    await api("/api/events", { method: "POST", body: { name, props } });
  } catch {
    // ignore analytics failures
  }
}

function qs(sel) {
  return document.querySelector(sel);
}

function qsa(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function drawRadar(canvas, dims) {
  // dims: [{name, score}] score 0-100
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.36;
  const n = dims.length;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const angleAt = (i) => toRad(-90 + (360 / n) * i);

  // grid
  ctx.lineWidth = 1;
  for (const level of [0.2, 0.4, 0.6, 0.8, 1.0]) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = angleAt(i);
      const x = cx + Math.cos(a) * r * level;
      const y = cy + Math.sin(a) * r * level;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.stroke();
  }

  // axes + labels
  ctx.font = "12px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,PingFang SC,Noto Sans CJK SC,Microsoft YaHei,sans-serif";
  ctx.fillStyle = "rgba(231,238,252,.85)";
  for (let i = 0; i < n; i++) {
    const a = angleAt(i);
    const x2 = cx + Math.cos(a) * r;
    const y2 = cy + Math.sin(a) * r;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.stroke();

    const lx = cx + Math.cos(a) * (r + 18);
    const ly = cy + Math.sin(a) * (r + 18);
    const label = `${dims[i].name} ${dims[i].score}`;
    const metrics = ctx.measureText(label);
    ctx.fillText(label, lx - metrics.width / 2, ly + 4);
  }

  // polygon
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = angleAt(i);
    const level = (dims[i].score ?? 0) / 100;
    const x = cx + Math.cos(a) * r * level;
    const y = cy + Math.sin(a) * r * level;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(124,92,255,.22)";
  ctx.strokeStyle = "rgba(124,92,255,.85)";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  // points
  for (let i = 0; i < n; i++) {
    const a = angleAt(i);
    const level = (dims[i].score ?? 0) / 100;
    const x = cx + Math.cos(a) * r * level;
    const y = cy + Math.sin(a) * r * level;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(32,201,151,.95)";
    ctx.fill();
  }
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function computeLocalScores(questionBank, model, answers) {
  const dims = model.dimensions.map((d) => d.id);
  const points = Object.fromEntries(dims.map((d) => [d, 0]));

  const applyDelta = (delta) => {
    if (!delta) return;
    for (const [dim, v] of Object.entries(delta)) points[dim] = (points[dim] || 0) + Number(v || 0);
  };

  for (const q of questionBank.questions) {
    const a = answers[q.id];
    if (a === undefined || a === null || a === "") continue;
    const scoring = q.scoring;
    if (!scoring) continue;

    if (q.type === "single") applyDelta(scoring.options?.[String(a)]);
    if (q.type === "multi" && Array.isArray(a)) for (const opt of a) applyDelta(scoring.options?.[String(opt)]);
    if (q.type === "number") {
      const n = Number(a);
      if (!Number.isFinite(n)) continue;
      for (const band of scoring.bands || []) {
        if (n >= band.min && n <= band.max) {
          applyDelta(band.delta);
          break;
        }
      }
    }
  }

  const scores = {};
  for (const d of model.dimensions) {
    const raw = points[d.id] || 0;
    const max = d.maxPoints || 100;
    scores[d.id] = clamp(Math.round((raw / max) * 100), 0, 100);
  }
  return { points, scores };
}

function pickBadges(scores) {
  const badges = [];
  if ((scores.projects ?? 0) >= 75) badges.push("项目输出强");
  if ((scores.math_cs ?? 0) >= 75) badges.push("数理底子好");
  if ((scores.research ?? 0) >= 75) badges.push("科研潜力高");
  if ((scores.communication ?? 0) >= 70) badges.push("表达加成");
  if ((scores.positioning ?? 0) >= 70) badges.push("定位清晰");
  if (badges.length === 0) badges.push("正在解锁潜力");
  return badges.slice(0, 3);
}

function offerProbability(scores) {
  // 0-100 -> 0-100
  const dims = ["academics", "math_cs", "projects", "research", "communication", "positioning"];
  const weights = { academics: 1.0, math_cs: 1.2, projects: 1.2, research: 0.9, communication: 0.8, positioning: 0.9 };
  let wsum = 0;
  let s = 0;
  for (const d of dims) {
    const w = weights[d] || 1;
    wsum += w;
    s += w * (scores[d] ?? 0);
  }
  const avg = s / Math.max(1e-6, wsum); // 0-100
  // logistic-ish curve: 50 -> ~55, 70 -> ~78, 85 -> ~90
  const x = (avg - 55) / 12;
  const p = 100 / (1 + Math.exp(-x));
  return clamp(Math.round(p), 1, 99);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function typewriter(el, text, { speed = 16, cursor = true } = {}) {
  if (!el) return;
  const full = String(text || "");
  el.innerHTML = "";
  for (let i = 0; i < full.length; i++) {
    el.textContent = full.slice(0, i + 1);
    if (cursor) el.innerHTML = el.textContent + '<span class="cursor"></span>';
    await sleep(speed);
  }
  if (cursor) el.textContent = full;
}

function showRpgOverlay({ rank = "✦", title, sub, btnText = "继续" }) {
  return new Promise((resolve) => {
    let ov = qs("#rpgOverlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "rpgOverlay";
      ov.className = "rpg-overlay";
      ov.innerHTML = `
        <div class="rpg-overlay-card">
          <div class="rpg-overlay-rank" id="ovRank"></div>
          <h3 class="rpg-overlay-title" id="ovTitle"></h3>
          <p class="rpg-overlay-sub" id="ovSub"></p>
          <button type="button" class="btn primary" id="ovBtn">继续</button>
        </div>
      `;
      document.body.appendChild(ov);
    }
    ov.querySelector("#ovRank").textContent = rank;
    ov.querySelector("#ovTitle").textContent = title;
    ov.querySelector("#ovSub").textContent = sub || "";
    const btn = ov.querySelector("#ovBtn");
    btn.textContent = btnText;
    requestAnimationFrame(() => ov.classList.add("show"));
    const done = () => {
      ov.classList.remove("show");
      setTimeout(resolve, 350);
    };
    btn.onclick = done;
    ov.onclick = (e) => {
      if (e.target === ov) done();
    };
  });
}

const RPG_NPC = {
  setup: { name: "系统引导", emoji: "🎮" },
  academics: { name: "学术委员会 HR", emoji: "📚" },
  math_cs: { name: "技术总监", emoji: "🧮" },
  projects: { name: "工程负责人", emoji: "🛠️" },
  research: { name: "科研导师", emoji: "🔬" },
  communication: { name: "海外面试官", emoji: "🗣️" },
  positioning: { name: "终面合伙人", emoji: "🧭" },
  lead: { name: "录取办", emoji: "📬" },
};

const GATE_RANK = (score) => {
  if (score >= 85) return { rank: "S", label: "碾压通关" };
  if (score >= 70) return { rank: "A", label: "稳健过关" };
  if (score >= 55) return { rank: "B", label: "勉强通过" };
  return { rank: "C", label: "险象环生" };
};

function computeTitle(scores) {
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0];
  const low = Object.entries(scores).sort((a, b) => a[1] - b[1])[0]?.[0];
  const map = {
    academics: "学霸底盘",
    math_cs: "数理引擎",
    projects: "项目怪",
    research: "科研型选手",
    communication: "表达Buff",
    positioning: "战略家",
  };
  if ((scores.projects ?? 0) >= 80 && (scores.math_cs ?? 0) >= 70) return "大厂潜力股";
  if ((scores.research ?? 0) >= 78 && (scores.academics ?? 0) >= 70) return "研究型选手";
  if ((scores.positioning ?? 0) <= 45 && (scores.projects ?? 0) >= 70) return "有货但不聚焦";
  return `${map[top] || "全能"} · 需补${map[low] || "短板"}`;
}


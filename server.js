/* eslint-disable no-console */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const kimi = require("./kimi.js");
const sqlite = require("./sqlite.js");
sqlite.init();
sqlite.migrateFromJson();

// 确保默认运营邀请码存在
(() => {
  try {
    const ic = sqlite.getInviteCode("AOTA001");
    if (!ic) {
      sqlite.createInviteCode({ code: "AOTA001", maxUses: 0, status: "active", label: "运营邀请码", createdAt: Date.now() });
      console.log("[init] created default invite code AOTA001");
    }
  } catch (e) { /* ignore */ }
})();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORAGE_DIR = path.join(ROOT, "storage");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  if (!p.startsWith(base)) return null;
  return p;
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = safeJoin(PUBLIC_DIR, rel);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const ct =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : ext === ".json"
            ? "application/json; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : "application/octet-stream";
  res.writeHead(200, { "content-type": ct, "cache-control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function loadConfig() {
  return {
    model: readJson(path.join(DATA_DIR, "model.json"), null),
    questionBank: readJson(path.join(DATA_DIR, "questionBank.v1.json"), null),
    industries: readJson(path.join(DATA_DIR, "industries.json"), []),
    roles: readJson(path.join(DATA_DIR, "roles.json"), []),
    companyTypes: readJson(path.join(DATA_DIR, "companyTypes.json"), []),
    companies: readJson(path.join(DATA_DIR, "companies.json"), []),
    programs: readJson(path.join(DATA_DIR, "programs.v1.json"), []),
    lifestylePrefs: readJson(path.join(DATA_DIR, "lifestylePrefs.json"), null),
    scenarios: readJson(path.join(DATA_DIR, "scenarios.json"), { scenarios: [] }),
    rules: readJson(path.join(DATA_DIR, "rules.v1.json"), null),
    templates: readJson(path.join(DATA_DIR, "templates.v1.json"), null),
    archetypes: readJson(path.join(DATA_DIR, "archetypes.json"), { types: [], rules: [], defaults: {} }),
  };
}

// ---------------------- 评分引擎 V2 ----------------------

function applyDelta(points, delta) {
  if (!delta) return;
  for (const [dim, v] of Object.entries(delta)) {
    points[dim] = (points[dim] || 0) + Number(v || 0);
  }
}

/**
 * 把 roleCard 的事实字段映射到维度分。
 * answers 里以 rc_xxx 为 key 存储 roleCard 输入。
 */
function scoreRoleCardFacts(answers, cfg, points) {
  const reasons = [];
  // 院校层级
  const tier = answers.rc_school_tier;
  const tierMap = { c9: 35, "985": 28, "211": 20, shuangfei: 12, overseas: 25, joint: 20 };
  if (tier && tierMap[tier] != null) {
    points.academic = (points.academic || 0) + tierMap[tier];
    reasons.push({ field: "rc_school_tier", value: tier, dim: "academic", delta: tierMap[tier] });
  }
  // GPA 百分制
  const gpa = Number(answers.rc_gpa);
  if (Number.isFinite(gpa) && gpa > 0) {
    let g = 0;
    if (gpa >= 90) g = 25;
    else if (gpa >= 85) g = 20;
    else if (gpa >= 80) g = 15;
    else if (gpa >= 75) g = 10;
    else g = 5;
    points.academic = (points.academic || 0) + g;
    reasons.push({ field: "rc_gpa", value: gpa, dim: "academic", delta: g });
  }
  // 排名
  const rank = answers.rc_rank;
  const rankMap = { top5: 15, top10: 12, top20: 8, mid: 4, unknown: 0 };
  if (rank && rankMap[rank] != null) {
    points.academic = (points.academic || 0) + rankMap[rank];
    reasons.push({ field: "rc_rank", value: rank, dim: "academic", delta: rankMap[rank] });
  }
  // 专业-目标跨度
  const fromMajor = answers.rc_major;
  const toMajors = Array.isArray(answers.rc_target_majors) ? answers.rc_target_majors : [];
  if (fromMajor && toMajors.length > 0) {
    const gapMap = (cfg.rules?.majorToTargetGap || {})[fromMajor] || {};
    // 取最近的目标专业（最小距离）
    let minDist = 3;
    for (const tm of toMajors) {
      const d = gapMap[tm];
      if (typeof d === "number" && d < minDist) minDist = d;
    }
    const distToScore = [40, 30, 18, 8];
    const gp = distToScore[minDist] ?? 8;
    points.gap = (points.gap || 0) + gp;
    reasons.push({ field: "major_gap", value: { from: fromMajor, to: toMajors, dist: minDist }, dim: "gap", delta: gp });
  }
  // 路径清晰度——按多选数量评分
  const indCount = (answers.rc_target_industries || []).length;
  const indScore = indCount === 0 ? 0 : indCount <= 2 ? 14 : indCount <= 4 ? 9 : 5;
  if (indScore) {
    points.clarity = (points.clarity || 0) + indScore;
    reasons.push({ field: "rc_target_industries", count: indCount, dim: "clarity", delta: indScore });
  }
  const roleCount = (answers.rc_target_roles || []).length;
  const roleScore = roleCount === 0 ? 0 : roleCount <= 2 ? 14 : roleCount <= 4 ? 9 : 5;
  if (roleScore) {
    points.clarity = (points.clarity || 0) + roleScore;
    reasons.push({ field: "rc_target_roles", count: roleCount, dim: "clarity", delta: roleScore });
  }
  const locCount = (answers.rc_target_locations || []).length;
  const locScore = locCount === 0 ? 0 : locCount <= 2 ? 10 : 6;
  if (locScore) {
    points.clarity = (points.clarity || 0) + locScore;
    reasons.push({ field: "rc_target_locations", count: locCount, dim: "clarity", delta: locScore });
  }
  const ctCount = (answers.rc_target_company_types || []).length;
  const ctScore = ctCount === 0 ? 0 : ctCount <= 2 ? 10 : 6;
  if (ctScore) {
    points.clarity = (points.clarity || 0) + ctScore;
    reasons.push({ field: "rc_target_company_types", count: ctCount, dim: "clarity", delta: ctScore });
  }
  // 语言成绩 → execution
  const ielts = Number(answers.rc_ielts_score);
  const toefl = Number(answers.rc_toefl_score);
  const cet6 = Number(answers.rc_cet6_score);
  let langScore = 0;
  if (Number.isFinite(ielts) && ielts > 0) {
    if (ielts >= 7.5) langScore = 25;
    else if (ielts >= 7.0) langScore = 20;
    else if (ielts >= 6.5) langScore = 15;
    else if (ielts >= 6.0) langScore = 10;
    else langScore = 5;
  } else if (Number.isFinite(toefl) && toefl > 0) {
    if (toefl >= 105) langScore = 25;
    else if (toefl >= 95) langScore = 20;
    else if (toefl >= 85) langScore = 15;
    else if (toefl >= 75) langScore = 10;
    else langScore = 5;
  } else if (Number.isFinite(cet6) && cet6 > 0) {
    if (cet6 >= 550) langScore = 15;
    else if (cet6 >= 500) langScore = 10;
    else if (cet6 >= 425) langScore = 5;
  }
  if (langScore) {
    points.execution = (points.execution || 0) + langScore;
    reasons.push({ field: "language", score: langScore, dim: "execution", delta: langScore });
  }
  return reasons;
}

/**
 * 计算 6 维分数（roleCard + 关卡题 + scenarios）
 */
function computeScores({ model, questionBank, scenarios, answers, cfg }) {
  const dims = model.dimensions.map((d) => d.id);
  const points = Object.fromEntries(dims.map((d) => [d, 0]));
  const reasons = { roleCard: [], questions: [], scenarios: [] };

  // 1) roleCard 事实
  reasons.roleCard = scoreRoleCardFacts(answers, cfg, points);

  // 2) 普通题
  for (const q of questionBank.questions || []) {
    const a = answers[q.id];
    if (a === undefined || a === null || a === "") continue;
    const scoring = q.scoring;
    if (!scoring) continue;
    const apply = (optId) => {
      const d = scoring.options?.[String(optId)];
      if (d) {
        applyDelta(points, d);
        reasons.questions.push({ qid: q.id, opt: optId, delta: d });
      }
    };
    if (q.type === "single") apply(String(a));
    if (q.type === "multi" && Array.isArray(a)) for (const opt of a) apply(String(opt));
    if (q.type === "number") {
      const n = Number(a);
      if (!Number.isFinite(n)) continue;
      for (const band of scoring.bands || []) {
        if (n >= band.min && n <= band.max) {
          applyDelta(points, band.delta);
          reasons.questions.push({ qid: q.id, value: n, delta: band.delta });
          break;
        }
      }
    }
    if (q.type === "star") {
      const n = Number(a);
      if (!Number.isFinite(n) || n < 1) continue;
      const d = scoring.stars?.[String(n)];
      if (d) {
        applyDelta(points, d);
        reasons.questions.push({ qid: q.id, value: n, delta: d });
      }
    }
  }

  // 3) scenarios
  for (const s of scenarios.scenarios || []) {
    const a = answers[s.id];
    if (a === undefined || a === null || a === "") continue;
    const apply = (optId) => {
      const d = s.scoring?.options?.[String(optId)];
      if (d) {
        applyDelta(points, d);
        reasons.scenarios.push({ sid: s.id, opt: optId, delta: d });
      }
    };
    if (s.type === "single") apply(String(a));
    if (s.type === "multi" && Array.isArray(a)) for (const opt of a) apply(String(opt));
  }

  // 归一化
  const scores = {};
  for (const d of model.dimensions) {
    const raw = points[d.id] || 0;
    const max = d.maxPoints || 100;
    scores[d.id] = Math.max(0, Math.min(100, Math.round((raw / max) * 100)));
  }
  return { scores, points, reasons };
}

function offerProbability(scores) {
  const w = { academic: 1.0, gap: 0.9, experience: 1.2, clarity: 0.9, execution: 1.0, fit: 0.8 };
  let wsum = 0;
  let s = 0;
  for (const [d, v] of Object.entries(w)) {
    wsum += v;
    s += v * (scores[d] ?? 0);
  }
  const avg = s / Math.max(1e-6, wsum);
  const x = (avg - 55) / 12;
  const p = 100 / (1 + Math.exp(-x));
  return Math.max(1, Math.min(99, Math.round(p)));
}

function pickStrongWeak(scores, model) {
  const list = model.dimensions.map((d) => ({ id: d.id, name: d.name, score: scores[d.id] ?? 0 }));
  const sortedAsc = [...list].sort((a, b) => a.score - b.score);
  const sortedDesc = [...list].sort((a, b) => b.score - a.score);
  return { strong: sortedDesc[0], weak: sortedAsc[0] };
}

function deriveAlchemistType(scores, model, archetypes) {
  const types = archetypes.types || [];
  const rules = (archetypes.rules || []).slice().sort((a, b) => a.priority - b.priority);
  const defaults = archetypes.defaults || {};

  // 规则匹配
  for (const rule of rules) {
    const when = rule.when || {};
    let match = true;
    for (const [dim, cond] of Object.entries(when)) {
      const score = scores[dim] ?? 0;
      if (cond.min !== undefined && score < cond.min) { match = false; break; }
      if (cond.max !== undefined && score > cond.max) { match = false; break; }
    }
    if (match) {
      const t = types.find((x) => x.code === rule.typeId);
      if (t) return t;
    }
  }

  // 无规则匹配 → 按最强维度给默认类型
  const list = model.dimensions.map((d) => ({ id: d.id, score: scores[d.id] ?? 0 }));
  const top = [...list].sort((a, b) => b.score - a.score)[0];
  const def = defaults[top?.id];
  if (def) return def;

  // 最终硬兜底（理论上不会走到这里，但保证绝不返回问号类型）
  const avgScore = list.reduce((s, d) => s + d.score, 0) / list.length;
  if (avgScore >= 60) {
    return { code: "PERF", name: "六边形赌狗", tagline: "什么都沾点，什么都不精，申请季全靠赌", desc: "你的维度分布比较平均，没有特别突出的长板，也没有明显的短板。", strength: "容错率极高，哪个方向都能蹭一蹭", blindspot: "缺乏一锤定音的亮点", fitPath: "找到一个能串起你杂七杂八经历的叙事主线" };
  }
  return { code: "FOGG", name: "正在加载中…", tagline: "进度条卡在1%，但心态已经崩了", desc: "你的画像还在生成中，各项维度都还有很大的提升空间。", strength: "白纸一张，可塑性极强", blindspot: "信息差巨大，容易被割韭菜", fitPath: "先做信息扫盲，找个靠谱的人带你入门" };
}

// ---------------------- 推荐 fallback（LLM 不可用时） ----------------------

function fallbackMatches({ scores, profile, cfg }) {
  const { industries, roles, companyTypes, companies } = cfg;
  const targetIndustryIds = new Set(profile?.rc_target_industries || []);
  const targetRoleIds = new Set(profile?.rc_target_roles || []);
  const targetCompanyTypeIds = new Set(profile?.rc_target_company_types || []);
  const userMajor = profile?.rc_major;

  const MAJOR_TO_NAMES = {
    cs: ["计算机"],
    ai_ds: ["AI", "数据科学", "计算机"],
    ee: ["电子电气"],
    telecom: ["通信"],
    microe: ["微电子"],
    me: ["机械"],
    materials: ["材料"],
    chem: ["化工"],
    bio: ["生物医药", "生物"],
    business: ["商科"],
    cross: ["数学", "物理", "统计", "交叉学科"],
  };
  const majorNames = MAJOR_TO_NAMES[userMajor] || [];

  const norm = (v) => (v ?? 0) / 100;
  const user = Object.fromEntries(Object.keys(scores).map((k) => [k, norm(scores[k])]));

  const pairs = [];
  for (const ind of industries) {
    for (const role of roles) {
      if (!role.fitIndustries?.includes(ind.id)) continue;
      let dist = 0;
      let wsum = 0;
      for (const [dim, target] of Object.entries(ind.matchVector || {})) {
        const w = ind.weights?.[dim] ?? 1;
        const diff = (user[dim] ?? 0) - target;
        dist += w * diff * diff;
        wsum += w;
      }
      const avgDist = dist / Math.max(1e-6, wsum);
      // 线性衰减：完美匹配 1.0，avgDist=0.25 时降到 0.5，avgDist=0.5 时 0
      const base = Math.max(0, Math.min(1, 1 - avgDist * 2));
      let bonus = 0;
      // 目标方向偏好（学生主动勾选的方向权重更高）
      if (targetIndustryIds.has(ind.id)) bonus += 0.08;
      if (targetRoleIds.has(role.id)) bonus += 0.08;
      // 本科专业与行业/岗位的匹配度
      if (majorNames.some((n) => (ind.bestFitMajors || []).includes(n))) bonus += 0.05;
      if (majorNames.some((n) => (role.fitMajors || []).includes(n))) bonus += 0.05;
      const fitScore = Math.max(0, Math.min(1, base + bonus));
      pairs.push({ industry: ind, role, fitScore });
    }
  }
  pairs.sort((a, b) => b.fitScore - a.fitScore);

  const seenIndustry = new Set();
  const top = [];
  for (const p of pairs) {
    if (seenIndustry.has(p.industry.id) && top.length >= 1) continue; // 行业多样性
    if (top.length >= 3) break;
    seenIndustry.add(p.industry.id);
    // 公司
    let cands = companies.filter((c) => c.industry === p.industry.id);
    if (targetCompanyTypeIds.size > 0) {
      const filtered = cands.filter((c) => targetCompanyTypeIds.has(c.companyType));
      if (filtered.length > 0) cands = filtered;
    }
    const companyList = cands.slice(0, 3).map((c) => ({
      name: c.name,
      tag: c.tag,
      salary: c.salary,
      location: Array.isArray(c.locations) ? c.locations.join("/") : "",
    }));
    // 推断 companyType：从匹配的 companies 选最常见的
    const ctCount = {};
    for (const c of cands.slice(0, 5)) ctCount[c.companyType] = (ctCount[c.companyType] || 0) + 1;
    const dominantCT = Object.entries(ctCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "private_manufacturing";

    top.push({
      industryId: p.industry.id,
      roleId: p.role.id,
      companyTypeId: dominantCT,
      fitScore: Math.round(p.fitScore * 100),
      rating: p.industry.rating || "🟢",
      why: `${p.industry.tagline}。你的底牌与「${p.industry.name} × ${p.role.name}」的路径匹配度为 ${Math.round(p.fitScore * 100)}/100。${p.role.friendNote || ""}`,
      companies: companyList,
      salaryBand: p.industry.salaryBand,
    });
  }
  return top;
}

function fallbackPrograms({ scores, profile, cfg }) {
  const targetRegions = new Set(profile?.rc_target_locations || []);
  const targetIndustries = new Set(profile?.rc_target_industries || []);
  const targetMajors = new Set(profile?.rc_target_majors || []);

  const enriched = cfg.programs.map((p) => {
    const minBars = p.minBars || {};
    let met = 0;
    let total = 0;
    for (const [dim, bar] of Object.entries(minBars)) {
      total += 1;
      if ((scores[dim] ?? 0) >= bar) met += 1;
    }
    const academicReadiness = total > 0 ? met / total : 0.7;

    let fit = 0;
    if (targetRegions.size > 0 && targetRegions.has(p.country)) fit += 0.5;
    else if (targetRegions.size === 0) fit += 0.25;
    if ((p.fitIndustries || []).some((i) => targetIndustries.has(i))) fit += 0.4;
    const tl = (p.track || "").toLowerCase();
    if (targetMajors.has("materials") && tl.includes("materials")) fit += 0.2;
    if (targetMajors.has("microe") && (tl.includes("microe") || tl.includes("ic") || tl.includes("ece"))) fit += 0.2;
    if (targetMajors.has("cs") && (tl.includes("cs") || tl.includes("computer"))) fit += 0.2;
    if (targetMajors.has("ai_ds") && (tl.includes("ai") || tl.includes("data") || tl.includes("ml"))) fit += 0.2;
    if (targetMajors.has("me") && (tl.includes("me") || tl.includes("mechanical") || tl.includes("robot"))) fit += 0.2;
    if (targetMajors.has("ee") && (tl.includes("ee") || tl.includes("electrical"))) fit += 0.2;
    fit = Math.min(1, fit);

    const rankScore = academicReadiness * 0.5 + fit * 0.5;

    // tier 给冲刺额外加权（让冲刺池里能优先出 S/A 学校）
    const tierBonus = ({ "S+": 0.15, "S": 0.1, "A": 0.05, "B": 0, "C": -0.05 })[p.tier] || 0;

    return { p, academicReadiness, fit, rankScore, tierBonus };
  });

  // 风险判定：基础档 + 极端低分时按分位补档
  const allAcad = enriched.map((x) => x.academicReadiness).sort((a, b) => a - b);
  const p50 = allAcad[Math.floor(allAcad.length * 0.5)] ?? 0.5;
  for (const x of enriched) {
    if (x.academicReadiness >= 1.0) x.risk = "保底";
    else if (x.academicReadiness >= 0.6) x.risk = "匹配";
    else x.risk = "冲刺";
    // 整体水平太低时（p50 < 0.3），按相对分位上调 fit 极高的项目
    if (p50 < 0.3) {
      if (x.academicReadiness >= p50 && x.fit >= 0.9) x.risk = "保底";
      else if (x.academicReadiness >= p50) x.risk = "匹配";
    }
  }

  const sortReach = (a, b) => (b.fit + b.tierBonus) - (a.fit + a.tierBonus);
  const sortByRank = (a, b) => b.rankScore - a.rankScore;
  const sortByTier = (a, b) => (b.tierBonus) - (a.tierBonus) || (b.fit) - (a.fit);

  const safe = enriched.filter((x) => x.risk === "保底").sort(sortByRank);
  const match = enriched.filter((x) => x.risk === "匹配").sort(sortByRank);
  const reach = enriched.filter((x) => x.risk === "冲刺").sort(sortReach);

  // 配额：2 保底 / 3 匹配 / 3 冲刺。原桶不足从邻桶借，标记原始分类。
  const TARGET = { safe: 2, match: 3, reach: 3 };
  const picks = [];
  const ids = new Set();
  const take = (list, n, displayRisk) => {
    let taken = 0;
    for (const x of list) {
      if (taken >= n) break;
      if (ids.has(x.p.id)) continue;
      picks.push({ ...x, displayRisk });
      ids.add(x.p.id);
      taken += 1;
    }
    return taken;
  };

  // 1) 先在原桶里取
  let gotSafe = take(safe, TARGET.safe, "保底");
  let gotMatch = take(match, TARGET.match, "匹配");
  let gotReach = take(reach, TARGET.reach, "冲刺");

  // 2) 保底不足：把 academic≥0.75 的匹配项提为"接近保底"
  if (gotSafe < TARGET.safe) {
    const looseSafe = match.filter((x) => x.academicReadiness >= 0.75 && !ids.has(x.p.id)).sort(sortByRank);
    gotSafe += take(looseSafe, TARGET.safe - gotSafe, "保底");
  }
  // 3) 还不足：把 academic≥0.5 的冲刺项当保底——降级展示
  if (gotSafe < TARGET.safe) {
    const veryLooseSafe = reach.filter((x) => x.academicReadiness >= 0.5 && !ids.has(x.p.id)).sort(sortByRank);
    gotSafe += take(veryLooseSafe, TARGET.safe - gotSafe, "保底");
  }

  // 4) 匹配不足：从冲刺池按 fit 高的顺序借
  if (gotMatch < TARGET.match) {
    const looseMatch = reach.filter((x) => x.fit >= 0.7 && !ids.has(x.p.id)).sort(sortByRank);
    gotMatch += take(looseMatch, TARGET.match - gotMatch, "匹配");
  }
  // 还不足：从保底里借（取 academic 不那么饱和的）
  if (gotMatch < TARGET.match) {
    const safeAsMatch = safe.filter((x) => !ids.has(x.p.id)).sort(sortByRank);
    gotMatch += take(safeAsMatch, TARGET.match - gotMatch, "匹配");
  }
  // 极端低分情况下整个 enriched 都是冲刺——把前 3 个 fit 最高的当匹配（因为相对其他申请者还是有可能）
  if (gotMatch < TARGET.match) {
    const reachAsMatch = reach.filter((x) => !ids.has(x.p.id)).sort(sortByRank);
    gotMatch += take(reachAsMatch, TARGET.match - gotMatch, "匹配");
  }

  // 5) 冲刺不足：从匹配 + 保底中找 fit 最高、tier 最高的当冲刺
  if (gotReach < TARGET.reach) {
    const reachLooser = enriched
      .filter((x) => !ids.has(x.p.id) && (x.tierBonus > 0 || x.fit >= 0.6))
      .sort(sortByTier);
    gotReach += take(reachLooser, TARGET.reach - gotReach, "冲刺");
  }

  // 6) 还差就按整体 rankScore 补齐到 8（按原 risk 标）
  if (picks.length < 8) {
    const rest = enriched.filter((x) => !ids.has(x.p.id)).sort(sortByRank);
    for (const x of rest) {
      picks.push({ ...x, displayRisk: x.risk });
      ids.add(x.p.id);
      if (picks.length >= 8) break;
    }
  }

  // 7) 最终排序：保底 → 匹配 → 冲刺
  const orderKey = (r) => (r === "保底" ? 0 : r === "匹配" ? 1 : 2);
  picks.sort((a, b) => orderKey(a.displayRisk) - orderKey(b.displayRisk) || b.rankScore - a.rankScore);

  return picks.slice(0, 8).map(({ p, academicReadiness, fit, rankScore, displayRisk }) => ({
    id: p.id,
    country: p.country,
    school: p.school,
    name: p.name,
    track: p.track,
    tier: p.tier,
    risk: displayRisk,
    readiness: Math.round(rankScore * 100) / 100,
    academicReadiness: Math.round(academicReadiness * 100) / 100,
    fitScore: Math.round(fit * 100) / 100,
    link: p.link,
    fitTag: p.friendNote || `${p.country} · ${p.track}`,
  }));
}

function fallbackTruths({ scores, model, cfg }) {
  const actionsByDim = cfg.rules?.actionsByDim || {};
  const sorted = model.dimensions.slice().sort((a, b) => (scores[a.id] ?? 0) - (scores[b.id] ?? 0));
  const out = [];
  for (const dim of sorted) {
    const pool = actionsByDim[dim.id] || [];
    for (const a of pool) {
      if (out.length >= 3) break;
      out.push({ text: a.title, why: a.friendQuote || a.goal || "" });
    }
    if (out.length >= 3) break;
  }
  return out;
}

function fallbackTimeline({ profile }) {
  // 简单版：基于 apply_season + stage 反推
  const season = profile?.rc_apply_season || "27fall";
  const stage = profile?.rc_stage || "junior";
  const phases = [];
  if (season === "27fall") {
    phases.push({ phase: "现在 ~ 2026/08", tasks: ["补核心课/技能项目", "找一段相关方向实习"], milestone: "暑期实习到岗" });
    phases.push({ phase: "2026/09 ~ 2026/12", tasks: ["申请文书/推荐人/语言出分", "海投秋招练手"], milestone: "递交核心校申请" });
    phases.push({ phase: "2027/01 ~ 2027/04", tasks: ["拿到 offer 后选校", "春招+暑期实习同步投递"], milestone: "确定入学校" });
    phases.push({ phase: "2027/09", tasks: ["入学准备"], milestone: "27 Fall 入学" });
  } else if (season === "26fall") {
    phases.push({ phase: "现在 ~ 2026/06", tasks: ["finalize 材料", "找暑期实习", "提前批可大胆尝试"], milestone: "提前批投递" });
    phases.push({ phase: "2026/07 ~ 2026/10", tasks: ["秋招终极战", "全职冲刺 dream offer"], milestone: "拿到 offer" });
    phases.push({ phase: "2026/11+", tasks: ["毕业到岗准备"], milestone: "入职/入学" });
  } else {
    phases.push({ phase: "现在 ~ 1 年内", tasks: ["补 GPA/项目/语言三大件"], milestone: "申请准备就位" });
    phases.push({ phase: "申请季前 6 个月", tasks: ["定校单/写文书"], milestone: "递交申请" });
    phases.push({ phase: "申请季", tasks: ["面试/选校"], milestone: "拿到 offer" });
  }
  return phases;
}

function sanitizeString(s) {
  if (typeof s !== "string") return s;
  return s.replace(/LinkedIn/gi, "专业社交").replace(/领英/g, "专业社交");
}

function sanitizeReport(r) {
  if (!r) return r;
  const out = JSON.parse(JSON.stringify(r));
  if (out.title) out.title = sanitizeString(out.title);
  if (out.summary) out.summary = sanitizeString(out.summary);
  if (Array.isArray(out.truths)) {
    for (const t of out.truths) {
      if (t.text) t.text = sanitizeString(t.text);
      if (t.why) t.why = sanitizeString(t.why);
    }
  }
  if (Array.isArray(out.matches)) {
    for (const m of out.matches) {
      if (m.why) m.why = sanitizeString(m.why);
    }
  }
  if (Array.isArray(out.timeline)) {
    for (const tl of out.timeline) {
      if (tl.milestone) tl.milestone = sanitizeString(tl.milestone);
      if (Array.isArray(tl.tasks)) tl.tasks = tl.tasks.map(sanitizeString);
    }
  }
  if (Array.isArray(out.programs)) {
    for (const p of out.programs) {
      if (p.fitTag) p.fitTag = sanitizeString(p.fitTag);
    }
  }
  if (Array.isArray(out.scenarioCommentary)) {
    for (const s of out.scenarioCommentary) {
      if (s.comment) s.comment = sanitizeString(s.comment);
    }
  }
  return out;
}

// ---------------------- 报告生成 ----------------------

async function generateAssessmentReport({ cfg, answers, leadId }) {
  const { model, questionBank, scenarios } = cfg;

  // 1) 本地评分
  const { scores, points, reasons } = computeScores({ model, questionBank, scenarios, answers, cfg });
  const { strong, weak } = pickStrongWeak(scores, model);
  const offer = offerProbability(scores);
  const alchemistType = deriveAlchemistType(scores, model, cfg.archetypes);
  const fallbackTitle = `${alchemistType.name} · ${alchemistType.tagline}`;

  // 2) 提取 profile / scenarioAnswers
  const profile = {};
  for (const k of Object.keys(answers)) {
    if (k.startsWith("rc_")) profile[k] = answers[k];
  }
  const scenarioAnswers = {};
  for (const s of scenarios.scenarios || []) {
    if (answers[s.id] !== undefined) scenarioAnswers[s.id] = answers[s.id];
  }

  // 3) 基础 dims（雷达图用）
  const dims = model.dimensions.map((d) => ({ id: d.id, name: d.name, shortName: d.shortName, radarName: d.radarName || d.name, desc: d.desc, score: scores[d.id] ?? 0 }));

  // 4) 先生成 fallback（保证报告永远可用）
  const matchesFB = fallbackMatches({ scores, profile, cfg });
  const programsFB = fallbackPrograms({ scores, profile, cfg });
  const truthsFB = fallbackTruths({ scores, model, cfg });
  const timelineFB = fallbackTimeline({ profile });

  // 5) 调 LLM
  let llmReport = null;
  let llmTelemetry = null;
  let llmError = null;
  if (kimi.isAvailable()) {
    try {
      const dataset = {
        industries: cfg.industries,
        roles: cfg.roles,
        companyTypes: cfg.companyTypes,
        companies: cfg.companies,
        programs: cfg.programs,
      };
      const r = await kimi.generateReport({
        profile,
        answers,
        scores,
        scenarioAnswers,
        weakDim: weak?.id,
        strongDim: strong?.id,
        dataset,
      });
      if (r.report) {
        llmReport = sanitizeReport(r.report);
        llmTelemetry = r.telemetry;
      } else {
        llmError = r.error || "unknown";
        llmTelemetry = r.telemetry || null;
      }
    } catch (e) {
      llmError = "exception: " + e.message;
    }
  } else {
    llmError = "no_api_key";
  }

  // 6) 合并
  // 构造 fallback summary，把 ID 翻译成中文
  const topMatch = matchesFB[0];
  const topIndustryName = (cfg.industries.find((i) => i.id === topMatch?.industryId) || {}).name || "综合方向";
  const topRoleName = (cfg.roles.find((r) => r.id === topMatch?.roleId) || {}).name || "通用岗位";
  const topCompanyTypeName = (cfg.companyTypes.find((c) => c.id === topMatch?.companyTypeId) || {}).shortName || "";
  const ctSuffix = topCompanyTypeName ? ` × ${topCompanyTypeName}` : "";
  const fallbackSummary = `你的底牌最接近「${topIndustryName} × ${topRoleName}${ctSuffix}」的路径方向。最强的是「${strong?.name || "—"}」，最需要补强的是「${weak?.name || "—"}》。`;

  const finalOffer = llmReport?.offerProbability ?? offer;
  const finalTruths = llmReport?.truths || truthsFB;

  const report = {
    scores,
    dims,
    offerProbability: finalOffer,
    title: llmReport?.title || fallbackTitle,
    summary: llmReport?.summary || fallbackSummary,
    strongDim: strong,
    weakDim: weak,
    matches: llmReport?.matches || matchesFB,
    truths: finalTruths,
    timeline: llmReport?.timeline || timelineFB,
    programs: llmReport?.programs || programsFB,
    scenarioCommentary: llmReport?.scenarioCommentary || [],
    llmGenerated: Boolean(llmReport),
    llmError,
    reasons,
    alchemistType,
  };

  return { report, llmTelemetry };
}

// ---------------------- 路由 ----------------------

function requireAdmin(req, res, url) {
  const pass = url.searchParams.get("password") || req.headers["x-admin-password"];
  if (pass !== ADMIN_PASSWORD) {
    send(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

const ADMIN_FILE_MAP = {
  model: "model.json",
  "questionBank.v1": "questionBank.v1.json",
  "programs.v1": "programs.v1.json",
  industries: "industries.json",
  roles: "roles.json",
  companyTypes: "companyTypes.json",
  companies: "companies.json",
  lifestylePrefs: "lifestylePrefs.json",
  scenarios: "scenarios.json",
  "rules.v1": "rules.v1.json",
  "templates.v1": "templates.v1.json",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === "GET" && serveStatic(req, res, pathname)) return;

    if (req.method === "GET" && pathname === "/api/health") {
      return send(res, 200, { ok: true, llmAvailable: kimi.isAvailable() });
    }

    if (req.method === "GET" && pathname === "/api/config") {
      const cfg = loadConfig();
      return send(res, 200, {
        model: cfg.model,
        questionBank: { meta: cfg.questionBank?.meta, gates: cfg.questionBank?.gates },
        industries: cfg.industries,
        roles: cfg.roles,
        companyTypes: cfg.companyTypes,
        lifestylePrefs: cfg.lifestylePrefs,
        counts: {
          companies: cfg.companies.length,
          programs: cfg.programs.length,
          scenarios: (cfg.scenarios.scenarios || []).length,
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/questionBank") {
      const cfg = loadConfig();
      return send(res, 200, {
        ...cfg.questionBank,
        scenariosById: Object.fromEntries((cfg.scenarios.scenarios || []).map((s) => [s.id, s])),
      });
    }

    if (req.method === "GET" && pathname === "/api/scenarios") {
      const cfg = loadConfig();
      return send(res, 200, cfg.scenarios);
    }

    // admin file CRUD
    if (pathname.startsWith("/api/admin/") && pathname !== "/api/admin/export" && pathname !== "/api/admin/stats" && pathname !== "/api/admin/test-llm") {
      if (!requireAdmin(req, res, url)) return;
      const name = pathname.replace("/api/admin/", "");
      const file = ADMIN_FILE_MAP[name];
      if (!file) return send(res, 404, { error: "not_found" });
      const fp = path.join(DATA_DIR, file);
      if (req.method === "GET") return send(res, 200, readJson(fp, null));
      if (req.method === "POST" || req.method === "PUT") {
        const raw = await readBody(req);
        let json;
        try {
          json = JSON.parse(raw);
        } catch {
          return send(res, 400, { error: "invalid_json" });
        }
        writeJson(fp, json);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: "method_not_allowed" });
    }

    // invite code verify
    if (req.method === "POST" && pathname === "/api/invite/verify") {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "invalid_json" }); }
      const code = String(body.code || "").trim().toUpperCase();
      if (!code) return send(res, 400, { error: "code_required" });
      const row = sqlite.getInviteCode(code);
      if (!row) return send(res, 403, { error: "invalid_code", message: "邀请码不存在" });
      if (row.status !== "active") return send(res, 403, { error: "code_disabled", message: "邀请码已失效" });
      if (row.maxUses > 0 && row.usedCount >= row.maxUses) return send(res, 403, { error: "code_exhausted", message: "邀请码使用次数已达上限" });
      return send(res, 200, { valid: true, code: row.code, label: row.label, remaining: row.maxUses > 0 ? row.maxUses - row.usedCount : null });
    }

    // invite code generate (after assessment completion)
    if (req.method === "POST" && pathname === "/api/invite/generate") {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "invalid_json" }); }
      const leadId = String(body.leadId || "").trim();
      if (!leadId) return send(res, 400, { error: "leadId_required" });
      // check if already generated
      const existing = sqlite.getInviteCodeByOwner(leadId);
      if (existing) return send(res, 200, { code: existing.code, existing: true });
      const code = "REF" + crypto.randomBytes(4).toString("hex").toUpperCase();
      const row = { code, ownerLeadId: leadId, maxUses: 0, status: "active", label: "用户裂变码", createdAt: nowIso() };
      sqlite.createInviteCode(row);
      return send(res, 200, { code, existing: false });
    }

    if (req.method === "POST" && pathname === "/api/leads") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "invalid_json" });
      }
      const lead = {
        id: id("lead"),
        createdAt: nowIso(),
        contactType: body.contactType || "wechat",
        contact: String(body.contact || "").trim(),
        source: body.source || "web",
        budget: body.budget || null,
        invitedBy: body.invitedBy || null,
      };
      if (!lead.contact) return send(res, 400, { error: "contact_required" });
      // track invite code usage
      if (lead.invitedBy) {
        const ic = sqlite.getInviteCode(lead.invitedBy);
        if (ic && ic.status === "active" && (ic.maxUses === 0 || ic.usedCount < ic.maxUses)) {
          sqlite.useInviteCode(lead.invitedBy);
        }
      }
      sqlite.insertLead(lead);
      return send(res, 200, lead);
    }

    if (req.method === "POST" && pathname === "/api/assessments") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "invalid_json" });
      }
      const cfg = loadConfig();
      if (!cfg.model || !cfg.questionBank) return send(res, 500, { error: "config_missing" });

      const answers = body.answers || {};
      const leadId = body.leadId || null;

      const { report, llmTelemetry } = await generateAssessmentReport({ cfg, answers, leadId });

      const assessment = {
        id: id("asm"),
        createdAt: nowIso(),
        version: cfg.questionBank.meta?.version || "v2",
        leadId,
        answers,
        report,
        llmTelemetry,
      };
      sqlite.insertAssessment(assessment);

      sqlite.insertEvent({
        id: id("evt"),
        createdAt: nowIso(),
        name: report.llmGenerated ? "llm_called" : "llm_skipped",
        props: {
          assessmentId: assessment.id,
          model: llmTelemetry?.model,
          elapsedMs: llmTelemetry?.elapsedMs,
          inputTokens: llmTelemetry?.inputTokens,
          outputTokens: llmTelemetry?.outputTokens,
          cacheReadTokens: llmTelemetry?.cacheReadTokens,
          cacheCreationTokens: llmTelemetry?.cacheCreationTokens,
          error: report.llmError || null,
        },
      });

      return send(res, 200, { id: assessment.id, llmGenerated: report.llmGenerated, llmError: report.llmError });
    }

    if (req.method === "GET" && pathname.startsWith("/api/assessments/")) {
      const idPart = pathname.replace("/api/assessments/", "");
      const row = sqlite.getAssessment(idPart);
      if (!row) return send(res, 404, { error: "not_found" });
      return send(res, 200, row);
    }

    if (req.method === "POST" && pathname === "/api/events") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "invalid_json" });
      }
      const evt = {
        id: id("evt"),
        createdAt: nowIso(),
        name: String(body.name || "").slice(0, 64),
        props: body.props || {},
      };
      if (!evt.name) return send(res, 400, { error: "name_required" });
      sqlite.insertEvent(evt);
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/admin/stats") {
      if (!requireAdmin(req, res, url)) return;
      const leads = sqlite.listLeads();
      const assessments = sqlite.listAssessments();
      const countByName = sqlite.countEventsByName();
      const landing = countByName["landing_view"] || 0;
      const started = countByName["assessment_start"] || 0;
      const submitted = countByName["assessment_submit_click"] || 0;
      const completed = countByName["assessment_completed"] || 0;
      const reportViews = countByName["report_view"] || 0;
      const llmCalled = countByName["llm_called"] || 0;
      const llmSkipped = countByName["llm_skipped"] || 0;
      const safeRate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
      const tokens = sqlite.sumEventTokens();
      return send(res, 200, {
        totals: { leads: leads.length, assessments: assessments.length, events: Object.values(countByName).reduce((s, c) => s + c, 0) },
        events: countByName,
        funnel: {
          landing,
          started,
          submitted,
          completed,
          reportViews,
          startRate: safeRate(started, landing),
          submitRate: safeRate(submitted, started),
          completeRate: safeRate(completed, started),
        },
        llm: {
          available: kimi.isAvailable(),
          called: llmCalled,
          skipped: llmSkipped,
          tokens: { in: tokens.totalIn, out: tokens.totalOut, cacheRead: tokens.totalCacheRead, cacheCreate: tokens.totalCacheCreate },
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/admin/invite-codes") {
      if (!requireAdmin(req, res, url)) return;
      return send(res, 200, sqlite.listInviteCodes());
    }

    if (req.method === "POST" && pathname === "/api/admin/invite-codes") {
      if (!requireAdmin(req, res, url)) return;
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "invalid_json" }); }
      const code = String(body.code || "").trim().toUpperCase();
      if (!code) return send(res, 400, { error: "code_required" });
      const row = {
        code,
        ownerLeadId: null,
        maxUses: Number(body.maxUses) || 0,
        status: "active",
        label: body.label || null,
        createdAt: nowIso(),
      };
      sqlite.createInviteCode(row);
      return send(res, 200, { ok: true, code: row.code });
    }

    if (req.method === "GET" && pathname === "/api/admin/export") {
      if (!requireAdmin(req, res, url)) return;
      const bundle = sqlite.exportAll();
      return sendText(res, 200, JSON.stringify(bundle, null, 2), "application/json; charset=utf-8");
    }

    if (req.method === "POST" && pathname === "/api/admin/test-llm") {
      if (!requireAdmin(req, res, url)) return;
      if (!kimi.isAvailable()) return send(res, 200, { available: false, error: "no_api_key" });
      const cfg = loadConfig();
      // 用一个最小化的 dummy payload 调用一次
      const dummyAnswers = {
        rc_stage: "master_in",
        rc_apply_season: "27fall",
        rc_school_tier: "211",
        rc_major: "materials",
        rc_gpa: 85,
        rc_rank: "top20",
        rc_target_regions: ["SG", "HK"],
        rc_target_degree: "taught",
        rc_target_majors: ["materials", "microe"],
        rc_target_industries: ["semiconductor", "new_energy"],
        rc_target_roles: ["materials_rd", "pie_yield"],
      };
      const { report, llmTelemetry } = await generateAssessmentReport({ cfg, answers: dummyAnswers });
      return send(res, 200, { ok: true, telemetry: llmTelemetry, llmGenerated: report.llmGenerated, sampleTitle: report.title });
    }

    send(res, 404, { error: "not_found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "internal_error", detail: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`留学冶炼屋 server running at http://localhost:${PORT}`);
  console.log(`路径导师可用: ${kimi.isAvailable() ? "✅ 在线" : "❌ 离线 (在 data/secret.json 填入 moonshotApiKey)"}`);
});

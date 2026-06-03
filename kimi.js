/* eslint-disable no-console */
/**
 * Moonshot AI (Kimi) API 集成模块
 *
 * 职责：
 *   1. 加载 case 知识库 + 输出 schema 作为 system prompt
 *   2. 提供 generateReport({ payload, model, options }) 给 server 调用
 *   3. 使用 OpenAI 兼容格式调用 Kimi API
 *   4. 解析模型返回的 <output_json>...</output_json>，失败则返回 fallback
 *   5. 记录 token / cost 信息供埋点用
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname);
const DATA_DIR = path.join(ROOT, "data");
const SECRET_PATH = path.join(DATA_DIR, "secret.json");
const KNOWLEDGE_PATH = path.join(DATA_DIR, "caseKnowledge.md");

const DEFAULT_MODEL = process.env.KIMI_MODEL || "moonshot-v1-128k";
const API_URL = "https://api.moonshot.cn/v1/chat/completions";

let cachedKey = null;
let cachedKnowledge = null;

function loadApiKey() {
  if (cachedKey) return cachedKey;
  if (fs.existsSync(SECRET_PATH)) {
    try {
      const raw = fs.readFileSync(SECRET_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.moonshotApiKey && !parsed.moonshotApiKey.includes("填入")) {
        cachedKey = parsed.moonshotApiKey;
        return cachedKey;
      }
    } catch (e) {
      console.warn("[kimi] secret.json 解析失败:", e.message);
    }
  }
  if (process.env.MOONSHOT_API_KEY) {
    cachedKey = process.env.MOONSHOT_API_KEY;
    return cachedKey;
  }
  return null;
}

function loadKnowledge() {
  if (cachedKnowledge) return cachedKnowledge;
  try {
    cachedKnowledge = fs.readFileSync(KNOWLEDGE_PATH, "utf8");
  } catch {
    cachedKnowledge = "（知识库未加载）";
  }
  return cachedKnowledge;
}

function isAvailable() {
  return Boolean(loadApiKey());
}

function buildSystemPrompt({ industries, roles, companyTypes, companies, programs }) {
  const knowledge = loadKnowledge();
  // 缩减数据集体积，避免请求体过大导致网关拒绝或超时
  const limit = (arr, n) => arr.slice(0, n);
  const dataDump = JSON.stringify(
    {
      industries: industries.map((i) => ({
        id: i.id, name: i.name, rating: i.rating, tagline: i.tagline,
        salaryBand: i.salaryBand, bestFitMajors: i.bestFitMajors,
      })),
      roles: roles.map((r) => ({
        id: r.id, name: r.name, rating: r.rating, fitIndustries: r.fitIndustries,
        lifestyleTags: r.lifestyleTags, friendNote: r.friendNote,
      })),
      companyTypes: companyTypes.map((c) => ({
        id: c.id, name: c.name, stability: c.stability, salary: c.salary,
        wlb: c.wlb, hukou: c.hukou, salaryBand: c.salaryBand,
      })),
      companies: limit(companies, 20).map((c) => ({
        name: c.name, industry: c.industry, tag: c.tag, salary: c.salary, locations: c.locations,
      })),
      programs: limit(programs, 30).map((p) => ({
        id: p.id, country: p.country, school: p.school, name: p.name,
        track: p.track, tier: p.tier,
      })),
    },
    null,
    0
  );

  return [
    "你是一位路径导师，由资深留学顾问经验与真实案例数据蒸馏而成。你在留学冶炼屋（理工版）工作，专门帮助中国学生基于背景底牌规划留学+就业的清晰路径。",
    "你的输出语气必须温暖、专业、偶尔冷幽默。可用锻造/冶炼隐喻作装饰，但核心表达要直白：背景是底牌、能力是质量、执行是韧性、推荐是路径。结论先行、点名公司、给出薪资带、敢说红/黄/绿标签、用反向选法、不写空话。",
    "",
    "===== 顾问知识库（来源：9 份真实学生咨询案例） =====",
    knowledge,
    "",
    "===== 可引用的数据集（行业 / 岗位族 / 公司类型 / 代表公司 / 项目） =====",
    dataDump,
    "",
    "===== 输出契约（必须严格遵守） =====",
    "你的最终输出必须是单个 JSON 对象，包裹在 <output_json>...</output_json> 标签内，不要在 JSON 外再写任何说明文字。",
    "",
    "**用词约束**：所有面向学生的字符串（title/summary/why/text/comment）必须使用纯中文，禁止出现 industries/roles/companyTypes 的英文 id（如 foreign / private_internet / pie_yield 等）。引用行业/岗位/公司类型时直接写它的中文名（如「半导体」「良率/整合工程师 PIE」「外企」）。",
    "",
    "JSON 结构 schema：",
    "{",
    '  "title": "string - 像「CS底牌转算法路径 · 硅谷方向已清晰」这种 8-16 字短标题，可用路径/底牌隐喻",',
    '  "summary": "string - 2-3 句路径导师式总结，结论先行，可用路径/底牌比喻",',
    '  "offerProbability": "int 0-99 - 综合评估的录取/就业概率",',
    '  "matches": [',
    '    {',
    '      "industryId": "industries.id 字段",',
    '      "roleId": "roles.id 字段",',
    '      "companyTypeId": "companyTypes.id 字段",',
    '      "fitScore": "int 0-100",',
    '      "rating": "🟢|🟡|🔴",',
    '      "why": "100-200 字解释，要点名学生的底牌优劣/短板，可用路径比喻",',
    '      "companies": [',
    '        {"name": "公司名", "tag": "标签如黄埔军校/天花板", "salary": "薪资带", "location": "城市"}',
    '      ],',
    '      "salaryBand": "税前年薪 W 字符串"',
    '    }',
    "  ],",
    '  "truths": [',
    '    {"text": "一句 30-60 字的路径导师式真话，像补强建议", "why": "20-40 字这条对该底牌为什么必须马上做"}',
    "  ],",
    '  "timeline": [',
    '    {"phase": "时间段如 2026/05-2026/08", "tasks": ["具体任务1", "具体任务2"], "milestone": "里程碑"}',
    "  ],",
    '  "programs": [',
    '    {"id": "programs.id", "school": "学校", "name": "项目名", "country": "UK|HK|SG|US|AU|EU", "risk": "冲刺|匹配|保底", "readiness": "float 0-1", "fitTag": "推荐理由 30-60 字，像「这个项目适合你底牌的理由」"}',
    "  ],",
    '  "scenarioCommentary": [',
    '    {"scenarioId": "scenarios.id", "userChoice": "你选的 option id", "comment": "路径导师点评 60-100 字，敢于纠正，可用「这步力度过了/不够」等比喻"}',
    "  ]",
    "}",
    "",
    "matches 必须返回正好 3 条，按 fitScore 降序。",
    "truths 必须返回 3 条，每条都要 actionable（可以马上做的）。",
    "timeline 至少 3 段，最后一段是入学/到岗里程碑。",
    "programs 返回 5-9 条，覆盖冲刺/匹配/保底三档。",
    "scenarioCommentary 只对学生真实回答过的 scenario 做点评。",
  ].join("\n");
}

function buildUserMessage({ profile, answers, scores, scenarioAnswers, weakDim, strongDim }) {
  return [
    "请基于以下学生的底牌画像，生成完整路径图谱。",
    "",
    "===== 学生底牌卡 =====",
    JSON.stringify(profile, null, 2),
    "",
    "===== 四步诊断数据（已映射为 6 维属性分） =====",
    "本地诊断得分（0-100）：" + JSON.stringify(scores),
    "最强项：" + (strongDim || "未识别"),
    "最短板：" + (weakDim || "未识别"),
    "",
    "===== 诊断原始记录 =====",
    JSON.stringify(answers, null, 2),
    "",
    "===== 情境选择记录 =====",
    JSON.stringify(scenarioAnswers, null, 2),
    "",
    "===== 诊断任务 =====",
    "1) 给学生一句话底牌画像 + 综合录取/就业概率",
    "2) Top3「行业 × 岗位族 × 公司类型」路径组合，每条挂 2-3 个代表公司（从数据集里挑），并解释和该底牌优势/短板的关系",
    "3) 路径导师真话 Top3——必须 actionable（如「GPA 换百分制并标排名」而非「完善简历」），可用补强/打磨比喻",
    "4) 申请季-求职时间线（按 profile 里的 apply_season + stage 倒推）",
    "5) 5-9 个推荐项目，覆盖冲刺/匹配/保底，每项附一句推荐理由",
    "6) 对学生回答过的情境题做导师点评（敢纠错敢推荐，可用力度比喻）",
    "",
    "严格按 system prompt 中的 JSON schema 输出，包裹在 <output_json>...</output_json> 标签内。",
  ].join("\n");
}

async function generateReport({ profile, answers, scores, scenarioAnswers, weakDim, strongDim, dataset, options = {} }) {
  if (!isAvailable()) {
    return {
      error: "no_api_key",
      fallback: null,
    };
  }

  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || 4096;
  const timeoutMs = options.timeoutMs || 120000;

  const systemPrompt = buildSystemPrompt(dataset);
  const userMessage = buildUserMessage({ profile, answers, scores, scenarioAnswers, weakDim, strongDim });

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.7,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp;
  let respText;
  let json;
  const t0 = Date.now();
  try {
    resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + loadApiKey(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    respText = await resp.text();
    try {
      json = JSON.parse(respText);
    } catch {
      json = null;
    }
  } catch (e) {
    clearTimeout(timer);
    console.error("[kimi] fetch error:", e.message);
    return { error: "network_error: " + e.message, fallback: null };
  }
  clearTimeout(timer);
  const elapsedMs = Date.now() - t0;

  if (!resp.ok || !json) {
    console.error("[kimi] API error", resp.status, respText?.slice(0, 500));
    return { error: `api_error_${resp.status}`, fallback: null };
  }

  const fullText = json.choices?.[0]?.message?.content || "";

  const match = fullText.match(/<output_json>([\s\S]*?)<\/output_json>/);
  let parsed = null;
  if (match) {
    try {
      parsed = JSON.parse(match[1].trim());
    } catch (e) {
      console.error("[kimi] JSON parse failed:", e.message, "raw:", match[1].slice(0, 300));
    }
  }

  if (!parsed) {
    try {
      parsed = JSON.parse(fullText.trim());
    } catch {
      const firstBrace = fullText.indexOf("{");
      const lastBrace = fullText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsed = JSON.parse(fullText.slice(firstBrace, lastBrace + 1));
        } catch {
          parsed = null;
        }
      }
    }
  }

  const usage = json.usage || {};
  const telemetry = {
    model,
    elapsedMs,
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    stopReason: json.choices?.[0]?.finish_reason || "",
  };

  if (!parsed) {
    return { error: "parse_failed", fallback: null, telemetry, rawText: fullText.slice(0, 2000) };
  }

  return { report: parsed, telemetry };
}

module.exports = {
  generateReport,
  isAvailable,
  buildSystemPrompt,
  buildUserMessage,
};

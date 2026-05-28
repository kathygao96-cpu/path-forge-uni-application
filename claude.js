/* eslint-disable no-console */
/**
 * Anthropic Claude API 集成模块（零依赖，Node 18+ 内置 fetch）
 *
 * 职责：
 *   1. 加载 case 知识库 + 输出 schema 作为 system prompt（带 prompt cache）
 *   2. 提供 generateReport({ payload, model, options }) 给 server 调用
 *   3. 自动启用 web_search 工具（除非 options.webSearch = false）
 *   4. 解析模型返回的 <output_json>...</output_json>，失败则返回 fallback
 *   5. 记录 token / cost 信息供埋点用
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname);
const DATA_DIR = path.join(ROOT, "data");
const SECRET_PATH = path.join(DATA_DIR, "secret.json");
const KNOWLEDGE_PATH = path.join(DATA_DIR, "caseKnowledge.md");

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

let cachedKey = null;
let cachedKnowledge = null;

function loadApiKey() {
  if (cachedKey) return cachedKey;
  // 1) data/secret.json
  if (fs.existsSync(SECRET_PATH)) {
    try {
      const raw = fs.readFileSync(SECRET_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.anthropicApiKey && !parsed.anthropicApiKey.includes("填入")) {
        cachedKey = parsed.anthropicApiKey;
        return cachedKey;
      }
    } catch (e) {
      console.warn("[claude] secret.json 解析失败:", e.message);
    }
  }
  // 2) env var
  if (process.env.ANTHROPIC_API_KEY) {
    cachedKey = process.env.ANTHROPIC_API_KEY;
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

/**
 * 当前调用是否可用（API key 是否就绪）
 */
function isAvailable() {
  return Boolean(loadApiKey());
}

/**
 * 构造 system prompt
 * - 框架描述 + 案例知识 + 输出 schema
 * - 整段走 prompt cache（5min ephemeral cache，跨请求复用）
 */
function buildSystemPrompt({ industries, roles, companyTypes, companies, programs }) {
  const knowledge = loadKnowledge();
  const dataDump = JSON.stringify(
    {
      industries: industries.map((i) => ({
        id: i.id,
        name: i.name,
        rating: i.rating,
        tagline: i.tagline,
        salaryBand: i.salaryBand,
        environment: i.environment,
        bestFitMajors: i.bestFitMajors,
        warnings: i.warnings,
      })),
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        rating: r.rating,
        fitIndustries: r.fitIndustries,
        fitMajors: r.fitMajors,
        lifestyleTags: r.lifestyleTags,
        salaryBand: r.salaryBand,
        friendNote: r.friendNote,
      })),
      companyTypes: companyTypes.map((c) => ({
        id: c.id,
        name: c.name,
        stability: c.stability,
        salary: c.salary,
        wlb: c.wlb,
        hukou: c.hukou,
        salaryBand: c.salaryBand,
      })),
      companies: companies.map((c) => ({
        name: c.name,
        industry: c.industry,
        companyType: c.companyType,
        rating: c.rating,
        tag: c.tag,
        salary: c.salary,
        locations: c.locations,
      })),
      programs: programs.map((p) => ({
        id: p.id,
        country: p.country,
        school: p.school,
        name: p.name,
        track: p.track,
        fitIndustries: p.fitIndustries,
        fitRoles: p.fitRoles,
        tier: p.tier,
      })),
    },
    null,
    0
  );

  return [
    "你是一位冶炼导师，由资深留学顾问经验与真实案例数据蒸馏而成。你在留学冶炼屋（理工版）工作，专门帮助中国学生将他们的背景原矿锻造成留学+就业的锋利兵器。",
    "你的输出语气必须温暖、专业、偶尔冷幽默。善用锻造/冶炼/兵器隐喻：背景是原矿、能力是纯度、执行是韧度、推荐是兵器谱。结论先行、点名公司、给出薪资带、敢说红/黄/绿标签、用反向选法、不写空话。",
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
    '  "title": "string - 像「暗影矿石锻算法兵器 · 硅谷路径已开刃」这种 8-16 字短标题，善用矿石/锻造/兵器隐喻",',
    '  "summary": "string - 2-3 句冶炼导师式总结，结论先行，可用锻造比喻",',
    '  "offerProbability": "int 0-99 - 综合评估的录取/就业概率",',
    '  "matches": [',
    '    {',
    '      "industryId": "industries.id 字段",',
    '      "roleId": "roles.id 字段",',
    '      "companyTypeId": "companyTypes.id 字段",',
    '      "fitScore": "int 0-100",',
    '      "rating": "🟢|🟡|🔴",',
    '      "why": "100-200 字解释，要点名学生的原矿纯度/杂质，善用锻造比喻",',
    '      "companies": [',
    '        {"name": "公司名", "tag": "标签如黄埔军校/天花板", "salary": "薪资带", "location": "城市"}',
    '      ],',
    '      "salaryBand": "税前年薪 W 字符串"',
    '    }',
    "  ],",
    '  "truths": [',
    '    {"text": "一句 30-60 字的冶炼导师式真话，像回炉建议", "why": "20-40 字这条对该原矿为什么必须马上炼"}',
    '  ],',
    '  "timeline": [',
    '    {"phase": "时间段如 2026/05-2026/08", "tasks": ["具体任务1", "具体任务2"], "milestone": "里程碑"}',
    '  ],',
    '  "programs": [',
    '    {"id": "programs.id", "school": "学校", "name": "项目名", "country": "UK|HK|SG|US|AU|EU", "risk": "冲刺|匹配|保底", "readiness": "float 0-1", "fitTag": "锻造理由 30-60 字，像「这块矿石适合在这里淬火的理由」"}',
    '  ],',
    '  "scenarioCommentary": [',
    '    {"scenarioId": "scenarios.id", "userChoice": "学徒选的 option id", "comment": "冶炼导师点评 60-100 字，敢于纠正，可用「这步火候过了/不够」等比喻"}',
    '  ]',
    "}",
    "",
    "matches 必须返回正好 3 条，按 fitScore 降序。",
    "truths 必须返回 3 条，每条都要 actionable（可以马上做的）。",
    "timeline 至少 3 段，最后一段是入学/到岗里程碑。",
    "programs 返回 5-9 条，覆盖冲刺/匹配/保底三档。",
    "scenarioCommentary 只对学生真实回答过的 scenario 做点评。",
    "",
    "如果有需要可以使用 web_search 工具查最新校招公告/薪资数据/项目截止日期，但不要为了搜而搜——优先用知识库。",
  ].join("\n");
}

function buildUserMessage({ profile, answers, scores, scenarioAnswers, weakDim, strongDim }) {
  return [
    "请基于以下学徒的原矿画像，铸造完整兵器图谱。",
    "",
    "===== 学徒原矿卡 =====",
    JSON.stringify(profile, null, 2),
    "",
    "===== 四道锻造工序数据（已映射为原矿属性分） =====",
    "本地冶炼得分（0-100）：" + JSON.stringify(scores),
    "纯度最高：" + (strongDim || "未识别"),
    "杂质最重：" + (weakDim || "未识别"),
    "",
    "===== 锻造原始记录 =====",
    JSON.stringify(answers, null, 2),
    "",
    "===== 情境锻造选择 =====",
    JSON.stringify(scenarioAnswers, null, 2),
    "",
    "===== 冶炼任务 =====",
    "1) 给学徒一句话原矿画像 + 综合录取/就业概率",
    "2) Top3「行业 × 岗位族 × 公司类型」兵器组合，每条挂 2-3 个代表公司（从数据集里挑），并解释和该原矿纯度/杂质的关系",
    "3) 冶炼导师真话 Top3——必须 actionable（如「GPA 换百分制并标排名」而非「完善简历」），可用回炉/淬火/锻打比喻",
    "4) 申请季-求职锻造时间线（按 profile 里的 apply_season + stage 倒推）",
    "5) 5-9 个推荐冶炼炉（项目），覆盖冲刺/匹配/保底，每项附一句锻造理由",
    "6) 对学徒回答过的情境锻造题做导师点评（敢纠错敢推荐，可用火候比喻）",
    "",
    "严格按 system prompt 中的 JSON schema 输出，包裹在 <output_json>...</output_json> 标签内。",
  ].join("\n");
}

/**
 * 主入口：生成报告
 * @returns {Promise<{report: object, telemetry: object} | {error: string, fallback: object}>}
 */
async function generateReport({ profile, answers, scores, scenarioAnswers, weakDim, strongDim, dataset, options = {} }) {
  if (!isAvailable()) {
    return {
      error: "no_api_key",
      fallback: null,
    };
  }

  const model = options.model || DEFAULT_MODEL;
  const enableSearch = options.webSearch !== false;
  const maxTokens = options.maxTokens || 4096;
  const timeoutMs = options.timeoutMs || 60000;

  const systemPrompt = buildSystemPrompt(dataset);
  const userMessage = buildUserMessage({ profile, answers, scores, scenarioAnswers, weakDim, strongDim });

  const body = {
    model,
    max_tokens: maxTokens,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  };

  if (enableSearch) {
    body.tools = [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
      },
    ];
  }

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
        "x-api-key": loadApiKey(),
        "anthropic-version": ANTHROPIC_VERSION,
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
    console.error("[claude] fetch error:", e.message);
    return { error: "network_error: " + e.message, fallback: null };
  }
  clearTimeout(timer);
  const elapsedMs = Date.now() - t0;

  if (!resp.ok || !json) {
    console.error("[claude] API error", resp.status, respText?.slice(0, 500));
    return { error: `api_error_${resp.status}`, fallback: null };
  }

  // content is an array of blocks; concatenate text blocks
  const textBlocks = (json.content || []).filter((b) => b.type === "text");
  const fullText = textBlocks.map((b) => b.text).join("\n");

  const match = fullText.match(/<output_json>([\s\S]*?)<\/output_json>/);
  let parsed = null;
  if (match) {
    try {
      parsed = JSON.parse(match[1].trim());
    } catch (e) {
      console.error("[claude] JSON parse failed:", e.message, "raw:", match[1].slice(0, 300));
    }
  }

  if (!parsed) {
    // 尝试直接当成 JSON
    try {
      parsed = JSON.parse(fullText.trim());
    } catch {
      // 兜底：从文本里抽
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
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    serverToolUse: usage.server_tool_use || null,
    stopReason: json.stop_reason || "",
    webSearchEnabled: enableSearch,
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

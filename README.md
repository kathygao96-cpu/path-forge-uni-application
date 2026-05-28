## WayTo 能力图鉴 v2 · 留学+就业大厂模拟器

**零依赖** 本地可运行原型（Node 18+ 内置 fetch，不需要 npm/pnpm）：

- 闯关式诊断：序章·角色卡（4 屏事实型表单）+ 6 关闯关（含 15 道真实情境题）+ 终章·录取办（联系方式+预算）
- **顾问视角的 6 维模型**：学术硬度 / 跨度 / 经历含金量 / 路径清晰度 / 执行准备度 / 个人匹配性
- **AI 顾问报告**：调用 Claude（默认 Haiku 4.5），带 prompt caching + web_search 工具，基于 9 份真实咨询案例知识库生成
- 推荐结构：Top3 行业-岗位组合 / 代表公司清单（带红黄绿标） / 申请-求职时间线 / 朋友式真话 Top3 / 推荐项目（覆盖 UK/HK/SG/US/AU/EU）
- 后台 JSON 编辑器 + 数据看板 + LLM 用量统计

### 运行

```bash
node server.js
```

打开 `http://localhost:8787`。

### 接入 Claude API（可选，但强烈推荐）

复制示例文件并填入真实 key：

```bash
cp data/secret.example.json data/secret.json
# 编辑 data/secret.json，把 anthropicApiKey 填入
```

或者用环境变量：

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
node server.js
```

切换模型（可选）：

```bash
export CLAUDE_MODEL=claude-sonnet-4-6   # 默认 claude-haiku-4-5-20251001
```

未配置 key 时，系统自动降级用本地规则评分 + 模板生成（仍可用，但缺少 AI 顾问的个性化分析）。

### 数据层

| 文件 | 用途 |
|---|---|
| `data/model.json` | 6 维模型定义 + maxPoints |
| `data/questionBank.v1.json` | 角色卡 4 屏 + 6 关 + 13 道关卡题 + 终章 |
| `data/scenarios.json` | 15 道真实情境题（来自咨询案例） |
| `data/industries.json` | 10 个行业（含评级、薪资带、匹配向量、warnings） |
| `data/roles.json` | 21 个岗位族（含红黑榜、朋友点评） |
| `data/companyTypes.json` | 国央企 / 互联网 / 民营制造 / 外企 / 院所 / startup |
| `data/companies.json` | 47 个代表公司（含薪资、城市、tag） |
| `data/programs.v1.json` | 24 个推荐项目（UK/HK/SG/US/AU/EU） |
| `data/lifestylePrefs.json` | 倒班/驻厂/出差/性格/优先级枚举 |
| `data/rules.v1.json` | 跨度对照表 + 朋友式真话清单 |
| `data/caseKnowledge.md` | LLM system prompt 用的案例知识库 |

### 环境变量

- `PORT`：服务端口（默认 8787）
- `ADMIN_PASSWORD`：后台密码（默认 `admin`）
- `ANTHROPIC_API_KEY`：Claude API key（也可通过 `data/secret.json` 配置）
- `CLAUDE_MODEL`：模型 ID（默认 `claude-haiku-4-5-20251001`）

### 后台

- `/admin.html`：JSON 编辑器（支持新增的 industries/roles/companyTypes 等），含「测试 LLM」按钮
- `/analytics.html`：漏斗 + LLM 用量统计（cache_read 命中率）



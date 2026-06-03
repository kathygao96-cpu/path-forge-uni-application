const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "storage", "data.db");
const JSON_DIR = path.join(__dirname, "storage");

let db = null;

function init() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      contactType TEXT NOT NULL,
      contact TEXT NOT NULL,
      source TEXT,
      budget TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(createdAt DESC);

    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      leadId TEXT,
      version TEXT,
      answers TEXT,
      report TEXT,
      llmTelemetry TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assessments_created ON assessments(createdAt DESC);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      props TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(createdAt DESC);

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      ownerLeadId TEXT,
      maxUses INTEGER NOT NULL DEFAULT 0,
      usedCount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      label TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invite_owner ON invite_codes(ownerLeadId);
  `);
  // 迁移：leads 表加 invitedBy 字段
  try { db.exec("ALTER TABLE leads ADD COLUMN invitedBy TEXT"); } catch {}
  return db;
}

function migrateFromJson() {
  const db = init();
  const count = db.prepare("SELECT COUNT(*) as c FROM leads").get();
  if (count.c > 0) return; // 已有数据，跳过迁移

  const readJson = (filePath, fallback) => {
    try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
    catch { return fallback; }
  };

  const leads = readJson(path.join(JSON_DIR, "leads.json"), []);
  const assessments = readJson(path.join(JSON_DIR, "assessments.json"), []);
  const events = readJson(path.join(JSON_DIR, "events.json"), []);

  const insertLead = db.prepare(`
    INSERT OR IGNORE INTO leads (id, contactType, contact, source, budget, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertAsm = db.prepare(`
    INSERT OR IGNORE INTO assessments (id, leadId, version, answers, report, llmTelemetry, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO events (id, name, props, createdAt)
    VALUES (?, ?, ?, ?)
  `);

  for (const row of leads) {
    insertLead.run(row.id, row.contactType || "wechat", row.contact, row.source || "web", row.budget || null, row.createdAt);
  }
  for (const row of assessments) {
    insertAsm.run(row.id, row.leadId || null, row.version || null, JSON.stringify(row.answers || {}), JSON.stringify(row.report || {}), JSON.stringify(row.llmTelemetry || null), row.createdAt);
  }
  for (const row of events) {
    insertEvent.run(row.id, row.name, JSON.stringify(row.props || {}), row.createdAt);
  }

  console.log(`[sqlite] Migrated: ${leads.length} leads, ${assessments.length} assessments, ${events.length} events`);
}

/* ===== leads ===== */
function listLeads(limit = 10000) {
  const rows = init().prepare("SELECT * FROM leads ORDER BY createdAt DESC LIMIT ?").all(limit);
  return rows;
}

function insertLead(row) {
  init().prepare("INSERT INTO leads (id, contactType, contact, source, budget, invitedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(row.id, row.contactType, row.contact, row.source, row.budget, row.invitedBy || null, row.createdAt);
}

/* ===== assessments ===== */
function listAssessments(limit = 10000) {
  const rows = init().prepare("SELECT * FROM assessments ORDER BY createdAt DESC LIMIT ?").all(limit);
  return rows.map((r) => ({
    ...r,
    answers: safeJsonParse(r.answers),
    report: safeJsonParse(r.report),
    llmTelemetry: safeJsonParse(r.llmTelemetry),
  }));
}

function getAssessment(id) {
  const r = init().prepare("SELECT * FROM assessments WHERE id = ?").get(id);
  if (!r) return null;
  return {
    ...r,
    answers: safeJsonParse(r.answers),
    report: safeJsonParse(r.report),
    llmTelemetry: safeJsonParse(r.llmTelemetry),
  };
}

function insertAssessment(row) {
  init().prepare("INSERT INTO assessments (id, leadId, version, answers, report, llmTelemetry, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    row.id, row.leadId || null, row.version || null, JSON.stringify(row.answers || {}), JSON.stringify(row.report || {}), JSON.stringify(row.llmTelemetry || null), row.createdAt
  );
}

/* ===== events ===== */
function listEvents(limit = 10000) {
  const rows = init().prepare("SELECT * FROM events ORDER BY createdAt DESC LIMIT ?").all(limit);
  return rows.map((r) => ({ ...r, props: safeJsonParse(r.props) }));
}

function insertEvent(row) {
  init().prepare("INSERT INTO events (id, name, props, createdAt) VALUES (?, ?, ?, ?)").run(row.id, row.name, JSON.stringify(row.props || {}), row.createdAt);
}

function countEventsByName() {
  const rows = init().prepare("SELECT name, COUNT(*) as c FROM events GROUP BY name").all();
  const out = {};
  for (const r of rows) out[r.name] = r.c;
  return out;
}

/* ===== invite codes ===== */
function getInviteCode(code) {
  return init().prepare("SELECT * FROM invite_codes WHERE code = ?").get(code);
}

function useInviteCode(code) {
  init().prepare("UPDATE invite_codes SET usedCount = usedCount + 1 WHERE code = ?").run(code);
}

function createInviteCode(row) {
  init().prepare("INSERT INTO invite_codes (code, ownerLeadId, maxUses, status, label, createdAt) VALUES (?, ?, ?, ?, ?, ?)").run(row.code, row.ownerLeadId || null, row.maxUses, row.status || 'active', row.label || null, row.createdAt);
}

function listInviteCodes() {
  return init().prepare("SELECT * FROM invite_codes ORDER BY createdAt DESC").all();
}

function getInviteCodeByOwner(leadId) {
  return init().prepare("SELECT * FROM invite_codes WHERE ownerLeadId = ? AND status = 'active' LIMIT 1").get(leadId);
}

function sumEventTokens() {
  const rows = init().prepare(`
    SELECT
      COALESCE(SUM(CAST(json_extract(props, '$.inputTokens') AS INTEGER)), 0) as totalIn,
      COALESCE(SUM(CAST(json_extract(props, '$.outputTokens') AS INTEGER)), 0) as totalOut,
      COALESCE(SUM(CAST(json_extract(props, '$.cacheReadTokens') AS INTEGER)), 0) as totalCacheRead,
      COALESCE(SUM(CAST(json_extract(props, '$.cacheCreationTokens') AS INTEGER)), 0) as totalCacheCreate
    FROM events WHERE name = 'llm_called'
  `).all();
  return rows[0] || { totalIn: 0, totalOut: 0, totalCacheRead: 0, totalCacheCreate: 0 };
}

/* ===== export ===== */
function exportAll() {
  return {
    leads: listLeads(),
    assessments: listAssessments(),
    events: listEvents(),
  };
}

function safeJsonParse(v) {
  try { return JSON.parse(v); } catch { return null; }
}

module.exports = {
  init,
  migrateFromJson,
  listLeads,
  insertLead,
  listAssessments,
  getAssessment,
  insertAssessment,
  listEvents,
  insertEvent,
  countEventsByName,
  sumEventTokens,
  getInviteCode,
  useInviteCode,
  createInviteCode,
  listInviteCodes,
  getInviteCodeByOwner,
  exportAll,
};

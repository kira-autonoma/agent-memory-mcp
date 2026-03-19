/**
 * Agent Memory Store with Provenance & Trust
 *
 * Core storage layer using SQLite. Every memory has:
 * - Provenance: where it came from, how it was extracted, confidence level
 * - Trust scoring: source reliability weighting
 * - Decay: time-based confidence reduction with access reinforcement
 * - Feedback: track if recalled memories were actually useful
 */
import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
const logger = {
    info: (msg) => process.env.MEMORY_DEBUG && console.error(`[memory] ${msg}`),
    debug: (msg) => process.env.MEMORY_DEBUG === "verbose" && console.error(`[memory:debug] ${msg}`),
};
// --- Database ---
const DB_PATH = process.env.MEMORY_DB_PATH ||
    path.join(process.env.HOME || process.cwd(), ".agent-memory", "memory.db");
let db = null;
function getDb() {
    if (db)
        return db;
    // Ensure directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // Create tables
    db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT DEFAULT '[]',

      -- Provenance
      source_type TEXT NOT NULL,
      source_id TEXT,
      extraction_method TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      source_trust REAL NOT NULL DEFAULT 0.5,

      -- Lifecycle
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TEXT,

      -- Feedback
      useful_count INTEGER NOT NULL DEFAULT 0,
      not_useful_count INTEGER NOT NULL DEFAULT 0,

      -- Status
      superseded_by TEXT,
      active INTEGER NOT NULL DEFAULT 1,

      FOREIGN KEY (superseded_by) REFERENCES memories(id)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(active);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

    -- Feedback log (for the flywheel)
    CREATE TABLE IF NOT EXISTS feedback_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      useful INTEGER NOT NULL,
      context TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    );
  `);
    logger.info(`Memory store initialized at ${DB_PATH}`);
    return db;
}
// --- Core Operations ---
function generateId() {
    return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * Store a memory with provenance.
 */
export function store(input) {
    const db = getDb();
    const id = generateId();
    const now = new Date().toISOString();
    const tags = JSON.stringify(input.tags || []);
    db.prepare(`
    INSERT INTO memories (id, content, category, tags, source_type, source_id, extraction_method, confidence, source_trust, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.content, input.category, tags, input.provenance.source_type, input.provenance.source_id || null, input.provenance.extraction_method, input.provenance.confidence, input.provenance.source_trust, now, now);
    logger.debug(`Stored memory ${id}: ${input.content.slice(0, 60)}...`);
    return {
        id,
        content: input.content,
        category: input.category,
        tags: input.tags || [],
        provenance: input.provenance,
        created_at: now,
        updated_at: now,
        access_count: 0,
        last_accessed: null,
        useful_count: 0,
        not_useful_count: 0,
        superseded_by: null,
        active: true,
    };
}
/**
 * Recall memories with decay/trust-weighted scoring.
 *
 * Score = base_confidence * trust_weight * decay_factor * usefulness_factor
 *
 * - decay_factor: exponential decay based on age (half-life = 30 days)
 * - trust_weight: source_trust directly
 * - usefulness_factor: boosted by positive feedback, penalized by negative
 */
export function recall(query, options = {}) {
    const db = getDb();
    const { category, tags, min_confidence = 0, min_trust = 0, limit = 20, include_inactive = false, } = options;
    // Build query
    const conditions = [];
    const params = [];
    if (!include_inactive) {
        conditions.push("active = 1");
    }
    if (category) {
        conditions.push("category = ?");
        params.push(category);
    }
    if (min_confidence > 0) {
        conditions.push("confidence >= ?");
        params.push(min_confidence);
    }
    if (min_trust > 0) {
        conditions.push("source_trust >= ?");
        params.push(min_trust);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
        .prepare(`
    SELECT * FROM memories ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `)
        .all(...params, limit * 3); // fetch extra for scoring/filtering
    const now = Date.now();
    const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    let results = rows.map((row) => {
        const ageMs = now - new Date(row.created_at).getTime();
        const decayFactor = Math.pow(0.5, ageMs / HALF_LIFE_MS);
        const totalFeedback = row.useful_count + row.not_useful_count;
        const usefulnessFactor = totalFeedback > 0
            ? 0.5 + 0.5 * (row.useful_count / totalFeedback) // 0.5 to 1.0
            : 0.75; // neutral default
        // Access reinforcement: recently accessed memories get a small boost
        const accessBoost = row.last_accessed
            ? Math.pow(0.5, (now - new Date(row.last_accessed).getTime()) / HALF_LIFE_MS) * 0.1
            : 0;
        const relevance_score = row.confidence *
            row.source_trust *
            decayFactor *
            usefulnessFactor +
            accessBoost;
        return {
            id: row.id,
            content: row.content,
            category: row.category,
            tags: JSON.parse(row.tags || "[]"),
            provenance: {
                source_type: row.source_type,
                source_id: row.source_id,
                extraction_method: row.extraction_method,
                confidence: row.confidence,
                source_trust: row.source_trust,
            },
            created_at: row.created_at,
            updated_at: row.updated_at,
            access_count: row.access_count,
            last_accessed: row.last_accessed,
            useful_count: row.useful_count,
            not_useful_count: row.not_useful_count,
            superseded_by: row.superseded_by,
            active: !!row.active,
            relevance_score,
        };
    });
    // Filter by tags if specified (post-query for simplicity)
    if (tags && tags.length > 0) {
        results = results.filter((r) => tags.some((t) => r.tags.includes(t)));
    }
    // Filter by keyword match in content (simple substring for now)
    if (query.trim()) {
        const queryLower = query.toLowerCase();
        const keywords = queryLower.split(/\s+/).filter((k) => k.length > 2);
        results = results.filter((r) => {
            const contentLower = r.content.toLowerCase();
            return keywords.some((k) => contentLower.includes(k));
        });
    }
    // Sort by relevance score (highest first)
    results.sort((a, b) => b.relevance_score - a.relevance_score);
    // Update access counts for returned results
    const updateStmt = db.prepare(`
    UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?
  `);
    const nowIso = new Date().toISOString();
    const limited = results.slice(0, limit);
    for (const r of limited) {
        updateStmt.run(nowIso, r.id);
    }
    return limited;
}
/**
 * Record feedback on a recalled memory. This is the flywheel.
 */
export function feedback(memoryId, useful, context) {
    const db = getDb();
    const col = useful ? "useful_count" : "not_useful_count";
    db.prepare(`UPDATE memories SET ${col} = ${col} + 1 WHERE id = ?`).run(memoryId);
    db.prepare(`INSERT INTO feedback_log (memory_id, useful, context) VALUES (?, ?, ?)`).run(memoryId, useful ? 1 : 0, context || null);
    logger.debug(`Feedback for ${memoryId}: ${useful ? "useful" : "not useful"}`);
}
/**
 * Supersede a memory with a new one (for corrections/updates).
 */
export function supersede(oldId, newInput) {
    const db = getDb();
    const newMemory = store(newInput);
    db.prepare(`UPDATE memories SET superseded_by = ?, active = 0 WHERE id = ?`).run(newMemory.id, oldId);
    logger.debug(`Memory ${oldId} superseded by ${newMemory.id}`);
    return newMemory;
}
/**
 * Get stats about the memory store.
 */
export function stats() {
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) as n FROM memories").get().n;
    const active = db.prepare("SELECT COUNT(*) as n FROM memories WHERE active = 1").get().n;
    const avgConf = db
        .prepare("SELECT AVG(confidence) as avg FROM memories WHERE active = 1")
        .get().avg;
    const feedbackCount = db.prepare("SELECT COUNT(*) as n FROM feedback_log").get().n;
    const categories = db
        .prepare("SELECT category, COUNT(*) as n FROM memories WHERE active = 1 GROUP BY category")
        .all();
    const by_category = {};
    for (const c of categories) {
        by_category[c.category] = c.n;
    }
    return {
        total,
        active,
        by_category,
        avg_confidence: avgConf || 0,
        feedback_count: feedbackCount,
    };
}
/**
 * Close the database connection.
 */
export function close() {
    if (db) {
        db.close();
        db = null;
    }
}
//# sourceMappingURL=store.js.map
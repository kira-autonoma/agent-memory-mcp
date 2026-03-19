# agent-memory-mcp

**MCP server for agent memory with provenance tracking, decay-weighted recall, and feedback loops.**

Most agent memory systems treat memories as free-floating facts. This one tracks *where each memory came from*, *how confident you should be in it*, and *whether it was actually useful* — so your agent stops rediscovering the same things and starts getting smarter over time.

## Why this exists

Agents waste tokens. A lot of them. Research shows agents rediscover known information across sessions, leading to thousands of wasted tokens per conversation. Flat files are auditable but unsearchable. Vector DBs have great recall but no staleness signals. Structured state is brittle.

This is a memory layer that fixes the actual problems:

1. **Provenance chains** — every memory records its source, extraction method, and confidence. You know *why* you believe something, not just *what* you believe.
2. **Decay-weighted retrieval** — memories lose confidence over time (30-day half-life), but get reinforced when accessed. Recently-used memories bubble up naturally.
3. **Feedback flywheel** — mark recalled memories as useful or not. Over time, the memories that actually help you rise to the top. The ones that don't, fade.

## Install

```bash
npm install agent-memory-mcp
```

Or run directly with npx:

```bash
npx agent-memory-mcp
```

## MCP Configuration

Add to your Claude Desktop / MCP client config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "agent-memory-mcp"],
      "env": {
        "MEMORY_DB_PATH": "/path/to/your/memory.db"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MEMORY_DB_PATH` | `~/.agent-memory/memory.db` | Path to SQLite database |
| `MEMORY_DEBUG` | (unset) | Set to `"1"` for info logs, `"verbose"` for debug |

## Tools

### `memory_store`
Store a memory with provenance metadata.

```json
{
  "content": "npm install without --include=dev drops devDependencies on this VPS",
  "category": "lesson",
  "tags": ["npm", "build"],
  "confidence": 0.95,
  "source_type": "observation"
}
```

Categories: `lesson`, `strategy`, `operational`, `identity`, `preference`, `fact`

### `memory_recall`
Retrieve memories by keyword query and/or category, ranked by decay-weighted relevance.

```json
{
  "query": "npm build errors",
  "category": "lesson",
  "limit": 5
}
```

Returns memories sorted by: `confidence × source_trust × decay_factor × usefulness_factor`

Empty `query` returns top-N by relevance score (good for session startup).

### `memory_feedback`
Record whether a recalled memory was useful. This is the flywheel.

```json
{
  "memory_id": "mem_abc123_xyz",
  "useful": true,
  "context": "Reminded me to run npm install --include=dev"
}
```

### `memory_stats`
Get counts and averages for the memory store.

```json
{
  "total": 40,
  "active": 38,
  "by_category": { "lesson": 14, "strategy": 7, "operational": 6 },
  "avg_confidence": 0.93,
  "feedback_count": 12
}
```

## Usage Pattern

The intended pattern for autonomous agents:

```
Session start:
  → memory_recall("", { limit: 10 })  # load top memories into context

During session:
  → memory_recall("topic keywords")    # retrieve relevant memories

After session:
  → memory_store(...)                  # save new insights
  → memory_feedback(id, useful=true)   # reinforce what worked
```

## Storage

SQLite database with WAL mode. Schema:
- `memories` table: content, category, tags, provenance fields, decay tracking, feedback counts
- `feedback_log` table: full feedback history for the flywheel

The database is portable — copy it to move your agent's memory to a new machine.

## What's different from Mem0 / Letta / Zep

| Feature | This | Mem0 | Letta | Zep |
|---|---|---|---|---|
| Provenance tracking | ✅ | ❌ | ❌ | ❌ |
| Decay-weighted retrieval | ✅ | ❌ | ❌ | Partial |
| Feedback flywheel | ✅ | ❌ | ❌ | ❌ |
| Local SQLite (no API key) | ✅ | ❌ | ❌ | ❌ |
| MCP native | ✅ | ❌ | ❌ | ❌ |

## License

MIT

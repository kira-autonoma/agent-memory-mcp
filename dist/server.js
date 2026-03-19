/**
 * Memory MCP Server
 *
 * Exposes the memory store as MCP tools so any agent can:
 * - Store memories with provenance
 * - Recall memories (decay-weighted, keyword-filtered)
 * - Record feedback (the flywheel)
 * - Get stats
 *
 * Run standalone: npx agent-memory-mcp
 * Or: node dist/server.js
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as mem from "./store.js";
// --- Tool schemas ---
const StoreInputSchema = z.object({
    content: z.string().describe("The memory content to store"),
    category: z
        .enum(["lesson", "strategy", "operational", "identity", "preference", "fact"])
        .describe("Memory category"),
    tags: z.array(z.string()).optional().describe("Optional tags for filtering"),
    source_type: z
        .enum(["conversation", "api_response", "document", "agent_inference", "observation", "explicit"])
        .default("agent_inference")
        .describe("Where this memory came from"),
    confidence: z
        .number()
        .min(0)
        .max(1)
        .default(0.8)
        .describe("Confidence score 0.0-1.0"),
    source_trust: z
        .number()
        .min(0)
        .max(1)
        .default(0.8)
        .describe("Trust level of the source 0.0-1.0"),
});
const RecallInputSchema = z.object({
    query: z
        .string()
        .default("")
        .describe("Keyword query (empty = top-N by relevance)"),
    category: z
        .enum(["lesson", "strategy", "operational", "identity", "preference", "fact"])
        .optional()
        .describe("Filter by category"),
    tags: z.array(z.string()).optional().describe("Filter by tags"),
    min_confidence: z.number().min(0).max(1).default(0).describe("Minimum confidence"),
    limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
});
const FeedbackInputSchema = z.object({
    memory_id: z.string().describe("ID of the recalled memory"),
    useful: z.boolean().describe("Was this memory useful?"),
    context: z.string().optional().describe("Optional context about why"),
});
// --- MCP Server ---
const server = new Server({
    name: "memory",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "memory_store",
            description: "Store a new memory with provenance tracking. Use for lessons learned, strategic insights, operational facts, or preferences.",
            inputSchema: {
                type: "object",
                properties: {
                    content: { type: "string", description: "The memory content to store" },
                    category: {
                        type: "string",
                        enum: ["lesson", "strategy", "operational", "identity", "preference", "fact"],
                        description: "Memory category",
                    },
                    tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
                    source_type: {
                        type: "string",
                        enum: ["conversation", "api_response", "document", "agent_inference", "observation", "explicit"],
                        default: "agent_inference",
                    },
                    confidence: { type: "number", minimum: 0, maximum: 1, default: 0.8 },
                    source_trust: { type: "number", minimum: 0, maximum: 1, default: 0.8 },
                },
                required: ["content", "category"],
            },
        },
        {
            name: "memory_recall",
            description: "Recall memories ranked by decay-weighted relevance. Supports keyword search and category/tag filtering. Returns memories with provenance and confidence scores.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Keyword query (empty = top-N by relevance)", default: "" },
                    category: {
                        type: "string",
                        enum: ["lesson", "strategy", "operational", "identity", "preference", "fact"],
                        description: "Filter by category",
                    },
                    tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
                    min_confidence: { type: "number", minimum: 0, maximum: 1, default: 0 },
                    limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
                },
                required: [],
            },
        },
        {
            name: "memory_feedback",
            description: "Record whether a recalled memory was useful. This drives the learning flywheel — memories marked useful bubble up, unused ones decay away.",
            inputSchema: {
                type: "object",
                properties: {
                    memory_id: { type: "string", description: "ID from a memory_recall result" },
                    useful: { type: "boolean", description: "Was this memory useful?" },
                    context: { type: "string", description: "Why was it useful/not useful?" },
                },
                required: ["memory_id", "useful"],
            },
        },
        {
            name: "memory_stats",
            description: "Get statistics about the memory store (counts, categories, avg confidence).",
            inputSchema: { type: "object", properties: {}, required: [] },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case "memory_store": {
                const input = StoreInputSchema.parse(args);
                const memory = mem.store({
                    content: input.content,
                    category: input.category,
                    tags: input.tags,
                    provenance: {
                        source_type: input.source_type,
                        extraction_method: "explicit_statement",
                        confidence: input.confidence,
                        source_trust: input.source_trust,
                    },
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ id: memory.id, category: memory.category, created_at: memory.created_at }),
                        },
                    ],
                };
            }
            case "memory_recall": {
                const input = RecallInputSchema.parse(args);
                const results = mem.recall(input.query, {
                    category: input.category,
                    tags: input.tags,
                    min_confidence: input.min_confidence,
                    limit: input.limit,
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(results.map((r) => ({
                                id: r.id,
                                content: r.content,
                                category: r.category,
                                tags: r.tags,
                                relevance_score: Math.round(r.relevance_score * 1000) / 1000,
                                confidence: r.provenance.confidence,
                                source_trust: r.provenance.source_trust,
                                access_count: r.access_count,
                                useful_count: r.useful_count,
                            })), null, 2),
                        },
                    ],
                };
            }
            case "memory_feedback": {
                const input = FeedbackInputSchema.parse(args);
                mem.feedback(input.memory_id, input.useful, input.context);
                return {
                    content: [{ type: "text", text: `Feedback recorded for ${input.memory_id}` }],
                };
            }
            case "memory_stats": {
                const s = mem.stats();
                return {
                    content: [{ type: "text", text: JSON.stringify(s, null, 2) }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `Error: ${msg}` }],
            isError: true,
        };
    }
});
// --- Entry point ---
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Server runs until stdin closes
}
main().catch((err) => {
    console.error("Memory MCP server error:", err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map
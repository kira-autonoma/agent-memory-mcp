/**
 * Agent Memory Store with Provenance & Trust
 *
 * Core storage layer using SQLite. Every memory has:
 * - Provenance: where it came from, how it was extracted, confidence level
 * - Trust scoring: source reliability weighting
 * - Decay: time-based confidence reduction with access reinforcement
 * - Feedback: track if recalled memories were actually useful
 */
export type SourceType = "conversation" | "api_response" | "document" | "agent_inference" | "observation" | "explicit";
export type ExtractionMethod = "llm_extract" | "explicit_statement" | "inferred" | "structured_import";
export interface Provenance {
    source_type: SourceType;
    source_id?: string;
    extraction_method: ExtractionMethod;
    confidence: number;
    source_trust: number;
}
export interface Memory {
    id: string;
    content: string;
    category: string;
    tags: string[];
    intent?: string;
    provenance: Provenance;
    created_at: string;
    updated_at: string;
    access_count: number;
    last_accessed: string | null;
    useful_count: number;
    not_useful_count: number;
    superseded_by: string | null;
    active: boolean;
}
export interface StoreInput {
    content: string;
    category: string;
    tags?: string[];
    intent?: string;
    provenance: Provenance;
}
export interface RecallOptions {
    category?: string;
    tags?: string[];
    min_confidence?: number;
    min_trust?: number;
    limit?: number;
    include_inactive?: boolean;
}
export interface RecallResult extends Memory {
    relevance_score: number;
}
/**
 * Store a memory with provenance.
 */
export declare function store(input: StoreInput): Memory;
/**
 * Recall memories with decay/trust-weighted scoring.
 *
 * Score = base_confidence * trust_weight * decay_factor * usefulness_factor
 *
 * - decay_factor: exponential decay based on age (half-life = 30 days)
 * - trust_weight: source_trust directly
 * - usefulness_factor: boosted by positive feedback, penalized by negative
 */
export declare function recall(query: string, options?: RecallOptions): RecallResult[];
/**
 * Record feedback on a recalled memory. This is the flywheel.
 */
export declare function feedback(memoryId: string, useful: boolean, context?: string): void;
/**
 * Supersede a memory with a new one (for corrections/updates).
 */
export declare function supersede(oldId: string, newInput: StoreInput): Memory;
/**
 * Get stats about the memory store.
 */
export declare function stats(): {
    total: number;
    active: number;
    by_category: Record<string, number>;
    avg_confidence: number;
    feedback_count: number;
};
/**
 * Close the database connection.
 */
export declare function close(): void;
//# sourceMappingURL=store.d.ts.map
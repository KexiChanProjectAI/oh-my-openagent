/**
 * Implementation Team Schemas
 *
 * Zod schemas and types for all implementation-team data structures:
 * Finding, ReviewerVerdict, RoleAggregateVerdict, GlobalAggregateVerdict,
 * EscalationJudgeVerdict, and MalformedVerdict.
 */

import { z } from "zod"

// ============================================================================
// Finding Schema
// ============================================================================

export const FindingSchema = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.enum(["BLOCKER", "MAJOR", "MINOR"]),
  file_ref: z.string().optional(),
  category: z.enum(["correctness", "maintainability", "risk", "performance", "security"]),
})

export type Finding = z.infer<typeof FindingSchema>

// ============================================================================
// Reviewer Verdict Schema
// ============================================================================

export const ReviewerVerdictSchema = z.object({
  schema_version: z.literal("1.0"),
  run_id: z.string(),
  round: z.number().int().positive(),
  role: z.string(),
  reviewer_id: z.string(),
  model_id: z.string(),
  verdict: z.enum(["PASS", "FAIL"]),
  severity: z.enum(["BLOCKER", "MAJOR", "MINOR", "NONE"]),
  blocker_count: z.number().int().min(0),
  findings: z.array(FindingSchema),
  summary: z.string(),
  timestamp: z.string(),
})

export type ReviewerVerdict = z.infer<typeof ReviewerVerdictSchema>

// ============================================================================
// Role Aggregate Verdict Schema
// ============================================================================

export const ReviewerLineageSchema = z.object({
  reviewer_id: z.string(),
  model_id: z.string(),
  verdict: z.enum(["PASS", "FAIL"]),
  malformed: z.boolean(),
})

export type ReviewerLineage = z.infer<typeof ReviewerLineageSchema>

export const RoleAggregateVerdictSchema = z.object({
  role: z.string(),
  round: z.number().int().positive(),
  pass: z.boolean(),
  reviewer_count: z.number().int().positive(),
  malformed_count: z.number().int().min(0),
  blocker_count: z.number().int().min(0),
  deduped_findings: z.array(FindingSchema),
  reviewer_lineage: z.array(ReviewerLineageSchema),
})

export type RoleAggregateVerdict = z.infer<typeof RoleAggregateVerdictSchema>

// ============================================================================
// Global Aggregate Verdict Schema
// ============================================================================

export const ExecutorPatchBriefSchema = z.object({
  unresolved_blockers: z.array(FindingSchema),
  failed_role_ids: z.array(z.string()),
  execution_round: z.number().int().positive(),
})

export type ExecutorPatchBrief = z.infer<typeof ExecutorPatchBriefSchema>

export const GlobalAggregateVerdictSchema = z.object({
  pass: z.boolean(),
  round: z.number().int().positive(),
  failed_roles: z.array(z.string()),
  role_aggregates: z.array(RoleAggregateVerdictSchema),
  executor_patch_brief: ExecutorPatchBriefSchema,
})

export type GlobalAggregateVerdict = z.infer<typeof GlobalAggregateVerdictSchema>

// ============================================================================
// Escalation Judge Verdict Schema
// ============================================================================

export const MandatoryChangeSchema = z.object({
  id: z.string(),
  description: z.string(),
  role: z.string(),
  priority: z.enum(["mandatory", "recommended"]),
})

export type MandatoryChange = z.infer<typeof MandatoryChangeSchema>

export const EscalationJudgeVerdictSchema = z.object({
  verdict: z.enum(["approve", "revise-once-mandatory", "reject-escalate-human"]),
  reasoning: z.string(),
  mandatory_changes: z.array(MandatoryChangeSchema),
})

export type EscalationJudgeVerdict = z.infer<typeof EscalationJudgeVerdictSchema>

// ============================================================================
// Malformed Verdict Schema
// ============================================================================

export const MalformedVerdictSchema = z.object({
  is_malformed: z.literal(true),
  raw_output: z.string(),
  error_type: z.enum(["invalid_json", "missing_fields", "parse_error", "timeout", "cancellation", "empty_output"]),
  role: z.string(),
})

export type MalformedVerdict = z.infer<typeof MalformedVerdictSchema>

// ============================================================================
// Validator Functions
// ============================================================================

export function validateReviewerVerdict(raw: unknown): ReviewerVerdict | MalformedVerdict {
  // Attempt JSON parsing if raw is a string
  let parsed: unknown = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        is_malformed: true,
        raw_output: raw,
        error_type: "invalid_json",
        role: "",
      }
    }
  }

  // Validate required fields exist before schema parsing
  if (typeof parsed !== "object" || parsed === null) {
    return {
      is_malformed: true,
      raw_output: typeof raw === "string" ? raw : JSON.stringify(raw),
      error_type: "parse_error",
      role: "",
    }
  }

  const obj = parsed as Record<string, unknown>

  // Check for essential fields
  const essentialFields = ["schema_version", "run_id", "round", "role", "verdict", "timestamp"]
  const missingFields = essentialFields.filter((field) => !(field in obj))

  if (missingFields.length > 0) {
    return {
      is_malformed: true,
      raw_output: typeof raw === "string" ? raw : JSON.stringify(raw),
      error_type: "missing_fields",
      role: typeof obj.role === "string" ? obj.role : "",
    }
  }

  // Check for empty output
  if (typeof obj.summary === "string" && obj.summary.trim() === "" && Array.isArray(obj.findings) && obj.findings.length === 0) {
    return {
      is_malformed: true,
      raw_output: typeof raw === "string" ? raw : JSON.stringify(raw),
      error_type: "empty_output",
      role: typeof obj.role === "string" ? obj.role : "",
    }
  }

  // Attempt schema validation
  const result = ReviewerVerdictSchema.safeParse(parsed)

  if (!result.success) {
    return {
      is_malformed: true,
      raw_output: typeof raw === "string" ? raw : JSON.stringify(raw),
      error_type: "parse_error",
      role: typeof obj.role === "string" ? obj.role : "",
    }
  }

  return result.data
}

export function isMalformedVerdict(v: unknown): v is MalformedVerdict {
  if (typeof v !== "object" || v === null) return false
  const obj = v as Record<string, unknown>
  return obj.is_malformed === true && MalformedVerdictSchema.safeParse(v).success
}

export function isValidReviewerVerdict(v: unknown): v is ReviewerVerdict {
  if (typeof v !== "object" || v === null) return false
  return ReviewerVerdictSchema.safeParse(v).success
}
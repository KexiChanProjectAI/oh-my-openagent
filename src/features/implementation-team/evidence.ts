/**
 * Implementation Team Evidence and Logging Contract
 *
 * Defines the evidence directory structure, artifact paths, and log payload
 * schema for implementation-team runs. All paths are deterministic based on
 * fixed run IDs.
 */

import { randomUUID } from "node:crypto"
import { z } from "zod"

export const EVIDENCE_BASE_DIR = ".sisyphus/evidence"
export const IMPL_TEAM_DIR = ".sisyphus/evidence/impl-team"

/**
 * Artifact types that can be captured during an impl-team run.
 */
export type ArtifactType =
  | "executor-output"
  | `reviewer-verdict-${string}`
  | `role-aggregate-${string}`
  | "global-aggregate"
  | "escalation-judge"
  | "run-metadata"
  | "terminal-verdict"

/**
 * Get the evidence directory for a specific run.
 * Returns `.sisyphus/evidence/impl-team/{runId}/`
 */
export function getRunEvidenceDir(runId: string): string {
  return `${IMPL_TEAM_DIR}/${runId}/`
}

/**
 * Get the evidence directory for a specific round within a run.
 * Returns `.sisyphus/evidence/impl-team/{runId}/round-{round}/`
 */
export function getRoundEvidencePath(runId: string, round: number): string {
  return `${getRunEvidenceDir(runId)}round-${round}/`
}

/**
 * Get the full path for a specific artifact type within a run.
 *
 * Mapping:
 * - "executor-output" → {runDir}/round-{round}/executor-output.txt
 * - "reviewer-verdict-{reviewerId}" → {runDir}/round-{round}/verdict-{reviewerId}.json
 * - "role-aggregate-{role}" → {runDir}/round-{round}/role-{role}.json
 * - "global-aggregate" → {runDir}/round-{round}/global-aggregate.json
 * - "escalation-judge" → {runDir}/escalation-judge.json
 * - "run-metadata" → {runDir}/metadata.json
 * - "terminal-verdict" → {runDir}/terminal-verdict.json
 */
export function getEvidencePath(runId: string, artifactType: ArtifactType, round?: number): string {
  const runDir = getRunEvidenceDir(runId)

  if (artifactType === "run-metadata") {
    return `${runDir}metadata.json`
  }

  if (artifactType === "terminal-verdict") {
    return `${runDir}terminal-verdict.json`
  }

  if (artifactType === "escalation-judge") {
    return `${runDir}escalation-judge.json`
  }

  if (round === undefined) {
    throw new Error(`Round must be provided for artifact type: ${artifactType}`)
  }

  const roundDir = getRoundEvidencePath(runId, round)

  if (artifactType === "executor-output") {
    return `${roundDir}executor-output.txt`
  }

  if (artifactType === "global-aggregate") {
    return `${roundDir}global-aggregate.json`
  }

  if (artifactType.startsWith("reviewer-verdict-")) {
    const reviewerId = artifactType.replace("reviewer-verdict-", "")
    return `${roundDir}verdict-${reviewerId}.json`
  }

  if (artifactType.startsWith("role-aggregate-")) {
    const role = artifactType.replace("role-aggregate-", "")
    return `${roundDir}role-${role}.json`
  }

  throw new Error(`Unknown artifact type: ${artifactType}`)
}

/**
 * Schema for run metadata stored in evidence/metadata.json
 */
export const RunMetadataSchema = z.object({
  run_id: z.string(),
  started_at: z.string(),
  terminal_outcome: z.string(),
  total_rounds: z.number().int().min(0),
  reviewer_count_by_role: z.record(z.string(), z.number()),
  escalation_triggered: z.boolean(),
  escalation_verdict: z.string().optional(),
  total_spawned_tasks: z.number().int().min(0),
  malformed_verdict_count: z.number().int().min(0),
  completed_at: z.string().optional(),
})

export type RunMetadata = z.infer<typeof RunMetadataSchema>

/**
 * Schema for log payloads emitted during an impl-team run
 */
export const LogPayloadSchema = z.object({
  run_id: z.string(),
  round: z.number().int().min(0),
  state: z.string(),
  event: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string(),
})

export type LogPayload = z.infer<typeof LogPayloadSchema>

/**
 * Generate a unique run ID using crypto.randomUUID().
 * Returns a deterministic-looking but unique identifier.
 */
export function generateRunId(): string {
  return randomUUID()
}

/**
 * Validate and parse raw input against RunMetadataSchema.
 * Throws ZodError if validation fails.
 */
export function validateRunMetadata(raw: unknown): RunMetadata {
  return RunMetadataSchema.parse(raw)
}

/**
 * Create a log payload with the given parameters.
 * Timestamp is automatically set to current ISO 8601.
 */
export function createLogPayload(
  runId: string,
  round: number,
  state: string,
  event: string,
  data?: Record<string, unknown>,
): LogPayload {
  return {
    run_id: runId,
    round,
    state,
    event,
    data,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Implementation Team Evidence Capture
 *
 * Writes deterministic evidence files for implementation-team runs.
 * All paths are derived from runId and round using getEvidencePath().
 * Evidence write failures produce explicit errors - evidence capture is NOT optional.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import {
  getEvidencePath,
  type RunMetadata,
} from "./evidence"
import type {
  ReviewerVerdict,
  MalformedVerdict,
  RoleAggregateVerdict,
  GlobalAggregateVerdict,
  EscalationJudgeVerdict,
} from "./schemas"

/**
 * Custom error thrown when evidence file write fails.
 */
export class EvidenceWriteError extends Error {
  public readonly runId: string
  public readonly artifactType: string
  public readonly filePath: string
  public override readonly cause: unknown

  constructor(runId: string, artifactType: string, filePath: string, cause: unknown) {
    const message = `Failed to write evidence for run ${runId}, artifact ${artifactType}, path ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`
    super(message)
    this.name = "EvidenceWriteError"
    this.runId = runId
    this.artifactType = artifactType
    this.filePath = filePath
    this.cause = cause
  }
}

/**
 * Ensures parent directory exists for a file path.
 */
function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
}

/**
 * EvidenceWriter captures deterministic evidence files for implementation-team runs.
 * Each artifact type maps to a specific file path derived from runId and round.
 */
export class EvidenceWriter {
  /**
   * Write executor output to round directory.
   * File: {runDir}/round-{round}/executor-output.txt
   */
  writeExecutorOutput(runId: string, round: number, output: string): void {
    const artifactType = "executor-output"
    const filePath = getEvidencePath(runId, artifactType, round)
    try {
      ensureParentDir(filePath)
      writeFileSync(filePath, output, "utf-8")
    } catch (cause) {
      throw new EvidenceWriteError(runId, artifactType, filePath, cause)
    }
  }

  /**
   * Write reviewer verdict to round directory.
   * File: {runDir}/round-{round}/verdict-{reviewerId}.json
   *
   * Note: MalformedVerdict uses 'role' as the identifier since it lacks reviewer_id.
   */
  writeReviewerVerdict(runId: string, round: number, verdict: ReviewerVerdict | MalformedVerdict): void {
    // MalformedVerdict lacks reviewer_id - use role as fallback identifier
    const reviewerId = "reviewer_id" in verdict ? verdict.reviewer_id : verdict.role ?? "unknown"
    const artifactType = `reviewer-verdict-${reviewerId}` as const
    const filePath = getEvidencePath(runId, artifactType, round)
    try {
      ensureParentDir(filePath)
      const json = JSON.stringify(verdict, null, 2)
      writeFileSync(filePath, json, "utf-8")
    } catch (cause) {
      throw new EvidenceWriteError(runId, artifactType, filePath, cause)
    }
  }

  /**
   * Write role aggregate verdict to round directory.
   * File: {runDir}/round-{round}/role-{role}.json
   */
  writeRoleAggregate(runId: string, round: number, aggregate: RoleAggregateVerdict): void {
    const role = aggregate.role
    const artifactType = `role-aggregate-${role}` as const
    const filePath = getEvidencePath(runId, artifactType, round)
    try {
      ensureParentDir(filePath)
      const json = JSON.stringify(aggregate, null, 2)
      writeFileSync(filePath, json, "utf-8")
    } catch (cause) {
      throw new EvidenceWriteError(runId, artifactType, filePath, cause)
    }
  }

  /**
   * Write global aggregate verdict to round directory.
   * File: {runDir}/round-{round}/global-aggregate.json
   */
  writeGlobalAggregate(runId: string, round: number, aggregate: GlobalAggregateVerdict): void {
    const artifactType = "global-aggregate"
    const filePath = getEvidencePath(runId, artifactType, round)
    try {
      ensureParentDir(filePath)
      const json = JSON.stringify(aggregate, null, 2)
      writeFileSync(filePath, json, "utf-8")
    } catch (cause) {
      throw new EvidenceWriteError(runId, artifactType, filePath, cause)
    }
  }

  /**
   * Write escalation judge verdict to run directory (no round).
   * File: {runDir}/escalation-judge.json
   */
  writeEscalationJudgeVerdict(runId: string, verdict: EscalationJudgeVerdict): void {
    const artifactType = "escalation-judge"
    const filePath = getEvidencePath(runId, artifactType)
    try {
      ensureParentDir(filePath)
      const json = JSON.stringify(verdict, null, 2)
      writeFileSync(filePath, json, "utf-8")
    } catch (cause) {
      throw new EvidenceWriteError(runId, artifactType, filePath, cause)
    }
  }

  /**
   * Write run metadata to run directory (no round).
   * File: {runDir}/metadata.json
   */
  writeRunMetadata(runId: string, metadata: RunMetadata): void {
    const artifactType = "run-metadata"
    const filePath = getEvidencePath(runId, artifactType)
    try {
      ensureParentDir(filePath)
      const json = JSON.stringify(metadata, null, 2)
      writeFileSync(filePath, json, "utf-8")
    } catch (cause) {
      throw new EvidenceWriteError(runId, artifactType, filePath, cause)
    }
  }

  /**
   * Write terminal verdict summary to run directory (no round).
   * File: {runDir}/terminal-verdict.json
   */
  writeTerminalVerdict(runId: string, summary: object): void {
    const artifactType = "terminal-verdict"
    const filePath = getEvidencePath(runId, artifactType)
    try {
      ensureParentDir(filePath)
      const json = JSON.stringify(summary, null, 2)
      writeFileSync(filePath, json, "utf-8")
    } catch (cause) {
      throw new EvidenceWriteError(runId, artifactType, filePath, cause)
    }
  }
}

/**
 * Factory to create a new EvidenceWriter instance.
 */
export function createEvidenceWriter(): EvidenceWriter {
  return new EvidenceWriter()
}
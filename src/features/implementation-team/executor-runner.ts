/**
 * Implementation Team Executor Runner
 *
 * Launches one implementation attempt per ordinary round using existing
 * delegate-task/background-task infrastructure. Handles fix rounds with
 * unresolved findings packet.
 */

import type { DelegateTaskArgs } from "../../tools/delegate-task/types"
import type { ExecutorPatchBrief } from "./schemas"
import type { ResolvedImplementationTeamConfig } from "./config-resolver"
import { getRoundEvidencePath } from "./evidence"

// ============================================================================
// Launch Input/Output Types
// ============================================================================

export interface ExecutorLaunchInput {
  runId: string
  round: number
  config: ResolvedImplementationTeamConfig
  taskDescription: string // Original user task description
  taskPrompt: string // Full implementation prompt
  unresolvedFindings?: ExecutorPatchBrief // Only for fix rounds (round > 1)
}

export interface ExecutorLaunchResult {
  taskId: string // Background task ID
  sessionId: string // Session ID
  round: number
  evidencePath: string // Where output will be captured
}

// ============================================================================
// Internal State (in-memory tracking for duplicate prevention)
// ============================================================================

/**
 * Map of runId+round -> ExecutorLaunchResult
 * Used for duplicate launch prevention within the same process lifetime.
 */
const launchedTasks = new Map<string, ExecutorLaunchResult>()

// ============================================================================
// Task ID Generation
// ============================================================================

/**
 * Generate a deterministic task ID from runId and round.
 * Format: impl-team-{runId}-round-{round}
 */
export function generateExecutorTaskId(runId: string, round: number): string {
  return `impl-team-${runId}-round-${round}`
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the executor prompt with round-aware context.
 * Includes run metadata tag and optional unresolved findings for fix rounds.
 */
export function buildExecutorPrompt(input: ExecutorLaunchInput): string {
  const { runId, round, taskPrompt, unresolvedFindings } = input

  // Base run metadata tag
  const runMetadataTag = `[IMPLEMENTATION_TEAM_RUN runId=${runId} round=${round}]`

  // Build the prompt with round-aware context
  let prompt = `${runMetadataTag}\n\n${taskPrompt}`

  // For fix rounds (round > 1), include unresolved findings
  if (round > 1 && unresolvedFindings) {
    const findingsSection = buildFindingsSection(unresolvedFindings)
    prompt += `\n\n${findingsSection}`
  }

  return prompt
}

/**
 * Build the unresolved findings section for fix rounds.
 */
function buildFindingsSection(patchBrief: ExecutorPatchBrief): string {
  const lines: string[] = [
    "\n--- UNRESOLVED FINDINGS FROM PREVIOUS ROUND ---",
    "\nThe following blockers must be addressed in this implementation:\n",
  ]

  if (patchBrief.unresolved_blockers.length > 0) {
    lines.push("## Blockers to Resolve:")
    for (const finding of patchBrief.unresolved_blockers) {
      lines.push(`- [${finding.severity}] ${finding.description}`)
      if (finding.file_ref) {
        lines.push(`  Location: ${finding.file_ref}`)
      }
      if (finding.category) {
        lines.push(`  Category: ${finding.category}`)
      }
    }
  }

  if (patchBrief.failed_role_ids.length > 0) {
    lines.push(`\n## Failed Review Roles: ${patchBrief.failed_role_ids.join(", ")}`)
  }

  lines.push("\nPlease address all listed blockers in your implementation.")
  lines.push("---\n")

  return lines.join("\n")
}

// ============================================================================
// Task Args Building
// ============================================================================

/**
 * Build task args for delegate-task tool.
 */
export function buildExecutorTaskArgs(input: ExecutorLaunchInput): DelegateTaskArgs {
  const { runId, round, config, taskDescription } = input

  // Generate deterministic task ID
  const taskId = generateExecutorTaskId(runId, round)

  // Build description with run ID for traceability
  const description = `[${runId}] ${taskDescription}`

  // Build the prompt with round-aware context
  const prompt = buildExecutorPrompt(input)

  // Use executor's configured category (defaults to "unspecified-high" if not set)
  const category = config.executor.category || "unspecified-high"

  return {
    description,
    prompt,
    category,
    run_in_background: true,
    task_id: taskId,
    load_skills: [], // Executor doesn't need skills
  }
}

// ============================================================================
// Duplicate Prevention
// ============================================================================

/**
 * Get the cache key for a specific run+round combination.
 */
function getCacheKey(runId: string, round: number): string {
  return `${runId}:${round}`
}

/**
 * Check if a task has already been launched for this run+round.
 * Returns the existing result if found.
 */
export function getExistingLaunchResult(runId: string, round: number): ExecutorLaunchResult | undefined {
  const key = getCacheKey(runId, round)
  return launchedTasks.get(key)
}

// ============================================================================
// Main Executor Task Creation
// ============================================================================

/**
 * Create a task for one implementation round.
 *
 * This function:
 * - Builds a complete DelegateTaskArgs object for the executor
 * - Uses the executor's configured category from config.executor.category
 * - Sets run_in_background: true for background execution
 * - Includes load_skills: [] (executor doesn't need skills)
 * - Attaches run metadata in the prompt: [IMPLEMENTATION_TEAM_RUN runId={runId} round={round}]
 * - For round > 1: includes unresolved findings as structured feedback
 * - Returns a deterministic evidence path using getRoundEvidencePath(runId, round)
 * - Every executor task has a unique task ID (computed from runId + round)
 * - Prevents duplicate launches for the same runId+round
 */
export function createExecutorTask(input: ExecutorLaunchInput): ExecutorLaunchResult {
  const { runId, round } = input

  // Check for duplicate launch prevention
  const existing = getExistingLaunchResult(runId, round)
  if (existing) {
    return existing
  }

  // Build task args
  const taskArgs = buildExecutorTaskArgs(input)

  // Compute evidence path (deterministic)
  const evidencePath = getRoundEvidencePath(runId, round)

  // The actual task launching is done by the caller (BackgroundManager integration).
  // This function returns the computed args and metadata that would be used.
  // The taskId is generated deterministically from runId+round.
  const taskId = taskArgs.task_id!

  // In a real implementation, the BackgroundManager would be called here.
  // For now, we return the computed result with a placeholder sessionId.
  // The sessionId will be populated when BackgroundManager.launch() completes.
  const result: ExecutorLaunchResult = {
    taskId,
    sessionId: "", // Will be populated by BackgroundManager
    round,
    evidencePath,
  }

  // Store in cache for duplicate prevention
  const cacheKey = getCacheKey(runId, round)
  launchedTasks.set(cacheKey, result)

  return result
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Reset the internal task cache. For testing purposes only.
 */
export function _resetLaunchedTasksCache(): void {
  launchedTasks.clear()
}

/**
 * Get the number of cached launch results. For testing purposes only.
 */
export function _getLaunchedTasksCacheSize(): number {
  return launchedTasks.size
}
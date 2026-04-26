/**
 * Implementation Team Escalation Judge Runner
 *
 * Runs a stronger-model judge that arbitrates unresolved findings after
 * two failed ordinary rounds. The judge produces a structured verdict:
 * approve, revise-once-mandatory, or reject-escalate-human.
 */

import type { DelegateTaskArgs } from "../../tools/delegate-task/types"
import type {
  EscalationJudgeVerdict,
  Finding,
  GlobalAggregateVerdict,
  MalformedVerdict,
} from "./schemas"
import { EscalationJudgeVerdictSchema } from "./schemas"
import type { ResolvedImplementationTeamConfig } from "./config-resolver"
import { canEscalate } from "./state-machine"
import type { RunState } from "./state-machine"
import { getRunEvidenceDir } from "./evidence"

// ============================================================================
// Input/Output Types
// ============================================================================

export interface EscalationJudgeInput {
  runId: string
  config: ResolvedImplementationTeamConfig
  roundHistory: {
    globalAggregate: GlobalAggregateVerdict
    unresolvedFindings: Finding[]
  }
  taskDescription: string
  taskPrompt: string
}

export interface EscalationJudgeResult {
  taskId: string
  sessionId: string
  evidencePath: string
  verdict?: EscalationJudgeVerdict
}

// ============================================================================
// JSON Schema for Prompt (human-readable format)
// ============================================================================

const ESCALATION_JUDGE_SCHEMA = {
  verdict: "enum: approve | revise-once-mandatory | reject-escalate-human",
  reasoning: "string (1-3 sentences explaining the verdict)",
  mandatory_changes: [
    {
      id: "string",
      description: "string",
      role: "string",
      priority: "enum: mandatory | recommended",
    },
  ],
}

// ============================================================================
// Internal State (in-memory tracking for duplicate prevention)
// ============================================================================

/**
 * Record of launched judge tasks by runId.
 * Used for duplicate launch prevention within the same process lifetime.
 */
const launchedJudgeTasks: Record<string, EscalationJudgeResult> = {}

// ============================================================================
// Task ID Generation
// ============================================================================

/**
 * Generate a deterministic task ID for the escalation judge.
 * Format: impl-team-{runId}-escalation-judge
 */
export function generateJudgeTaskId(runId: string): string {
  return `impl-team-${runId}-escalation-judge`
}

// ============================================================================
// Judge Prompt Building
// ============================================================================

/**
 * Build the escalation judge prompt with arbitration context.
 * Includes the original task description/prompt, unresolved findings,
 * and clear verdict instructions.
 */
export function buildJudgePrompt(input: EscalationJudgeInput): string {
  const { runId, taskDescription, taskPrompt, roundHistory } = input
  const { globalAggregate, unresolvedFindings } = roundHistory
  const schemaJson = JSON.stringify(ESCALATION_JUDGE_SCHEMA, null, 2)

  // Build findings list
  const findingsList =
    unresolvedFindings.length > 0
      ? unresolvedFindings
          .map(
            (f, i) =>
              `${i + 1}. [${f.severity}] ${f.category}: ${f.description}${f.file_ref ? ` (ref: ${f.file_ref})` : ""}`,
          )
          .join("\n")
      : "No unresolved findings."

  // Build failed roles summary
  const failedRolesSummary =
    globalAggregate.failed_roles.length > 0
      ? `Failed roles: ${globalAggregate.failed_roles.join(", ")}`
      : "No specific role failures recorded."

  const prompt = `# Escalation Judge - Final Arbiter

[IMPLEMENTATION_TEAM_RUN runId=${runId} role=escalation-judge]

## Original Task Description
${taskDescription}

## Original Implementation Prompt
${taskPrompt}

## Round 2 Final State
- Overall pass: ${globalAggregate.pass}
- ${failedRolesSummary}
- Round: ${globalAggregate.round}

## Unresolved Blockers Requiring Arbitration
The following findings were not resolved through two ordinary review rounds:

${findingsList}

## Your Role as Final Arbiter

You are the ESCALATION JUDGE. You have the final word on this implementation.

You must examine the unresolved blockers above and determine the appropriate verdict.

## Verdict Options

Choose ONE of these three verdicts:

### 1. "approve"
The implementation is acceptable despite the listed issues. The remaining findings are acceptable risks or are false positives.
Use this when the issues are minor, acceptable, or the implementation is fundamentally sound.

### 2. "revise-once-mandatory"
The implementation has significant issues that MUST be fixed. After exactly ONE fix round and ONE re-review, this will be complete.
Use this when critical issues exist but are fixable with specific guidance.

### 3. "reject-escalate-human"
This implementation cannot be resolved automatically. Human intervention is required.
Use this when the issues are too severe, ambiguous, or fundamental for automated resolution.

## Required Output Schema
Your output MUST be valid JSON matching this schema exactly. No other text.

\`\`\`json
${schemaJson}
\`\`\`

## Mandatory Output Format
- Output ONLY valid JSON matching the schema above
- No explanations, no markdown, no additional text
- The "reasoning" field must explain your verdict in 1-3 sentences
- The "mandatory_changes" array is required for "revise-once-mandatory" verdict (can be empty for other verdicts)

You are the FINAL arbiter. Your verdict is binding unless human override occurs.`

  return prompt
}

// ============================================================================
// Task Args Building
// ============================================================================

/**
 * Build task args for delegate-task tool for the escalation judge.
 */
export function buildJudgeTaskArgs(input: EscalationJudgeInput): DelegateTaskArgs {
  const { runId, config, taskDescription } = input

  // Generate deterministic task ID
  const taskId = generateJudgeTaskId(runId)

  // Build description with run ID for traceability
  const description = `[ESCALATION JUDGE] ${taskDescription}`

  // Build the judge prompt
  const prompt = buildJudgePrompt(input)

  // Use escalation model config, fallback to executor category if not specified
  const category = config.escalation.category ?? config.executor.category

  return {
    description,
    prompt,
    category,
    run_in_background: true,
    task_id: taskId,
    load_skills: [],
  }
}

// ============================================================================
// Duplicate Prevention
// ============================================================================

/**
 * Check if a judge task has already been launched for this run.
 * Returns the existing result if found.
 */
export function getExistingJudgeLaunchResult(runId: string): EscalationJudgeResult | undefined {
  return launchedJudgeTasks[runId]
}

// ============================================================================
// Main Escalation Judge Task Creation
// ============================================================================

/**
 * V1: judge runs exactly once per pipeline execution, no re-invocation
 *
 * Create an escalation judge task that arbitrates unresolved findings.
 *
 * This function:
 * - Uses the escalation model from config (falls back to executor category if not set)
 * - Sets run_in_background: true for background execution
 * - Includes all unresolved findings and round context
 * - Returns deterministic evidence path using getRunEvidenceDir(runId) + escalation-judge.json
 * - Prevents duplicate launches for the same runId
 */
export function createEscalationJudgeTask(input: EscalationJudgeInput): EscalationJudgeResult {
  const { runId } = input

  // Check for duplicate launch prevention
  const existing = getExistingJudgeLaunchResult(runId)
  if (existing) {
    return existing
  }

  // Build task args
  const taskArgs = buildJudgeTaskArgs(input)

  // Compute evidence path (deterministic)
  const evidencePath = `${getRunEvidenceDir(runId)}escalation-judge.json`

  // The taskId is generated deterministically
  const taskId = taskArgs.task_id!

  // In a real implementation, the BackgroundManager would be called here.
  // This function returns the computed args and metadata.
  // The sessionId will be populated when BackgroundManager.launch() completes.
  const result: EscalationJudgeResult = {
    taskId,
    sessionId: "", // Will be populated by BackgroundManager
    evidencePath,
  }

  // Store in cache for duplicate prevention
  launchedJudgeTasks[runId] = result

  return result
}

// ============================================================================
// Escalation Eligibility Validation
// ============================================================================

/**
 * Validate that escalation is allowed for the given run state.
 *
 * @throws Error if escalation is not allowed (wrong state or wrong round)
 */
export function validateEscalationEligibility(runState: RunState): void {
  if (!canEscalate(runState)) {
    const reason =
      runState.round < 2
        ? `Escalation requires round >= 2, currently round ${runState.round}`
        : `Escalation requires state CONVERGENCE_CHECK, currently state ${runState.state}`
    throw new Error(`Escalation not allowed: ${reason}`)
  }
}

// ============================================================================
// Judge Output Parsing
// ============================================================================

/**
 * Parse judge output into a structured verdict.
 * Uses validateReviewerVerdict-style parsing from schemas.ts.
 *
 * @returns EscalationJudgeVerdict if valid, MalformedVerdict if parsing fails
 */
export function parseJudgeOutput(raw: unknown): EscalationJudgeVerdict | MalformedVerdict {
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
        role: "escalation-judge",
      }
    }
  }

  // Validate required fields exist before schema parsing
  if (typeof parsed !== "object" || parsed === null) {
    return {
      is_malformed: true,
      raw_output: typeof raw === "string" ? raw : JSON.stringify(raw),
      error_type: "parse_error",
      role: "escalation-judge",
    }
  }

  const obj = parsed as Record<string, unknown>

  // Check for essential fields
  const essentialFields = ["verdict", "reasoning", "mandatory_changes"]
  const missingFields = essentialFields.filter((field) => !(field in obj))

  if (missingFields.length > 0) {
    return {
      is_malformed: true,
      raw_output: typeof raw === "string" ? raw : JSON.stringify(raw),
      error_type: "missing_fields",
      role: typeof obj.role === "string" ? obj.role : "escalation-judge",
    }
  }

  // Validate verdict is one of the three allowed values
  if (typeof obj.verdict === "string") {
    const validVerdicts = ["approve", "revise-once-mandatory", "reject-escalate-human"]
    if (!validVerdicts.includes(obj.verdict)) {
      return {
        is_malformed: true,
        raw_output: typeof raw === "string" ? raw : JSON.stringify(raw),
        error_type: "parse_error",
        role: "escalation-judge",
      }
    }
  }

  // Attempt schema validation
  const result = EscalationJudgeVerdictSchema.safeParse(parsed)

  if (!result.success) {
    return {
      is_malformed: true,
      raw_output: typeof raw === "string" ? raw : JSON.stringify(raw),
      error_type: "parse_error",
      role: "escalation-judge",
    }
  }

  return result.data
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Reset the internal judge task cache. For testing purposes only.
 */
export function _resetJudgeTasksCache(): void {
  // Delete all keys to clear the record
  for (const key of Object.keys(launchedJudgeTasks)) {
    delete launchedJudgeTasks[key]
  }
}

/**
 * Get the number of cached judge launch results. For testing purposes only.
 */
export function _getJudgeTasksCacheSize(): number {
  return Object.keys(launchedJudgeTasks).length
}

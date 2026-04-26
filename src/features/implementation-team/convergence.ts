/**
 * Implementation Team Convergence Controller
 *
 * Decision layer that evaluates whether the implementation pipeline should
 * continue, pass, escalate, or fail based on aggregate verdicts across rounds.
 * This is a pure function: inputs -> decision (no side effects).
 */

import type {
  EscalationJudgeVerdict,
  GlobalAggregateVerdict,
  MandatoryChange,
} from "./schemas"
import { PipelineState } from "./state-machine"

// ============================================================================
// Convergence Decision Types
// ============================================================================

export type ConvergenceDecision =
  | { action: "continue"; reason: string }
  | { action: "pass"; reason: string }
  | { action: "escalate"; reason: string }
  | { action: "fail"; reason: string }
  | { action: "revise-once"; reason: string; mandatoryChanges: MandatoryChange[] }

// ============================================================================
// Convergence Evaluation Input
// ============================================================================

export interface ConvergenceInput {
  currentRound: number
  currentGlobalVerdict: GlobalAggregateVerdict
  previousGlobalVerdict?: GlobalAggregateVerdict
  escalationVerdict?: EscalationJudgeVerdict
  postJudgeFixDone?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract blocker finding IDs from an executor patch brief.
 */
function extractBlockerIds(globalVerdict: GlobalAggregateVerdict): Set<string> {
  const blockerIds = new Set<string>()
  for (const blocker of globalVerdict.executor_patch_brief.unresolved_blockers) {
    blockerIds.add(blocker.id)
  }
  return blockerIds
}

/**
 * Check if blocker findings have decreased in count (progress indicator).
 * Note: Reduced count is treated as progress; identical findings are not.
 */
function hasBlockerProgress(
  currentVerdict: GlobalAggregateVerdict,
  previousVerdict?: GlobalAggregateVerdict,
): boolean {
  if (!previousVerdict) {
    return false
  }

  const currentBlockers = currentVerdict.executor_patch_brief.unresolved_blockers
  const previousBlockers = previousVerdict.executor_patch_brief.unresolved_blockers

  // Progress = blocker count decreased
  return currentBlockers.length < previousBlockers.length
}

/**
 * Check if blocker findings are identical (stagnation).
 * Stagnation means same blocker IDs, same count - not progress.
 */
function isBlockerStagnation(
  currentVerdict: GlobalAggregateVerdict,
  previousVerdict?: GlobalAggregateVerdict,
): boolean {
  if (!previousVerdict) {
    return false
  }

  const currentIds = extractBlockerIds(currentVerdict)
  const previousIds = extractBlockerIds(previousVerdict)

  // If same IDs and same count, it's stagnation
  if (currentIds.size !== previousIds.size) {
    return false
  }

  for (const id of previousIds) {
    if (!currentIds.has(id)) {
      return false
    }
  }

  return true
}

// ============================================================================
// Main Evaluation Functions
// ============================================================================

/**
 * V1: bounded to maxOrdinaryRounds (2 by default), no infinite retry
 *
 * Evaluate convergence for the current round and determine the next action.
 *
 * Logic:
 * 1. Round 1 + pass -> pass
 * 2. Round 1 + fail -> continue (first failure is expected, 1 more round allowed)
 * 3. Round 2 + pass -> pass
 * 4. Round 2 + fail:
 *    a. If blocker count decreased -> still escalate (2 ordinary rounds max)
 *    b. If blockers identical/increased -> escalate (stagnation)
 * 5. Post-judge revise-once path handled separately
 */
export function evaluateConvergence(input: ConvergenceInput): ConvergenceDecision {
  const {
    currentRound,
    currentGlobalVerdict,
    previousGlobalVerdict,
    escalationVerdict,
    postJudgeFixDone = false,
  } = input

  // Handle post-judge revise-once path
  // After escalation judge issues revise-once-mandatory, we get exactly ONE fix cycle
  if (escalationVerdict) {
    if (escalationVerdict.verdict === "revise-once-mandatory") {
      if (postJudgeFixDone) {
        // Already did the fix+review cycle, must fail now
        return {
          action: "fail",
          reason: "Post-judge revise-once cycle completed without resolution",
        }
      }

      // Return revise-once action for exactly 1 fix cycle
      return {
        action: "revise-once",
        reason: "Escalation judge mandated one fix cycle with specific changes",
        mandatoryChanges: escalationVerdict.mandatory_changes ?? [],
      }
    }

    if (escalationVerdict.verdict === "approve") {
      // Judge approved despite unresolved issues
      return {
        action: "pass",
        reason: "Escalation judge approved the implementation",
      }
    }

    if (escalationVerdict.verdict === "reject-escalate-human") {
      // Judge rejected, human needed
      return {
        action: "fail",
        reason: "Escalation judge determined human intervention required",
      }
    }
  }

  // Ordinary round evaluation (rounds 1 and 2)
  if (currentRound === 1) {
    if (currentGlobalVerdict.pass) {
      return {
        action: "pass",
        reason: "Round 1 passed all reviews",
      }
    }
    // Round 1 failure is expected, allow one more round
    return {
      action: "continue",
      reason: "Round 1 failed, allowing second round of review",
    }
  }

  if (currentRound === 2) {
    if (currentGlobalVerdict.pass) {
      return {
        action: "pass",
        reason: "Round 2 passed all reviews",
      }
    }

    // Round 2 failed - check for stagnation
    if (isBlockerStagnation(currentGlobalVerdict, previousGlobalVerdict)) {
      return {
        action: "escalate",
        reason: "Round 2 failed with stagnant blocker findings - escalating to judge",
      }
    }

    // Even with progress (fewer blockers), we escalate after 2 ordinary rounds max
    if (hasBlockerProgress(currentGlobalVerdict, previousGlobalVerdict)) {
      return {
        action: "escalate",
        reason: "Round 2 failed with some progress - escalating to judge for final arbitration",
      }
    }

    // Default round 2 failure escalates
    return {
      action: "escalate",
      reason: "Round 2 failed after two ordinary rounds - escalating to judge",
    }
  }

  // Round > 2 is not an ordinary path - this should not be reached in normal flow
  // If we somehow get here without escalation verdict, fail
  return {
    action: "fail",
    reason: `Invalid state: round ${currentRound} reached without escalation verdict`,
  }
}

/**
 * Determine if escalation judge should run.
 * Returns true when evaluateConvergence returns "escalate".
 */
export function shouldEscalate(input: ConvergenceInput): boolean {
  const decision = evaluateConvergence(input)
  return decision.action === "escalate"
}

/**
 * Get a human-readable summary of the convergence decision for logging.
 */
export function getConvergenceSummary(decision: ConvergenceDecision): string {
  switch (decision.action) {
    case "continue":
      return `Continue: ${decision.reason}`
    case "pass":
      return `Pass: ${decision.reason}`
    case "escalate":
      return `Escalate: ${decision.reason}`
    case "fail":
      return `Fail: ${decision.reason}`
    case "revise-once":
      return `Revise-once: ${decision.reason} (${decision.mandatoryChanges.length} mandatory changes)`
  }
}

// ============================================================================
// State Transition Helpers
// ============================================================================

/**
 * Determine the next PipelineState based on convergence decision.
 * This is the orchestration helper - convergence.ts itself does NOT transition states.
 */
export function getNextStateAfterConvergence(
  currentState: PipelineState,
  decision: ConvergenceDecision,
): PipelineState {
  switch (decision.action) {
    case "pass":
      return "TERMINAL_PASS"
    case "fail":
      return "TERMINAL_FAIL_NONCONVERGENT"
    case "continue":
      // continue means we go to implement next round
      if (currentState === "CONVERGENCE_CHECK") {
        return "IMPLEMENT_ROUND_2"
      }
      // Fallback - should not reach here in normal flow
      return currentState
    case "escalate":
      return "ESCALATION_JUDGE"
    case "revise-once":
      return "IMPLEMENT_ESCALATION_FIX"
  }
}

/**
 * Check if the current state allows convergence evaluation.
 */
export function canEvaluateConvergence(state: PipelineState): boolean {
  return state === "CONVERGENCE_CHECK"
}

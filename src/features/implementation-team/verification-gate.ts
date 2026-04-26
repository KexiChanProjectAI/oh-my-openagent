/**
 * Implementation Team Verification Gate
 *
 * Determines whether the implementation pipeline can proceed to final verification
 * based on the current run state. This gate ensures that:
 * - Passing implementation-team is a PRECONDITION for final verification, not a replacement
 * - Failed implementation-team blocks downstream verification
 * - Non-terminal states cannot proceed
 */

import { isTerminalState, type PipelineState, type RunState } from "./state-machine"

// ============================================================================
// Verification Gate Result
// ============================================================================

export interface VerificationGateResult {
  canProceed: boolean
  requiresFinalVerification: boolean
  terminalState: PipelineState
  reason: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if the implementation team has passed.
 * Pass states include both ordinary pass and escalated pass.
 */
export function isImplementationTeamPass(state: PipelineState): boolean {
  return state === "TERMINAL_PASS" || state === "TERMINAL_ESCALATED_PASS"
}

/**
 * Check if the implementation team has failed.
 * Fail states include blocked, nonconvergent, escalated fail, and cancelled.
 */
export function isImplementationTeamFail(state: PipelineState): boolean {
  return (
    state === "TERMINAL_FAIL_BLOCKED" ||
    state === "TERMINAL_FAIL_NONCONVERGENT" ||
    state === "TERMINAL_ESCALATED_FAIL" ||
    state === "TERMINAL_CANCELLED"
  )
}

// ============================================================================
// Main Gate Functions
// ============================================================================

/**
 * V1: implementation-team is pre-condition, not replacement, for final verification
 *
 * Determine if the pipeline can proceed to final verification.
 *
 * Logic:
 * - Non-terminal states: cannot proceed (pipeline still in progress)
 * - Pass states (TERMINAL_PASS, TERMINAL_ESCALATED_PASS): can proceed but requires final verification
 * - Fail states: cannot proceed with descriptive failure reason
 * - Cancelled: cannot proceed
 */
export function canProceedToFinalVerification(runState: RunState): VerificationGateResult {
  const { state } = runState

  // Non-terminal states: pipeline still in progress
  if (!isTerminalState(state)) {
    return {
      canProceed: false,
      requiresFinalVerification: false,
      terminalState: state,
      reason: "Pipeline still in progress",
    }
  }

  // Pass states: can proceed but requires final verification (precondition, not replacement)
  if (isImplementationTeamPass(state)) {
    return {
      canProceed: true,
      requiresFinalVerification: true,
      terminalState: state,
      reason: "Implementation team passed, proceed to final verification",
    }
  }

  // Fail states: cannot proceed
  if (state === "TERMINAL_FAIL_BLOCKED") {
    return {
      canProceed: false,
      requiresFinalVerification: false,
      terminalState: state,
      reason: "Pipeline failed with unresolved blockers",
    }
  }

  if (state === "TERMINAL_FAIL_NONCONVERGENT") {
    return {
      canProceed: false,
      requiresFinalVerification: false,
      terminalState: state,
      reason: "Pipeline failed to converge after two rounds",
    }
  }

  if (state === "TERMINAL_ESCALATED_FAIL") {
    return {
      canProceed: false,
      requiresFinalVerification: false,
      terminalState: state,
      reason: "Pipeline failed after escalation judge review",
    }
  }

  // Cancelled state
  if (state === "TERMINAL_CANCELLED") {
    return {
      canProceed: false,
      requiresFinalVerification: false,
      terminalState: state,
      reason: "Pipeline was cancelled",
    }
  }

  // Should not reach here - all terminal states handled above
  // This is a defensive fallback
  return {
    canProceed: false,
    requiresFinalVerification: false,
    terminalState: state,
    reason: `Unknown terminal state: ${state}`,
  }
}

/**
 * Get the reason why verification is blocked, or null if can proceed.
 * This is a convenience wrapper around canProceedToFinalVerification.
 */
export function getVerificationBlockingReason(runState: RunState): string | null {
  const result = canProceedToFinalVerification(runState)
  return result.canProceed ? null : result.reason
}

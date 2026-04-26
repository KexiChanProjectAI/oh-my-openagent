/**
 * Implementation Team State Machine
 *
 * Canonical state machine encoding the exact run lifecycle for the
 * implementation team pipeline. Manages rounds, reviews, escalation,
 * and terminal outcomes.
 */

import type { EscalationJudgeVerdict } from "./schemas"

// ============================================================================
// Pipeline States
// ============================================================================

export type PipelineState =
  | "IDLE"
  | "IMPLEMENT_ROUND_1"
  | "REVIEW_ROUND_1"
  | "AGGREGATE_ROUND_1"
  | "IMPLEMENT_ROUND_2"
  | "REVIEW_ROUND_2"
  | "AGGREGATE_ROUND_2"
  | "CONVERGENCE_CHECK"
  | "ESCALATION_JUDGE"
  | "IMPLEMENT_ESCALATION_FIX"
  | "FINAL_VERIFICATION_REVIEW"
  | "TERMINAL_PASS"
  | "TERMINAL_FAIL_BLOCKED"
  | "TERMINAL_FAIL_NONCONVERGENT"
  | "TERMINAL_ESCALATED_PASS"
  | "TERMINAL_ESCALATED_FAIL"
  | "TERMINAL_CANCELLED"

// ============================================================================
// Run State
// ============================================================================

export interface RoundRecord {
  round: number
  implementState: PipelineState
  reviewState: PipelineState
  aggregateState: PipelineState
  pass: boolean
  timestamp: string
}

export interface RunState {
  runId: string
  state: PipelineState
  round: number // 0, 1, 2
  startedAt: string // ISO
  lastTransitionedAt: string // ISO
  executorSessionId?: string
  reviewerSessionIds: Record<string, string[]> // role -> [sessionIds]
  judgeSessionId?: string
  escalationVerdict?: EscalationJudgeVerdict
  terminalOutcome?: string
  roundHistory: RoundRecord[]
}

// ============================================================================
// Terminal States
// ============================================================================

const TERMINAL_STATES: Set<PipelineState> = new Set([
  "TERMINAL_PASS",
  "TERMINAL_FAIL_BLOCKED",
  "TERMINAL_FAIL_NONCONVERGENT",
  "TERMINAL_ESCALATED_PASS",
  "TERMINAL_ESCALATED_FAIL",
  "TERMINAL_CANCELLED",
])

// ============================================================================
// Valid Transitions Map
// ============================================================================

const VALID_TRANSITIONS: Record<PipelineState, PipelineState[]> = {
  IDLE: ["IMPLEMENT_ROUND_1"],
  IMPLEMENT_ROUND_1: ["REVIEW_ROUND_1"],
  REVIEW_ROUND_1: ["AGGREGATE_ROUND_1"],
  AGGREGATE_ROUND_1: ["TERMINAL_PASS", "IMPLEMENT_ROUND_2"],
  IMPLEMENT_ROUND_2: ["REVIEW_ROUND_2"],
  REVIEW_ROUND_2: ["AGGREGATE_ROUND_2"],
  AGGREGATE_ROUND_2: ["TERMINAL_PASS", "CONVERGENCE_CHECK"],
  CONVERGENCE_CHECK: ["TERMINAL_PASS", "ESCALATION_JUDGE"],
  ESCALATION_JUDGE: ["TERMINAL_ESCALATED_PASS", "TERMINAL_ESCALATED_FAIL", "IMPLEMENT_ESCALATION_FIX"],
  IMPLEMENT_ESCALATION_FIX: ["FINAL_VERIFICATION_REVIEW"],
  FINAL_VERIFICATION_REVIEW: ["TERMINAL_ESCALATED_PASS", "TERMINAL_ESCALATED_FAIL"],
  TERMINAL_PASS: [],
  TERMINAL_FAIL_BLOCKED: [],
  TERMINAL_FAIL_NONCONVERGENT: [],
  TERMINAL_ESCALATED_PASS: [],
  TERMINAL_ESCALATED_FAIL: [],
  TERMINAL_CANCELLED: [],
}

// ============================================================================
// Transition Functions
// ============================================================================

/**
 * Check if a transition from one state to another is valid
 */
export function isValidTransition(from: PipelineState, to: PipelineState): boolean {
  // Cancellation allowed from any non-terminal state
  if (to === "TERMINAL_CANCELLED" && !isTerminalState(from)) {
    return true
  }
  const allowed = VALID_TRANSITIONS[from]
  return allowed.includes(to)
}

/**
 * Check if a state is terminal (no outgoing transitions)
 */
export function isTerminalState(state: PipelineState): boolean {
  return TERMINAL_STATES.has(state)
}

/**
 * Get all allowed transitions from a given state
 */
export function getAllowedTransitions(state: PipelineState): PipelineState[] {
  const base = VALID_TRANSITIONS[state] ?? []
  // Cancellation is always allowed from non-terminal states
  if (!isTerminalState(state) && !base.includes("TERMINAL_CANCELLED")) {
    return [...base, "TERMINAL_CANCELLED"]
  }
  return base
}

/**
 * Transition the run to a new state. Returns a NEW RunState (immutable).
 * Throws if the transition is invalid.
 */
export function transition(current: RunState, next: PipelineState): RunState {
  if (!isValidTransition(current.state, next)) {
    throw new Error(
      `Invalid transition from '${current.state}' to '${next}'. ` +
        `Allowed transitions: [${getAllowedTransitions(current.state).join(", ") || "none"}]`,
    )
  }

  // Determine the new round number
  let newRound = current.round
  if (next === "IMPLEMENT_ROUND_1") {
    newRound = 1
  } else if (next === "IMPLEMENT_ROUND_2") {
    newRound = 2
  }

  const now = new Date().toISOString()

  return {
    ...current,
    state: next,
    round: newRound,
    lastTransitionedAt: now,
  }
}

/**
 * Start a new run from IDLE state
 */
export function startRun(runId: string): RunState {
  const now = new Date().toISOString()
  return {
    runId,
    state: "IDLE",
    round: 0,
    startedAt: now,
    lastTransitionedAt: now,
    reviewerSessionIds: {},
    roundHistory: [],
  }
}

/**
 * Generate an idempotent run identifier based on context
 */
export function generateRunId(context: {
  planName: string
  sessionId: string
  attemptNumber?: number
}): string {
  const timestamp = new Date().toISOString().split("T")[0]
  const attempt = context.attemptNumber ?? 1
  // Idempotent format: {planName}-{sessionIdshort}-{date}-{attempt}
  const sessionShort = context.sessionId.slice(0, 8)
  return `${context.planName}-${sessionShort}-${timestamp}-r${attempt}`
}

/**
 * Record a round in history
 */
export function recordRound(current: RunState, record: Omit<RoundRecord, "round">): RunState {
  const roundRecord: RoundRecord = {
    round: current.round,
    ...record,
  }

  return {
    ...current,
    roundHistory: [...current.roundHistory, roundRecord],
  }
}

/**
 * Check if escalation is allowed (only after 2 failed ordinary rounds)
 */
export function canEscalate(current: RunState): boolean {
  // Judge can only run after two failed ordinary rounds
  if (current.round < 2) {
    return false
  }
  // Can only escalate from CONVERGENCE_CHECK
  return current.state === "CONVERGENCE_CHECK"
}

/**
 * Check if the run has failed after two ordinary rounds but before escalation
 */
export function hasTwoFailedOrdinaryRounds(current: RunState): boolean {
  // After AGGREGATE_ROUND_2, check if both rounds failed
  if (current.round !== 2) {
    return false
  }
  // Check round history for two failures
  const failures = current.roundHistory.filter((r) => !r.pass)
  return failures.length >= 2
}

/**
 * Get the current phase description for debugging/logging
 */
export function getPhaseDescription(state: PipelineState): string {
  const descriptions: Record<PipelineState, string> = {
    IDLE: "Not started",
    IMPLEMENT_ROUND_1: "First executor run",
    REVIEW_ROUND_1: "First review swarm",
    AGGREGATE_ROUND_1: "First aggregation",
    IMPLEMENT_ROUND_2: "Second executor run (with findings)",
    REVIEW_ROUND_2: "Second review swarm",
    AGGREGATE_ROUND_2: "Second aggregation",
    CONVERGENCE_CHECK: "Checking convergence",
    ESCALATION_JUDGE: "Escalation judge running",
    IMPLEMENT_ESCALATION_FIX: "Post-judge mandatory fix",
    FINAL_VERIFICATION_REVIEW: "Final verification review",
    TERMINAL_PASS: "Pipeline passed",
    TERMINAL_FAIL_BLOCKED: "Failed with unresolved blockers",
    TERMINAL_FAIL_NONCONVERGENT: "Failed to converge",
    TERMINAL_ESCALATED_PASS: "Passed after escalation",
    TERMINAL_ESCALATED_FAIL: "Failed after escalation",
    TERMINAL_CANCELLED: "Cancelled externally",
  }
  return descriptions[state] ?? "Unknown"
}

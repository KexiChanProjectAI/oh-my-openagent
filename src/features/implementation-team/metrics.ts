/**
 * Implementation Team Metrics and Logging Instrumentation
 *
 * Provides structured metrics collection and logging for implementation-team
 * pipeline runs. Tracks run count, escalation triggers, malformed verdicts,
 * unresolved blockers by round, reviewer fan-out, and terminal outcomes.
 */

import { log } from "../../shared/logger"
import { createLogPayload } from "./evidence"
import type { PipelineState } from "./state-machine"

// ============================================================================
// Event Types
// ============================================================================

/**
 * Lifecycle events emitted during an impl-team run
 */
export type RunEvent =
  | "run_started"
  | "round_started"
  | "executor_launched"
  | "reviewers_launched"
  | "role_aggregated"
  | "global_aggregated"
  | "escalation_triggered"
  | "run_terminated"

// ============================================================================
// Terminal Outcome Types
// ============================================================================

export type TerminalOutcome =
  | "TERMINAL_PASS"
  | "TERMINAL_FAIL_BLOCKED"
  | "TERMINAL_FAIL_NONCONVERGENT"
  | "TERMINAL_ESCALATED_PASS"
  | "TERMINAL_ESCALATED_FAIL"
  | "TERMINAL_CANCELLED"

// ============================================================================
// Metrics Collector
// ============================================================================

export interface MetricsSnapshot {
  totalRuns: number
  escalationTriggerCount: number
  malformedVerdictCount: number
  unresolvedBlockerCountByRound: Record<number, number>
  reviewerFanOut: Record<string, number>
  terminalOutcomeDistribution: Record<TerminalOutcome, number>
}

export class MetricsCollector {
  totalRuns: number = 0
  escalationTriggerCount: number = 0
  malformedVerdictCount: number = 0
  unresolvedBlockerCountByRound: Record<number, number> = {}
  reviewerFanOut: Record<string, number> = {}
  terminalOutcomeDistribution: Record<TerminalOutcome, number> = {
    TERMINAL_PASS: 0,
    TERMINAL_FAIL_BLOCKED: 0,
    TERMINAL_FAIL_NONCONVERGENT: 0,
    TERMINAL_ESCALATED_PASS: 0,
    TERMINAL_ESCALATED_FAIL: 0,
    TERMINAL_CANCELLED: 0,
  }

  /**
   * Increment the total run counter
   */
  recordRun(): void {
    this.totalRuns++
  }

  /**
   * Record an escalation trigger event
   */
  recordEscalation(): void {
    this.escalationTriggerCount++
  }

  /**
   * Record a malformed verdict
   */
  recordMalformedVerdict(): void {
    this.malformedVerdictCount++
  }

  /**
   * Record unresolved blockers for a specific round
   */
  recordUnresolvedBlockers(round: number, count: number): void {
    this.unresolvedBlockerCountByRound[round] = (this.unresolvedBlockerCountByRound[round] ?? 0) + count
  }

  /**
   * Record a reviewer fan-out event for a role
   */
  recordReviewerFanOut(role: string, count: number): void {
    this.reviewerFanOut[role] = (this.reviewerFanOut[role] ?? 0) + count
  }

  /**
   * Record a terminal outcome
   */
  recordTerminalOutcome(outcome: TerminalOutcome): void {
    this.terminalOutcomeDistribution[outcome]++
  }

  /**
   * Get a snapshot of current metrics
   */
  snapshot(): MetricsSnapshot {
    return {
      totalRuns: this.totalRuns,
      escalationTriggerCount: this.escalationTriggerCount,
      malformedVerdictCount: this.malformedVerdictCount,
      unresolvedBlockerCountByRound: { ...this.unresolvedBlockerCountByRound },
      reviewerFanOut: { ...this.reviewerFanOut },
      terminalOutcomeDistribution: { ...this.terminalOutcomeDistribution },
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new MetricsCollector instance
 */
export function createMetricsCollector(): MetricsCollector {
  return new MetricsCollector()
}

// ============================================================================
// Run Logger
// ============================================================================

/**
 * Log a lifecycle event for an impl-team run using structured logging.
 * Uses the shared logger and emits LogPayload with run_id, round, state,
 * event, and timestamp for correlation.
 */
export function runLogger(
  runId: string,
  round: number,
  state: PipelineState | "IDLE",
  event: RunEvent,
  data?: Record<string, unknown>,
): void {
  const payload = createLogPayload(runId, round, state, event, data)
  log(`[impl-team] ${event}`, payload)
}

/**
 * Create a bound run logger for a specific run
 */
export function createRunLogger(runId: string) {
  return (round: number, state: PipelineState | "IDLE", event: RunEvent, data?: Record<string, unknown>) => {
    runLogger(runId, round, state, event, data)
  }
}

// ============================================================================
// Terminal State Helpers
// ============================================================================

/**
 * Check if a state is a terminal outcome state
 */
export function isTerminalOutcome(state: PipelineState): state is TerminalOutcome {
  const terminalOutcomes: TerminalOutcome[] = [
    "TERMINAL_PASS",
    "TERMINAL_FAIL_BLOCKED",
    "TERMINAL_FAIL_NONCONVERGENT",
    "TERMINAL_ESCALATED_PASS",
    "TERMINAL_ESCALATED_FAIL",
    "TERMINAL_CANCELLED",
  ]
  return terminalOutcomes.includes(state as TerminalOutcome)
}

/**
 * Map a terminal state to its outcome type
 */
export function terminalStateToOutcome(state: TerminalOutcome): TerminalOutcome {
  return state
}

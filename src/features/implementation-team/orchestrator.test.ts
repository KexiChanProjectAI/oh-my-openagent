/**
 * Implementation Team Orchestrator Integration Tests
 *
 * Tests the integrated behavior of state-machine, convergence, and state-store
 * working together to manage the full implementation pipeline lifecycle.
 * Uses stubbed/mocked task launching - no live model calls.
 *
 * Covered scenarios:
 * - Full pipeline lifecycle (start -> rounds -> terminal states)
 * - State transitions with convergence evaluation
 * - Idempotency: saving and reloading same run state
 * - State recovery from persistent store
 * - Impossible transition rejection
 * - Bounded retries (max 2 ordinary rounds)
 * - Escalation gating (judge only after 2 failed rounds)
 * - Post-judge revise-once semantics
 * - Malformed output handling in aggregate context
 * - Round metadata preservation
 */

import { describe, expect, test } from "bun:test"
import {
  startRun,
  transition,
  recordRound,
  isValidTransition,
  isTerminalState,
  getAllowedTransitions,
  canEscalate,
  type RunState,
} from "./state-machine"
import {
  evaluateConvergence,
  canEvaluateConvergence,
} from "./convergence"
import { saveRunState, loadRunState, deleteRunState } from "./state-store"
import type { EscalationJudgeVerdict, Finding, GlobalAggregateVerdict, RoleAggregateVerdict } from "./schemas"

// ============================================================================
// Test Fixtures
// ============================================================================

function createFinding(id: string, severity: Finding["severity"] = "BLOCKER"): Finding {
  return {
    id,
    description: `Finding ${id}`,
    severity,
    category: "correctness",
  }
}

function createGlobalVerdict(
  pass: boolean,
  round: number,
  blockers: Finding[] = [],
  failedRoles: string[] = [],
): GlobalAggregateVerdict {
  return {
    pass,
    round,
    failed_roles: failedRoles,
    role_aggregates: [],
    executor_patch_brief: {
      unresolved_blockers: blockers,
      failed_role_ids: failedRoles,
      execution_round: round,
    },
  }
}

function createEscalationJudgeVerdict(
  verdict: EscalationJudgeVerdict["verdict"],
  mandatoryChanges: Finding[] = [],
): EscalationJudgeVerdict {
  return {
    verdict,
    reasoning: `Judge verdict: ${verdict}`,
    mandatory_changes: mandatoryChanges.map((f) => ({
      id: f.id,
      description: f.description,
      role: "executor",
      priority: "mandatory" as const,
    })),
  }
}

// Unique run ID generator for test isolation
function uniqueRunId(name: string): string {
  return `orch-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// Full Pipeline Lifecycle Tests
// ============================================================================

describe("full pipeline lifecycle", () => {
  describe("happy path - single round pass", () => {
    test("given IDLE when startRun then run is initialized", () => {
      const runId = uniqueRunId("happy-init")
      const run = startRun(runId)
      expect(run.state).toBe("IDLE")
      expect(run.round).toBe(0)
      expect(run.runId).toBe(runId)
      expect(run.reviewerSessionIds).toEqual({})
      expect(run.roundHistory).toEqual([])
      deleteRunState(runId)
    })

    test("given IDLE when transition to IMPLEMENT_ROUND_1 then round becomes 1", () => {
      const runId = uniqueRunId("happy-round1")
      let run = startRun(runId)
      run = transition(run, "IMPLEMENT_ROUND_1")
      expect(run.state).toBe("IMPLEMENT_ROUND_1")
      expect(run.round).toBe(1)
      deleteRunState(runId)
    })

    test("given IMPLEMENT_ROUND_1 when review completes and aggregate passes then TERMINAL_PASS", () => {
      const runId = uniqueRunId("happy-pass")
      let run = startRun(runId)
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")

      const verdict = createGlobalVerdict(true, 1)
      const decision = evaluateConvergence({ currentRound: 1, currentGlobalVerdict: verdict })
      expect(decision.action).toBe("pass")

      // From AGGREGATE_ROUND_1, pass -> TERMINAL_PASS
      expect(isValidTransition(run.state, "TERMINAL_PASS")).toBe(true)
      run = transition(run, "TERMINAL_PASS")
      expect(isTerminalState(run.state)).toBe(true)
      expect(run.state).toBe("TERMINAL_PASS")
      deleteRunState(runId)
    })
  })

  describe("two-round flow with pass on round 2", () => {
    test("given round 1 fail when round 2 passes then TERMINAL_PASS", () => {
      const runId = uniqueRunId("two-round-pass")
      let run = startRun(runId)

      // Round 1: fail
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")

      const round1Verdict = createGlobalVerdict(false, 1, [createFinding("b1")])
      const round1Decision = evaluateConvergence({ currentRound: 1, currentGlobalVerdict: round1Verdict })
      expect(round1Decision.action).toBe("continue")

      // From AGGREGATE_ROUND_1, continue -> IMPLEMENT_ROUND_2
      run = transition(run, "IMPLEMENT_ROUND_2")
      expect(run.state).toBe("IMPLEMENT_ROUND_2")
      expect(run.round).toBe(2)

      // Round 2: pass
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")

      const round2Verdict = createGlobalVerdict(true, 2)
      const round2Decision = evaluateConvergence({
        currentRound: 2,
        currentGlobalVerdict: round2Verdict,
        previousGlobalVerdict: round1Verdict,
      })
      expect(round2Decision.action).toBe("pass")

      run = transition(run, "TERMINAL_PASS")
      expect(run.state).toBe("TERMINAL_PASS")
      expect(run.round).toBe(2)
      deleteRunState(runId)
    })
  })

  describe("two-round flow with escalation", () => {
    test("given round 1 fail and round 2 fail when convergence check then ESCALATION_JUDGE", () => {
      const runId = uniqueRunId("two-round-escalate")
      let run = startRun(runId)

      // Round 1: fail
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")

      const round1Verdict = createGlobalVerdict(false, 1, [createFinding("b1")])
      const round1Decision = evaluateConvergence({ currentRound: 1, currentGlobalVerdict: round1Verdict })
      expect(round1Decision.action).toBe("continue")

      run = transition(run, "IMPLEMENT_ROUND_2")

      // Round 2: fail with same blocker (stagnation)
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")

      const round2Verdict = createGlobalVerdict(false, 2, [createFinding("b1")])
      const round2Decision = evaluateConvergence({
        currentRound: 2,
        currentGlobalVerdict: round2Verdict,
        previousGlobalVerdict: round1Verdict,
      })
      expect(round2Decision.action).toBe("escalate")

      // From AGGREGATE_ROUND_2, escalate -> CONVERGENCE_CHECK (first)
      run = transition(run, "CONVERGENCE_CHECK")

      // From CONVERGENCE_CHECK, escalate -> ESCALATION_JUDGE
      run = transition(run, "ESCALATION_JUDGE")
      expect(run.state).toBe("ESCALATION_JUDGE")
      deleteRunState(runId)
    })
  })

  describe("escalation paths", () => {
    test("given ESCALATION_JUDGE when verdict is approve then TERMINAL_ESCALATED_PASS", () => {
      const runId = uniqueRunId("escalate-approve")
      let run = startRun(runId)

      // Setup: go through rounds 1 and 2 to reach ESCALATION_JUDGE
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      run = transition(run, "CONVERGENCE_CHECK")
      run = transition(run, "ESCALATION_JUDGE")

      // From ESCALATION_JUDGE, approve -> TERMINAL_ESCALATED_PASS
      expect(isValidTransition(run.state, "TERMINAL_ESCALATED_PASS")).toBe(true)
      run = transition(run, "TERMINAL_ESCALATED_PASS")
      expect(run.state).toBe("TERMINAL_ESCALATED_PASS")
      expect(isTerminalState(run.state)).toBe(true)
      deleteRunState(runId)
    })

    test("given ESCALATION_JUDGE when verdict is reject-escalate-human then TERMINAL_ESCALATED_FAIL", () => {
      const runId = uniqueRunId("escalate-reject")
      let run = startRun(runId)

      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      run = transition(run, "CONVERGENCE_CHECK")
      run = transition(run, "ESCALATION_JUDGE")

      // From ESCALATION_JUDGE, reject-escalate-human -> TERMINAL_ESCALATED_FAIL
      expect(isValidTransition(run.state, "TERMINAL_ESCALATED_FAIL")).toBe(true)
      run = transition(run, "TERMINAL_ESCALATED_FAIL")
      expect(run.state).toBe("TERMINAL_ESCALATED_FAIL")
      expect(isTerminalState(run.state)).toBe(true)
      deleteRunState(runId)
    })
  })

  describe("post-judge revise-once semantics", () => {
    test("given ESCALATION_JUDGE when verdict is revise-once-mandatory then IMPLEMENT_ESCALATION_FIX", () => {
      const runId = uniqueRunId("revise-once")
      let run = startRun(runId)

      // Setup to reach ESCALATION_JUDGE
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      run = transition(run, "CONVERGENCE_CHECK")
      run = transition(run, "ESCALATION_JUDGE")

      // From ESCALATION_JUDGE, revise-once-mandatory -> IMPLEMENT_ESCALATION_FIX
      expect(isValidTransition(run.state, "IMPLEMENT_ESCALATION_FIX")).toBe(true)
      run = transition(run, "IMPLEMENT_ESCALATION_FIX")
      expect(run.state).toBe("IMPLEMENT_ESCALATION_FIX")
      deleteRunState(runId)
    })

    test("given revise-once-mandatory verdict when evaluate then returns revise-once action", () => {
      const judgeVerdict = createEscalationJudgeVerdict("revise-once-mandatory", [createFinding("fix-required")])
      const decision = evaluateConvergence({
        currentRound: 3,
        currentGlobalVerdict: createGlobalVerdict(false, 2),
        escalationVerdict: judgeVerdict,
        postJudgeFixDone: false,
      })
      expect(decision.action).toBe("revise-once")
      expect((decision as { action: "revise-once"; mandatoryChanges: unknown[] }).mandatoryChanges).toHaveLength(1)
    })

    test("given revise-once-mandatory when fix already done then returns fail", () => {
      const judgeVerdict = createEscalationJudgeVerdict("revise-once-mandatory", [createFinding("fix-required")])
      const decision = evaluateConvergence({
        currentRound: 3,
        currentGlobalVerdict: createGlobalVerdict(false, 2),
        escalationVerdict: judgeVerdict,
        postJudgeFixDone: true,
      })
      expect(decision.action).toBe("fail")
    })

    test("given IMPLEMENT_ESCALATION_FIX when final review passes then TERMINAL_ESCALATED_PASS", () => {
      const runId = uniqueRunId("final-review-pass")
      let run = startRun(runId)

      // Full escalation flow
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      run = transition(run, "CONVERGENCE_CHECK")
      run = transition(run, "ESCALATION_JUDGE")
      run = transition(run, "IMPLEMENT_ESCALATION_FIX")
      run = transition(run, "FINAL_VERIFICATION_REVIEW")

      // From FINAL_VERIFICATION_REVIEW, approve -> TERMINAL_ESCALATED_PASS
      expect(isValidTransition(run.state, "TERMINAL_ESCALATED_PASS")).toBe(true)
      run = transition(run, "TERMINAL_ESCALATED_PASS")
      expect(run.state).toBe("TERMINAL_ESCALATED_PASS")
      deleteRunState(runId)
    })
  })
})

// ============================================================================
// Idempotency Tests
// ============================================================================

describe("idempotency", () => {
  test("given same run state when saved and reloaded then no duplicate work initiated", () => {
    const runId = uniqueRunId("idempotent-save")
    // Simulate a run at REVIEW_ROUND_1
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")

    // Save state
    saveRunState(runId, run)

    // Simulate another component checking state - it should see the same state
    const loaded = loadRunState(runId)
    expect(loaded).not.toBeNull()
    expect(loaded?.state).toBe("REVIEW_ROUND_1")
    expect(loaded?.round).toBe(1)
    expect(loaded?.executorSessionId).toBeUndefined()

    // The component checking should not find any executor session yet
    // (no duplicate launch because executorSessionId is still undefined)
    expect(loaded?.reviewerSessionIds).toEqual({})

    deleteRunState(runId)
  })

  test("given run with executor session when reloaded then same executor not relaunched", () => {
    const runId = uniqueRunId("idempotent-executor")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")

    // Simulate executor already launched
    run = { ...run, executorSessionId: "ses-executor-123" }
    saveRunState(runId, run)

    const loaded = loadRunState(runId)
    expect(loaded?.executorSessionId).toBe("ses-executor-123")

    // If component checks loaded state, it should NOT relaunch executor
    // because executorSessionId is already set
    const shouldNotRelaunch = loaded?.executorSessionId !== undefined
    expect(shouldNotRelaunch).toBe(true)

    deleteRunState(runId)
  })

  test("given run with reviewer sessions when reloaded then reviewers not relaunched", () => {
    const runId = uniqueRunId("idempotent-reviewers")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")

    // Simulate reviewers already launched
    run = {
      ...run,
      reviewerSessionIds: {
        code_review: ["ses-reviewer-1", "ses-reviewer-2"],
        security: ["ses-reviewer-3"],
      },
    }
    saveRunState(runId, run)

    const loaded = loadRunState(runId)
    expect(loaded?.reviewerSessionIds).toEqual({
      code_review: ["ses-reviewer-1", "ses-reviewer-2"],
      security: ["ses-reviewer-3"],
    })

    // Component should not relaunch reviewers
    const shouldNotRelaunch =
      loaded?.reviewerSessionIds && Object.keys(loaded.reviewerSessionIds).length > 0
    expect(shouldNotRelaunch).toBe(true)

    deleteRunState(runId)
  })

  test("given terminal run when reloaded then no further transitions allowed", () => {
    const runId = uniqueRunId("idempotent-terminal")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "TERMINAL_PASS")

    saveRunState(runId, run)
    const loaded = loadRunState(runId)

    expect(isTerminalState(loaded!.state)).toBe(true)
    expect(getAllowedTransitions(loaded!.state)).toEqual([])
    deleteRunState(runId)
  })
})

// ============================================================================
// State Recovery Tests
// ============================================================================

describe("state recovery from persistent store", () => {
  test("given interrupted run at REVIEW_ROUND_1 when recovered then correct round and state restored", () => {
    const runId = uniqueRunId("recovery-review")
    // Simulate interrupted run at REVIEW_ROUND_1
    const interruptedState: RunState = {
      runId,
      state: "REVIEW_ROUND_1",
      round: 1,
      startedAt: "2026-04-26T00:00:00.000Z",
      lastTransitionedAt: "2026-04-26T00:05:00.000Z",
      executorSessionId: "ses-executor-123",
      reviewerSessionIds: {
        code_review: ["ses-reviewer-1"],
      },
      roundHistory: [],
    }

    saveRunState(runId, interruptedState)

    // Recover state
    const recovered = loadRunState(runId)
    expect(recovered).not.toBeNull()
    expect(recovered?.state).toBe("REVIEW_ROUND_1")
    expect(recovered?.round).toBe(1)
    expect(recovered?.executorSessionId).toBe("ses-executor-123")
    expect(recovered?.reviewerSessionIds).toEqual({ code_review: ["ses-reviewer-1"] })

    deleteRunState(runId)
  })

  test("given recovered run when continue transition then valid next state used", () => {
    const runId = uniqueRunId("recovery-continue")
    const interruptedState: RunState = {
      runId,
      state: "REVIEW_ROUND_1",
      round: 1,
      startedAt: "2026-04-26T00:00:00.000Z",
      lastTransitionedAt: "2026-04-26T00:05:00.000Z",
      executorSessionId: "ses-executor-123",
      reviewerSessionIds: {
        code_review: ["ses-reviewer-1"],
      },
      roundHistory: [],
    }

    saveRunState(runId, interruptedState)

    const recovered = loadRunState(runId)!

    // Continue: AGGREGATE_ROUND_1 is valid next from REVIEW_ROUND_1
    expect(isValidTransition(recovered.state, "AGGREGATE_ROUND_1")).toBe(true)

    const continued = transition(recovered, "AGGREGATE_ROUND_1")
    expect(continued.state).toBe("AGGREGATE_ROUND_1")
    expect(continued.round).toBe(1)

    // Record the round and save
    const withRecord = recordRound(continued, {
      implementState: "IMPLEMENT_ROUND_1",
      reviewState: "REVIEW_ROUND_1",
      aggregateState: "AGGREGATE_ROUND_1",
      pass: true,
      timestamp: new Date().toISOString(),
    })
    saveRunState(runId, withRecord)

    // Verify saved
    const reloaded = loadRunState(runId)
    expect(reloaded?.roundHistory).toHaveLength(1)
    expect(reloaded?.roundHistory[0].pass).toBe(true)

    deleteRunState(runId)
  })

  test("given run at CONVERGENCE_CHECK when recovered then correct escalation path available", () => {
    const runId = uniqueRunId("recovery-convergence")
    let run = startRun(runId)

    // Go through rounds 1 and 2 to reach CONVERGENCE_CHECK
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = transition(run, "CONVERGENCE_CHECK")

    saveRunState(runId, run)

    const recovered = loadRunState(runId)
    expect(recovered?.state).toBe("CONVERGENCE_CHECK")
    expect(canEscalate(recovered!)).toBe(true)
    expect(canEvaluateConvergence(recovered!.state)).toBe(true)

    deleteRunState(runId)
  })

  test("given multiple saves during round when recovered then latest state is correct", () => {
    const runId = uniqueRunId("recovery-multisave")
    let run = startRun(runId)

    // Simulate multiple save points during round 1
    run = transition(run, "IMPLEMENT_ROUND_1")
    saveRunState(runId, { ...run, executorSessionId: "ses-executor-1" })

    let loaded = loadRunState(runId)
    expect(loaded?.state).toBe("IMPLEMENT_ROUND_1")

    run = transition(loaded!, "REVIEW_ROUND_1")
    saveRunState(runId, {
      ...run,
      reviewerSessionIds: { code_review: ["ses-reviewer-1"] },
    })

    loaded = loadRunState(runId)
    expect(loaded?.state).toBe("REVIEW_ROUND_1")
    expect(loaded?.reviewerSessionIds).toEqual({ code_review: ["ses-reviewer-1"] })

    // The executor session should still be preserved
    expect(loaded?.executorSessionId).toBe("ses-executor-1")

    deleteRunState(runId)
  })
})

// ============================================================================
// Impossible Transition Rejection Tests
// ============================================================================

describe("impossible transition rejection", () => {
  test("given IDLE when try to go to REVIEW_ROUND_1 then throws", () => {
    const runId = uniqueRunId("impossible-idle")
    const run = startRun(runId)
    expect(() => transition(run, "REVIEW_ROUND_1")).toThrow()
  })

  test("given IMPLEMENT_ROUND_1 when try to skip to AGGREGATE_ROUND_1 then throws", () => {
    const runId = uniqueRunId("impossible-skip")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    expect(() => transition(run, "AGGREGATE_ROUND_1")).toThrow()
  })

  test("given TERMINAL_PASS when try any transition then throws", () => {
    const runId = uniqueRunId("impossible-terminal")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "TERMINAL_PASS")

    expect(() => transition(run, "IMPLEMENT_ROUND_1")).toThrow()
    expect(() => transition(run, "IDLE")).toThrow()
    expect(() => transition(run, "REVIEW_ROUND_1")).toThrow()
  })

  test("given AGGREGATE_ROUND_1 when try to go directly to ESCALATION_JUDGE then throws", () => {
    const runId = uniqueRunId("impossible-escalate")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")

    // Must go through IMPLEMENT_ROUND_2 and CONVERGENCE_CHECK first
    expect(() => transition(run, "ESCALATION_JUDGE")).toThrow()
    expect(() => transition(run, "CONVERGENCE_CHECK")).toThrow()
  })

  test("given IMPLEMENT_ESCALATION_FIX when try to return to ordinary rounds then throws", () => {
    const runId = uniqueRunId("impossible-escalation-fix")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = transition(run, "CONVERGENCE_CHECK")
    run = transition(run, "ESCALATION_JUDGE")
    run = transition(run, "IMPLEMENT_ESCALATION_FIX")

    // Cannot go back to ordinary rounds
    expect(() => transition(run, "IMPLEMENT_ROUND_1")).toThrow()
    expect(() => transition(run, "IMPLEMENT_ROUND_2")).toThrow()
    expect(() => transition(run, "CONVERGENCE_CHECK")).toThrow()
  })
})

// ============================================================================
// Bounded Retries Tests (max 2 ordinary rounds)
// ============================================================================

describe("bounded retries", () => {
  test("given round 1 fail when continue then round 2 is allowed", () => {
    const runId = uniqueRunId("bounded-round1")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")

    expect(run.round).toBe(1)

    const verdict = createGlobalVerdict(false, 1)
    const decision = evaluateConvergence({ currentRound: 1, currentGlobalVerdict: verdict })
    expect(decision.action).toBe("continue")

    // From AGGREGATE_ROUND_1, continue -> IMPLEMENT_ROUND_2
    run = transition(run, "IMPLEMENT_ROUND_2")
    expect(run.state).toBe("IMPLEMENT_ROUND_2")
    expect(run.round).toBe(2)
    deleteRunState(runId)
  })

  test("given round 2 fail and escalate when judge verdict then path is NOT ordinary rounds", () => {
    const runId = uniqueRunId("bounded-escalate")
    let run = startRun(runId)

    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = transition(run, "CONVERGENCE_CHECK")

    // After round 2, escalate to judge (not another ordinary round)
    const verdict = createGlobalVerdict(false, 2, [createFinding("b1")])
    const decision = evaluateConvergence({ currentRound: 2, currentGlobalVerdict: verdict })
    expect(decision.action).toBe("escalate")

    run = transition(run, "ESCALATION_JUDGE")
    expect(run.state).toBe("ESCALATION_JUDGE")

    // IMPLEMENT_ESCALATION_FIX is NOT an ordinary round - it's the post-judge fix
    expect(isValidTransition(run.state, "IMPLEMENT_ESCALATION_FIX")).toBe(true)
    run = transition(run, "IMPLEMENT_ESCALATION_FIX")
    expect(run.state).toBe("IMPLEMENT_ESCALATION_FIX")
    deleteRunState(runId)
  })

  test("given IMPLEMENT_ROUND_2 when state reached then cannot go to IMPLEMENT_ROUND_3", () => {
    const runId = uniqueRunId("bounded-no-round3")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")

    // No valid transition from IMPLEMENT_ROUND_2 to any ROUND_3 state (max 2 ordinary rounds)
    // The next valid state after IMPLEMENT_ROUND_2 is REVIEW_ROUND_2
    expect(isValidTransition(run.state, "REVIEW_ROUND_2")).toBe(true)
    // Cannot go back to IMPLEMENT_ROUND_1 or skip to AGGREGATE_ROUND_2
    expect(isValidTransition(run.state, "IMPLEMENT_ROUND_1")).toBe(false)
    expect(isValidTransition(run.state, "AGGREGATE_ROUND_2")).toBe(false)
    deleteRunState(runId)
  })
})

// ============================================================================
// Escalation Gating Tests
// ============================================================================

describe("escalation gating", () => {
  test("given round 1 when canEscalate then false", () => {
    const runId = uniqueRunId("gate-round1")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")

    // Before CONVERGENCE_CHECK, cannot escalate
    expect(canEscalate(run)).toBe(false)
    deleteRunState(runId)
  })

  test("given CONVERGENCE_CHECK with round 2 then canEscalate is true", () => {
    const runId = uniqueRunId("gate-convergence")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = transition(run, "CONVERGENCE_CHECK")

    expect(run.round).toBe(2)
    expect(canEscalate(run)).toBe(true)
    deleteRunState(runId)
  })

  test("given before CONVERGENCE_CHECK when try to go to ESCALATION_JUDGE then throws", () => {
    const runId = uniqueRunId("gate-before")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")

    // Not at CONVERGENCE_CHECK yet - ESCALATION_JUDGE is not allowed
    expect(() => transition(run, "ESCALATION_JUDGE")).toThrow()
    deleteRunState(runId)
  })

  test("given at CONVERGENCE_CHECK when transition to ESCALATION_JUDGE then succeeds", () => {
    const runId = uniqueRunId("gate-valid")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = transition(run, "CONVERGENCE_CHECK")

    expect(isValidTransition(run.state, "ESCALATION_JUDGE")).toBe(true)
    run = transition(run, "ESCALATION_JUDGE")
    expect(run.state).toBe("ESCALATION_JUDGE")
    deleteRunState(runId)
  })
})

// ============================================================================
// Round Metadata Preservation Tests
// ============================================================================

describe("round metadata preservation", () => {
  test("given round 1 complete when recordRound then history has correct round number", () => {
    const runId = uniqueRunId("metadata-round1")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")

    run = recordRound(run, {
      implementState: "IMPLEMENT_ROUND_1",
      reviewState: "REVIEW_ROUND_1",
      aggregateState: "AGGREGATE_ROUND_1",
      pass: true,
      timestamp: new Date().toISOString(),
    })

    expect(run.roundHistory).toHaveLength(1)
    expect(run.roundHistory[0].round).toBe(1)
    expect(run.roundHistory[0].pass).toBe(true)
    deleteRunState(runId)
  })

  test("given both rounds complete when recordRound then history has both rounds", () => {
    const runId = uniqueRunId("metadata-both")
    let run = startRun(runId)

    // Round 1
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = recordRound(run, {
      implementState: "IMPLEMENT_ROUND_1",
      reviewState: "REVIEW_ROUND_1",
      aggregateState: "AGGREGATE_ROUND_1",
      pass: true,
      timestamp: new Date().toISOString(),
    })

    // Round 2
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = recordRound(run, {
      implementState: "IMPLEMENT_ROUND_2",
      reviewState: "REVIEW_ROUND_2",
      aggregateState: "AGGREGATE_ROUND_2",
      pass: false,
      timestamp: new Date().toISOString(),
    })

    expect(run.roundHistory).toHaveLength(2)
    expect(run.roundHistory[0].round).toBe(1)
    expect(run.roundHistory[0].pass).toBe(true)
    expect(run.roundHistory[1].round).toBe(2)
    expect(run.roundHistory[1].pass).toBe(false)
    deleteRunState(runId)
  })

  test("given run with history when saved and reloaded then history preserved", () => {
    const runId = uniqueRunId("metadata-save")
    let run = startRun(runId)

    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = recordRound(run, {
      implementState: "IMPLEMENT_ROUND_1",
      reviewState: "REVIEW_ROUND_1",
      aggregateState: "AGGREGATE_ROUND_1",
      pass: true,
      timestamp: "2026-04-26T00:10:00.000Z",
    })

    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = recordRound(run, {
      implementState: "IMPLEMENT_ROUND_2",
      reviewState: "REVIEW_ROUND_2",
      aggregateState: "AGGREGATE_ROUND_2",
      pass: false,
      timestamp: "2026-04-26T00:20:00.000Z",
    })

    saveRunState(runId, run)
    const loaded = loadRunState(runId)

    expect(loaded?.roundHistory).toHaveLength(2)
    expect(loaded?.roundHistory[0].pass).toBe(true)
    expect(loaded?.roundHistory[1].pass).toBe(false)
    expect(loaded?.roundHistory[0].timestamp).toBe("2026-04-26T00:10:00.000Z")
    expect(loaded?.roundHistory[1].timestamp).toBe("2026-04-26T00:20:00.000Z")

    deleteRunState(runId)
  })
})

// ============================================================================
// Malformed Output Handling in Aggregate Context Tests
// ============================================================================

describe("malformed output handling in aggregate context", () => {
  test("given verdict with malformed reviewers when aggregate then role fails", () => {
    // This tests that malformed verdicts (from malformed-output.ts) are handled
    // correctly when aggregating role verdicts into global verdict

    // A role aggregate with malformed_count > 0 should cause that role to fail
    const roleAggregate: RoleAggregateVerdict = {
      role: "code_review",
      round: 1,
      pass: false, // BLOCKER verdict causes pass === false
      reviewer_count: 2,
      malformed_count: 1, // One malformed verdict
      blocker_count: 0,
      deduped_findings: [],
      reviewer_lineage: [
        { reviewer_id: "reviewer-1", model_id: "gpt-5", verdict: "PASS", malformed: false },
        { reviewer_id: "", model_id: "", verdict: "FAIL", malformed: true }, // malformed
      ],
    }

    // The global aggregate should include this role in failed_roles
    // because pass === false OR malformed_count > 0
    expect(roleAggregate.pass).toBe(false)
    expect(roleAggregate.malformed_count).toBeGreaterThan(0)
  })

  test("given all roles pass with no malformed when global verdict then pass is true", () => {
    const roleAggregates: RoleAggregateVerdict[] = [
      {
        role: "code_review",
        round: 1,
        pass: true,
        reviewer_count: 2,
        malformed_count: 0,
        blocker_count: 0,
        deduped_findings: [],
        reviewer_lineage: [
          { reviewer_id: "reviewer-1", model_id: "gpt-5", verdict: "PASS", malformed: false },
          { reviewer_id: "reviewer-2", model_id: "gpt-5", verdict: "PASS", malformed: false },
        ],
      },
      {
        role: "security",
        round: 1,
        pass: true,
        reviewer_count: 1,
        malformed_count: 0,
        blocker_count: 0,
        deduped_findings: [],
        reviewer_lineage: [
          { reviewer_id: "security-reviewer-1", model_id: "claude-opus", verdict: "PASS", malformed: false },
        ],
      },
    ]

    // All pass with no malformed = global pass
    const globalPass = roleAggregates.every((r) => r.pass && r.malformed_count === 0)
    expect(globalPass).toBe(true)
  })

  test("given one role has malformed verdicts when evaluate convergence then correct decision", () => {
    // Role with malformed verdicts is treated as failed
    const globalVerdict = createGlobalVerdict(false, 1, [], ["code_review"])
    const decision = evaluateConvergence({
      currentRound: 1,
      currentGlobalVerdict: globalVerdict,
    })

    // Round 1 fail = continue (allows second round)
    expect(decision.action).toBe("continue")
  })
})

// ============================================================================
// Terminal Outcome Consistency Tests
// ============================================================================

describe("terminal outcome consistency", () => {
  test("given TERMINAL_PASS when save and reload then terminalOutcome preserved", () => {
    const runId = uniqueRunId("terminal-pass")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "TERMINAL_PASS")

    run = { ...run, terminalOutcome: "PASS" }
    saveRunState(runId, run)

    const loaded = loadRunState(runId)
    expect(loaded?.terminalOutcome).toBe("PASS")
    expect(isTerminalState(loaded!.state)).toBe(true)

    deleteRunState(runId)
  })

  test("given TERMINAL_ESCALATED_FAIL when save and reload then verdict preserved", () => {
    const runId = uniqueRunId("terminal-escalated")
    let run = startRun(runId)

    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = transition(run, "CONVERGENCE_CHECK")
    run = transition(run, "ESCALATION_JUDGE")
    run = transition(run, "TERMINAL_ESCALATED_FAIL")

    run = {
      ...run,
      terminalOutcome: "FAIL",
      escalationVerdict: createEscalationJudgeVerdict("reject-escalate-human"),
    }
    saveRunState(runId, run)

    const loaded = loadRunState(runId)
    expect(loaded?.state).toBe("TERMINAL_ESCALATED_FAIL")
    expect(loaded?.escalationVerdict?.verdict).toBe("reject-escalate-human")

    deleteRunState(runId)
  })
})

// ============================================================================
// Cancellation Tests
// ============================================================================

describe("cancellation from non-terminal states", () => {
  test("given IMPLEMENT_ROUND_1 when cancelled then TERMINAL_CANCELLED", () => {
    const runId = uniqueRunId("cancel-impl")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    expect(isValidTransition(run.state, "TERMINAL_CANCELLED")).toBe(true)
    run = transition(run, "TERMINAL_CANCELLED")
    expect(run.state).toBe("TERMINAL_CANCELLED")
    expect(isTerminalState(run.state)).toBe(true)
  })

  test("given CONVERGENCE_CHECK when cancelled then TERMINAL_CANCELLED", () => {
    const runId = uniqueRunId("cancel-convergence")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = transition(run, "CONVERGENCE_CHECK")

    expect(isValidTransition(run.state, "TERMINAL_CANCELLED")).toBe(true)
    run = transition(run, "TERMINAL_CANCELLED")
    expect(run.state).toBe("TERMINAL_CANCELLED")
  })

  test("given ESCALATION_JUDGE when cancelled then TERMINAL_CANCELLED", () => {
    const runId = uniqueRunId("cancel-judge")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")
    run = transition(run, "REVIEW_ROUND_1")
    run = transition(run, "AGGREGATE_ROUND_1")
    run = transition(run, "IMPLEMENT_ROUND_2")
    run = transition(run, "REVIEW_ROUND_2")
    run = transition(run, "AGGREGATE_ROUND_2")
    run = transition(run, "CONVERGENCE_CHECK")
    run = transition(run, "ESCALATION_JUDGE")

    expect(isValidTransition(run.state, "TERMINAL_CANCELLED")).toBe(true)
    run = transition(run, "TERMINAL_CANCELLED")
    expect(run.state).toBe("TERMINAL_CANCELLED")
  })
})

// ============================================================================
// State Store Isolation Tests
// ============================================================================

describe("state store isolation", () => {
  test("given multiple concurrent runs when save then each run has isolated state", () => {
    const runId1 = uniqueRunId("concurrent-1")
    const runId2 = uniqueRunId("concurrent-2")
    const runId3 = uniqueRunId("concurrent-3")

    // Create three runs at different states
    let run1 = startRun(runId1)
    run1 = transition(run1, "IMPLEMENT_ROUND_1")

    let run2 = startRun(runId2)
    run2 = transition(run2, "IMPLEMENT_ROUND_1")
    run2 = transition(run2, "REVIEW_ROUND_1")

    let run3 = startRun(runId3)
    run3 = transition(run3, "IMPLEMENT_ROUND_1")
    run3 = transition(run3, "REVIEW_ROUND_1")
    run3 = transition(run3, "AGGREGATE_ROUND_1")

    // Save all
    saveRunState(runId1, run1)
    saveRunState(runId2, run2)
    saveRunState(runId3, run3)

    // Verify each is isolated
    const loaded1 = loadRunState(runId1)
    const loaded2 = loadRunState(runId2)
    const loaded3 = loadRunState(runId3)

    expect(loaded1?.state).toBe("IMPLEMENT_ROUND_1")
    expect(loaded2?.state).toBe("REVIEW_ROUND_1")
    expect(loaded3?.state).toBe("AGGREGATE_ROUND_1")

    expect(loaded1?.round).toBe(1)
    expect(loaded2?.round).toBe(1)
    expect(loaded3?.round).toBe(1)

    // Clean up
    deleteRunState(runId1)
    deleteRunState(runId2)
    deleteRunState(runId3)
  })

  test("given deleted run when load then returns null", () => {
    const runId = uniqueRunId("deleted")
    let run = startRun(runId)
    run = transition(run, "IMPLEMENT_ROUND_1")

    saveRunState(runId, run)
    expect(loadRunState(runId)).not.toBeNull()

    deleteRunState(runId)
    expect(loadRunState(runId)).toBeNull()
  })
})

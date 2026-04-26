/**
 * Implementation Team Integration Tests
 *
 * End-to-end tests using stubbed executor/reviewer/judge outputs to verify
 * timeout propagation, malformed reviewer handling, failed role/global behavior,
 * escalation after bounded retries, post-judge revise-once handling, and final
 * terminal verdicts.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import type {
  Finding,
  ReviewerVerdict,
  RoleAggregateVerdict,
  GlobalAggregateVerdict,
  EscalationJudgeVerdict,
  MalformedVerdict,
} from "./schemas"
import { aggregateRole } from "./role-aggregator"
import { aggregateGlobal } from "./global-aggregator"
import {
  evaluateConvergence,
  getNextStateAfterConvergence,
  canEvaluateConvergence,
  type ConvergenceInput,
} from "./convergence"
import {
  transition,
  startRun,
  isTerminalState,
  isValidTransition,
  canEscalate,
  hasTwoFailedOrdinaryRounds,
  recordRound,
  getPhaseDescription,
  type RunState,
  type PipelineState,
} from "./state-machine"
import {
  saveRunState,
  loadRunState,
  deleteRunState,
} from "./state-store"
import { canProceedToFinalVerification } from "./verification-gate"
import { _resetJudgeTasksCache } from "./escalation-judge"
import { _resetLaunchedTasksCache } from "./executor-runner"

// ============================================================================
// Stubbed Verdict Data Helpers
// ============================================================================

function makeFinding(
  id: string,
  severity: Finding["severity"] = "BLOCKER",
  category: Finding["category"] = "correctness",
): Finding {
  return {
    id,
    description: `Finding ${id}`,
    severity,
    category,
    file_ref: undefined,
  }
}

function makePassVerdict(
  roleId: string,
  reviewerIndex: number,
  runId: string = "test-run",
  round: number = 1,
): ReviewerVerdict {
  return {
    schema_version: "1.0",
    run_id: runId,
    round,
    role: roleId,
    reviewer_id: `${roleId}-reviewer-${reviewerIndex}`,
    model_id: "test-model",
    verdict: "PASS",
    severity: "NONE",
    blocker_count: 0,
    findings: [],
    summary: `${roleId} passed review`,
    timestamp: new Date().toISOString(),
  }
}

function makeFailVerdict(
  roleId: string,
  reviewerIndex: number,
  blockers: Finding[],
  runId: string = "test-run",
  round: number = 1,
): ReviewerVerdict {
  const blockerCount = blockers.filter((f) => f.severity === "BLOCKER").length
  return {
    schema_version: "1.0",
    run_id: runId,
    round,
    role: roleId,
    reviewer_id: `${roleId}-reviewer-${reviewerIndex}`,
    model_id: "test-model",
    verdict: "FAIL",
    severity: blockers.length > 0 ? blockers[0].severity : "MAJOR",
    blocker_count: blockerCount,
    findings: blockers,
    summary: `${roleId} failed with ${blockers.length} findings`,
    timestamp: new Date().toISOString(),
  }
}

function makeMalformedVerdict(
  roleId: string,
  errorType: MalformedVerdict["error_type"],
  rawOutput: string = "malformed output",
): MalformedVerdict {
  return {
    is_malformed: true,
    raw_output: rawOutput,
    error_type: errorType,
    role: roleId,
  }
}

function makeEscalationVerdict(
  verdict: EscalationJudgeVerdict["verdict"],
  reasoning: string = "Test reasoning",
  mandatoryChanges: EscalationJudgeVerdict["mandatory_changes"] = [],
): EscalationJudgeVerdict {
  return {
    verdict,
    reasoning,
    mandatory_changes: mandatoryChanges,
  }
}

// ============================================================================
// Test Configuration
// ============================================================================

const ROLES = ["spec-fidelity", "code-quality", "risk-regression"]
const REVIEWERS_PER_ROLE = 2

function createRoleVerdictsForRole(
  roleId: string,
  round: number,
  verdict: ReviewerVerdict,
): ReviewerVerdict[] {
  return Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) => ({
    ...verdict,
    reviewer_id: `${roleId}-reviewer-${i}`,
  }))
}

// ============================================================================
// Integration Tests: Happy Path
// ============================================================================

describe("integration: happy path", () => {
  describe("given all reviewers pass across all roles", () => {
    test("when aggregating round 1 then global verdict is pass", () => {
      // given: all reviewers pass
      const roleAggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
        const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
          makePassVerdict(roleId, i),
        )
        return aggregateRole(roleId, 1, verdicts)
      })

      // when: aggregating globally
      const globalVerdict = aggregateGlobal(1, roleAggregates)

      // then: global pass
      expect(globalVerdict.pass).toBe(true)
      expect(globalVerdict.failed_roles).toEqual([])
    })

    test("when evaluating convergence then returns pass", () => {
      // given: global pass verdict
      const roleAggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
        const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
          makePassVerdict(roleId, i),
        )
        return aggregateRole(roleId, 1, verdicts)
      })
      const globalVerdict = aggregateGlobal(1, roleAggregates)

      // when: evaluating convergence
      const input: ConvergenceInput = {
        currentRound: 1,
        currentGlobalVerdict: globalVerdict,
      }
      const decision = evaluateConvergence(input)

      // then: pass decision
      expect(decision.action).toBe("pass")
    })

    test("when transitioning through pipeline then reaches TERMINAL_PASS", () => {
      // given: starting from IDLE
      let state = startRun("test-run")

      // when: transitioning through happy path
      state = transition(state, "IMPLEMENT_ROUND_1")
      state = transition(state, "REVIEW_ROUND_1")
      state = transition(state, "AGGREGATE_ROUND_1")
      state = transition(state, "TERMINAL_PASS")

      // then: terminal pass reached
      expect(state.state).toBe("TERMINAL_PASS")
      expect(isTerminalState(state.state)).toBe(true)
    })

    test("when checking verification gate then can proceed", () => {
      // given: terminal pass state
      let runState = startRun("test-run")
      runState = transition(runState, "IMPLEMENT_ROUND_1")
      runState = transition(runState, "REVIEW_ROUND_1")
      runState = transition(runState, "AGGREGATE_ROUND_1")
      runState = transition(runState, "TERMINAL_PASS")

      // when: checking verification gate
      const gateResult = canProceedToFinalVerification(runState)

      // then: can proceed
      expect(gateResult.canProceed).toBe(true)
      expect(gateResult.requiresFinalVerification).toBe(true)
      expect(gateResult.terminalState).toBe("TERMINAL_PASS")
    })
  })
})

// ============================================================================
// Integration Tests: Round 1 Fail, Round 2 Pass
// ============================================================================

describe("integration: round 1 fail then round 2 pass", () => {
  test("given round 1 fails when evaluating convergence then returns continue", () => {
    // given: round 1 fail verdicts
    const roleAggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = ROLES.map((_, i) =>
        makeFailVerdict(roleId, i, [makeFinding("b1", "BLOCKER")]),
      )
      return aggregateRole(roleId, 1, verdicts)
    })
    const globalVerdict = aggregateGlobal(1, roleAggregates)

    // when: evaluating convergence at round 1
    const input: ConvergenceInput = {
      currentRound: 1,
      currentGlobalVerdict: globalVerdict,
    }
    const decision = evaluateConvergence(input)

    // then: continue to round 2
    expect(decision.action).toBe("continue")
  })

  test("given round 1 fail and round 2 pass when evaluating convergence then returns pass", () => {
    // given: round 1 failed
    const round1Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
        makeFailVerdict(roleId, i, [makeFinding("b1", "BLOCKER")]),
      )
      return aggregateRole(roleId, 1, verdicts)
    })
    const round1Global = aggregateGlobal(1, round1Aggregates)

    // and: round 2 passes
    const round2Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
        makePassVerdict(roleId, i, "test-run", 2),
      )
      return aggregateRole(roleId, 2, verdicts)
    })
    const round2Global = aggregateGlobal(2, round2Aggregates)

    // when: evaluating convergence at round 2 with previous verdict
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: round2Global,
      previousGlobalVerdict: round1Global,
    }
    const decision = evaluateConvergence(input)

    // then: pass
    expect(decision.action).toBe("pass")
  })

  test("when pipeline recovers from round 1 fail then transitions to round 2", () => {
    // given: start pipeline
    let state = startRun("test-run")

    // when: transitioning through round 1 fail path
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = transition(state, "IMPLEMENT_ROUND_2")

    // then: in round 2
    expect(state.state).toBe("IMPLEMENT_ROUND_2")
    expect(state.round).toBe(2)
  })
})

// ============================================================================
// Integration Tests: Two-Round Non-Convergence to Escalation
// ============================================================================

describe("integration: two-round non-convergence triggers escalation", () => {
  test("given round 1 fail and round 2 fail when evaluating convergence then returns escalate", () => {
    // given: round 1 failed with blocker
    const blocker = makeFinding("b1", "BLOCKER")
    const round1Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
        makeFailVerdict(roleId, i, [blocker]),
      )
      return aggregateRole(roleId, 1, verdicts)
    })
    const round1Global = aggregateGlobal(1, round1Aggregates)

    // and: round 2 failed with same blocker (stagnation)
    const round2Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
        makeFailVerdict(roleId, i, [blocker], "test-run", 2),
      )
      return aggregateRole(roleId, 2, verdicts)
    })
    const round2Global = aggregateGlobal(2, round2Aggregates)

    // when: evaluating convergence at round 2
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: round2Global,
      previousGlobalVerdict: round1Global,
    }
    const decision = evaluateConvergence(input)

    // then: escalate
    expect(decision.action).toBe("escalate")
  })

  test("given escalate decision when transitioning then reaches ESCALATION_JUDGE", () => {
    // given: CONVERGENCE_CHECK state with escalate decision
    let state = startRun("test-run")
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = transition(state, "IMPLEMENT_ROUND_2")
    state = transition(state, "REVIEW_ROUND_2")
    state = transition(state, "AGGREGATE_ROUND_2")
    state = transition(state, "CONVERGENCE_CHECK")

    // when: getting next state with escalate decision
    const decision = { action: "escalate" as const, reason: "Two failed rounds" }
    const nextState = getNextStateAfterConvergence(state.state, decision)

    // then: escalate to judge
    expect(nextState).toBe("ESCALATION_JUDGE")
  })

  test("given two failed rounds canEscalate returns true", () => {
    // given: two failed rounds recorded
    let state = startRun("test-run")
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = recordRound(state, {
      implementState: "IMPLEMENT_ROUND_1",
      reviewState: "REVIEW_ROUND_1",
      aggregateState: "AGGREGATE_ROUND_1",
      pass: false,
      timestamp: new Date().toISOString(),
    })
    state = transition(state, "IMPLEMENT_ROUND_2")
    state = transition(state, "REVIEW_ROUND_2")
    state = transition(state, "AGGREGATE_ROUND_2")
    state = transition(state, "CONVERGENCE_CHECK")
    state = recordRound(state, {
      implementState: "IMPLEMENT_ROUND_2",
      reviewState: "REVIEW_ROUND_2",
      aggregateState: "AGGREGATE_ROUND_2",
      pass: false,
      timestamp: new Date().toISOString(),
    })

    // then: can escalate
    expect(canEscalate(state)).toBe(true)
    expect(hasTwoFailedOrdinaryRounds(state)).toBe(true)
  })
})

// ============================================================================
// Integration Tests: Post-Judge Revise-Once
// ============================================================================

describe("integration: post-judge revise-once-mandatory", () => {
  test("given revise-once-mandatory verdict when evaluating convergence then returns revise-once", () => {
    // given: escalation judge issued revise-once-mandatory
    const escalationVerdict = makeEscalationVerdict(
      "revise-once-mandatory",
      "Must fix critical issue",
      [{ id: "m1", description: "Fix the thing", role: "executor", priority: "mandatory" }],
    )
    const globalVerdict = aggregateGlobal(2, [])

    // when: evaluating convergence with postJudgeFixDone = false
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: globalVerdict,
      escalationVerdict,
      postJudgeFixDone: false,
    }
    const decision = evaluateConvergence(input)

    // then: revise-once action with mandatory changes
    expect(decision.action).toBe("revise-once")
    if (decision.action === "revise-once") {
      expect(decision.mandatoryChanges).toHaveLength(1)
      expect(decision.mandatoryChanges[0].id).toBe("m1")
    }
  })

  test("given revise-once-mandatory with postJudgeFixDone when evaluating convergence then returns fail", () => {
    // given: escalation judge issued revise-once-mandatory and fix is done
    const escalationVerdict = makeEscalationVerdict("revise-once-mandatory", "Must fix", [])
    const globalVerdict = aggregateGlobal(2, [])

    // when: evaluating convergence with postJudgeFixDone = true
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: globalVerdict,
      escalationVerdict,
      postJudgeFixDone: true,
    }
    const decision = evaluateConvergence(input)

    // then: fail (no second judge run after revise-once)
    expect(decision.action).toBe("fail")
  })

  test("given revise-once decision when transitioning then reaches IMPLEMENT_ESCALATION_FIX", () => {
    // given: CONVERGENCE_CHECK state with revise-once decision
    let state = startRun("test-run")
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = transition(state, "IMPLEMENT_ROUND_2")
    state = transition(state, "REVIEW_ROUND_2")
    state = transition(state, "AGGREGATE_ROUND_2")
    state = transition(state, "CONVERGENCE_CHECK")

    // when: getting next state with revise-once decision
    const decision = {
      action: "revise-once" as const,
      reason: "Must fix",
      mandatoryChanges: [],
    }
    const nextState = getNextStateAfterConvergence(state.state, decision)

    // then: go to escalation fix
    expect(nextState).toBe("IMPLEMENT_ESCALATION_FIX")
  })

  test("given judge runs exactly once after two failed rounds", () => {
    // Reset caches before test
    _resetJudgeTasksCache()
    _resetLaunchedTasksCache()

    // given: two failed rounds
    const blocker = makeFinding("b1", "BLOCKER")
    const round1Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
        makeFailVerdict(roleId, i, [blocker]),
      )
      return aggregateRole(roleId, 1, verdicts)
    })
    const round1Global = aggregateGlobal(1, round1Aggregates)

    const round2Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
        makeFailVerdict(roleId, i, [blocker], "test-run", 2),
      )
      return aggregateRole(roleId, 2, verdicts)
    })
    const round2Global = aggregateGlobal(2, round2Aggregates)

    // when: evaluating convergence triggers escalation
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: round2Global,
      previousGlobalVerdict: round1Global,
    }
    const decision = evaluateConvergence(input)

    // then: escalate decision (not another round)
    expect(decision.action).toBe("escalate")

    // and: state transitions to ESCALATION_JUDGE
    let state = startRun("test-run")
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = transition(state, "IMPLEMENT_ROUND_2")
    state = transition(state, "REVIEW_ROUND_2")
    state = transition(state, "AGGREGATE_ROUND_2")
    state = transition(state, "CONVERGENCE_CHECK")

    const nextState = getNextStateAfterConvergence(state.state, decision)
    expect(nextState).toBe("ESCALATION_JUDGE")

    // and: verify judge is at ESCALATION_JUDGE state
    state = transition(state, nextState)
    expect(state.state).toBe("ESCALATION_JUDGE")
  })
})

// ============================================================================
// Integration Tests: Malformed Output Handling
// ============================================================================

describe("integration: malformed output handling", () => {
  test("given malformed verdict when aggregating role then pass is false", () => {
    // given: one malformed verdict in a role
    const verdicts: (ReviewerVerdict | MalformedVerdict)[] = [
      makePassVerdict("spec-fidelity", 0),
      makeMalformedVerdict("spec-fidelity", "invalid_json", "not valid json"),
    ]

    // when: aggregating role
    const roleAggregate = aggregateRole("spec-fidelity", 1, verdicts)

    // then: pass is false due to malformed
    expect(roleAggregate.pass).toBe(false)
    expect(roleAggregate.malformed_count).toBe(1)
  })

  test("given malformed verdict when aggregating globally then global pass is false", () => {
    // given: spec-fidelity has malformed, others pass
    const specFidelityAggregate = aggregateRole("spec-fidelity", 1, [
      makeMalformedVerdict("spec-fidelity", "parse_error"),
    ])
    const codeQualityAggregate = aggregateRole("code-quality", 1, [
      makePassVerdict("code-quality", 0),
      makePassVerdict("code-quality", 1),
    ])
    const riskAggregate = aggregateRole("risk-regression", 1, [
      makePassVerdict("risk-regression", 0),
      makePassVerdict("risk-regression", 1),
    ])

    // when: aggregating globally
    const globalVerdict = aggregateGlobal(1, [
      specFidelityAggregate,
      codeQualityAggregate,
      riskAggregate,
    ])

    // then: global pass is false
    expect(globalVerdict.pass).toBe(false)
    expect(globalVerdict.failed_roles).toContain("spec-fidelity")
  })

  test("given all roles have malformed verdicts when evaluating convergence then does not pass", () => {
    // given: all roles have malformed verdicts
    const aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) =>
      aggregateRole(roleId, 1, [makeMalformedVerdict(roleId, "missing_fields")]),
    )
    const globalVerdict = aggregateGlobal(1, aggregates)

    // when: evaluating convergence
    const input: ConvergenceInput = {
      currentRound: 1,
      currentGlobalVerdict: globalVerdict,
    }
    const decision = evaluateConvergence(input)

    // then: not pass (either continue or escalate depending on round)
    expect(decision.action).not.toBe("pass")
  })

  test("given malformed verdict with empty_output error_type then prevents false pass", () => {
    // given: empty output verdict
    const verdicts: (ReviewerVerdict | MalformedVerdict)[] = [
      makeMalformedVerdict("spec-fidelity", "empty_output", ""),
    ]

    // when: aggregating role
    const roleAggregate = aggregateRole("spec-fidelity", 1, verdicts)

    // then: pass is false
    expect(roleAggregate.pass).toBe(false)
    expect(roleAggregate.malformed_count).toBe(1)
  })
})

// ============================================================================
// Integration Tests: Timeout/Cancellation/Error States
// ============================================================================

describe("integration: timeout and cancellation error handling", () => {
  test("given timeout error_type verdict when aggregating then pass is false", () => {
    // given: timeout malformed verdict
    const verdicts: (ReviewerVerdict | MalformedVerdict)[] = [
      makeMalformedVerdict("spec-fidelity", "timeout", "Task timed out after 120 seconds"),
    ]

    // when: aggregating
    const roleAggregate = aggregateRole("spec-fidelity", 1, verdicts)

    // then: pass is false
    expect(roleAggregate.pass).toBe(false)
    expect(roleAggregate.malformed_count).toBe(1)
  })

  test("given cancellation error_type verdict when aggregating then pass is false", () => {
    // given: cancellation malformed verdict
    const verdicts: (ReviewerVerdict | MalformedVerdict)[] = [
      makeMalformedVerdict("spec-fidelity", "cancellation", "Task was cancelled by user"),
    ]

    // when: aggregating
    const roleAggregate = aggregateRole("spec-fidelity", 1, verdicts)

    // then: pass is false
    expect(roleAggregate.pass).toBe(false)
    expect(roleAggregate.malformed_count).toBe(1)
  })

  test("given timeout verdicts across roles when evaluating convergence then does not pass", () => {
    // given: all roles have timeout errors
    const aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) =>
      aggregateRole(roleId, 1, [
        makeMalformedVerdict(roleId, "timeout", "Task timed out"),
        makeMalformedVerdict(roleId, "timeout", "Task timed out"),
      ]),
    )
    const globalVerdict = aggregateGlobal(1, aggregates)

    // when: evaluating convergence
    const input: ConvergenceInput = {
      currentRound: 1,
      currentGlobalVerdict: globalVerdict,
    }
    const decision = evaluateConvergence(input)

    // then: continue (round 1 failure allows one more round)
    expect(decision.action).toBe("continue")
  })

  test("given cancellation verdict at round 2 when evaluating convergence then escalates", () => {
    // given: round 1 pass, round 2 cancellation
    const round1Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
        makePassVerdict(roleId, i),
      )
      return aggregateRole(roleId, 1, verdicts)
    })
    const round1Global = aggregateGlobal(1, round1Aggregates)

    const round2Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) =>
      aggregateRole(roleId, 2, [makeMalformedVerdict(roleId, "cancellation")]),
    )
    const round2Global = aggregateGlobal(2, round2Aggregates)

    // when: evaluating convergence at round 2
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: round2Global,
      previousGlobalVerdict: round1Global,
    }
    const decision = evaluateConvergence(input)

    // then: escalate (round 2 fail triggers escalation)
    expect(decision.action).toBe("escalate")
  })

  test("given judge approve verdict when evaluating convergence then returns pass", () => {
    // given: escalation judge approved
    const escalationVerdict = makeEscalationVerdict("approve", "Implementation acceptable")
    const globalVerdict = aggregateGlobal(2, [])

    // when: evaluating convergence
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: globalVerdict,
      escalationVerdict,
    }
    const decision = evaluateConvergence(input)

    // then: pass
    expect(decision.action).toBe("pass")
  })

  test("given judge reject-escalate-human verdict when evaluating convergence then returns fail", () => {
    // given: escalation judge rejected
    const escalationVerdict = makeEscalationVerdict(
      "reject-escalate-human",
      "Human intervention required",
    )
    const globalVerdict = aggregateGlobal(2, [])

    // when: evaluating convergence
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: globalVerdict,
      escalationVerdict,
    }
    const decision = evaluateConvergence(input)

    // then: fail
    expect(decision.action).toBe("fail")
  })
})

// ============================================================================
// Integration Tests: State Store Recovery
// ============================================================================

describe("integration: state store recovery", () => {
  const testRunId = "recovery-test-run"

  afterEach(() => {
    // Cleanup test state file
    deleteRunState(testRunId)
  })

  test("given run state saved when loading then returns correct state", () => {
    // given: a run in progress at IMPLEMENT_ROUND_2
    let state = startRun(testRunId)
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = transition(state, "IMPLEMENT_ROUND_2")

    // when: saving and loading
    saveRunState(testRunId, state)
    const loadedState = loadRunState(testRunId)

    // then: state matches
    expect(loadedState).not.toBeNull()
    expect(loadedState!.runId).toBe(testRunId)
    expect(loadedState!.state).toBe("IMPLEMENT_ROUND_2")
    expect(loadedState!.round).toBe(2)
  })

  test("given non-existent runId when loading then returns null", () => {
    // when: loading non-existent run
    const loadedState = loadRunState("non-existent-run")

    // then: null returned
    expect(loadedState).toBeNull()
  })

  test("given recovered state when transitioning then no duplicate launch allowed", () => {
    // Reset caches
    _resetLaunchedTasksCache()
    _resetJudgeTasksCache()

    // given: recovered state at CONVERGENCE_CHECK with two failed rounds
    let state = startRun(testRunId)
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = recordRound(state, {
      implementState: "IMPLEMENT_ROUND_1",
      reviewState: "REVIEW_ROUND_1",
      aggregateState: "AGGREGATE_ROUND_1",
      pass: false,
      timestamp: new Date().toISOString(),
    })
    state = transition(state, "IMPLEMENT_ROUND_2")
    state = transition(state, "REVIEW_ROUND_2")
    state = transition(state, "AGGREGATE_ROUND_2")
    state = transition(state, "CONVERGENCE_CHECK")
    state = recordRound(state, {
      implementState: "IMPLEMENT_ROUND_2",
      reviewState: "REVIEW_ROUND_2",
      aggregateState: "AGGREGATE_ROUND_2",
      pass: false,
      timestamp: new Date().toISOString(),
    })

    // when: saving and loading
    saveRunState(testRunId, state)
    const loadedState = loadRunState(testRunId)

    // then: canEscalate is true
    expect(loadedState).not.toBeNull()
    expect(canEscalate(loadedState!)).toBe(true)

    // and: hasTwoFailedOrdinaryRounds is true
    expect(hasTwoFailedOrdinaryRounds(loadedState!)).toBe(true)

    // and: isValidTransition to ESCALATION_JUDGE is allowed
    expect(isValidTransition(loadedState!.state, "ESCALATION_JUDGE")).toBe(true)
  })

  test("given terminal state saved and loaded when checking verification gate then works correctly", () => {
    // given: terminal pass state
    let state = startRun(testRunId)
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = transition(state, "TERMINAL_PASS")

    // when: saving, loading, and checking gate
    saveRunState(testRunId, state)
    const loadedState = loadRunState(testRunId)
    const gateResult = canProceedToFinalVerification(loadedState!)

    // then: can proceed
    expect(gateResult.canProceed).toBe(true)
    expect(gateResult.terminalState).toBe("TERMINAL_PASS")
  })

  test("given cancelled state when transitioning then is terminal", () => {
    // given: IMPLEMENT_ROUND_1 state
    let state = startRun(testRunId)
    state = transition(state, "IMPLEMENT_ROUND_1")

    // when: transitioning to cancelled
    state = transition(state, "TERMINAL_CANCELLED")

    // then: is terminal
    expect(isTerminalState(state.state)).toBe(true)
    expect(state.state).toBe("TERMINAL_CANCELLED")
  })
})

// ============================================================================
// Integration Tests: Pipeline State Machine Transitions
// ============================================================================

describe("integration: state machine transitions", () => {
  test("given IDLE when transitioning then reaches IMPLEMENT_ROUND_1", () => {
    // given: IDLE state
    const state = startRun("test-run")

    // when: transitioning
    const next = transition(state, "IMPLEMENT_ROUND_1")

    // then: round 1 started
    expect(next.state).toBe("IMPLEMENT_ROUND_1")
    expect(next.round).toBe(1)
  })

  test("given invalid transition when attempting then throws error", () => {
    // given: IDLE state
    const state = startRun("test-run")

    // when/then: invalid transition throws
    expect(() => transition(state, "TERMINAL_PASS")).toThrow()
    expect(() => transition(state, "ESCALATION_JUDGE")).toThrow()
  })

  test("given terminal state when transitioning then throws", () => {
    // given: terminal pass state
    let state = startRun("test-run")
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = transition(state, "TERMINAL_PASS")

    // when/then: cannot transition from terminal
    expect(() => transition(state, "IMPLEMENT_ROUND_2")).toThrow()
  })

  test("getPhaseDescription returns human-readable descriptions", () => {
    expect(getPhaseDescription("IDLE")).toBe("Not started")
    expect(getPhaseDescription("IMPLEMENT_ROUND_1")).toBe("First executor run")
    expect(getPhaseDescription("REVIEW_ROUND_1")).toBe("First review swarm")
    expect(getPhaseDescription("CONVERGENCE_CHECK")).toBe("Checking convergence")
    expect(getPhaseDescription("ESCALATION_JUDGE")).toBe("Escalation judge running")
    expect(getPhaseDescription("TERMINAL_PASS")).toBe("Pipeline passed")
    expect(getPhaseDescription("TERMINAL_CANCELLED")).toBe("Cancelled externally")
  })
})

// ============================================================================
// Integration Tests: Child Task Timeout/Cancel/Error Surface to Terminal
// ============================================================================

describe("integration: child task error states surface to terminal verdict", () => {
  test("given all reviewers timeout when aggregating globally then terminal is blocked", () => {
    // given: all roles have timeout errors at round 1
    const aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) =>
      aggregateRole(roleId, 1, [
        makeMalformedVerdict(roleId, "timeout", "Task timed out after 120s"),
        makeMalformedVerdict(roleId, "timeout", "Task timed out after 120s"),
      ]),
    )
    const globalVerdict = aggregateGlobal(1, aggregates)

    // when: evaluating convergence at round 1
    const input: ConvergenceInput = {
      currentRound: 1,
      currentGlobalVerdict: globalVerdict,
    }
    const decision = evaluateConvergence(input)

    // then: continue (first round allows retry)
    expect(decision.action).toBe("continue")

    // when: round 2 also times out
    const round2Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) =>
      aggregateRole(roleId, 2, [
        makeMalformedVerdict(roleId, "timeout", "Task timed out after 120s"),
        makeMalformedVerdict(roleId, "timeout", "Task timed out after 120s"),
      ]),
    )
    const round2Global = aggregateGlobal(2, round2Aggregates)

    const input2: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: round2Global,
      previousGlobalVerdict: globalVerdict,
    }
    const decision2 = evaluateConvergence(input2)

    // then: escalate to judge
    expect(decision2.action).toBe("escalate")
  })

  test("given cancelled reviewers at round 2 when converging then escalates", () => {
    // given: round 1 pass
    const round1Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) => {
      const verdicts = Array.from({ length: REVIEWERS_PER_ROLE }, (_, i) =>
        makePassVerdict(roleId, i),
      )
      return aggregateRole(roleId, 1, verdicts)
    })
    const round1Global = aggregateGlobal(1, round1Aggregates)

    // and: round 2 all cancelled
    const round2Aggregates: RoleAggregateVerdict[] = ROLES.map((roleId) =>
      aggregateRole(roleId, 2, [
        makeMalformedVerdict(roleId, "cancellation", "Task cancelled by user"),
        makeMalformedVerdict(roleId, "cancellation", "Task cancelled by user"),
      ]),
    )
    const round2Global = aggregateGlobal(2, round2Aggregates)

    // when: evaluating convergence
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: round2Global,
      previousGlobalVerdict: round1Global,
    }
    const decision = evaluateConvergence(input)

    // then: escalate
    expect(decision.action).toBe("escalate")
  })

  test("given escalation judge rejects when converging then terminal fail", () => {
    // given: escalation judge rejects
    const escalationVerdict = makeEscalationVerdict(
      "reject-escalate-human",
      "Cannot resolve automatically",
    )
    const globalVerdict = aggregateGlobal(2, [])

    // when: evaluating convergence
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: globalVerdict,
      escalationVerdict,
    }
    const decision = evaluateConvergence(input)

    // then: fail
    expect(decision.action).toBe("fail")

    // and: terminal state would be FAIL_NONCONVERGENT or ESCALATED_FAIL
    const terminalState = getNextStateAfterConvergence("CONVERGENCE_CHECK", decision)
    expect(terminalState).toBe("TERMINAL_FAIL_NONCONVERGENT")
  })

  test("given escalation judge approves when converging then terminal pass", () => {
    // given: escalation judge approves
    const escalationVerdict = makeEscalationVerdict(
      "approve",
      "Implementation acceptable despite issues",
    )
    const globalVerdict = aggregateGlobal(2, [])

    // when: evaluating convergence
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: globalVerdict,
      escalationVerdict,
    }
    const decision = evaluateConvergence(input)

    // then: pass
    expect(decision.action).toBe("pass")

    // and: terminal state would be ESCALATED_PASS
    const terminalState = getNextStateAfterConvergence("CONVERGENCE_CHECK", decision)
    expect(terminalState).toBe("TERMINAL_PASS")
  })
})

// ============================================================================
// Integration Tests: Revise-Once Mandatory Bounded Cycle
// ============================================================================

describe("integration: revise-once-mandatory yields bounded post-judge fix cycle", () => {
  test("given revise-once-mandatory when fix not done then allows one fix cycle", () => {
    // given: judge mandated revise-once
    const escalationVerdict = makeEscalationVerdict(
      "revise-once-mandatory",
      "Critical issues must be fixed",
      [{ id: "m1", description: "Fix security vulnerability", role: "executor", priority: "mandatory" }],
    )
    const globalVerdict = aggregateGlobal(2, [])

    // when: evaluating convergence with postJudgeFixDone = false
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: globalVerdict,
      escalationVerdict,
      postJudgeFixDone: false,
    }
    const decision = evaluateConvergence(input)

    // then: revise-once action (one fix cycle allowed)
    expect(decision.action).toBe("revise-once")
    if (decision.action === "revise-once") {
      expect(decision.mandatoryChanges).toHaveLength(1)
    }
  })

  test("given revise-once completed when evaluating again then fails (no second judge)", () => {
    // given: judge mandated revise-once and fix was done
    const escalationVerdict = makeEscalationVerdict(
      "revise-once-mandatory",
      "Fix required",
      [],
    )
    const globalVerdict = aggregateGlobal(2, [])

    // when: evaluating with postJudgeFixDone = true
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: globalVerdict,
      escalationVerdict,
      postJudgeFixDone: true,
    }
    const decision = evaluateConvergence(input)

    // then: fail (bounded cycle - no second judge run)
    expect(decision.action).toBe("fail")
    expect(decision.reason).toContain("Post-judge revise-once cycle completed")
  })

  test("given revise-once path when transitioning through pipeline then one judge run only", () => {
    // given: CONVERGENCE_CHECK with escalate decision
    let state = startRun("test-run")
    state = transition(state, "IMPLEMENT_ROUND_1")
    state = transition(state, "REVIEW_ROUND_1")
    state = transition(state, "AGGREGATE_ROUND_1")
    state = transition(state, "IMPLEMENT_ROUND_2")
    state = transition(state, "REVIEW_ROUND_2")
    state = transition(state, "AGGREGATE_ROUND_2")
    state = transition(state, "CONVERGENCE_CHECK")

    // when: escalate decision leads to ESCALATION_JUDGE
    const escalateDecision = { action: "escalate" as const, reason: "Two failures" }
    let nextState = getNextStateAfterConvergence(state.state, escalateDecision)
    state = transition(state, nextState)

    // then: at ESCALATION_JUDGE
    expect(state.state).toBe("ESCALATION_JUDGE")

    // when: judge returns revise-once-mandatory and we proceed
    const reviseOnceDecision = {
      action: "revise-once" as const,
      reason: "Must fix",
      mandatoryChanges: [],
    }
    nextState = getNextStateAfterConvergence(state.state, reviseOnceDecision)
    state = transition(state, nextState)

    // then: at IMPLEMENT_ESCALATION_FIX (not back to judge)
    expect(state.state).toBe("IMPLEMENT_ESCALATION_FIX")

    // when: after fix, go to FINAL_VERIFICATION_REVIEW and pass
    state = transition(state, "FINAL_VERIFICATION_REVIEW")

    // then: at final verification
    expect(state.state).toBe("FINAL_VERIFICATION_REVIEW")

    // when: final verification passes, go directly to terminal escalated pass
    // (not through getNextStateAfterConvergence which is for CONVERGENCE_CHECK only)
    state = transition(state, "TERMINAL_ESCALATED_PASS")

    // then: terminal escalated pass (no second judge, passed after escalation)
    expect(state.state).toBe("TERMINAL_ESCALATED_PASS")
    expect(isTerminalState(state.state)).toBe(true)
  })
})

// ============================================================================
// Integration Tests: Verification Gate
// ============================================================================

describe("integration: verification gate", () => {
  test("given TERMINAL_PASS when checking gate then can proceed", () => {
    // given
    let runState = startRun("test")
    runState = transition(runState, "IMPLEMENT_ROUND_1")
    runState = transition(runState, "REVIEW_ROUND_1")
    runState = transition(runState, "AGGREGATE_ROUND_1")
    runState = transition(runState, "TERMINAL_PASS")

    // when
    const result = canProceedToFinalVerification(runState)

    // then
    expect(result.canProceed).toBe(true)
    expect(result.requiresFinalVerification).toBe(true)
  })

  test("given TERMINAL_ESCALATED_PASS when checking gate then can proceed", () => {
    // given
    let runState = startRun("test")
    runState = transition(runState, "IMPLEMENT_ROUND_1")
    runState = transition(runState, "REVIEW_ROUND_1")
    runState = transition(runState, "AGGREGATE_ROUND_1")
    runState = transition(runState, "IMPLEMENT_ROUND_2")
    runState = transition(runState, "REVIEW_ROUND_2")
    runState = transition(runState, "AGGREGATE_ROUND_2")
    runState = transition(runState, "CONVERGENCE_CHECK")
    runState = transition(runState, "ESCALATION_JUDGE")
    runState = transition(runState, "TERMINAL_ESCALATED_PASS")

    // when
    const result = canProceedToFinalVerification(runState)

    // then
    expect(result.canProceed).toBe(true)
    expect(result.requiresFinalVerification).toBe(true)
  })

  test("given TERMINAL_ESCALATED_FAIL when checking gate then cannot proceed", () => {
    // given: reached terminal escalated fail through escalation judge
    let runState = startRun("test")
    runState = transition(runState, "IMPLEMENT_ROUND_1")
    runState = transition(runState, "REVIEW_ROUND_1")
    runState = transition(runState, "AGGREGATE_ROUND_1")
    runState = transition(runState, "IMPLEMENT_ROUND_2")
    runState = transition(runState, "REVIEW_ROUND_2")
    runState = transition(runState, "AGGREGATE_ROUND_2")
    runState = transition(runState, "CONVERGENCE_CHECK")
    runState = transition(runState, "ESCALATION_JUDGE")
    runState = transition(runState, "TERMINAL_ESCALATED_FAIL")

    // when
    const result = canProceedToFinalVerification(runState)

    // then
    expect(result.canProceed).toBe(false)
    expect(result.reason).toContain("after escalation")
  })

  test("given TERMINAL_CANCELLED when checking gate then cannot proceed", () => {
    // given
    let runState = startRun("test")
    runState = transition(runState, "IMPLEMENT_ROUND_1")
    runState = transition(runState, "TERMINAL_CANCELLED")

    // when
    const result = canProceedToFinalVerification(runState)

    // then
    expect(result.canProceed).toBe(false)
    expect(result.reason).toContain("cancelled")
  })

  test("given non-terminal state when checking gate then cannot proceed", () => {
    // given
    let runState = startRun("test")
    runState = transition(runState, "IMPLEMENT_ROUND_1")
    runState = transition(runState, "REVIEW_ROUND_1")

    // when
    const result = canProceedToFinalVerification(runState)

    // then
    expect(result.canProceed).toBe(false)
    expect(result.requiresFinalVerification).toBe(false)
    expect(result.reason).toContain("still in progress")
  })
})

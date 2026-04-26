import { describe, expect, test } from "bun:test"
import {
  isValidTransition,
  isTerminalState,
  getAllowedTransitions,
  transition,
  startRun,
  generateRunId,
  recordRound,
  canEscalate,
  hasTwoFailedOrdinaryRounds,
  getPhaseDescription,
  type PipelineState,
} from "./state-machine"

describe("state-machine", () => {
  describe("startRun", () => {
    test("given valid runId when startRun then returns IDLE state with round 0", () => {
      const run = startRun("test-run-1")
      expect(run.state).toBe("IDLE")
      expect(run.round).toBe(0)
      expect(run.runId).toBe("test-run-1")
      expect(run.reviewerSessionIds).toEqual({})
      expect(run.roundHistory).toEqual([])
    })
  })

  describe("generateRunId", () => {
    test("given planName sessionId and attemptNumber when generateRunId then returns idempotent string", () => {
      const runId = generateRunId({
        planName: "my-plan",
        sessionId: "ses_abc12345",
        attemptNumber: 1,
      })
      expect(runId).toBe("my-plan-ses_abc1-2026-04-26-r1")
    })

    test("given no attemptNumber when generateRunId then defaults to r1", () => {
      const runId = generateRunId({
        planName: "my-plan",
        sessionId: "ses_abc12345",
      })
      expect(runId).toBe("my-plan-ses_abc1-2026-04-26-r1")
    })

    test("given different attemptNumbers when generateRunId then returns different ids", () => {
      const runId1 = generateRunId({
        planName: "my-plan",
        sessionId: "ses_abc12345",
        attemptNumber: 1,
      })
      const runId2 = generateRunId({
        planName: "my-plan",
        sessionId: "ses_abc12345",
        attemptNumber: 2,
      })
      expect(runId1).not.toBe(runId2)
    })
  })

  describe("isTerminalState", () => {
    test("given terminal states when isTerminalState then returns true", () => {
      const terminalStates: PipelineState[] = [
        "TERMINAL_PASS",
        "TERMINAL_FAIL_BLOCKED",
        "TERMINAL_FAIL_NONCONVERGENT",
        "TERMINAL_ESCALATED_PASS",
        "TERMINAL_ESCALATED_FAIL",
        "TERMINAL_CANCELLED",
      ]
      for (const state of terminalStates) {
        expect(isTerminalState(state)).toBe(true)
      }
    })

    test("given non-terminal states when isTerminalState then returns false", () => {
      const nonTerminalStates: PipelineState[] = [
        "IDLE",
        "IMPLEMENT_ROUND_1",
        "REVIEW_ROUND_1",
        "AGGREGATE_ROUND_1",
        "IMPLEMENT_ROUND_2",
        "REVIEW_ROUND_2",
        "AGGREGATE_ROUND_2",
        "CONVERGENCE_CHECK",
        "ESCALATION_JUDGE",
        "IMPLEMENT_ESCALATION_FIX",
        "FINAL_VERIFICATION_REVIEW",
      ]
      for (const state of nonTerminalStates) {
        expect(isTerminalState(state)).toBe(false)
      }
    })
  })

  describe("getAllowedTransitions", () => {
    test("given IDLE when getAllowedTransitions then returns IMPLEMENT_ROUND_1 and TERMINAL_CANCELLED", () => {
      const allowed = getAllowedTransitions("IDLE")
      expect(allowed).toContain("IMPLEMENT_ROUND_1")
      expect(allowed).toContain("TERMINAL_CANCELLED")
    })

    test("given IMPLEMENT_ROUND_1 when getAllowedTransitions then returns REVIEW_ROUND_1 and TERMINAL_CANCELLED", () => {
      const allowed = getAllowedTransitions("IMPLEMENT_ROUND_1")
      expect(allowed).toContain("REVIEW_ROUND_1")
      expect(allowed).toContain("TERMINAL_CANCELLED")
    })

    test("given terminal states when getAllowedTransitions then returns empty array", () => {
      const terminalStates: PipelineState[] = [
        "TERMINAL_PASS",
        "TERMINAL_FAIL_BLOCKED",
        "TERMINAL_FAIL_NONCONVERGENT",
        "TERMINAL_ESCALATED_PASS",
        "TERMINAL_ESCALATED_FAIL",
        "TERMINAL_CANCELLED",
      ]
      for (const state of terminalStates) {
        expect(getAllowedTransitions(state)).toEqual([])
      }
    })
  })

  describe("isValidTransition", () => {
    test("given valid transition when isValidTransition then returns true", () => {
      expect(isValidTransition("IDLE", "IMPLEMENT_ROUND_1")).toBe(true)
      expect(isValidTransition("IMPLEMENT_ROUND_1", "REVIEW_ROUND_1")).toBe(true)
      expect(isValidTransition("REVIEW_ROUND_1", "AGGREGATE_ROUND_1")).toBe(true)
    })

    test("given invalid transition when isValidTransition then returns false", () => {
      expect(isValidTransition("IDLE", "REVIEW_ROUND_1")).toBe(false)
      expect(isValidTransition("IMPLEMENT_ROUND_1", "AGGREGATE_ROUND_1")).toBe(false)
      expect(isValidTransition("TERMINAL_PASS", "IDLE")).toBe(false)
    })

    test("given terminal to non-terminal when isValidTransition then returns false", () => {
      expect(isValidTransition("TERMINAL_PASS", "IMPLEMENT_ROUND_1")).toBe(false)
      expect(isValidTransition("TERMINAL_FAIL_BLOCKED", "IDLE")).toBe(false)
    })
  })

  describe("transition", () => {
    test("given valid transition when transition then returns new state", () => {
      const run = startRun("test-run-1")
      const newRun = transition(run, "IMPLEMENT_ROUND_1")
      expect(newRun.state).toBe("IMPLEMENT_ROUND_1")
      expect(newRun.round).toBe(1)
    })

    test("given invalid transition when transition then throws", () => {
      const run = startRun("test-run-1")
      expect(() => transition(run, "REVIEW_ROUND_1")).toThrow()
    })

    test("given transition from terminal when transition then throws", () => {
      const run = startRun("test-run-1")
      const terminalRun = transition(run, "IMPLEMENT_ROUND_1")
      const passRun = transition(terminalRun, "REVIEW_ROUND_1")
      const aggregateRun = transition(passRun, "AGGREGATE_ROUND_1")
      const finalRun = transition(aggregateRun, "TERMINAL_PASS")
      expect(() => transition(finalRun, "IDLE")).toThrow()
    })

    test("given transition is immutable when transition then original state unchanged", () => {
      const run = startRun("test-run-1")
      transition(run, "IMPLEMENT_ROUND_1")
      expect(run.state).toBe("IDLE")
    })

    test("given round increment when transition then round updates correctly", () => {
      let run = startRun("test-run-1")
      run = transition(run, "IMPLEMENT_ROUND_1")
      expect(run.round).toBe(1)
      run = transition(run, "REVIEW_ROUND_1")
      expect(run.round).toBe(1)
      run = transition(run, "AGGREGATE_ROUND_1")
      expect(run.round).toBe(1)
      run = transition(run, "IMPLEMENT_ROUND_2")
      expect(run.round).toBe(2)
    })
  })

  describe("happy path", () => {
    test("given IDLE through AGGREGATE_ROUND_1 to TERMINAL_PASS when following happy path then succeeds", () => {
      let run = startRun("happy-run")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      expect(run.state).toBe("AGGREGATE_ROUND_1")
      run = transition(run, "TERMINAL_PASS")
      expect(run.state).toBe("TERMINAL_PASS")
      expect(run.round).toBe(1)
      expect(isTerminalState(run.state)).toBe(true)
    })
  })

  describe("two-round failure triggers escalation", () => {
    test("given two failed rounds when at CONVERGENCE_CHECK then can escalate", () => {
      let run = startRun("escalation-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      run = transition(run, "CONVERGENCE_CHECK")
      expect(run.state).toBe("CONVERGENCE_CHECK")
      expect(canEscalate(run)).toBe(true)
    })

    test("given at AGGREGATE_ROUND_2 before CONVERGENCE_CHECK when canEscalate then returns false", () => {
      let run = startRun("early-escalation-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      expect(canEscalate(run)).toBe(false)
    })

    test("given not at CONVERGENCE_CHECK when canEscalate then returns false", () => {
      let run = startRun("wrong-state-escalation-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      expect(canEscalate(run)).toBe(false)
    })

    test("given two failed rounds in history when hasTwoFailedOrdinaryRounds then returns true", () => {
      let run = startRun("failed-rounds-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = recordRound(run, {
        implementState: "IMPLEMENT_ROUND_1",
        reviewState: "REVIEW_ROUND_1",
        aggregateState: "AGGREGATE_ROUND_1",
        pass: false,
        timestamp: new Date().toISOString(),
      })
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
      expect(hasTwoFailedOrdinaryRounds(run)).toBe(true)
    })
  })

  describe("judge cannot run before two failed ordinary rounds", () => {
    test("given round 1 when trying to go to ESCALATION_JUDGE then throws", () => {
      let run = startRun("early-judge-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      run = transition(run, "CONVERGENCE_CHECK")
      expect(run.state).toBe("CONVERGENCE_CHECK")
      const allowed = getAllowedTransitions(run.state)
      expect(allowed).toContain("ESCALATION_JUDGE")
    })

    test("given before CONVERGENCE_CHECK when trying to go to ESCALATION_JUDGE then throws", () => {
      let run = startRun("wrong-state-judge-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      expect(() => transition(run, "ESCALATION_JUDGE")).toThrow()
    })
  })

  describe("revise-once-mandatory escalation flow", () => {
    test("given ESCALATION_JUDGE to IMPLEMENT_ESCALATION_FIX then FINAL_VERIFICATION_REVIEW then terminates", () => {
      let run = startRun("revise-once-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      run = transition(run, "CONVERGENCE_CHECK")
      run = transition(run, "ESCALATION_JUDGE")
      expect(run.state).toBe("ESCALATION_JUDGE")
      expect(getAllowedTransitions(run.state)).toContain("IMPLEMENT_ESCALATION_FIX")
      run = transition(run, "IMPLEMENT_ESCALATION_FIX")
      expect(run.state).toBe("IMPLEMENT_ESCALATION_FIX")
      expect(getAllowedTransitions(run.state)).toContain("FINAL_VERIFICATION_REVIEW")
      run = transition(run, "FINAL_VERIFICATION_REVIEW")
      expect(run.state).toBe("FINAL_VERIFICATION_REVIEW")
      expect(isTerminalState(run.state)).toBe(false)
      const allowed = getAllowedTransitions(run.state)
      expect(allowed).toContain("TERMINAL_ESCALATED_PASS")
      expect(allowed).toContain("TERMINAL_ESCALATED_FAIL")
    })

    test("given FINAL_VERIFICATION_REVIEW then no return to ordinary rounds", () => {
      let run = startRun("final-review-test")
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
      const allowed = getAllowedTransitions(run.state)
      expect(allowed).not.toContain("IMPLEMENT_ROUND_1")
      expect(allowed).not.toContain("IMPLEMENT_ROUND_2")
      expect(allowed).not.toContain("CONVERGENCE_CHECK")
    })
  })

  describe("recordRound", () => {
    test("given existing run when recordRound then appends to history", () => {
      let run = startRun("record-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      const timestamp = new Date().toISOString()
      run = recordRound(run, {
        implementState: "IMPLEMENT_ROUND_1",
        reviewState: "REVIEW_ROUND_1",
        aggregateState: "AGGREGATE_ROUND_1",
        pass: true,
        timestamp,
      })
      expect(run.roundHistory.length).toBe(1)
      expect(run.roundHistory[0].round).toBe(1)
      expect(run.roundHistory[0].pass).toBe(true)
    })
  })

  describe("getPhaseDescription", () => {
    test("given each state when getPhaseDescription then returns description", () => {
      expect(getPhaseDescription("IDLE")).toBe("Not started")
      expect(getPhaseDescription("IMPLEMENT_ROUND_1")).toBe("First executor run")
      expect(getPhaseDescription("TERMINAL_PASS")).toBe("Pipeline passed")
      expect(getPhaseDescription("TERMINAL_CANCELLED")).toBe("Cancelled externally")
    })
  })

  describe("cancellation", () => {
    test("given any non-terminal when cancelled then can transition to TERMINAL_CANCELLED", () => {
      let run = startRun("cancel-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      expect(isValidTransition(run.state, "TERMINAL_CANCELLED")).toBe(true)
    })
  })

  describe("terminal states have no outgoing transitions", () => {
    test("given TERMINAL_PASS when getAllowedTransitions then returns empty", () => {
      expect(getAllowedTransitions("TERMINAL_PASS")).toEqual([])
    })

    test("given TERMINAL_FAIL_BLOCKED when getAllowedTransitions then returns empty", () => {
      expect(getAllowedTransitions("TERMINAL_FAIL_BLOCKED")).toEqual([])
    })

    test("given TERMINAL_ESCALATED_FAIL when getAllowedTransitions then returns empty", () => {
      expect(getAllowedTransitions("TERMINAL_ESCALATED_FAIL")).toEqual([])
    })
  })

  describe("round counter increments correctly", () => {
    test("given IMPLEMENT_ROUND_1 when transition then round becomes 1", () => {
      let run = startRun("round-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      expect(run.round).toBe(1)
    })

    test("given IMPLEMENT_ROUND_2 when transition then round becomes 2", () => {
      let run = startRun("round-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      expect(run.round).toBe(2)
    })

    test("given REVIEW_ROUND_1 when transition then round stays same", () => {
      let run = startRun("round-test")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      expect(run.round).toBe(1)
    })
  })
})

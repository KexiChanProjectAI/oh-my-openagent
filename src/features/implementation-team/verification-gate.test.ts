import { describe, expect, test } from "bun:test"
import { startRun, type RunState } from "./state-machine"
import {
  canProceedToFinalVerification,
  getVerificationBlockingReason,
  isImplementationTeamPass,
  isImplementationTeamFail,
} from "./verification-gate"

// ============================================================================
// Test Fixtures
// ============================================================================

function makeRunState(state: RunState["state"]): RunState {
  const run = startRun(`test-run-${state}`)
  // Transition to the desired state (valid for testing purposes)
  // For terminal states, we go through the appropriate path
  return { ...run, state }
}

function makeTerminalRunState(terminalState: RunState["state"]): RunState {
  const run = startRun(`test-terminal-${terminalState}`)
  return { ...run, state: terminalState }
}

// ============================================================================
// isImplementationTeamPass Tests
// ============================================================================

describe("isImplementationTeamPass", () => {
  describe("given pass states", () => {
    test("when TERMINAL_PASS then returns true", () => {
      expect(isImplementationTeamPass("TERMINAL_PASS")).toBe(true)
    })

    test("when TERMINAL_ESCALATED_PASS then returns true", () => {
      expect(isImplementationTeamPass("TERMINAL_ESCALATED_PASS")).toBe(true)
    })
  })

  describe("given fail states", () => {
    test("when TERMINAL_FAIL_BLOCKED then returns false", () => {
      expect(isImplementationTeamPass("TERMINAL_FAIL_BLOCKED")).toBe(false)
    })

    test("when TERMINAL_FAIL_NONCONVERGENT then returns false", () => {
      expect(isImplementationTeamPass("TERMINAL_FAIL_NONCONVERGENT")).toBe(false)
    })

    test("when TERMINAL_ESCALATED_FAIL then returns false", () => {
      expect(isImplementationTeamPass("TERMINAL_ESCALATED_FAIL")).toBe(false)
    })

    test("when TERMINAL_CANCELLED then returns false", () => {
      expect(isImplementationTeamPass("TERMINAL_CANCELLED")).toBe(false)
    })
  })

  describe("given non-terminal states", () => {
    test("when IDLE then returns false", () => {
      expect(isImplementationTeamPass("IDLE")).toBe(false)
    })

    test("when IMPLEMENT_ROUND_1 then returns false", () => {
      expect(isImplementationTeamPass("IMPLEMENT_ROUND_1")).toBe(false)
    })

    test("when REVIEW_ROUND_1 then returns false", () => {
      expect(isImplementationTeamPass("REVIEW_ROUND_1")).toBe(false)
    })

    test("when AGGREGATE_ROUND_1 then returns false", () => {
      expect(isImplementationTeamPass("AGGREGATE_ROUND_1")).toBe(false)
    })

    test("when CONVERGENCE_CHECK then returns false", () => {
      expect(isImplementationTeamPass("CONVERGENCE_CHECK")).toBe(false)
    })

    test("when ESCALATION_JUDGE then returns false", () => {
      expect(isImplementationTeamPass("ESCALATION_JUDGE")).toBe(false)
    })
  })
})

// ============================================================================
// isImplementationTeamFail Tests
// ============================================================================

describe("isImplementationTeamFail", () => {
  describe("given fail states", () => {
    test("when TERMINAL_FAIL_BLOCKED then returns true", () => {
      expect(isImplementationTeamFail("TERMINAL_FAIL_BLOCKED")).toBe(true)
    })

    test("when TERMINAL_FAIL_NONCONVERGENT then returns true", () => {
      expect(isImplementationTeamFail("TERMINAL_FAIL_NONCONVERGENT")).toBe(true)
    })

    test("when TERMINAL_ESCALATED_FAIL then returns true", () => {
      expect(isImplementationTeamFail("TERMINAL_ESCALATED_FAIL")).toBe(true)
    })

    test("when TERMINAL_CANCELLED then returns true", () => {
      expect(isImplementationTeamFail("TERMINAL_CANCELLED")).toBe(true)
    })
  })

  describe("given pass states", () => {
    test("when TERMINAL_PASS then returns false", () => {
      expect(isImplementationTeamFail("TERMINAL_PASS")).toBe(false)
    })

    test("when TERMINAL_ESCALATED_PASS then returns false", () => {
      expect(isImplementationTeamFail("TERMINAL_ESCALATED_PASS")).toBe(false)
    })
  })

  describe("given non-terminal states", () => {
    test("when IDLE then returns false", () => {
      expect(isImplementationTeamFail("IDLE")).toBe(false)
    })

    test("when IMPLEMENT_ROUND_1 then returns false", () => {
      expect(isImplementationTeamFail("IMPLEMENT_ROUND_1")).toBe(false)
    })

    test("when CONVERGENCE_CHECK then returns false", () => {
      expect(isImplementationTeamFail("CONVERGENCE_CHECK")).toBe(false)
    })
  })
})

// ============================================================================
// canProceedToFinalVerification Tests
// ============================================================================

describe("canProceedToFinalVerification", () => {
  describe("given non-terminal states", () => {
    test("when IDLE then returns canProceed false with in-progress reason", () => {
      const runState = makeRunState("IDLE")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.requiresFinalVerification).toBe(false)
      expect(result.terminalState).toBe("IDLE")
      expect(result.reason).toBe("Pipeline still in progress")
    })

    test("when IMPLEMENT_ROUND_1 then returns canProceed false", () => {
      const runState = makeRunState("IMPLEMENT_ROUND_1")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.requiresFinalVerification).toBe(false)
      expect(result.reason).toBe("Pipeline still in progress")
    })

    test("when REVIEW_ROUND_1 then returns canProceed false", () => {
      const runState = makeRunState("REVIEW_ROUND_1")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.reason).toBe("Pipeline still in progress")
    })

    test("when AGGREGATE_ROUND_1 then returns canProceed false", () => {
      const runState = makeRunState("AGGREGATE_ROUND_1")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.reason).toBe("Pipeline still in progress")
    })

    test("when IMPLEMENT_ROUND_2 then returns canProceed false", () => {
      const runState = makeRunState("IMPLEMENT_ROUND_2")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.reason).toBe("Pipeline still in progress")
    })

    test("when CONVERGENCE_CHECK then returns canProceed false", () => {
      const runState = makeRunState("CONVERGENCE_CHECK")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.reason).toBe("Pipeline still in progress")
    })

    test("when ESCALATION_JUDGE then returns canProceed false", () => {
      const runState = makeRunState("ESCALATION_JUDGE")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.reason).toBe("Pipeline still in progress")
    })

    test("when FINAL_VERIFICATION_REVIEW then returns canProceed false", () => {
      const runState = makeRunState("FINAL_VERIFICATION_REVIEW")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.reason).toBe("Pipeline still in progress")
    })
  })

  describe("given TERMINAL_PASS", () => {
    test("when TERMINAL_PASS then returns canProceed true with requiresFinalVerification true", () => {
      const runState = makeTerminalRunState("TERMINAL_PASS")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(true)
      expect(result.requiresFinalVerification).toBe(true)
      expect(result.terminalState).toBe("TERMINAL_PASS")
      expect(result.reason).toBe("Implementation team passed, proceed to final verification")
    })
  })

  describe("given TERMINAL_ESCALATED_PASS", () => {
    test("when TERMINAL_ESCALATED_PASS then returns canProceed true with requiresFinalVerification true", () => {
      const runState = makeTerminalRunState("TERMINAL_ESCALATED_PASS")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(true)
      expect(result.requiresFinalVerification).toBe(true)
      expect(result.terminalState).toBe("TERMINAL_ESCALATED_PASS")
      expect(result.reason).toBe("Implementation team passed, proceed to final verification")
    })
  })

  describe("given TERMINAL_FAIL_BLOCKED", () => {
    test("when TERMINAL_FAIL_BLOCKED then returns canProceed false with blockers reason", () => {
      const runState = makeTerminalRunState("TERMINAL_FAIL_BLOCKED")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.requiresFinalVerification).toBe(false)
      expect(result.terminalState).toBe("TERMINAL_FAIL_BLOCKED")
      expect(result.reason).toBe("Pipeline failed with unresolved blockers")
    })
  })

  describe("given TERMINAL_FAIL_NONCONVERGENT", () => {
    test("when TERMINAL_FAIL_NONCONVERGENT then returns canProceed false with nonconvergent reason", () => {
      const runState = makeTerminalRunState("TERMINAL_FAIL_NONCONVERGENT")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.requiresFinalVerification).toBe(false)
      expect(result.terminalState).toBe("TERMINAL_FAIL_NONCONVERGENT")
      expect(result.reason).toBe("Pipeline failed to converge after two rounds")
    })
  })

  describe("given TERMINAL_ESCALATED_FAIL", () => {
    test("when TERMINAL_ESCALATED_FAIL then returns canProceed false with escalation fail reason", () => {
      const runState = makeTerminalRunState("TERMINAL_ESCALATED_FAIL")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.requiresFinalVerification).toBe(false)
      expect(result.terminalState).toBe("TERMINAL_ESCALATED_FAIL")
      expect(result.reason).toBe("Pipeline failed after escalation judge review")
    })
  })

  describe("given TERMINAL_CANCELLED", () => {
    test("when TERMINAL_CANCELLED then returns canProceed false with cancelled reason", () => {
      const runState = makeTerminalRunState("TERMINAL_CANCELLED")
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.requiresFinalVerification).toBe(false)
      expect(result.terminalState).toBe("TERMINAL_CANCELLED")
      expect(result.reason).toBe("Pipeline was cancelled")
    })
  })
})

// ============================================================================
// getVerificationBlockingReason Tests
// ============================================================================

describe("getVerificationBlockingReason", () => {
  describe("given non-terminal states", () => {
    test("when IDLE then returns blocking reason", () => {
      const runState = makeRunState("IDLE")
      const reason = getVerificationBlockingReason(runState)
      expect(reason).toBe("Pipeline still in progress")
    })

    test("when IMPLEMENT_ROUND_1 then returns blocking reason", () => {
      const runState = makeRunState("IMPLEMENT_ROUND_1")
      const reason = getVerificationBlockingReason(runState)
      expect(reason).toBe("Pipeline still in progress")
    })
  })

  describe("given pass states", () => {
    test("when TERMINAL_PASS then returns null (can proceed)", () => {
      const runState = makeTerminalRunState("TERMINAL_PASS")
      const reason = getVerificationBlockingReason(runState)
      expect(reason).toBeNull()
    })

    test("when TERMINAL_ESCALATED_PASS then returns null (can proceed)", () => {
      const runState = makeTerminalRunState("TERMINAL_ESCALATED_PASS")
      const reason = getVerificationBlockingReason(runState)
      expect(reason).toBeNull()
    })
  })

  describe("given fail states", () => {
    test("when TERMINAL_FAIL_BLOCKED then returns blocking reason", () => {
      const runState = makeTerminalRunState("TERMINAL_FAIL_BLOCKED")
      const reason = getVerificationBlockingReason(runState)
      expect(reason).toBe("Pipeline failed with unresolved blockers")
    })

    test("when TERMINAL_FAIL_NONCONVERGENT then returns blocking reason", () => {
      const runState = makeTerminalRunState("TERMINAL_FAIL_NONCONVERGENT")
      const reason = getVerificationBlockingReason(runState)
      expect(reason).toBe("Pipeline failed to converge after two rounds")
    })

    test("when TERMINAL_ESCALATED_FAIL then returns blocking reason", () => {
      const runState = makeTerminalRunState("TERMINAL_ESCALATED_FAIL")
      const reason = getVerificationBlockingReason(runState)
      expect(reason).toBe("Pipeline failed after escalation judge review")
    })

    test("when TERMINAL_CANCELLED then returns blocking reason", () => {
      const runState = makeTerminalRunState("TERMINAL_CANCELLED")
      const reason = getVerificationBlockingReason(runState)
      expect(reason).toBe("Pipeline was cancelled")
    })
  })
})

// ============================================================================
// Integration: Passing Implementation Team Requires Final Verification
// ============================================================================

describe("verification gate enforces final verification", () => {
  test("passing implementation team sets requiresFinalVerification to true (not skip)", () => {
    const passStates: RunState["state"][] = ["TERMINAL_PASS", "TERMINAL_ESCALATED_PASS"]
    for (const state of passStates) {
      const runState = makeTerminalRunState(state)
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(true)
      expect(result.requiresFinalVerification).toBe(true)
    }
  })

  test("failed implementation team sets requiresFinalVerification to false", () => {
    const failStates: RunState["state"][] = [
      "TERMINAL_FAIL_BLOCKED",
      "TERMINAL_FAIL_NONCONVERGENT",
      "TERMINAL_ESCALATED_FAIL",
      "TERMINAL_CANCELLED",
    ]
    for (const state of failStates) {
      const runState = makeTerminalRunState(state)
      const result = canProceedToFinalVerification(runState)
      expect(result.canProceed).toBe(false)
      expect(result.requiresFinalVerification).toBe(false)
    }
  })
})

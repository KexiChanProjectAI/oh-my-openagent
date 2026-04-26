import { describe, expect, test } from "bun:test"
import type { EscalationJudgeVerdict, Finding, GlobalAggregateVerdict } from "./schemas"
import {
  evaluateConvergence,
  shouldEscalate,
  getConvergenceSummary,
  getNextStateAfterConvergence,
  canEvaluateConvergence,
  type ConvergenceInput,
} from "./convergence"
import { PipelineState } from "./state-machine"

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

// ============================================================================
// evaluateConvergence Tests
// ============================================================================

describe("evaluateConvergence", () => {
  describe("given round 1", () => {
    test("when pass then returns pass", () => {
      const input: ConvergenceInput = {
        currentRound: 1,
        currentGlobalVerdict: createGlobalVerdict(true, 1),
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("pass")
      expect(result.reason).toContain("Round 1 passed")
    })

    test("when fail then returns continue", () => {
      const input: ConvergenceInput = {
        currentRound: 1,
        currentGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("continue")
      expect(result.reason).toContain("Round 1 failed")
    })
  })

  describe("given round 2", () => {
    test("when pass then returns pass", () => {
      const input: ConvergenceInput = {
        currentRound: 2,
        currentGlobalVerdict: createGlobalVerdict(true, 2),
        previousGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("pass")
      expect(result.reason).toContain("Round 2 passed")
    })

    test("when fail with identical blockers then returns escalate", () => {
      const blocker = createFinding("b1")
      const input: ConvergenceInput = {
        currentRound: 2,
        currentGlobalVerdict: createGlobalVerdict(false, 2, [blocker]),
        previousGlobalVerdict: createGlobalVerdict(false, 1, [blocker]),
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("escalate")
      expect(result.reason).toContain("stagnant")
    })

    test("when fail with increased blockers then returns escalate", () => {
      const input: ConvergenceInput = {
        currentRound: 2,
        currentGlobalVerdict: createGlobalVerdict(false, 2, [
          createFinding("b1"),
          createFinding("b2"),
          createFinding("b3"),
        ]),
        previousGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("escalate")
      // Increased blockers = not stagnation, not progress, falls through to default escalation
    })

    test("when fail with decreased blockers then returns escalate (progress but max rounds)", () => {
      const input: ConvergenceInput = {
        currentRound: 2,
        currentGlobalVerdict: createGlobalVerdict(false, 2, [createFinding("b1")]),
        previousGlobalVerdict: createGlobalVerdict(false, 1, [
          createFinding("b1"),
          createFinding("b2"),
        ]),
      }
      const result = evaluateConvergence(input)
      // Progress (fewer blockers) still escalates because max 2 ordinary rounds
      expect(result.action).toBe("escalate")
      expect(result.reason).toContain("progress")
    })

    test("when fail with different blockers (not identical) then returns escalate", () => {
      const input: ConvergenceInput = {
        currentRound: 2,
        currentGlobalVerdict: createGlobalVerdict(false, 2, [createFinding("b2")]),
        previousGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("escalate")
      // Different blockers (not identical) - escalation
    })
  })

  describe("given post-judge revise-once-mandatory", () => {
    test("when fix not done then returns revise-once with mandatory changes", () => {
      const mandatoryChanges = [
        { id: "m1", description: "Fix the thing", role: "executor", priority: "mandatory" as const },
      ]
      const escalationVerdict: EscalationJudgeVerdict = {
        verdict: "revise-once-mandatory",
        reasoning: "Must fix critical issue",
        mandatory_changes: mandatoryChanges,
      }
      const input: ConvergenceInput = {
        currentRound: 3,
        currentGlobalVerdict: createGlobalVerdict(false, 2),
        escalationVerdict,
        postJudgeFixDone: false,
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("revise-once")
      if (result.action === "revise-once") {
        expect(result.mandatoryChanges).toEqual(mandatoryChanges)
      }
    })

    test("when fix already done then returns fail", () => {
      const escalationVerdict: EscalationJudgeVerdict = {
        verdict: "revise-once-mandatory",
        reasoning: "Must fix critical issue",
        mandatory_changes: [],
      }
      const input: ConvergenceInput = {
        currentRound: 3,
        currentGlobalVerdict: createGlobalVerdict(false, 2),
        escalationVerdict,
        postJudgeFixDone: true,
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("fail")
      expect(result.reason).toContain("Post-judge revise-once cycle completed")
    })
  })

  describe("given post-judge approve", () => {
    test("when judge approves then returns pass", () => {
      const escalationVerdict: EscalationJudgeVerdict = {
        verdict: "approve",
        reasoning: "Implementation acceptable despite issues",
        mandatory_changes: [],
      }
      const input: ConvergenceInput = {
        currentRound: 3,
        currentGlobalVerdict: createGlobalVerdict(false, 2),
        escalationVerdict,
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("pass")
      expect(result.reason).toContain("judge approved")
    })
  })

  describe("given post-judge reject-escalate-human", () => {
    test("when judge rejects then returns fail", () => {
      const escalationVerdict: EscalationJudgeVerdict = {
        verdict: "reject-escalate-human",
        reasoning: "Cannot resolve automatically",
        mandatory_changes: [],
      }
      const input: ConvergenceInput = {
        currentRound: 3,
        currentGlobalVerdict: createGlobalVerdict(false, 2),
        escalationVerdict,
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("fail")
      expect(result.reason).toContain("human intervention required")
    })
  })

  describe("given no previous verdict (first round)", () => {
    test("when blockers present in round 1 then returns continue", () => {
      const input: ConvergenceInput = {
        currentRound: 1,
        currentGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("continue")
      // No previous verdict to compare, so no stagnation possible
      expect(result.reason).toContain("Round 1 failed")
    })
  })

  describe("given round > 2 without escalation verdict", () => {
    test("when no escalation verdict then returns fail", () => {
      const input: ConvergenceInput = {
        currentRound: 5,
        currentGlobalVerdict: createGlobalVerdict(false, 5),
      }
      const result = evaluateConvergence(input)
      expect(result.action).toBe("fail")
      expect(result.reason).toContain("Invalid state")
    })
  })
})

// ============================================================================
// shouldEscalate Tests
// ============================================================================

describe("shouldEscalate", () => {
  test("given round 2 fail with stagnation then returns true", () => {
    const blocker = createFinding("b1")
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: createGlobalVerdict(false, 2, [blocker]),
      previousGlobalVerdict: createGlobalVerdict(false, 1, [blocker]),
    }
    expect(shouldEscalate(input)).toBe(true)
  })

  test("given round 1 fail then returns false", () => {
    const input: ConvergenceInput = {
      currentRound: 1,
      currentGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
    }
    expect(shouldEscalate(input)).toBe(false)
  })

  test("given round 1 pass then returns false", () => {
    const input: ConvergenceInput = {
      currentRound: 1,
      currentGlobalVerdict: createGlobalVerdict(true, 1),
    }
    expect(shouldEscalate(input)).toBe(false)
  })

  test("given round 2 pass then returns false", () => {
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: createGlobalVerdict(true, 2),
      previousGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
    }
    expect(shouldEscalate(input)).toBe(false)
  })

  test("given revise-once-mandatory verdict then returns false", () => {
    const escalationVerdict: EscalationJudgeVerdict = {
      verdict: "revise-once-mandatory",
      reasoning: "Must fix",
      mandatory_changes: [],
    }
    const input: ConvergenceInput = {
      currentRound: 3,
      currentGlobalVerdict: createGlobalVerdict(false, 2),
      escalationVerdict,
      postJudgeFixDone: false,
    }
    expect(shouldEscalate(input)).toBe(false)
  })
})

// ============================================================================
// getConvergenceSummary Tests
// ============================================================================

describe("getConvergenceSummary", () => {
  test("given pass decision then formats correctly", () => {
    const decision = { action: "pass" as const, reason: "All good" }
    const summary = getConvergenceSummary(decision)
    expect(summary).toBe("Pass: All good")
  })

  test("given fail decision then formats correctly", () => {
    const decision = { action: "fail" as const, reason: "Blocked" }
    const summary = getConvergenceSummary(decision)
    expect(summary).toBe("Fail: Blocked")
  })

  test("given continue decision then formats correctly", () => {
    const decision = { action: "continue" as const, reason: "More rounds" }
    const summary = getConvergenceSummary(decision)
    expect(summary).toBe("Continue: More rounds")
  })

  test("given escalate decision then formats correctly", () => {
    const decision = { action: "escalate" as const, reason: "Stuck" }
    const summary = getConvergenceSummary(decision)
    expect(summary).toBe("Escalate: Stuck")
  })

  test("given revise-once decision then includes mandatory changes count", () => {
    const decision = {
      action: "revise-once" as const,
      reason: "Fix required",
      mandatoryChanges: [
        { id: "m1", description: "Fix A", role: "executor", priority: "mandatory" as const },
        { id: "m2", description: "Fix B", role: "executor", priority: "mandatory" as const },
      ],
    }
    const summary = getConvergenceSummary(decision)
    expect(summary).toBe("Revise-once: Fix required (2 mandatory changes)")
  })
})

// ============================================================================
// getNextStateAfterConvergence Tests
// ============================================================================

describe("getNextStateAfterConvergence", () => {
  test("given pass from CONVERGENCE_CHECK then returns TERMINAL_PASS", () => {
    const decision = { action: "pass" as const, reason: "All good" }
    const nextState = getNextStateAfterConvergence("CONVERGENCE_CHECK", decision)
    expect(nextState).toBe("TERMINAL_PASS")
  })

  test("given fail from CONVERGENCE_CHECK then returns TERMINAL_FAIL_NONCONVERGENT", () => {
    const decision = { action: "fail" as const, reason: "Blocked" }
    const nextState = getNextStateAfterConvergence("CONVERGENCE_CHECK", decision)
    expect(nextState).toBe("TERMINAL_FAIL_NONCONVERGENT")
  })

  test("given escalate from CONVERGENCE_CHECK then returns ESCALATION_JUDGE", () => {
    const decision = { action: "escalate" as const, reason: "Stuck" }
    const nextState = getNextStateAfterConvergence("CONVERGENCE_CHECK", decision)
    expect(nextState).toBe("ESCALATION_JUDGE")
  })

  test("given revise-once then returns IMPLEMENT_ESCALATION_FIX", () => {
    const decision = {
      action: "revise-once" as const,
      reason: "Fix required",
      mandatoryChanges: [],
    }
    const nextState = getNextStateAfterConvergence("CONVERGENCE_CHECK", decision)
    expect(nextState).toBe("IMPLEMENT_ESCALATION_FIX")
  })

  test("given continue from CONVERGENCE_CHECK then returns IMPLEMENT_ROUND_2", () => {
    const decision = { action: "continue" as const, reason: "More work" }
    const nextState = getNextStateAfterConvergence("CONVERGENCE_CHECK", decision)
    expect(nextState).toBe("IMPLEMENT_ROUND_2")
  })
})

// ============================================================================
// canEvaluateConvergence Tests
// ============================================================================

describe("canEvaluateConvergence", () => {
  test("given CONVERGENCE_CHECK state then returns true", () => {
    expect(canEvaluateConvergence("CONVERGENCE_CHECK")).toBe(true)
  })

  test("given IMPLEMENT_ROUND_1 state then returns false", () => {
    expect(canEvaluateConvergence("IMPLEMENT_ROUND_1")).toBe(false)
  })

  test("given AGGREGATE_ROUND_2 state then returns false", () => {
    expect(canEvaluateConvergence("AGGREGATE_ROUND_2")).toBe(false)
  })

  test("given TERMINAL_PASS state then returns false", () => {
    expect(canEvaluateConvergence("TERMINAL_PASS")).toBe(false)
  })
})

// ============================================================================
// Stagnation Detection Edge Cases
// ============================================================================

describe("stagnation detection edge cases", () => {
  test("given same blocker IDs in different order then detects stagnation", () => {
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: createGlobalVerdict(false, 2, [
        createFinding("b2"),
        createFinding("b1"),
      ]),
      previousGlobalVerdict: createGlobalVerdict(false, 1, [
        createFinding("b1"),
        createFinding("b2"),
      ]),
    }
    const result = evaluateConvergence(input)
    // Same IDs, same count = stagnation
    expect(result.action).toBe("escalate")
    expect(result.reason).toContain("stagnant")
  })

  test("given round 2 fail with no previous verdict then escalates", () => {
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: createGlobalVerdict(false, 2, [createFinding("b1")]),
    }
    const result = evaluateConvergence(input)
    expect(result.action).toBe("escalate")
    // No previous to compare = escalate (stagnation not applicable)
  })

  test("given empty blockers in both rounds then treats as stagnation", () => {
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: createGlobalVerdict(false, 2, []),
      previousGlobalVerdict: createGlobalVerdict(false, 1, []),
    }
    const result = evaluateConvergence(input)
    // Empty blockers in both = same = stagnation (escalate)
    expect(result.action).toBe("escalate")
    expect(result.reason).toContain("stagnant")
  })

  test("given fewer blockers is treated as progress but still escalates due to max rounds", () => {
    const input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: createGlobalVerdict(false, 2, [createFinding("b1")]),
      previousGlobalVerdict: createGlobalVerdict(false, 1, [
        createFinding("b1"),
        createFinding("b2"),
        createFinding("b3"),
      ]),
    }
    const result = evaluateConvergence(input)
    // Fewer blockers = progress, but 2 rounds max so still escalate
    expect(result.action).toBe("escalate")
    expect(result.reason).toContain("progress")
  })
})

// ============================================================================
// Two Consecutive Failures Path
// ============================================================================

describe("two consecutive failures trigger escalation", () => {
  test("given round 1 fail followed by round 2 fail with same blocker then escalate", () => {
    const blocker = createFinding("b1")

    // Round 1 verdict
    const round1Input: ConvergenceInput = {
      currentRound: 1,
      currentGlobalVerdict: createGlobalVerdict(false, 1, [blocker]),
    }
    const round1Result = evaluateConvergence(round1Input)
    expect(round1Result.action).toBe("continue")

    // Round 2 verdict with same blocker
    const round2Input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: createGlobalVerdict(false, 2, [blocker]),
      previousGlobalVerdict: createGlobalVerdict(false, 1, [blocker]),
    }
    const round2Result = evaluateConvergence(round2Input)
    expect(round2Result.action).toBe("escalate")
    expect(round2Result.reason).toContain("stagnant")
  })

  test("given round 1 fail followed by round 2 pass then pass", () => {
    // Round 1 verdict
    const round1Input: ConvergenceInput = {
      currentRound: 1,
      currentGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
    }
    const round1Result = evaluateConvergence(round1Input)
    expect(round1Result.action).toBe("continue")

    // Round 2 verdict - passes
    const round2Input: ConvergenceInput = {
      currentRound: 2,
      currentGlobalVerdict: createGlobalVerdict(true, 2),
      previousGlobalVerdict: createGlobalVerdict(false, 1, [createFinding("b1")]),
    }
    const round2Result = evaluateConvergence(round2Input)
    expect(round2Result.action).toBe("pass")
  })
})

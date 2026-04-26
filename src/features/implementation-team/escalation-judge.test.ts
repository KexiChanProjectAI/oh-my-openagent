import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  buildJudgePrompt,
  buildJudgeTaskArgs,
  createEscalationJudgeTask,
  generateJudgeTaskId,
  getExistingJudgeLaunchResult,
  parseJudgeOutput,
  validateEscalationEligibility,
  _resetJudgeTasksCache,
  _getJudgeTasksCacheSize,
  type EscalationJudgeInput,
} from "./escalation-judge"
import type { RunState } from "./state-machine"
import { startRun, transition } from "./state-machine"
import type { Finding, GlobalAggregateVerdict } from "./schemas"

// Helper to create a minimal valid input for testing
function createValidInput(): EscalationJudgeInput {
  const globalAggregate: GlobalAggregateVerdict = {
    pass: false,
    round: 2,
    failed_roles: ["spec-fidelity", "code-quality"],
    role_aggregates: [],
    executor_patch_brief: {
      unresolved_blockers: [],
      failed_role_ids: ["spec-fidelity", "code-quality"],
      execution_round: 2,
    },
  }

  const unresolvedFindings: Finding[] = [
    {
      id: "FIND-001",
      description: "Null pointer risk in user lookup",
      severity: "BLOCKER",
      category: "correctness",
    },
    {
      id: "FIND-002",
      description: "SQL injection vulnerability",
      severity: "BLOCKER",
      category: "security",
      file_ref: "src/db/queries.ts:42",
    },
  ]

  return {
    runId: "test-run-123",
    config: {
      enabled: true,
      executor: {
        category: "unspecified-high",
        model: "claude-opus-4-7",
      },
      roles: [],
      maxOrdinaryRounds: 2,
      escalation: {
        enabled: true,
        model: "gpt-5.5",
        category: "ultrabrain",
      },
      resourceCaps: {
        maxTotalSpawnedTasks: 50,
        maxReviewersPerRole: 5,
        maxRoles: 3,
      },
      passPolicy: {
        requireAllRolesPass: true,
      },
      blockerPolicy: {
        anyBlockerFailsRole: true,
      },
      defaultRoles: false,
    },
    roundHistory: {
      globalAggregate,
      unresolvedFindings,
    },
    taskDescription: "Implement user authentication system",
    taskPrompt: "Create a secure user authentication system with JWT tokens...",
  }
}

describe("escalation-judge", () => {
  beforeEach(() => {
    _resetJudgeTasksCache()
  })

  afterEach(() => {
    _resetJudgeTasksCache()
  })

  describe("generateJudgeTaskId", () => {
    test("given runId when generateJudgeTaskId then returns deterministic id", () => {
      const taskId = generateJudgeTaskId("run-abc-123")
      expect(taskId).toBe("impl-team-run-abc-123-escalation-judge")
    })

    test("given same runId when generateJudgeTaskId multiple times then returns same id", () => {
      const taskId1 = generateJudgeTaskId("run-xyz")
      const taskId2 = generateJudgeTaskId("run-xyz")
      expect(taskId1).toBe(taskId2)
    })

    test("given different runIds when generateJudgeTaskId then returns different ids", () => {
      const taskId1 = generateJudgeTaskId("run-001")
      const taskId2 = generateJudgeTaskId("run-002")
      expect(taskId1).not.toBe(taskId2)
    })
  })

  describe("buildJudgePrompt", () => {
    test("given valid input when buildJudgePrompt then includes original task description", () => {
      const input = createValidInput()
      const prompt = buildJudgePrompt(input)
      expect(prompt).toContain(input.taskDescription)
    })

    test("given valid input when buildJudgePrompt then includes original task prompt", () => {
      const input = createValidInput()
      const prompt = buildJudgePrompt(input)
      expect(prompt).toContain(input.taskPrompt)
    })

    test("given valid input when buildJudgePrompt then includes all unresolved findings", () => {
      const input = createValidInput()
      const prompt = buildJudgePrompt(input)
      expect(prompt).toContain("Null pointer risk in user lookup")
      expect(prompt).toContain("SQL injection vulnerability")
    })

    test("given valid input when buildJudgePrompt then includes verdict options", () => {
      const input = createValidInput()
      const prompt = buildJudgePrompt(input)
      expect(prompt).toContain("approve")
      expect(prompt).toContain("revise-once-mandatory")
      expect(prompt).toContain("reject-escalate-human")
    })

    test("given valid input when buildJudgePrompt then includes JSON schema", () => {
      const input = createValidInput()
      const prompt = buildJudgePrompt(input)
      expect(prompt).toContain('"verdict":')
      expect(prompt).toContain('"reasoning":')
      expect(prompt).toContain('"mandatory_changes":')
    })

    test("given valid input when buildJudgePrompt then marks as final arbiter", () => {
      const input = createValidInput()
      const prompt = buildJudgePrompt(input)
      expect(prompt).toContain("FINAL arbiter")
    })

    test("given empty unresolved findings when buildJudgePrompt then handles gracefully", () => {
      const input = createValidInput()
      input.roundHistory.unresolvedFindings = []
      const prompt = buildJudgePrompt(input)
      expect(prompt).toContain("No unresolved findings")
    })

    test("given valid input when buildJudgePrompt then includes run metadata tag", () => {
      const input = createValidInput()
      const prompt = buildJudgePrompt(input)
      expect(prompt).toContain(`[IMPLEMENTATION_TEAM_RUN runId=${input.runId}`)
      expect(prompt).toContain("role=escalation-judge")
    })
  })

  describe("buildJudgeTaskArgs", () => {
    test("given valid input when buildJudgeTaskArgs then returns DelegateTaskArgs", () => {
      const input = createValidInput()
      const args = buildJudgeTaskArgs(input)
      expect(args).toHaveProperty("description")
      expect(args).toHaveProperty("prompt")
      expect(args).toHaveProperty("category")
      expect(args).toHaveProperty("run_in_background")
      expect(args).toHaveProperty("task_id")
      expect(args).toHaveProperty("load_skills")
    })

    test("given valid input when buildJudgeTaskArgs then run_in_background is true", () => {
      const input = createValidInput()
      const args = buildJudgeTaskArgs(input)
      expect(args.run_in_background).toBe(true)
    })

    test("given valid input when buildJudgeTaskArgs then task_id is deterministic", () => {
      const input = createValidInput()
      const args = buildJudgeTaskArgs(input)
      expect(args.task_id).toBe(`impl-team-${input.runId}-escalation-judge`)
    })

    test("given valid input when buildJudgeTaskArgs then category comes from escalation config", () => {
      const input = createValidInput()
      const args = buildJudgeTaskArgs(input)
      expect(args.category).toBe(input.config.escalation.category)
    })

    test("given input without escalation category when buildJudgeTaskArgs then falls back to executor category", () => {
      const input = createValidInput()
      input.config.escalation.category = undefined
      const args = buildJudgeTaskArgs(input)
      expect(args.category).toBe(input.config.executor.category)
    })

    test("given valid input when buildJudgeTaskArgs then description includes ESCALATION JUDGE", () => {
      const input = createValidInput()
      const args = buildJudgeTaskArgs(input)
      expect(args.description).toContain("[ESCALATION JUDGE]")
    })

    test("given valid input when buildJudgeTaskArgs then prompt contains escalation context", () => {
      const input = createValidInput()
      const args = buildJudgeTaskArgs(input)
      expect(args.prompt).toContain("Escalation Judge")
      expect(args.prompt).toContain(input.taskDescription)
    })
  })

  describe("createEscalationJudgeTask", () => {
    test("given valid input when createEscalationJudgeTask then returns EscalationJudgeResult", () => {
      const input = createValidInput()
      const result = createEscalationJudgeTask(input)
      expect(result).toHaveProperty("taskId")
      expect(result).toHaveProperty("sessionId")
      expect(result).toHaveProperty("evidencePath")
    })

    test("given valid input when createEscalationJudgeTask then evidence path is deterministic", () => {
      const input = createValidInput()
      const result = createEscalationJudgeTask(input)
      expect(result.evidencePath).toBe(
        `.sisyphus/evidence/impl-team/${input.runId}/escalation-judge.json`,
      )
    })

    test("given valid input when createEscalationJudgeTask then taskId is deterministic", () => {
      const input = createValidInput()
      const result = createEscalationJudgeTask(input)
      expect(result.taskId).toBe(`impl-team-${input.runId}-escalation-judge`)
    })

    test("given duplicate launch when createEscalationJudgeTask then returns existing result", () => {
      const input = createValidInput()
      const result1 = createEscalationJudgeTask(input)
      const result2 = createEscalationJudgeTask(input)
      expect(result1.taskId).toBe(result2.taskId)
      expect(result1.evidencePath).toBe(result2.evidencePath)
    })

    test("given valid input when createEscalationJudgeTask then cache size is 1", () => {
      const input = createValidInput()
      createEscalationJudgeTask(input)
      expect(_getJudgeTasksCacheSize()).toBe(1)
    })

    test("given different runIds when createEscalationJudgeTask then creates separate entries", () => {
      const input1 = createValidInput()
      input1.runId = "run-001"
      const input2 = createValidInput()
      input2.runId = "run-002"
      createEscalationJudgeTask(input1)
      createEscalationJudgeTask(input2)
      expect(_getJudgeTasksCacheSize()).toBe(2)
    })
  })

  describe("getExistingJudgeLaunchResult", () => {
    test("given non-existent runId when getExistingJudgeLaunchResult then returns undefined", () => {
      const result = getExistingJudgeLaunchResult("non-existent-run")
      expect(result).toBeUndefined()
    })

    test("given existing runId when getExistingJudgeLaunchResult then returns result", () => {
      const input = createValidInput()
      createEscalationJudgeTask(input)
      const result = getExistingJudgeLaunchResult(input.runId)
      expect(result).toBeDefined()
      expect(result?.taskId).toBe(`impl-team-${input.runId}-escalation-judge`)
    })
  })

  describe("validateEscalationEligibility", () => {
    test("given round 2 and CONVERGENCE_CHECK state when validateEscalationEligibility then does not throw", () => {
      let run: RunState = startRun("test-run")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      run = transition(run, "CONVERGENCE_CHECK")

      expect(() => validateEscalationEligibility(run)).not.toThrow()
    })

    test("given round 1 when validateEscalationEligibility then throws", () => {
      let run: RunState = startRun("test-run")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")

      expect(() => validateEscalationEligibility(run)).toThrow("Escalation not allowed")
    })

    test("given not at CONVERGENCE_CHECK when validateEscalationEligibility then throws", () => {
      let run: RunState = startRun("test-run")
      run = transition(run, "IMPLEMENT_ROUND_1")
      run = transition(run, "REVIEW_ROUND_1")
      run = transition(run, "AGGREGATE_ROUND_1")
      run = transition(run, "IMPLEMENT_ROUND_2")
      run = transition(run, "REVIEW_ROUND_2")
      run = transition(run, "AGGREGATE_ROUND_2")
      // Not transitioning to CONVERGENCE_CHECK

      expect(() => validateEscalationEligibility(run)).toThrow("Escalation not allowed")
    })

    test("given round 0 when validateEscalationEligibility then throws with round message", () => {
      const run: RunState = startRun("test-run")

      expect(() => validateEscalationEligibility(run)).toThrow("round >= 2")
    })
  })

  describe("parseJudgeOutput", () => {
    describe("given approve verdict", () => {
      test("when parseJudgeOutput then returns valid EscalationJudgeVerdict", () => {
        const raw = {
          verdict: "approve",
          reasoning: "All issues are acceptable risks",
          mandatory_changes: [],
        }
        const result = parseJudgeOutput(raw)
        expect(result).not.toHaveProperty("is_malformed")
        expect(result).toHaveProperty("verdict", "approve")
        expect(result).toHaveProperty("reasoning", "All issues are acceptable risks")
      })
    })

    describe("given revise-once-mandatory verdict", () => {
      test("when parseJudgeOutput then returns valid EscalationJudgeVerdict", () => {
        const raw = {
          verdict: "revise-once-mandatory",
          reasoning: "Security hardening required",
          mandatory_changes: [
            {
              id: "MC-001",
              description: "Add CSRF tokens",
              role: "security",
              priority: "mandatory",
            },
          ],
        }
        const result = parseJudgeOutput(raw)
        expect(result).not.toHaveProperty("is_malformed")
        expect(result).toHaveProperty("verdict", "revise-once-mandatory")
        expect(result).toHaveProperty("reasoning", "Security hardening required")
        if (!("is_malformed" in result)) {
          expect(result.mandatory_changes).toHaveLength(1)
        }
      })
    })

    describe("given reject-escalate-human verdict", () => {
      test("when parseJudgeOutput then returns valid EscalationJudgeVerdict", () => {
        const raw = {
          verdict: "reject-escalate-human",
          reasoning: "Fundamental architectural issues require human review",
          mandatory_changes: [],
        }
        const result = parseJudgeOutput(raw)
        expect(result).not.toHaveProperty("is_malformed")
        expect(result).toHaveProperty("verdict", "reject-escalate-human")
      })
    })

    describe("given invalid JSON string", () => {
      test("when parseJudgeOutput then returns MalformedVerdict", () => {
        const raw = '{"verdict": "approve"'
        const result = parseJudgeOutput(raw)
        expect(result).toHaveProperty("is_malformed", true)
        if ("is_malformed" in result) {
          expect(result.error_type).toBe("invalid_json")
        }
      })
    })

    describe("given missing essential fields", () => {
      test("when parseJudgeOutput then returns MalformedVerdict", () => {
        const raw = { verdict: "approve" }
        const result = parseJudgeOutput(raw)
        expect(result).toHaveProperty("is_malformed", true)
        if ("is_malformed" in result) {
          expect(result.error_type).toBe("missing_fields")
        }
      })
    })

    describe("given invalid verdict type", () => {
      test("when parseJudgeOutput then returns MalformedVerdict", () => {
        const raw = {
          verdict: "maybe",
          reasoning: "test",
          mandatory_changes: [],
        }
        const result = parseJudgeOutput(raw)
        expect(result).toHaveProperty("is_malformed", true)
        if ("is_malformed" in result) {
          expect(result.error_type).toBe("parse_error")
        }
      })
    })

    describe("given non-object input", () => {
      test("when parseJudgeOutput with string then returns MalformedVerdict", () => {
        const result = parseJudgeOutput("just some text")
        expect(result).toHaveProperty("is_malformed", true)
        if ("is_malformed" in result) {
          expect(result.error_type).toBe("invalid_json")
        }
      })

      test("when parseJudgeOutput with number then returns MalformedVerdict", () => {
        const result = parseJudgeOutput(42)
        expect(result).toHaveProperty("is_malformed", true)
        if ("is_malformed" in result) {
          expect(result.error_type).toBe("parse_error")
        }
      })

      test("when parseJudgeOutput with null then returns MalformedVerdict", () => {
        const result = parseJudgeOutput(null)
        expect(result).toHaveProperty("is_malformed", true)
        if ("is_malformed" in result) {
          expect(result.error_type).toBe("parse_error")
        }
      })
    })

    describe("given valid JSON string", () => {
      test("when parseJudgeOutput then parses correctly", () => {
        const raw = JSON.stringify({
          verdict: "approve",
          reasoning: "All issues resolved",
          mandatory_changes: [],
        })
        const result = parseJudgeOutput(raw)
        expect(result).not.toHaveProperty("is_malformed")
        expect(result).toHaveProperty("verdict", "approve")
      })
    })
  })

  describe("evidence path deterministic", () => {
    test("given same input when createEscalationJudgeTask multiple times then evidence path is same", () => {
      const input = createValidInput()
      const result1 = createEscalationJudgeTask(input)
      _resetJudgeTasksCache()
      const result2 = createEscalationJudgeTask(input)
      expect(result1.evidencePath).toBe(result2.evidencePath)
    })

    test("given runId with special characters when createEscalationJudgeTask then evidence path is correct", () => {
      const input = createValidInput()
      input.runId = "my-plan-ses_abc1-2026-04-26-r1"
      const result = createEscalationJudgeTask(input)
      expect(result.evidencePath).toBe(
        `.sisyphus/evidence/impl-team/my-plan-ses_abc1-2026-04-26-r1/escalation-judge.json`,
      )
    })
  })
})

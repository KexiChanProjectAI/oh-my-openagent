import { beforeEach, describe, expect, test } from "bun:test"
import type { ExecutorPatchBrief } from "./schemas"
import type { ResolvedImplementationTeamConfig } from "./config-resolver"
import {
  buildExecutorPrompt,
  buildExecutorTaskArgs,
  createExecutorTask,
  generateExecutorTaskId,
  getExistingLaunchResult,
  _resetLaunchedTasksCache,
  _getLaunchedTasksCacheSize,
} from "./executor-runner"

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockConfig(overrides?: Partial<ResolvedImplementationTeamConfig["executor"]>): ResolvedImplementationTeamConfig {
  return {
    enabled: true,
    executor: {
      category: "unspecified-high",
      model: undefined,
      fallbackModels: undefined,
      ...overrides,
    },
    roles: [],
    maxOrdinaryRounds: 2,
    escalation: {
      enabled: false,
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
  }
}

const mockUnresolvedFindings: ExecutorPatchBrief = {
  unresolved_blockers: [
    {
      id: "FIND-001",
      description: "Null pointer risk in user lookup",
      severity: "BLOCKER",
      category: "correctness",
      file_ref: "src/auth.ts:42",
    },
    {
      id: "FIND-002",
      description: "SQL injection vulnerability",
      severity: "BLOCKER",
      category: "security",
      file_ref: "src/db/queries.ts:15",
    },
  ],
  failed_role_ids: ["spec-fidelity", "security-review"],
  execution_round: 1,
}

// ============================================================================
// generateExecutorTaskId
// ============================================================================

describe("generateExecutorTaskId", () => {
  describe("#given runId and round", () => {
    test("#when generated #then returns deterministic task ID", () => {
      const taskId1 = generateExecutorTaskId("run-123", 1)
      const taskId2 = generateExecutorTaskId("run-123", 1)

      expect(taskId1).toBe("impl-team-run-123-round-1")
      expect(taskId1).toBe(taskId2)
    })
  })

  describe("#given different rounds for same run", () => {
    test("#when generated #then returns different task IDs", () => {
      const taskId1 = generateExecutorTaskId("run-123", 1)
      const taskId2 = generateExecutorTaskId("run-123", 2)

      expect(taskId1).not.toBe(taskId2)
      expect(taskId1).toBe("impl-team-run-123-round-1")
      expect(taskId2).toBe("impl-team-run-123-round-2")
    })
  })

  describe("#given different runs", () => {
    test("#when generated #then returns different task IDs", () => {
      const taskId1 = generateExecutorTaskId("run-123", 1)
      const taskId2 = generateExecutorTaskId("run-456", 1)

      expect(taskId1).not.toBe(taskId2)
      expect(taskId1).toBe("impl-team-run-123-round-1")
      expect(taskId2).toBe("impl-team-run-456-round-1")
    })
  })
})

// ============================================================================
// buildExecutorPrompt
// ============================================================================

describe("buildExecutorPrompt", () => {
  describe("#given round 1 input without unresolved findings", () => {
    test("#when built #then includes run metadata tag and task prompt", () => {
      const input = {
        runId: "run-123",
        round: 1,
        config: createMockConfig(),
        taskDescription: "Implement user authentication",
        taskPrompt: "Please implement user authentication with JWT tokens.",
      }

      const prompt = buildExecutorPrompt(input)

      expect(prompt).toContain("[IMPLEMENTATION_TEAM_RUN runId=run-123 round=1]")
      expect(prompt).toContain("Please implement user authentication with JWT tokens.")
      expect(prompt).not.toContain("UNRESOLVED FINDINGS")
    })
  })

  describe("#given round 2 input with unresolved findings", () => {
    test("#when built #then includes unresolved findings section", () => {
      const input = {
        runId: "run-123",
        round: 2,
        config: createMockConfig(),
        taskDescription: "Fix authentication issues",
        taskPrompt: "Please fix the authentication issues identified in review.",
        unresolvedFindings: mockUnresolvedFindings,
      }

      const prompt = buildExecutorPrompt(input)

      expect(prompt).toContain("[IMPLEMENTATION_TEAM_RUN runId=run-123 round=2]")
      expect(prompt).toContain("Please fix the authentication issues identified in review.")
      expect(prompt).toContain("UNRESOLVED FINDINGS FROM PREVIOUS ROUND")
      expect(prompt).toContain("Null pointer risk in user lookup")
      expect(prompt).toContain("SQL injection vulnerability")
      expect(prompt).toContain("src/auth.ts:42")
      expect(prompt).toContain("src/db/queries.ts:15")
      expect(prompt).toContain("Failed Review Roles: spec-fidelity, security-review")
    })
  })

  describe("#given round > 1 but no unresolved findings", () => {
    test("#when built #then does not include findings section", () => {
      const input = {
        runId: "run-123",
        round: 3,
        config: createMockConfig(),
        taskDescription: "Implement feature",
        taskPrompt: "Please implement the feature.",
        unresolvedFindings: undefined,
      }

      const prompt = buildExecutorPrompt(input)

      expect(prompt).toContain("[IMPLEMENTATION_TEAM_RUN runId=run-123 round=3]")
      expect(prompt).not.toContain("UNRESOLVED FINDINGS")
    })
  })
})

// ============================================================================
// buildExecutorTaskArgs
// ============================================================================

describe("buildExecutorTaskArgs", () => {
  describe("#given initial executor round (round 1)", () => {
    test("#when built #then creates correct task args", () => {
      const input = {
        runId: "run-123",
        round: 1,
        config: createMockConfig(),
        taskDescription: "Implement user authentication",
        taskPrompt: "Please implement user authentication with JWT tokens.",
      }

      const args = buildExecutorTaskArgs(input)

      expect(args.description).toBe("[run-123] Implement user authentication")
      expect(args.prompt).toContain("[IMPLEMENTATION_TEAM_RUN runId=run-123 round=1]")
      expect(args.prompt).toContain("Please implement user authentication with JWT tokens.")
      expect(args.category).toBe("unspecified-high")
      expect(args.run_in_background).toBe(true)
      expect(args.task_id).toBe("impl-team-run-123-round-1")
      expect(args.load_skills).toEqual([])
    })
  })

  describe("#given custom executor category", () => {
    test("#when built #then uses custom category", () => {
      const input = {
        runId: "run-123",
        round: 1,
        config: createMockConfig({ category: "deep" }),
        taskDescription: "Implement complex feature",
        taskPrompt: "Please implement the complex feature.",
      }

      const args = buildExecutorTaskArgs(input)

      expect(args.category).toBe("deep")
    })
  })

  describe("#given missing executor category", () => {
    test("#when built #then uses default unspecified-high category", () => {
      const input = {
        runId: "run-123",
        round: 1,
        config: createMockConfig({ category: undefined }),
        taskDescription: "Implement feature",
        taskPrompt: "Please implement the feature.",
      }

      const args = buildExecutorTaskArgs(input)

      expect(args.category).toBe("unspecified-high")
    })
  })

  describe("#given fix round with unresolved findings", () => {
    test("#when built #then includes findings in prompt", () => {
      const input = {
        runId: "run-123",
        round: 2,
        config: createMockConfig(),
        taskDescription: "Fix authentication issues",
        taskPrompt: "Please fix the authentication issues.",
        unresolvedFindings: mockUnresolvedFindings,
      }

      const args = buildExecutorTaskArgs(input)

      expect(args.prompt).toContain("UNRESOLVED FINDINGS FROM PREVIOUS ROUND")
      expect(args.prompt).toContain("Null pointer risk in user lookup")
      expect(args.prompt).toContain("SQL injection vulnerability")
      expect(args.task_id).toBe("impl-team-run-123-round-2")
    })
  })
})

// ============================================================================
// createExecutorTask
// ============================================================================

describe("createExecutorTask", () => {
  beforeEach(() => {
    _resetLaunchedTasksCache()
  })

  describe("#given initial executor round", () => {
    test("#when created #then returns correct launch result", () => {
      const input = {
        runId: "run-123",
        round: 1,
        config: createMockConfig(),
        taskDescription: "Implement user authentication",
        taskPrompt: "Please implement user authentication with JWT tokens.",
      }

      const result = createExecutorTask(input)

      expect(result.taskId).toBe("impl-team-run-123-round-1")
      expect(result.round).toBe(1)
      expect(result.evidencePath).toBe(".sisyphus/evidence/impl-team/run-123/round-1/")
      expect(result.sessionId).toBe("") // Empty initially, populated by BackgroundManager
    })
  })

  describe("#given deterministic evidence path", () => {
    test("#when called multiple times with same input #then returns same evidence path", () => {
      const input = {
        runId: "run-456",
        round: 1,
        config: createMockConfig(),
        taskDescription: "Test task",
        taskPrompt: "Test prompt",
      }

      const result1 = createExecutorTask(input)
      _resetLaunchedTasksCache()
      const result2 = createExecutorTask(input)

      expect(result1.evidencePath).toBe(result2.evidencePath)
    })
  })

  describe("#given task ID is deterministic", () => {
    test("#when called multiple times with same run+round #then returns same task ID", () => {
      const input = {
        runId: "run-789",
        round: 2,
        config: createMockConfig(),
        taskDescription: "Test task",
        taskPrompt: "Test prompt",
      }

      const result1 = createExecutorTask(input)
      _resetLaunchedTasksCache()
      const result2 = createExecutorTask(input)

      expect(result1.taskId).toBe(result2.taskId)
    })
  })

  describe("#given duplicate launch prevention", () => {
    test("#when called twice with same runId+round #then returns existing result", () => {
      const input = {
        runId: "run-dup",
        round: 1,
        config: createMockConfig(),
        taskDescription: "First call",
        taskPrompt: "First prompt",
      }

      const result1 = createExecutorTask(input)

      // Modify input to simulate second call
      const input2 = {
        ...input,
        taskDescription: "Second call",
        taskPrompt: "Second prompt",
      }
      const result2 = createExecutorTask(input2)

      // Should return the first result, not create a new one
      expect(result1).toBe(result2)
    })
  })

  describe("#given different rounds", () => {
    test("#when created for round 1 and round 2 #then returns different results", () => {
      const input1 = {
        runId: "run-multi",
        round: 1,
        config: createMockConfig(),
        taskDescription: "Task 1",
        taskPrompt: "Prompt 1",
      }

      const input2 = {
        runId: "run-multi",
        round: 2,
        config: createMockConfig(),
        taskDescription: "Task 2",
        taskPrompt: "Prompt 2",
        unresolvedFindings: mockUnresolvedFindings,
      }

      const result1 = createExecutorTask(input1)
      const result2 = createExecutorTask(input2)

      expect(result1.taskId).toBe("impl-team-run-multi-round-1")
      expect(result2.taskId).toBe("impl-team-run-multi-round-2")
      expect(result1.round).toBe(1)
      expect(result2.round).toBe(2)
      expect(result1.evidencePath).toContain("round-1/")
      expect(result2.evidencePath).toContain("round-2/")
    })
  })

  describe("#given cache size tracking", () => {
    test("#when creating tasks #then cache size increases correctly", () => {
      expect(_getLaunchedTasksCacheSize()).toBe(0)

      const input1 = {
        runId: "run-cache",
        round: 1,
        config: createMockConfig(),
        taskDescription: "Task 1",
        taskPrompt: "Prompt 1",
      }
      createExecutorTask(input1)
      expect(_getLaunchedTasksCacheSize()).toBe(1)

      const input2 = {
        runId: "run-cache",
        round: 2,
        config: createMockConfig(),
        taskDescription: "Task 2",
        taskPrompt: "Prompt 2",
      }
      createExecutorTask(input2)
      expect(_getLaunchedTasksCacheSize()).toBe(2)

      // Duplicate should not increase cache
      createExecutorTask(input1)
      expect(_getLaunchedTasksCacheSize()).toBe(2)
    })
  })

  describe("#given getExistingLaunchResult", () => {
    test("#when result exists #then returns existing result", () => {
      const input = {
        runId: "run-exists",
        round: 1,
        config: createMockConfig(),
        taskDescription: "Task",
        taskPrompt: "Prompt",
      }

      const result = createExecutorTask(input)
      const existing = getExistingLaunchResult("run-exists", 1)

      expect(existing).toBe(result)
    })

    test("#when result does not exist #then returns undefined", () => {
      const existing = getExistingLaunchResult("non-existent", 1)

      expect(existing).toBeUndefined()
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe("buildExecutorPrompt edge cases", () => {
  describe("#given empty unresolved blockers array", () => {
    test("#when built for round 2 #then does not include blockers section", () => {
      const input = {
        runId: "run-empty",
        round: 2,
        config: createMockConfig(),
        taskDescription: "Task",
        taskPrompt: "Prompt",
        unresolvedFindings: {
          unresolved_blockers: [],
          failed_role_ids: [],
          execution_round: 1,
        },
      }

      const prompt = buildExecutorPrompt(input)

      expect(prompt).toContain("UNRESOLVED FINDINGS")
      expect(prompt).not.toContain("## Blockers to Resolve:")
    })
  })

  describe("#given finding without file_ref", () => {
    test("#when built #then handles missing file_ref gracefully", () => {
      const input = {
        runId: "run-no-ref",
        round: 2,
        config: createMockConfig(),
        taskDescription: "Task",
        taskPrompt: "Prompt",
        unresolvedFindings: {
          unresolved_blockers: [
            {
              id: "FIND-003",
              description: "Minor issue",
              severity: "MINOR",
              category: "maintainability",
              file_ref: undefined,
            },
          ],
          failed_role_ids: [],
          execution_round: 1,
        },
      }

      const prompt = buildExecutorPrompt(input)

      expect(prompt).toContain("Minor issue")
      expect(prompt).not.toContain("Location:")
    })
  })
})
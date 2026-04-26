import { describe, expect, test } from "bun:test"
import {
  MAX_ROLES,
  MAX_REVIEWERS_PER_ROLE,
  MAX_ORDINARY_ROUNDS,
  MAX_ESCALATION_JUDGE_RUNS,
  MAX_TOTAL_SPAWNED_TASKS,
  validateResourceCaps,
  checkSpawnLimit,
} from "./resource-caps"
import type { ResolvedImplementationTeamConfig } from "./config-resolver"

// ============================================================================
// Test Data Helpers
// ============================================================================

function createMinimalConfig(overrides?: Partial<ResolvedImplementationTeamConfig>): ResolvedImplementationTeamConfig {
  return {
    enabled: true,
    executor: { category: "ultrabrain" },
    roles: [
      {
        id: "test-role",
        name: "Test Role",
        reviewers: [{ model: "default" }],
        blockerPolicy: "any_blocker_fails_role",
      },
    ],
    maxOrdinaryRounds: 1,
    escalation: { enabled: true },
    resourceCaps: {
      maxTotalSpawnedTasks: 50,
      maxReviewersPerRole: 5,
      maxRoles: 3,
    },
    passPolicy: { requireAllRolesPass: true },
    blockerPolicy: { anyBlockerFailsRole: true },
    defaultRoles: false,
    ...overrides,
  }
}

// ============================================================================
// validateResourceCaps Tests
// ============================================================================

describe("validateResourceCaps", () => {
  describe("given a valid minimal config", () => {
    test("when config has 1 role with 1 reviewer and 1 round", () => {
      const config = createMinimalConfig()
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe("given disabled config", () => {
    test("when enabled is false, returns valid=true regardless of values", () => {
      const config = createMinimalConfig({
        enabled: false,
        roles: Array(10).fill(null).map((_, i) => ({
          id: `role-${i}`,
          name: `Role ${i}`,
          reviewers: Array(10).fill(null).map((__, j) => ({ model: `model-${j}` })),
          blockerPolicy: "any_blocker_fails_role",
        })),
        maxOrdinaryRounds: 10,
      })
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe("given too many roles", () => {
    test("when roles exceed MAX_ROLES, returns errors", () => {
      const config = createMinimalConfig({
        roles: Array(MAX_ROLES + 1).fill(null).map((_, i) => ({
          id: `role-${i}`,
          name: `Role ${i}`,
          reviewers: [{ model: "default" }],
          blockerPolicy: "any_blocker_fails_role",
        })),
      })
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].field).toBe("roles")
      expect(result.errors[0].actual).toBe(MAX_ROLES + 1)
      expect(result.errors[0].maxAllowed).toBe(MAX_ROLES)
    })
  })

  describe("given too many reviewers per role", () => {
    test("when a role has more reviewers than MAX_REVIEWERS_PER_ROLE, returns error", () => {
      const config = createMinimalConfig({
        roles: [
          {
            id: "big-role",
            name: "Big Role",
            reviewers: Array(MAX_REVIEWERS_PER_ROLE + 1).fill(null).map((_, i) => ({
              model: `model-${i}`,
            })),
            blockerPolicy: "any_blocker_fails_role",
          },
        ],
      })
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].field).toBe("roles.big-role.reviewers")
      expect(result.errors[0].actual).toBe(MAX_REVIEWERS_PER_ROLE + 1)
      expect(result.errors[0].maxAllowed).toBe(MAX_REVIEWERS_PER_ROLE)
    })
  })

  describe("given multiple roles with excess reviewers", () => {
    test("when multiple roles exceed MAX_REVIEWERS_PER_ROLE, returns all errors", () => {
      const config = createMinimalConfig({
        roles: [
          {
            id: "big-role-1",
            name: "Big Role 1",
            reviewers: Array(MAX_REVIEWERS_PER_ROLE + 1).fill(null).map((_, i) => ({
              model: `model-${i}`,
            })),
            blockerPolicy: "any_blocker_fails_role",
          },
          {
            id: "big-role-2",
            name: "Big Role 2",
            reviewers: Array(MAX_REVIEWERS_PER_ROLE + 2).fill(null).map((_, i) => ({
              model: `model-${i}`,
            })),
            blockerPolicy: "any_blocker_fails_role",
          },
        ],
      })
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(2)
      expect(result.errors[0].field).toBe("roles.big-role-1.reviewers")
      expect(result.errors[1].field).toBe("roles.big-role-2.reviewers")
    })
  })

  describe("given too many ordinary rounds", () => {
    test("when maxOrdinaryRounds exceeds MAX_ORDINARY_ROUNDS, returns error", () => {
      const config = createMinimalConfig({
        maxOrdinaryRounds: MAX_ORDINARY_ROUNDS + 1,
      })
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].field).toBe("maxOrdinaryRounds")
      expect(result.errors[0].actual).toBe(MAX_ORDINARY_ROUNDS + 1)
      expect(result.errors[0].maxAllowed).toBe(MAX_ORDINARY_ROUNDS)
    })
  })

  describe("given multiple violations", () => {
    test("when config has roles AND reviewers AND rounds violations, returns all errors", () => {
      const config = createMinimalConfig({
        roles: Array(MAX_ROLES + 2).fill(null).map((_, i) => ({
          id: `role-${i}`,
          name: `Role ${i}`,
          reviewers: Array(MAX_REVIEWERS_PER_ROLE + 1).fill(null).map((__, j) => ({
            model: `model-${j}`,
          })),
          blockerPolicy: "any_blocker_fails_role",
        })),
        maxOrdinaryRounds: MAX_ORDINARY_ROUNDS + 3,
      })
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(false)
      // 1 for too many roles, 1 for too many rounds, and 1 for each role's reviewers
      const expectedErrors = 1 + 1 + config.roles.length
      expect(result.errors).toHaveLength(expectedErrors)
    })
  })

  describe("given config at exact limits", () => {
    test("when roles = MAX_ROLES, reviewers = MAX_REVIEWERS_PER_ROLE, rounds = MAX_ORDINARY_ROUNDS, returns valid", () => {
      const config = createMinimalConfig({
        roles: Array(MAX_ROLES).fill(null).map((_, i) => ({
          id: `role-${i}`,
          name: `Role ${i}`,
          reviewers: Array(MAX_REVIEWERS_PER_ROLE).fill(null).map((__, j) => ({
            model: `model-${j}`,
          })),
          blockerPolicy: "any_blocker_fails_role",
        })),
        maxOrdinaryRounds: MAX_ORDINARY_ROUNDS,
      })
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe("given escalation disabled", () => {
    test("when escalation.enabled is false, still validates other fields", () => {
      const config = createMinimalConfig({
        escalation: { enabled: false },
        roles: Array(MAX_ROLES + 1).fill(null).map((_, i) => ({
          id: `role-${i}`,
          name: `Role ${i}`,
          reviewers: [{ model: "default" }],
          blockerPolicy: "any_blocker_fails_role",
        })),
      })
      const result = validateResourceCaps(config)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].field).toBe("roles")
    })
  })
})

// ============================================================================
// checkSpawnLimit Tests
// ============================================================================

describe("checkSpawnLimit", () => {
  describe("given current count below limit", () => {
    test("when currentCount < maxAllowed, returns allowed=true", () => {
      const result = checkSpawnLimit(5, 20)
      expect(result.allowed).toBe(true)
      expect(result.current).toBe(5)
      expect(result.max).toBe(20)
    })
  })

  describe("given current count at limit", () => {
    test("when currentCount === maxAllowed, returns allowed=false", () => {
      const result = checkSpawnLimit(20, 20)
      expect(result.allowed).toBe(false)
      expect(result.current).toBe(20)
      expect(result.max).toBe(20)
    })
  })

  describe("given current count above limit", () => {
    test("when currentCount > maxAllowed, returns allowed=false", () => {
      const result = checkSpawnLimit(25, 20)
      expect(result.allowed).toBe(false)
      expect(result.current).toBe(25)
      expect(result.max).toBe(20)
    })
  })

  describe("given zero current count", () => {
    test("when currentCount is 0, returns allowed=true", () => {
      const result = checkSpawnLimit(0, MAX_TOTAL_SPAWNED_TASKS)
      expect(result.allowed).toBe(true)
      expect(result.current).toBe(0)
      expect(result.max).toBe(MAX_TOTAL_SPAWNED_TASKS)
    })
  })

  describe("given maxAllowed equals MAX_TOTAL_SPAWNED_TASKS", () => {
    test("when spawning would reach the cap, returns correct values", () => {
      const result = checkSpawnLimit(19, MAX_TOTAL_SPAWNED_TASKS)
      expect(result.allowed).toBe(true)
      expect(result.current).toBe(19)
      expect(result.max).toBe(MAX_TOTAL_SPAWNED_TASKS)
    })

    test("when spawning would exceed the cap, returns allowed=false", () => {
      const result = checkSpawnLimit(20, MAX_TOTAL_SPAWNED_TASKS)
      expect(result.allowed).toBe(false)
      expect(result.current).toBe(20)
      expect(result.max).toBe(MAX_TOTAL_SPAWNED_TASKS)
    })
  })
})

// ============================================================================
// Hard Limit Constants Tests
// ============================================================================

describe("hard limit constants", () => {
  test("MAX_ROLES is 5", () => {
    expect(MAX_ROLES).toBe(5)
  })

  test("MAX_REVIEWERS_PER_ROLE is 3", () => {
    expect(MAX_REVIEWERS_PER_ROLE).toBe(3)
  })

  test("MAX_ORDINARY_ROUNDS is 2", () => {
    expect(MAX_ORDINARY_ROUNDS).toBe(2)
  })

  test("MAX_ESCALATION_JUDGE_RUNS is 1", () => {
    expect(MAX_ESCALATION_JUDGE_RUNS).toBe(1)
  })

  test("MAX_TOTAL_SPAWNED_TASKS is 20", () => {
    expect(MAX_TOTAL_SPAWNED_TASKS).toBe(20)
  })
})

import { describe, expect, test } from "bun:test"
import {
  resolveImplementationTeamConfig,
  getDefaultRoles,
  validateRoleDefinitions,
  ImplementationTeamConfigError,
} from "./config-resolver"

describe("resolveImplementationTeamConfig", () => {
  describe("given no config provided", () => {
    test("when config is empty object, then applies defaults with default roles", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.enabled).toBe(true)
      expect(result.defaultRoles).toBe(true)
      expect(result.roles).toHaveLength(3)
      expect(result.maxOrdinaryRounds).toBe(2)
      expect(result.escalation.enabled).toBe(true)
      expect(result.resourceCaps.maxTotalSpawnedTasks).toBe(50)
      expect(result.resourceCaps.maxReviewersPerRole).toBe(5)
      expect(result.resourceCaps.maxRoles).toBe(3)
      expect(result.passPolicy.requireAllRolesPass).toBe(true)
      expect(result.blockerPolicy.anyBlockerFailsRole).toBe(true)
    })

    test("when config is null, then throws descriptive error", () => {
      expect(() => resolveImplementationTeamConfig(null)).toThrow(
        ImplementationTeamConfigError,
      )
    })

    test("when config is undefined, then applies defaults", () => {
      const result = resolveImplementationTeamConfig(undefined)

      expect(result.enabled).toBe(true)
      expect(result.defaultRoles).toBe(true)
      expect(result.roles).toHaveLength(3)
    })
  })

  describe("given default roles", () => {
    test("when roles not provided, then uses three default roles", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.defaultRoles).toBe(true)
      expect(result.roles).toEqual(getDefaultRoles())
    })

    test("when roles is empty array, then uses default roles", () => {
      const result = resolveImplementationTeamConfig({ roles: [] })

      expect(result.defaultRoles).toBe(true)
      expect(result.roles).toEqual(getDefaultRoles())
    })

    test("when roles is explicitly empty, then defaultRoles is true", () => {
      const result = resolveImplementationTeamConfig({ roles: [] })

      expect(result.defaultRoles).toBe(true)
    })
  })

  describe("given custom roles", () => {
    test("when custom roles provided, then overrides defaults", () => {
      const customRoles = [
        {
          id: "custom-role",
          name: "Custom Role",
          description: "A custom review role",
          reviewers: [{ model: "anthropic/claude-sonnet-4-6" }],
          blocker_policy: "any_blocker_fails_role",
        },
      ]

      const result = resolveImplementationTeamConfig({ roles: customRoles })

      expect(result.defaultRoles).toBe(false)
      expect(result.roles).toHaveLength(1)
      expect(result.roles[0].id).toBe("custom-role")
      expect(result.roles[0].name).toBe("Custom Role")
      expect(result.roles[0].reviewers).toEqual([
        { model: "anthropic/claude-sonnet-4-6" },
      ])
    })

    test("when custom role has reviewer with category, then preserves category", () => {
      const customRoles = [
        {
          id: "specialized-review",
          name: "Specialized Review",
          reviewers: [{ model: "gpt-5.5", category: "ultrabrain" }],
        },
      ]

      const result = resolveImplementationTeamConfig({ roles: customRoles })

      expect(result.roles[0].reviewers[0]).toEqual({
        model: "gpt-5.5",
        category: "ultrabrain",
      })
    })

    test("when custom role omits blocker_policy, then defaults to any_blocker_fails_role", () => {
      const customRoles = [
        {
          id: "no-policy",
          name: "No Policy Role",
          reviewers: [{ model: "default" }],
        },
      ]

      const result = resolveImplementationTeamConfig({ roles: customRoles })

      expect(result.roles[0].blockerPolicy).toBe("any_blocker_fails_role")
    })
  })

  describe("given enabled flag", () => {
    test("when enabled is true, then enabled is true", () => {
      const result = resolveImplementationTeamConfig({ enabled: true })

      expect(result.enabled).toBe(true)
    })

    test("when enabled is false, then enabled is false", () => {
      const result = resolveImplementationTeamConfig({ enabled: false })

      expect(result.enabled).toBe(false)
    })

    test("when enabled not provided, then defaults to true", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.enabled).toBe(true)
    })
  })

  describe("given executor config", () => {
    test("when executor provided, then preserves settings", () => {
      const config = {
        executor: {
          category: "ultrabrain",
          model: "gpt-5.5",
          fallback_models: ["anthropic/claude-opus-4-7"],
        },
      }

      const result = resolveImplementationTeamConfig(config)

      expect(result.executor.category).toBe("ultrabrain")
      expect(result.executor.model).toBe("gpt-5.5")
      expect(result.executor.fallbackModels).toEqual(["anthropic/claude-opus-4-7"])
    })

    test("when executor not provided, then uses unspecified-high category", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.executor.category).toBe("unspecified-high")
      expect(result.executor.model).toBeUndefined()
    })

    test("when executor has model-only config, then category is required", () => {
      const config = {
        executor: {
          category: "quick",
        },
      }

      const result = resolveImplementationTeamConfig(config)

      expect(result.executor.category).toBe("quick")
    })
  })

  describe("given escalation config", () => {
    test("when escalation provided with all fields, then preserves all", () => {
      const config = {
        escalation: {
          enabled: false,
          model: "gpt-5.5",
          category: "deep",
          fallback_models: ["anthropic/claude-opus-4-7"],
        },
      }

      const result = resolveImplementationTeamConfig(config)

      expect(result.escalation.enabled).toBe(false)
      expect(result.escalation.model).toBe("gpt-5.5")
      expect(result.escalation.category).toBe("deep")
      expect(result.escalation.fallbackModels).toEqual(["anthropic/claude-opus-4-7"])
    })

    test("when escalation not provided, then defaults enabled to true", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.escalation.enabled).toBe(true)
    })

    test("when escalation.enabled explicitly true, then true", () => {
      const result = resolveImplementationTeamConfig({ escalation: { enabled: true } })

      expect(result.escalation.enabled).toBe(true)
    })
  })

  describe("given resource caps", () => {
    test("when resource_caps provided, then preserves values", () => {
      const config = {
        resource_caps: {
          max_total_spawned_tasks: 100,
          max_reviewers_per_role: 3,
          max_roles: 5,
        },
      }

      const result = resolveImplementationTeamConfig(config)

      expect(result.resourceCaps.maxTotalSpawnedTasks).toBe(100)
      expect(result.resourceCaps.maxReviewersPerRole).toBe(3)
      expect(result.resourceCaps.maxRoles).toBe(5)
    })

    test("when resource_caps not provided, then uses defaults", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.resourceCaps.maxTotalSpawnedTasks).toBe(50)
      expect(result.resourceCaps.maxReviewersPerRole).toBe(5)
      expect(result.resourceCaps.maxRoles).toBe(3)
    })
  })

  describe("given pass policy", () => {
    test("when pass_policy.require_all_roles_pass is false, then false", () => {
      const config = {
        pass_policy: { require_all_roles_pass: false },
      }

      const result = resolveImplementationTeamConfig(config)

      expect(result.passPolicy.requireAllRolesPass).toBe(false)
    })

    test("when pass_policy not provided, then defaults to true", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.passPolicy.requireAllRolesPass).toBe(true)
    })
  })

  describe("given blocker policy", () => {
    test("when blocker_policy.any_blocker_fails_role is false, then false", () => {
      const config = {
        blocker_policy: { any_blocker_fails_role: false },
      }

      const result = resolveImplementationTeamConfig(config)

      expect(result.blockerPolicy.anyBlockerFailsRole).toBe(false)
    })

    test("when blocker_policy not provided, then defaults to true", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.blockerPolicy.anyBlockerFailsRole).toBe(true)
    })
  })

  describe("given max_ordinary_rounds", () => {
    test("when within valid range, then preserves value", () => {
      const result = resolveImplementationTeamConfig({ max_ordinary_rounds: 3 })

      expect(result.maxOrdinaryRounds).toBe(3)
    })

    test("when at minimum boundary (1), then 1", () => {
      const result = resolveImplementationTeamConfig({ max_ordinary_rounds: 1 })

      expect(result.maxOrdinaryRounds).toBe(1)
    })

    test("when at maximum boundary (5), then 5", () => {
      const result = resolveImplementationTeamConfig({ max_ordinary_rounds: 5 })

      expect(result.maxOrdinaryRounds).toBe(5)
    })

    test("when below minimum (0), then throws error", () => {
      expect(() => resolveImplementationTeamConfig({ max_ordinary_rounds: 0 })).toThrow(
        ImplementationTeamConfigError,
      )
    })

    test("when above maximum (6), then throws error", () => {
      expect(() => resolveImplementationTeamConfig({ max_ordinary_rounds: 6 })).toThrow(
        ImplementationTeamConfigError,
      )
    })

    test("when not provided, then defaults to 2", () => {
      const result = resolveImplementationTeamConfig({})

      expect(result.maxOrdinaryRounds).toBe(2)
    })
  })

  describe("given duplicate role IDs", () => {
    test("when duplicate role IDs exist, then throws descriptive error", () => {
      const config = {
        roles: [
          { id: "role-1", name: "Role 1", reviewers: [{ model: "default" }] },
          { id: "role-1", name: "Role 1 Duplicate", reviewers: [{ model: "default" }] },
        ],
      }

      expect(() => resolveImplementationTeamConfig(config)).toThrow(
        ImplementationTeamConfigError,
      )
    })
  })

  describe("given empty reviewer arrays", () => {
    test("when role has no reviewers, then throws error", () => {
      const config = {
        roles: [{ id: "empty-role", name: "Empty Role", reviewers: [] }],
      }

      expect(() => resolveImplementationTeamConfig(config)).toThrow(
        ImplementationTeamConfigError,
      )
    })
  })

  describe("given resource cap violations", () => {
    test("when too many roles defined, then throws error", () => {
      const config = {
        roles: [
          { id: "role-1", name: "Role 1", reviewers: [{ model: "default" }] },
          { id: "role-2", name: "Role 2", reviewers: [{ model: "default" }] },
          { id: "role-3", name: "Role 3", reviewers: [{ model: "default" }] },
          { id: "role-4", name: "Role 4", reviewers: [{ model: "default" }] },
        ],
        resource_caps: { max_roles: 3 },
      }

      expect(() => resolveImplementationTeamConfig(config)).toThrow(
        ImplementationTeamConfigError,
      )
    })

    test("when role exceeds max reviewers, then throws error", () => {
      const config = {
        roles: [
          {
            id: "role-1",
            name: "Role 1",
            reviewers: [
              { model: "model-1" },
              { model: "model-2" },
              { model: "model-3" },
              { model: "model-4" },
              { model: "model-5" },
              { model: "model-6" },
            ],
          },
        ],
        resource_caps: { max_reviewers_per_role: 5 },
      }

      expect(() => resolveImplementationTeamConfig(config)).toThrow(
        ImplementationTeamConfigError,
      )
    })
  })

  describe("given disabled config", () => {
    test("when enabled is false, then returns enabled=false with defaults", () => {
      const result = resolveImplementationTeamConfig({ enabled: false })

      expect(result.enabled).toBe(false)
      expect(result.defaultRoles).toBe(true)
      expect(result.roles).toHaveLength(3)
    })
  })

  describe("given full custom config", () => {
    test("when all fields provided, then preserves all settings", () => {
      const config = {
        enabled: true,
        executor: {
          category: "ultrabrain",
          model: "gpt-5.5",
          fallback_models: ["anthropic/claude-opus-4-7"],
        },
        roles: [
          {
            id: "spec-fidelity",
            name: "Spec Fidelity",
            description: "Checks implementation against spec",
            reviewers: [{ model: "anthropic/claude-sonnet-4-6" }],
            blocker_policy: "any_blocker_fails_role",
          },
          {
            id: "code-quality",
            name: "Code Quality",
            reviewers: [{ model: "gpt-5.5", category: "ultrabrain" }],
          },
        ],
        max_ordinary_rounds: 3,
        escalation: {
          enabled: true,
          model: "gpt-5.5",
          category: "deep",
          fallback_models: ["anthropic/claude-opus-4-7"],
        },
        resource_caps: {
          max_total_spawned_tasks: 100,
          max_reviewers_per_role: 3,
          max_roles: 5,
        },
        pass_policy: {
          require_all_roles_pass: false,
        },
        blocker_policy: {
          any_blocker_fails_role: false,
        },
      }

      const result = resolveImplementationTeamConfig(config)

      expect(result.enabled).toBe(true)
      expect(result.defaultRoles).toBe(false)
      expect(result.executor.category).toBe("ultrabrain")
      expect(result.executor.model).toBe("gpt-5.5")
      expect(result.roles).toHaveLength(2)
      expect(result.maxOrdinaryRounds).toBe(3)
      expect(result.escalation.enabled).toBe(true)
      expect(result.escalation.model).toBe("gpt-5.5")
      expect(result.resourceCaps.maxTotalSpawnedTasks).toBe(100)
      expect(result.passPolicy.requireAllRolesPass).toBe(false)
      expect(result.blockerPolicy.anyBlockerFailsRole).toBe(false)
    })
  })

  describe("given invalid raw input", () => {
    test("when config has invalid field types, then throws Zod error", () => {
      const invalidConfig = {
        enabled: "not-a-boolean",
        max_ordinary_rounds: "not-a-number",
      }

      expect(() => resolveImplementationTeamConfig(invalidConfig)).toThrow()
    })

    test("when executor.category is missing, then throws descriptive error", () => {
      const invalidConfig = {
        executor: {
          model: "some-model",
        },
      }

      expect(() => resolveImplementationTeamConfig(invalidConfig)).toThrow(
        ImplementationTeamConfigError,
      )
    })

    test("when role has invalid structure, then throws error", () => {
      const invalidConfig = {
        roles: [
          {
            id: 123,
            name: "Bad Role",
            reviewers: [{ model: "default" }],
          },
        ],
      }

      expect(() => resolveImplementationTeamConfig(invalidConfig)).toThrow()
    })
  })
})

describe("getDefaultRoles", () => {
  test("returns exactly three default roles", () => {
    const defaults = getDefaultRoles()

    expect(defaults).toHaveLength(3)
  })

  test("each default role has one reviewer with model default", () => {
    const defaults = getDefaultRoles()

    for (const role of defaults) {
      expect(role.reviewers).toHaveLength(1)
      expect(role.reviewers[0].model).toBe("default")
    }
  })

  test("default roles have expected IDs", () => {
    const defaults = getDefaultRoles()
    const ids = defaults.map((r) => r.id)

    expect(ids).toContain("spec-fidelity")
    expect(ids).toContain("code-quality")
    expect(ids).toContain("risk-regression")
  })

  test("each default role has blocker policy set", () => {
    const defaults = getDefaultRoles()

    for (const role of defaults) {
      expect(role.blockerPolicy).toBe("any_blocker_fails_role")
    }
  })
})

describe("validateRoleDefinitions", () => {
  test("when roles within caps, then does not throw", () => {
    const caps = {
      maxTotalSpawnedTasks: 50,
      maxReviewersPerRole: 5,
      maxRoles: 3,
    }
    const roles = [
      { id: "r1", name: "R1", reviewers: [{ model: "m1" }], blockerPolicy: "any" },
      { id: "r2", name: "R2", reviewers: [{ model: "m1" }], blockerPolicy: "any" },
    ]

    expect(() => validateRoleDefinitions(roles, caps)).not.toThrow()
  })

  test("when roles exceed maxRoles, then throws ImplementationTeamConfigError", () => {
    const caps = {
      maxTotalSpawnedTasks: 50,
      maxReviewersPerRole: 5,
      maxRoles: 2,
    }
    const roles = [
      { id: "r1", name: "R1", reviewers: [{ model: "m1" }], blockerPolicy: "any" },
      { id: "r2", name: "R2", reviewers: [{ model: "m1" }], blockerPolicy: "any" },
      { id: "r3", name: "R3", reviewers: [{ model: "m1" }], blockerPolicy: "any" },
    ]

    expect(() => validateRoleDefinitions(roles, caps)).toThrow(
      ImplementationTeamConfigError,
    )
  })

  test("when role has empty reviewers, then throws ImplementationTeamConfigError", () => {
    const caps = {
      maxTotalSpawnedTasks: 50,
      maxReviewersPerRole: 5,
      maxRoles: 3,
    }
    const roles = [
      { id: "r1", name: "R1", reviewers: [], blockerPolicy: "any" },
    ]

    expect(() => validateRoleDefinitions(roles, caps)).toThrow(
      ImplementationTeamConfigError,
    )
  })

  test("when role exceeds maxReviewersPerRole, then throws ImplementationTeamConfigError", () => {
    const caps = {
      maxTotalSpawnedTasks: 50,
      maxReviewersPerRole: 2,
      maxRoles: 3,
    }
    const roles = [
      {
        id: "r1",
        name: "R1",
        reviewers: [{ model: "m1" }, { model: "m2" }, { model: "m3" }],
        blockerPolicy: "any",
      },
    ]

    expect(() => validateRoleDefinitions(roles, caps)).toThrow(
      ImplementationTeamConfigError,
    )
  })
})

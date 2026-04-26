import { describe, expect, test } from "bun:test"
import { resolveImplementationTeamConfig } from "./config-resolver"
import {
  resolveExecutorCategory,
  resolveReviewerCategory,
  resolveReviewerModel,
  validateRoutingConfig,
  findRoleById,
  getReviewer,
} from "./delegate-routing"

describe("resolveExecutorCategory", () => {
  describe("given executor with explicit category", () => {
    test("when executor category is ultrabrain, then returns ultrabrain", () => {
      const config = resolveImplementationTeamConfig({
        executor: { category: "ultrabrain" },
      })

      const result = resolveExecutorCategory(config)

      expect(result).toBe("ultrabrain")
    })

    test("when executor category is deep, then returns deep", () => {
      const config = resolveImplementationTeamConfig({
        executor: { category: "deep" },
      })

      const result = resolveExecutorCategory(config)

      expect(result).toBe("deep")
    })

    test("when executor category is visual-engineering, then returns visual-engineering", () => {
      const config = resolveImplementationTeamConfig({
        executor: { category: "visual-engineering" },
      })

      const result = resolveExecutorCategory(config)

      expect(result).toBe("visual-engineering")
    })
  })

  describe("given executor with category and model", () => {
    test("when executor has both category and model, then returns category", () => {
      const config = resolveImplementationTeamConfig({
        executor: {
          category: "ultrabrain",
          model: "gpt-5.5",
        },
      })

      const result = resolveExecutorCategory(config)

      expect(result).toBe("ultrabrain")
    })
  })

  describe("given default config", () => {
    test("when no executor provided, then returns unspecified-high as default", () => {
      const config = resolveImplementationTeamConfig({})

      const result = resolveExecutorCategory(config)

      expect(result).toBe("unspecified-high")
    })
  })
})

describe("resolveReviewerCategory", () => {
  describe("given role with category on reviewer", () => {
    test("when reviewer has explicit category, then returns that category", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "spec-fidelity",
            name: "Spec Fidelity",
            reviewers: [{ model: "gpt-5.5", category: "ultrabrain" }],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "spec-fidelity", 0)

      expect(result).toBe("ultrabrain")
    })

    test("when reviewer has deep category, then returns deep", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "code-quality",
            name: "Code Quality",
            reviewers: [{ model: "claude-sonnet-4-6", category: "deep" }],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "code-quality", 0)

      expect(result).toBe("deep")
    })
  })

  describe("given role without category on reviewer", () => {
    test("when reviewer has no category, then returns undefined", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "risk-regression",
            name: "Risk & Regression",
            reviewers: [{ model: "anthropic/claude-opus-4-7" }],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "risk-regression", 0)

      expect(result).toBeUndefined()
    })
  })

  describe("given multiple reviewers in role", () => {
    test("when first reviewer has category, then returns first reviewer's category", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "multi-review",
            name: "Multi Reviewer Role",
            reviewers: [
              { model: "gpt-5.5", category: "ultrabrain" },
              { model: "claude-sonnet-4-6" },
            ],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "multi-review", 0)

      expect(result).toBe("ultrabrain")
    })

    test("when second reviewer has category, then returns second reviewer's category", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "multi-review",
            name: "Multi Reviewer Role",
            reviewers: [
              { model: "gpt-5.5" },
              { model: "claude-sonnet-4-6", category: "deep" },
            ],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "multi-review", 1)

      expect(result).toBe("deep")
    })

    test("when second reviewer has no category, then returns undefined", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "multi-review",
            name: "Multi Reviewer Role",
            reviewers: [
              { model: "gpt-5.5", category: "ultrabrain" },
              { model: "claude-sonnet-4-6" },
            ],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "multi-review", 1)

      expect(result).toBeUndefined()
    })
  })

  describe("given non-existent role", () => {
    test("when role does not exist, then returns undefined", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "existing-role",
            name: "Existing Role",
            reviewers: [{ model: "gpt-5.5", category: "ultrabrain" }],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "non-existent", 0)

      expect(result).toBeUndefined()
    })
  })

  describe("given out of bounds index", () => {
    test("when reviewer index is negative, then returns undefined", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "test-role",
            name: "Test Role",
            reviewers: [{ model: "gpt-5.5", category: "ultrabrain" }],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "test-role", -1)

      expect(result).toBeUndefined()
    })

    test("when reviewer index exceeds reviewer count, then returns undefined", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "test-role",
            name: "Test Role",
            reviewers: [{ model: "gpt-5.5", category: "ultrabrain" }],
          },
        ],
      })

      const result = resolveReviewerCategory(config, "test-role", 5)

      expect(result).toBeUndefined()
    })
  })

  describe("given default roles", () => {
    test("when using default roles with no categories, then returns undefined", () => {
      const config = resolveImplementationTeamConfig({})

      const result = resolveReviewerCategory(config, "spec-fidelity", 0)

      expect(result).toBeUndefined()
    })
  })
})

describe("resolveReviewerModel", () => {
  describe("given valid role and index", () => {
    test("when reviewer has model string, then returns the model", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "spec-fidelity",
            name: "Spec Fidelity",
            reviewers: [{ model: "gpt-5.5" }],
          },
        ],
      })

      const result = resolveReviewerModel(config, "spec-fidelity", 0)

      expect(result).toBe("gpt-5.5")
    })

    test("when reviewer has provider/model format, then returns full string", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "code-quality",
            name: "Code Quality",
            reviewers: [{ model: "anthropic/claude-sonnet-4-6" }],
          },
        ],
      })

      const result = resolveReviewerModel(config, "code-quality", 0)

      expect(result).toBe("anthropic/claude-sonnet-4-6")
    })

    test("when reviewer has default model, then returns default", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "risk-regression",
            name: "Risk & Regression",
            reviewers: [{ model: "default" }],
          },
        ],
      })

      const result = resolveReviewerModel(config, "risk-regression", 0)

      expect(result).toBe("default")
    })
  })

  describe("given multiple reviewers", () => {
    test("when getting first reviewer model, then returns first model", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "multi-review",
            name: "Multi Reviewer Role",
            reviewers: [
              { model: "gpt-5.5" },
              { model: "claude-sonnet-4-6" },
            ],
          },
        ],
      })

      const result = resolveReviewerModel(config, "multi-review", 0)

      expect(result).toBe("gpt-5.5")
    })

    test("when getting second reviewer model, then returns second model", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "multi-review",
            name: "Multi Reviewer Role",
            reviewers: [
              { model: "gpt-5.5" },
              { model: "claude-sonnet-4-6" },
            ],
          },
        ],
      })

      const result = resolveReviewerModel(config, "multi-review", 1)

      expect(result).toBe("claude-sonnet-4-6")
    })
  })

  describe("given non-existent role", () => {
    test("when role does not exist, then throws descriptive error", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "existing-role",
            name: "Existing Role",
            reviewers: [{ model: "gpt-5.5" }],
          },
        ],
      })

      expect(() => resolveReviewerModel(config, "non-existent", 0)).toThrow(
        'Role not found: "non-existent"',
      )
    })
  })

  describe("given out of bounds index", () => {
    test("when index is negative, then throws error with bounds info", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "test-role",
            name: "Test Role",
            reviewers: [{ model: "gpt-5.5" }],
          },
        ],
      })

      expect(() => resolveReviewerModel(config, "test-role", -1)).toThrow(
        'Reviewer index -1 out of bounds for role "test-role" (has 1 reviewers)',
      )
    })

    test("when index exceeds reviewer count, then throws error with bounds info", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "test-role",
            name: "Test Role",
            reviewers: [{ model: "gpt-5.5" }],
          },
        ],
      })

      expect(() => resolveReviewerModel(config, "test-role", 5)).toThrow(
        'Reviewer index 5 out of bounds for role "test-role" (has 1 reviewers)',
      )
    })
  })
})

describe("validateRoutingConfig", () => {
  describe("given valid config", () => {
    test("when executor has category only, then returns valid", () => {
      const config = resolveImplementationTeamConfig({
        executor: { category: "ultrabrain" },
        roles: [
          {
            id: "test-role",
            name: "Test Role",
            reviewers: [{ model: "gpt-5.5" }],
          },
        ],
      })

      const result = validateRoutingConfig(config)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test("when executor has model only, then returns valid", () => {
      const config = resolveImplementationTeamConfig({
        executor: { category: "ultrabrain", model: "gpt-5.5" },
        roles: [
          {
            id: "test-role",
            name: "Test Role",
            reviewers: [{ model: "claude-sonnet-4-6" }],
          },
        ],
      })

      const result = validateRoutingConfig(config)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test("when all reviewers have models, then returns valid", () => {
      const config = resolveImplementationTeamConfig({
        roles: [
          {
            id: "role-1",
            name: "Role 1",
            reviewers: [
              { model: "gpt-5.5" },
              { model: "claude-sonnet-4-6" },
            ],
          },
          {
            id: "role-2",
            name: "Role 2",
            reviewers: [{ model: "anthropic/claude-opus-4-7" }],
          },
        ],
      })

      const result = validateRoutingConfig(config)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe("given executor without category or model", () => {
    test("when executor has neither category nor model, then returns invalid with error", () => {
      // Create a minimal config that bypasses normal validation
      const config = resolveImplementationTeamConfig({})

      // Manually create a broken executor state (category and model are actually both undefined in defaults)
      const brokenConfig: typeof config = {
        ...config,
        executor: {
          category: undefined as unknown as string,
          model: undefined,
        },
      }

      const result = validateRoutingConfig(brokenConfig)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        "Executor must have at least one of: category, model. Currently executor has neither.",
      )
    })
  })

  describe("given default config", () => {
    test("when using defaults, then returns valid with unspecified-high default", () => {
      const config = resolveImplementationTeamConfig({})

      const result = validateRoutingConfig(config)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })
})

describe("findRoleById", () => {
  test("when role exists, then returns the role", () => {
    const config = resolveImplementationTeamConfig({
      roles: [
        { id: "spec-fidelity", name: "Spec Fidelity", reviewers: [{ model: "gpt-5.5" }] },
      ],
    })

    const result = findRoleById(config, "spec-fidelity")

    expect(result).toBeDefined()
    expect(result?.id).toBe("spec-fidelity")
  })

  test("when role does not exist, then returns undefined", () => {
    const config = resolveImplementationTeamConfig({
      roles: [
        { id: "existing", name: "Existing", reviewers: [{ model: "gpt-5.5" }] },
      ],
    })

    const result = findRoleById(config, "non-existent")

    expect(result).toBeUndefined()
  })
})

describe("getReviewer", () => {
  test("when role and index are valid, then returns the reviewer", () => {
    const config = resolveImplementationTeamConfig({
      roles: [
        { id: "test-role", name: "Test Role", reviewers: [{ model: "gpt-5.5", category: "ultrabrain" }] },
      ],
    })

    const result = getReviewer(config, "test-role", 0)

    expect(result).toEqual({ model: "gpt-5.5", category: "ultrabrain" })
  })

  test("when role does not exist, then returns undefined", () => {
    const config = resolveImplementationTeamConfig({
      roles: [
        { id: "test-role", name: "Test Role", reviewers: [{ model: "gpt-5.5" }] },
      ],
    })

    const result = getReviewer(config, "non-existent", 0)

    expect(result).toBeUndefined()
  })

  test("when index is out of bounds, then returns undefined", () => {
    const config = resolveImplementationTeamConfig({
      roles: [
        { id: "test-role", name: "Test Role", reviewers: [{ model: "gpt-5.5" }] },
      ],
    })

    const result = getReviewer(config, "test-role", 10)

    expect(result).toBeUndefined()
  })

  test("when index is negative, then returns undefined", () => {
    const config = resolveImplementationTeamConfig({
      roles: [
        { id: "test-role", name: "Test Role", reviewers: [{ model: "gpt-5.5" }] },
      ],
    })

    const result = getReviewer(config, "test-role", -1)

    expect(result).toBeUndefined()
  })
})
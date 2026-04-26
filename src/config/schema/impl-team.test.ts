import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"
import { ImplementationTeamConfigSchema } from "./impl-team"

describe("ImplementationTeamConfigSchema", () => {
  describe("enabled", () => {
    describe("#given enabled: true", () => {
      test("#when parsed #then returns true", () => {
        const result = ImplementationTeamConfigSchema.parse({ enabled: true })

        expect(result.enabled).toBe(true)
      })
    })

    describe("#given enabled not provided", () => {
      test("#when parsed #then default true is applied", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.enabled).toBe(true)
      })
    })

    describe("#given enabled: false", () => {
      test("#when parsed #then returns false", () => {
        const result = ImplementationTeamConfigSchema.parse({ enabled: false })

        expect(result.enabled).toBe(false)
      })
    })
  })

  describe("executor", () => {
    describe("#given valid executor config", () => {
      test("#when parsed #then returns executor with category and model", () => {
        const result = ImplementationTeamConfigSchema.parse({
          executor: { category: "deep", model: "gpt-5" },
        })

        expect(result.executor).toEqual({ category: "deep", model: "gpt-5" })
      })
    })

    describe("#given executor without optional model", () => {
      test("#when parsed #then returns executor with only category", () => {
        const result = ImplementationTeamConfigSchema.parse({
          executor: { category: "deep" },
        })

        expect(result.executor).toEqual({ category: "deep" })
      })
    })

    describe("#given executor not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.executor).toBeUndefined()
      })
    })
  })

  describe("roles", () => {
    describe("#given valid roles array", () => {
      test("#when parsed #then returns roles with reviewer details", () => {
        const result = ImplementationTeamConfigSchema.parse({
          roles: [
            {
              id: "reviewer-1",
              name: "Code Reviewer",
              description: "Reviews code quality",
              reviewers: [{ model: "claude-opus-4-7", category: "deep" }],
              blocker_policy: "any",
            },
          ],
        })

        expect(result.roles).toHaveLength(1)
        expect(result.roles?.[0].id).toBe("reviewer-1")
        expect(result.roles?.[0].reviewers).toHaveLength(1)
        expect(result.roles?.[0].reviewers?.[0].model).toBe("claude-opus-4-7")
      })
    })

    describe("#given empty roles array", () => {
      test("#when parsed #then returns empty array", () => {
        const result = ImplementationTeamConfigSchema.parse({ roles: [] })

        expect(result.roles).toEqual([])
      })
    })

    describe("#given roles not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.roles).toBeUndefined()
      })
    })
  })

  describe("max_ordinary_rounds", () => {
    describe("#given valid max_ordinary_rounds (3)", () => {
      test("#when parsed #then returns 3", () => {
        const result = ImplementationTeamConfigSchema.parse({ max_ordinary_rounds: 3 })

        expect(result.max_ordinary_rounds).toBe(3)
      })
    })

    describe("#given max_ordinary_rounds not provided", () => {
      test("#when parsed #then default 2 is applied", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.max_ordinary_rounds).toBe(2)
      })
    })

    describe("#given max_ordinary_rounds below minimum (0)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({ max_ordinary_rounds: 0 })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given max_ordinary_rounds above maximum (6)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({ max_ordinary_rounds: 6 })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given max_ordinary_rounds is non-integer (2.5)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({ max_ordinary_rounds: 2.5 })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })
  })

  describe("escalation", () => {
    describe("#given valid escalation config", () => {
      test("#when parsed #then returns escalation settings", () => {
        const result = ImplementationTeamConfigSchema.parse({
          escalation: { enabled: true, model: "claude-opus-4-7", category: "deep" },
        })

        expect(result.escalation?.enabled).toBe(true)
        expect(result.escalation?.model).toBe("claude-opus-4-7")
        expect(result.escalation?.category).toBe("deep")
      })
    })

    describe("#given escalation not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.escalation).toBeUndefined()
      })
    })

    describe("#given escalation with enabled not provided", () => {
      test("#when parsed #then default true is applied to enabled", () => {
        const result = ImplementationTeamConfigSchema.parse({
          escalation: { model: "claude-opus-4-7" },
        })

        expect(result.escalation?.enabled).toBe(true)
      })
    })
  })

  describe("resource_caps", () => {
    describe("#given valid resource_caps", () => {
      test("#when parsed #then returns custom caps", () => {
        const result = ImplementationTeamConfigSchema.parse({
          resource_caps: { max_total_spawned_tasks: 100, max_reviewers_per_role: 10, max_roles: 5 },
        })

        expect(result.resource_caps?.max_total_spawned_tasks).toBe(100)
        expect(result.resource_caps?.max_reviewers_per_role).toBe(10)
        expect(result.resource_caps?.max_roles).toBe(5)
      })
    })

    describe("#given resource_caps not provided", () => {
      test("#when parsed #then defaults are applied", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.resource_caps?.max_total_spawned_tasks).toBe(50)
        expect(result.resource_caps?.max_reviewers_per_role).toBe(5)
        expect(result.resource_caps?.max_roles).toBe(3)
      })
    })

    describe("#given resource_caps provided as empty object", () => {
      test("#when parsed #then defaults are applied", () => {
        const result = ImplementationTeamConfigSchema.parse({ resource_caps: {} })

        expect(result.resource_caps?.max_total_spawned_tasks).toBe(50)
        expect(result.resource_caps?.max_reviewers_per_role).toBe(5)
        expect(result.resource_caps?.max_roles).toBe(3)
      })
    })
  })

  describe("pass_policy", () => {
    describe("#given valid pass_policy", () => {
      test("#when parsed #then returns pass policy settings", () => {
        const result = ImplementationTeamConfigSchema.parse({
          pass_policy: { require_all_roles_pass: false },
        })

        expect(result.pass_policy?.require_all_roles_pass).toBe(false)
      })
    })

    describe("#given pass_policy not provided", () => {
      test("#when parsed #then default true is applied", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.pass_policy?.require_all_roles_pass).toBe(true)
      })
    })

    describe("#given pass_policy provided as empty object", () => {
      test("#when parsed #then default true is applied", () => {
        const result = ImplementationTeamConfigSchema.parse({ pass_policy: {} })

        expect(result.pass_policy?.require_all_roles_pass).toBe(true)
      })
    })
  })

  describe("blocker_policy", () => {
    describe("#given valid blocker_policy", () => {
      test("#when parsed #then returns blocker policy settings", () => {
        const result = ImplementationTeamConfigSchema.parse({
          blocker_policy: { any_blocker_fails_role: false },
        })

        expect(result.blocker_policy?.any_blocker_fails_role).toBe(false)
      })
    })

    describe("#given blocker_policy not provided", () => {
      test("#when parsed #then default true is applied", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.blocker_policy?.any_blocker_fails_role).toBe(true)
      })
    })

    describe("#given blocker_policy provided as empty object", () => {
      test("#when parsed #then default true is applied", () => {
        const result = ImplementationTeamConfigSchema.parse({ blocker_policy: {} })

        expect(result.blocker_policy?.any_blocker_fails_role).toBe(true)
      })
    })
  })

  describe("empty config", () => {
    describe("#given empty object", () => {
      test("#when parsed #then all defaults are applied", () => {
        const result = ImplementationTeamConfigSchema.parse({})

        expect(result.enabled).toBe(true)
        expect(result.max_ordinary_rounds).toBe(2)
        expect(result.resource_caps?.max_total_spawned_tasks).toBe(50)
        expect(result.resource_caps?.max_reviewers_per_role).toBe(5)
        expect(result.resource_caps?.max_roles).toBe(3)
        expect(result.pass_policy?.require_all_roles_pass).toBe(true)
        expect(result.blocker_policy?.any_blocker_fails_role).toBe(true)
      })
    })
  })

  describe("full valid config", () => {
    describe("#given complete valid config", () => {
      test("#when parsed #then all fields are correctly populated", () => {
        const result = ImplementationTeamConfigSchema.parse({
          enabled: true,
          executor: { category: "deep", model: "gpt-5", fallback_models: ["claude-opus-4-7"] },
          roles: [
            {
              id: "reviewer-1",
              name: "Code Reviewer",
              description: "Primary reviewer",
              reviewers: [{ model: "claude-opus-4-7", category: "deep" }],
              blocker_policy: "any",
            },
          ],
          max_ordinary_rounds: 3,
          escalation: { enabled: true, model: "claude-opus-4-7", category: "deep" },
          resource_caps: { max_total_spawned_tasks: 100, max_reviewers_per_role: 10, max_roles: 5 },
          pass_policy: { require_all_roles_pass: false },
          blocker_policy: { any_blocker_fails_role: false },
        })

        expect(result.enabled).toBe(true)
        expect(result.executor?.category).toBe("deep")
        expect(result.executor?.model).toBe("gpt-5")
        expect(result.roles).toHaveLength(1)
        expect(result.max_ordinary_rounds).toBe(3)
        expect(result.escalation?.enabled).toBe(true)
        expect(result.resource_caps?.max_total_spawned_tasks).toBe(100)
        expect(result.pass_policy?.require_all_roles_pass).toBe(false)
        expect(result.blocker_policy?.any_blocker_fails_role).toBe(false)
      })
    })
  })

  describe("invalid reviewer count", () => {
    describe("#given max_reviewers_per_role below minimum (0)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({
            resource_caps: { max_reviewers_per_role: 0 },
          })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })
  })

  describe("invalid role count", () => {
    describe("#given max_roles below minimum (0)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({
            resource_caps: { max_roles: 0 },
          })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })
  })

  describe("invalid max_ordinary_rounds", () => {
    describe("#given negative max_ordinary_rounds (-1)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({ max_ordinary_rounds: -1 })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })
  })

  describe("invalid role structure", () => {
    describe("#given role missing id", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({
            roles: [
              {
                name: "Reviewer Without ID",
                reviewers: [{ model: "claude-opus-4-7" }],
              },
            ],
          })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given role missing name", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({
            roles: [
              {
                id: "reviewer-1",
                reviewers: [{ model: "claude-opus-4-7" }],
              },
            ],
          })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given role missing reviewers", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({
            roles: [
              {
                id: "reviewer-1",
                name: "Reviewer Without Reviewers",
              },
            ],
          })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given reviewer missing model", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown

        try {
          ImplementationTeamConfigSchema.parse({
            roles: [
              {
                id: "reviewer-1",
                name: "Reviewer",
                reviewers: [{ category: "deep" }],
              },
            ],
          })
        } catch (error) {
          thrownError = error
        }

        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })
  })

  describe("minimal config with only required fields", () => {
    describe("#given config with enabled only", () => {
      test("#when parsed #then applies all other defaults", () => {
        const result = ImplementationTeamConfigSchema.parse({ enabled: true })

        expect(result.enabled).toBe(true)
        expect(result.max_ordinary_rounds).toBe(2)
        expect(result.resource_caps?.max_total_spawned_tasks).toBe(50)
        expect(result.resource_caps?.max_reviewers_per_role).toBe(5)
        expect(result.resource_caps?.max_roles).toBe(3)
      })
    })
  })
})
import { describe, expect, test } from "bun:test"
import { createReviewSwarm, buildReviewerPrompt, buildReviewerTaskArgs, getRoleContract, getReviewerIds, getTotalReviewerCount, getSharedReviewerRules, type ReviewerTaskInput } from "./review-swarm-runner"
import type { ResolvedImplementationTeamConfig } from "./config-resolver"
import { ImplementationTeamConfigSchema } from "../../config/schema/impl-team"

// ============================================================================
// Test Helpers
// ============================================================================

function createDefaultConfig(): ResolvedImplementationTeamConfig {
  return {
    enabled: true,
    executor: { category: "deep" },
    roles: [
      {
        id: "spec-fidelity",
        name: "Spec Fidelity",
        description: "Checks implementation against specification",
        reviewers: [{ model: "default" }],
        blockerPolicy: "any_blocker_fails_role",
      },
      {
        id: "code-quality",
        name: "Code Quality",
        description: "Reviews code quality and maintainability",
        reviewers: [{ model: "default" }],
        blockerPolicy: "any_blocker_fails_role",
      },
      {
        id: "risk-regression",
        name: "Risk & Regression",
        description: "Checks for risk, regression, and edge cases",
        reviewers: [{ model: "default" }],
        blockerPolicy: "any_blocker_fails_role",
      },
    ],
    maxOrdinaryRounds: 2,
    escalation: { enabled: true },
    resourceCaps: { maxTotalSpawnedTasks: 50, maxReviewersPerRole: 5, maxRoles: 3 },
    passPolicy: { requireAllRolesPass: true },
    blockerPolicy: { anyBlockerFailsRole: true },
    defaultRoles: true,
  }
}

// ============================================================================
// createReviewSwarm Tests
// ============================================================================

describe("createReviewSwarm", () => {
  test("#given default config with 3 roles each having 1 reviewer #when createReviewSwarm #then spawns 3 reviewer tasks", () => {
    const config = createDefaultConfig()
    const results = createReviewSwarm(
      "run-123",
      1,
      config,
      ".sisyphus/evidence/impl-team/run-123/round-1/executor-output.txt",
      "Implement a login feature",
    )

    expect(results).toHaveLength(3)
  })

  test("#given empty roles list #when createReviewSwarm #then returns empty array", () => {
    const config = createDefaultConfig()
    config.roles = []

    const results = createReviewSwarm(
      "run-123",
      1,
      config,
      ".sisyphus/evidence/impl-team/run-123/round-1/executor-output.txt",
      "Implement a login feature",
    )

    expect(results).toHaveLength(0)
  })

  test("#given role with multiple reviewers #when createReviewSwarm #then creates correct count", () => {
    const config = createDefaultConfig()
    config.roles = [
      {
        id: "spec-fidelity",
        name: "Spec Fidelity",
        reviewers: [
          { model: "gpt-5.4" },
          { model: "claude-opus-4-7" },
          { model: "gemini-3.1-pro" },
        ],
        blockerPolicy: "any_blocker_fails_role",
      },
    ]

    const results = createReviewSwarm(
      "run-123",
      1,
      config,
      ".sisyphus/evidence/impl-team/run-123/round-1/executor-output.txt",
      "Implement a login feature",
    )

    expect(results).toHaveLength(3)
  })

  test("#given missing executorOutputRef #when createReviewSwarm #then throws error", () => {
    const config = createDefaultConfig()

    expect(() =>
      createReviewSwarm(
        "run-123",
        1,
        config,
        "",
        "Implement a login feature",
      ),
    ).toThrow("executorOutputRef is required")
  })

  test("#given whitespace-only executorOutputRef #when createReviewSwarm #then throws error", () => {
    const config = createDefaultConfig()

    expect(() =>
      createReviewSwarm(
        "run-123",
        1,
        config,
        "   ",
        "Implement a login feature",
      ),
    ).toThrow("executorOutputRef is required")
  })

  test("#given valid input #when createReviewSwarm #then reviewerIds are unique and deterministic", () => {
    const config = createDefaultConfig()
    const results1 = createReviewSwarm(
      "run-123",
      1,
      config,
      ".sisyphus/evidence/impl-team/run-123/round-1/executor-output.txt",
      "Implement a login feature",
    )
    const results2 = createReviewSwarm(
      "run-123",
      1,
      config,
      ".sisyphus/evidence/impl-team/run-123/round-1/executor-output.txt",
      "Implement a login feature",
    )

    const ids1 = results1.map((r) => r.reviewerId)
    const ids2 = results2.map((r) => r.reviewerId)

    expect(ids1).toEqual(ids2)
    expect(new Set(ids1).size).toBe(ids1.length) // All unique
  })

  test("#given valid input #when createReviewSwarm #then evidence paths are correct for each reviewer", () => {
    const config = createDefaultConfig()
    const results = createReviewSwarm(
      "run-123",
      2,
      config,
      ".sisyphus/evidence/impl-team/run-123/round-2/executor-output.txt",
      "Implement a login feature",
    )

    for (const result of results) {
      expect(result.evidencePath).toMatch(/verdict-.*\.json$/)
      expect(result.evidencePath).toContain(result.reviewerId)
      expect(result.evidencePath).toContain("run-123")
      expect(result.evidencePath).toContain("round-2")
    }
  })

  test("#given valid input #when createReviewSwarm #then each result has correct roleId", () => {
    const config = createDefaultConfig()
    const results = createReviewSwarm(
      "run-123",
      1,
      config,
      ".sisyphus/evidence/impl-team/run-123/round-1/executor-output.txt",
      "Implement a login feature",
    )

    const roleIds = results.map((r) => r.roleId)
    expect(roleIds).toContain("spec-fidelity")
    expect(roleIds).toContain("code-quality")
    expect(roleIds).toContain("risk-regression")
  })

  test("#given valid input #when createReviewSwarm #then modelId is set from reviewer model", () => {
    const config = createDefaultConfig()
    config.roles[0].reviewers = [{ model: "gpt-5.4" }]

    const results = createReviewSwarm(
      "run-123",
      1,
      config,
      ".sisyphus/evidence/impl-team/run-123/round-1/executor-output.txt",
      "Implement a login feature",
    )

    expect(results[0].modelId).toBe("gpt-5.4")
  })
})

// ============================================================================
// buildReviewerPrompt Tests
// ============================================================================

describe("buildReviewerPrompt", () => {
  test("#given spec-fidelity role #when buildReviewerPrompt #then includes spec fidelity contract", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain("SPEC-FIDELITY REVIEWER")
    expect(prompt).toContain("Correct interpretation of requirements")
    expect(prompt).toContain("implementation faithfully adheres")
  })

  test("#given code-quality role #when buildReviewerPrompt #then includes code quality contract", () => {
    const input = createReviewerTaskInput("code-quality")
    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain("CODE-QUALITY REVIEWER")
    expect(prompt).toContain("maintainability")
    expect(prompt).toContain("readability")
  })

  test("#given risk-regression role #when buildReviewerPrompt #then includes risk regression contract", () => {
    const input = createReviewerTaskInput("risk-regression")
    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain("RISK & REGRESSION REVIEWER")
    expect(prompt).toContain("edge cases")
    expect(prompt).toContain("race condition")
  })

  test("#given unknown role #when buildReviewerPrompt #then includes generic contract", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    // Override the role id to simulate an unknown role
    input.role = {
      id: "custom-unknown-role",
      name: "Custom Unknown Role",
      reviewers: [{ model: "default" }],
      blockerPolicy: "any_blocker_fails_role",
    }
    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain("Generic Review Contract")
    expect(prompt).toContain("custom-unknown-role")
  })

  test("#given unresolvedFindings in round 2 #when buildReviewerPrompt #then includes findings", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    input.round = 2
    input.unresolvedFindings = [
      {
        id: "find-1",
        description: "Login does not handle empty password",
        severity: "BLOCKER",
        category: "correctness",
      },
    ]

    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain("Previous Unresolved Findings")
    expect(prompt).toContain("BLOCKER")
    expect(prompt).toContain("Login does not handle empty password")
  })

  test("#given no unresolvedFindings #when buildReviewerPrompt #then includes no findings message", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    input.unresolvedFindings = []

    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain("No unresolved findings from previous rounds")
  })

  test("#given valid input #when buildReviewerPrompt #then includes task description", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    input.taskDescription = "Implement user authentication"

    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain("Implement user authentication")
  })

  test("#given valid input #when buildReviewerPrompt #then includes executor output ref", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    input.executorOutputRef = ".sisyphus/evidence/run-123/round-1/output.txt"

    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain(".sisyphus/evidence/run-123/round-1/output.txt")
  })

  test("#given valid input #when buildReviewerPrompt #then includes ReviewerVerdictSchema", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    const prompt = buildReviewerPrompt(input)

    expect(prompt).toContain('"schema_version"')
    expect(prompt).toContain('"run_id"')
    expect(prompt).toContain('"verdict"')
    expect(prompt).toContain('"findings"')
    expect(prompt).toContain('"summary"')
  })

  test("#given valid input #when buildReviewerPrompt #then output is valid JSON schema format", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    const prompt = buildReviewerPrompt(input)

    // The schema should be in the prompt as a JSON code block
    expect(prompt).toContain("```json")
    expect(prompt).toContain("```")

    // Should have instruction about JSON output
    expect(prompt).toContain("valid JSON matching this schema")
    expect(prompt).toContain("No other text")
  })

  test("#given valid input #when buildReviewerPrompt #then includes shared reviewer rules between impl reference and role contract", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    const prompt = buildReviewerPrompt(input)

    // Shared rules should appear after Implementation Reference
    expect(prompt).toContain("## 2. Implementation Reference")
    expect(prompt).toContain("PASS is the default")
    expect(prompt).toContain("Maximum 10 findings per review")

    // Shared rules should appear before role contract
    const passIndex = prompt.indexOf("PASS is the default")
    const specFidelityIndex = prompt.indexOf("SPEC-FIDELITY REVIEWER")
    expect(passIndex).toBeLessThan(specFidelityIndex)
  })
})

// ============================================================================
// buildReviewerTaskArgs Tests
// ============================================================================

describe("buildReviewerTaskArgs", () => {
  test("#given valid input #when buildReviewerTaskArgs #then returns DelegateTaskArgs with run_in_background true", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    const args = buildReviewerTaskArgs(input)

    expect(args.run_in_background).toBe(true)
    expect(args.description).toContain("Spec Fidelity")
    expect(args.description).toContain("Round 1")
  })

  test("#given valid input #when buildReviewerTaskArgs #then task_id is reviewer id", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    input.reviewerIndex = 2
    const args = buildReviewerTaskArgs(input)

    expect(args.task_id).toBe("spec-fidelity-reviewer-2")
  })

  test("#given reviewer has category #when buildReviewerTaskArgs #then category is set", () => {
    const config = createDefaultConfig()
    config.roles[0].reviewers = [{ model: "gpt-5.4", category: "ultrabrain" }]

    const input: ReviewerTaskInput = {
      runId: "run-123",
      round: 1,
      role: config.roles[0],
      reviewerModel: "gpt-5.4",
      reviewerIndex: 0,
      executorOutputRef: "ref",
      taskDescription: "task",
    }

    const args = buildReviewerTaskArgs(input)

    expect(args.category).toBe("ultrabrain")
  })

  test("#given reviewer has no category #when buildReviewerTaskArgs #then category is undefined", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    const args = buildReviewerTaskArgs(input)

    expect(args.category).toBeUndefined()
  })

  test("#given valid input #when buildReviewerTaskArgs #then subagent_type is reviewer model", () => {
    const input = createReviewerTaskInput("spec-fidelity")
    input.reviewerModel = "claude-opus-4-7"
    const args = buildReviewerTaskArgs(input)

    expect(args.subagent_type).toBe("claude-opus-4-7")
  })
})

// ============================================================================
// getRoleContract Tests
// ============================================================================

describe("getRoleContract", () => {
  test("#given spec-fidelity role #when getRoleContract #then returns spec fidelity contract", () => {
    const contract = getRoleContract("spec-fidelity")

    expect(contract).toContain("SPEC-FIDELITY REVIEWER")
    expect(contract).toContain("Correct interpretation of requirements")
  })

  test("#given code-quality role #when getRoleContract #then returns code quality contract", () => {
    const contract = getRoleContract("code-quality")

    expect(contract).toContain("CODE-QUALITY REVIEWER")
    expect(contract).toContain("Code organization and modularity")
  })

  test("#given risk-regression role #when getRoleContract #then returns risk regression contract", () => {
    const contract = getRoleContract("risk-regression")

    expect(contract).toContain("RISK & REGRESSION REVIEWER")
    expect(contract).toContain("Edge cases and boundary conditions")
  })

  test("#given unknown role #when getRoleContract #then returns generic contract with role name", () => {
    const contract = getRoleContract("custom-role")

    expect(contract).toContain("Generic Review Contract")
    expect(contract).toContain("custom-role")
  })
})

// ============================================================================
// getReviewerIds Tests
// ============================================================================

describe("getReviewerIds", () => {
  test("#given default config #when getReviewerIds #then returns 3 ids", () => {
    const config = createDefaultConfig()
    const ids = getReviewerIds(config)

    expect(ids).toHaveLength(3)
    expect(ids).toContain("spec-fidelity-reviewer-0")
    expect(ids).toContain("code-quality-reviewer-0")
    expect(ids).toContain("risk-regression-reviewer-0")
  })

  test("#given config with multiple reviewers #when getReviewerIds #then returns all ids", () => {
    const config = createDefaultConfig()
    config.roles[0].reviewers = [{ model: "m1" }, { model: "m2" }]

    const ids = getReviewerIds(config)

    expect(ids).toContain("spec-fidelity-reviewer-0")
    expect(ids).toContain("spec-fidelity-reviewer-1")
  })
})

// ============================================================================
// getTotalReviewerCount Tests
// ============================================================================

describe("getTotalReviewerCount", () => {
  test("#given default config #when getTotalReviewerCount #then returns 3", () => {
    const config = createDefaultConfig()
    const count = getTotalReviewerCount(config)

    expect(count).toBe(3)
  })

  test("#given empty roles #when getTotalReviewerCount #then returns 0", () => {
    const config = createDefaultConfig()
    config.roles = []

    const count = getTotalReviewerCount(config)

    expect(count).toBe(0)
  })

  test("#given multiple reviewers per role #when getTotalReviewerCount #then returns correct total", () => {
    const config = createDefaultConfig()
    config.roles = [
      { id: "r1", name: "R1", reviewers: [{ model: "m1" }, { model: "m2" }], blockerPolicy: "any" },
      { id: "r2", name: "R2", reviewers: [{ model: "m3" }], blockerPolicy: "any" },
    ]

    const count = getTotalReviewerCount(config)

    expect(count).toBe(3)
  })
})

// ============================================================================
// getSharedReviewerRules Tests
// ============================================================================

describe("getSharedReviewerRules", () => {
  test("#when getSharedReviewerRules #then returns non-empty string", () => {
    const rules = getSharedReviewerRules()

    expect(typeof rules).toBe("string")
    expect(rules.length).toBeGreaterThan(0)
  })

  test("#when getSharedReviewerRules #then includes approval bias section", () => {
    const rules = getSharedReviewerRules()

    expect(rules).toContain("PASS is the default")
    expect(rules).toContain("Only issue FAIL when you have concrete")
  })

  test("#when getSharedReviewerRules #then includes evidence threshold section", () => {
    const rules = getSharedReviewerRules()

    expect(rules).toContain("Every FAIL finding MUST cite")
    expect(rules).toContain("file_ref")
  })

  test("#when getSharedReviewerRules #then includes output cap section", () => {
    const rules = getSharedReviewerRules()

    expect(rules).toContain("Maximum 10 findings per review")
    expect(rules).toContain("Prioritize highest-severity")
  })

  test("#when getSharedReviewerRules #then includes JSON-only output section", () => {
    const rules = getSharedReviewerRules()

    expect(rules).toContain("valid JSON matching the schema")
    expect(rules).toContain("No markdown")
    expect(rules).toContain("Raw JSON only")
  })

  test("#when getSharedReviewerRules #then includes anti-noise section", () => {
    const rules = getSharedReviewerRules()

    expect(rules).toContain("Do NOT flag")
    expect(rules).toContain("style preferences")
    expect(rules).toContain("speculative failures")
  })
})

// ============================================================================
// Role Contract Isolation Tests
// ============================================================================

describe("Role contract isolation", () => {
  describe("spec-fidelity contract", () => {
    test("#given spec-fidelity role contract #when inspected #then contains focus and anti-scope instructions", () => {
      // given
      const contract = getRoleContract("spec-fidelity")

      // then - focus assertions
      expect(contract).toContain("SPEC-FIDELITY REVIEWER")
      expect(contract).toContain("NOT a general code reviewer")

      // then - anti-scope assertions: what it MUST NOT review
      expect(contract).toContain("MUST NOT Review")
      expect(contract).toContain("Code style")
      // Maintainability appears in the context of out-of-scope items
      expect(contract).toContain("Maintainability")
      expect(contract).toContain("Security posture")
      expect(contract).toContain("Race conditions")
      expect(contract).toContain("concurrency")
    })

    test("#given spec-fidelity role contract #when inspected #then does NOT contain breakage risk as in-scope concern", () => {
      // given
      const contract = getRoleContract("spec-fidelity")

      // then - spec-fidelity should NOT have "Breakage risk" as an in-scope item
      // (breakage risk belongs to risk-regression)
      // We check that "Breakage risk" is NOT in the In-Scope section
      const inScopeMatch = contract.match(/## In-Scope.*?(?=## [^#])/s)
      if (inScopeMatch) {
        expect(inScopeMatch[0]).not.toContain("Breakage risk")
      }
    })
  })

  describe("code-quality contract", () => {
    test("#given code-quality role contract #when inspected #then contains focus and anti-scope instructions", () => {
      // given
      const contract = getRoleContract("code-quality")

      // then - focus assertions
      expect(contract).toContain("CODE-QUALITY REVIEWER")
      expect(contract).toContain("NOT a spec reviewer")

      // then - anti-scope assertions: what it MUST NOT review
      expect(contract).toContain("MUST NOT Review")
      // Spec conformance appears in the contract as "Spec conformance or requirement adherence"
      expect(contract).toContain("Spec conformance")
      expect(contract).toContain("Deployment risk")
      expect(contract).toContain("Edge cases beyond")
      expect(contract).toContain("Dependency vulnerabilities")
    })

    test("#given code-quality role contract #when inspected #then does NOT review spec as primary concern", () => {
      // given
      const contract = getRoleContract("code-quality")

      // then - code-quality should not claim spec review ownership
      // (spec-fidelity is the primary owner)
      // Verify that spec-fidelity is mentioned as the owner in Out-of-Scope
      expect(contract).toContain("belongs to spec-fidelity")
    })
  })

describe("risk-regression contract", () => {
    test("#given risk-regression role contract #when inspected #then contains focus and anti-scope instructions", () => {
      // given
      const contract = getRoleContract("risk-regression")

      // then - focus assertions
      expect(contract).toContain("RISK & REGRESSION REVIEWER")
      expect(contract).toContain("pre-merge risk assessor")
      expect(contract).toContain("NOT a code-quality reviewer")

      // then - key risk concerns
      expect(contract).toContain("Breakage risk")
      expect(contract).toContain("Backward compatibility")
      expect(contract).toContain("Failure modes")

      // then - anti-scope assertions: what it MUST NOT Review
      expect(contract).toContain("MUST NOT Review")
      expect(contract).toContain("Code style")
      expect(contract).toContain("maintainability")
      expect(contract).toContain("Spec conformance")
    })

    test("#given risk-regression role contract #when inspected #then does NOT claim ownership of naming conventions", () => {
      // given
      const contract = getRoleContract("risk-regression")

      // then - "naming conventions" appears in Out-of-Scope (saying NOT to review it)
      // Verify it's in the OUT-OF-SCOPE section, not In-Scope
      const outOfScopeMatch = contract.match(/## Out-of-Scope.*?(?=## [^#]|$)/s)
      if (outOfScopeMatch) {
        expect(outOfScopeMatch[0]).toContain("naming conventions")
      }
    })
  })
})

// ============================================================================
// Shared Rules Verification Tests
// ============================================================================

describe("Shared reviewer rules verification", () => {
  test("#when getSharedReviewerRules #then contains evidence threshold with specific code patterns and file_ref", () => {
    // given
    const rules = getSharedReviewerRules()

    // then
    expect(rules).toContain("specific code patterns")
    expect(rules).toContain("file_ref")
  })

  test("#when getSharedReviewerRules #then contains output cap of Maximum 10 findings", () => {
    // given
    const rules = getSharedReviewerRules()

    // then
    expect(rules).toContain("Maximum 10 findings")
  })

  test("#when getSharedReviewerRules #then contains anti-noise rules for style preferences and speculative failures", () => {
    // given
    const rules = getSharedReviewerRules()

    // then
    expect(rules).toContain("style preferences")
    expect(rules).toContain("speculative failures")
  })

  test("#when getSharedReviewerRules #then contains PASS is the default", () => {
    // given
    const rules = getSharedReviewerRules()

    // then
    expect(rules).toContain("PASS is the default")
  })
})

// ============================================================================
// Config Stability Tests (extend existing V1 config schema block)
// ============================================================================

describe("V1 config schema - no prompt fields needed", () => {
  test("#given empty config object #when safeParse #then succeeds", () => {
    // given
    const emptyConfig = {}

    // when
    const result = ImplementationTeamConfigSchema.safeParse(emptyConfig)

    // then
    expect(result.success).toBe(true)
  })

  test("#given empty config object #when resolveImplementationTeamConfig #then returns valid config with 3 default roles", () => {
    // given - empty config
    const emptyConfig = {}

    // when - need to import and use resolveImplementationTeamConfig
    const { resolveImplementationTeamConfig } = require("./config-resolver")
    const resolved = resolveImplementationTeamConfig(emptyConfig)

    // then
    expect(resolved).toBeDefined()
    expect(resolved.enabled).toBe(true)
    expect(resolved.roles).toBeDefined()
    expect(resolved.roles.length).toBeGreaterThanOrEqual(3)

    // Verify the 3 default roles exist
    const roleIds = resolved.roles.map((r: { id: string }) => r.id)
    expect(roleIds).toContain("spec-fidelity")
    expect(roleIds).toContain("code-quality")
    expect(roleIds).toContain("risk-regression")
  })

  test("#given full valid config with all current fields #when safeParse #then succeeds", () => {
    // given
    const fullConfig = {
      enabled: true,
      executor: { category: "deep" },
      roles: [
        {
          id: "spec-fidelity",
          name: "Spec Fidelity",
          description: "Checks implementation against specification",
          reviewers: [{ model: "default" }],
          blocker_policy: "any_blocker_fails_role",
        },
        {
          id: "code-quality",
          name: "Code Quality",
          description: "Reviews code quality",
          reviewers: [{ model: "gpt-5.4" }],
          blocker_policy: "any_blocker_fails_role",
        },
      ],
      max_ordinary_rounds: 3,
      escalation: { enabled: true, model: "claude-opus-4-7" },
      resource_caps: { max_total_spawned_tasks: 100, max_reviewers_per_role: 10, max_roles: 5 },
      pass_policy: { require_all_roles_pass: false },
      blocker_policy: { any_blocker_fails_role: false },
    }

    // when
    const result = ImplementationTeamConfigSchema.safeParse(fullConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      const parsed = result.data
      // Verify no prompt-related fields exist
      expect(parsed.roles?.[0]).not.toHaveProperty("prompt")
      expect(parsed.roles?.[0]).not.toHaveProperty("contract")
      expect(parsed.roles?.[0]).not.toHaveProperty("role_prompt")
      expect(parsed.roles?.[0]).not.toHaveProperty("system_prompt")
    }
  })

  test("#given minimal config #when safeParse #then applies defaults and has no prompt fields", () => {
    // given
    const minimalConfig = {}

    // when
    const result = ImplementationTeamConfigSchema.safeParse(minimalConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      const parsed = result.data
      expect(parsed.enabled).toBe(true)
      expect(parsed.max_ordinary_rounds).toBe(2)
      // Verify defaults also have no prompt fields
      if (parsed.roles && parsed.roles.length > 0) {
        expect(parsed.roles[0]).not.toHaveProperty("prompt")
        expect(parsed.roles[0]).not.toHaveProperty("contract")
      }
    }
  })

  test("#given role config fields #when safeParse #then only recognizes id, name, description, reviewers, blocker_policy", () => {
    // given
    const roleConfig = {
      roles: [
        {
          id: "custom-role",
          name: "Custom Role",
          description: "Custom description",
          reviewers: [{ model: "test-model" }],
          blocker_policy: "any_blocker_fails_role",
          // These should NOT be recognized (would be stripped or cause issues if added)
          prompt: "Should not exist",
          contract: "Should not exist",
          role_prompt: "Should not exist",
        },
      ],
    }

    // when
    const result = ImplementationTeamConfigSchema.safeParse(roleConfig)

    // then
    // Note: Zod will strip unknown fields, so we verify the schema does NOT have these fields
    // This test documents that these fields are NOT part of the schema in V1
    expect(result.success).toBe(true)
    if (result.success && result.data.roles && result.data.roles[0]) {
      // Unknown fields are stripped by Zod, so these should be undefined
      expect(result.data.roles[0]).not.toHaveProperty("prompt")
      expect(result.data.roles[0]).not.toHaveProperty("contract")
      expect(result.data.roles[0]).not.toHaveProperty("role_prompt")
    }
  })
})

// ============================================================================
// Helper Functions
// ============================================================================

function createReviewerTaskInput(roleId: string): ReviewerTaskInput {
  const config = createDefaultConfig()
  const role = config.roles.find((r) => r.id === roleId) ?? config.roles[0]

  return {
    runId: "run-123",
    round: 1,
    role,
    reviewerModel: "default",
    reviewerIndex: 0,
    executorOutputRef: ".sisyphus/evidence/impl-team/run-123/round-1/executor-output.txt",
    taskDescription: "Implement a login feature",
    unresolvedFindings: undefined,
  }
}

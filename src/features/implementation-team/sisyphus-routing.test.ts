import { describe, expect, test } from "bun:test"
import {
  activateImplementationTeamRoutingDirective,
  getImplementationTeamRoutingDirective,
  ROUTING_DIRECTIVE_TEMPLATE,
} from "./sisyphus-routing"
import type { ImplementationIntent } from "./activation-boundary"
import type { ResolvedImplementationTeamConfig } from "./config-resolver"

describe("activateImplementationTeamRoutingDirective", () => {
  describe("given qualifying intents with enabled config", () => {
    const qualifyingIntents: ImplementationIntent[] = [
      "implementation",
      "fix",
      "build",
      "refactor",
      "optimization",
    ]

    const enabledConfig: ResolvedImplementationTeamConfig = {
      enabled: true,
      executor: { category: "unspecified-high" },
      roles: [],
      maxOrdinaryRounds: 2,
      escalation: { enabled: true },
      resourceCaps: {
        maxTotalSpawnedTasks: 50,
        maxReviewersPerRole: 5,
        maxRoles: 3,
      },
      passPolicy: { requireAllRolesPass: true },
      blockerPolicy: { anyBlockerFailsRole: true },
      defaultRoles: true,
    }

    for (const intent of qualifyingIntents) {
      test(`when intent is ${intent}, then returns routing directive`, () => {
        const result = activateImplementationTeamRoutingDirective(intent, enabledConfig)
        expect(result).not.toBeNull()
        expect(typeof result).toBe("string")
      })

      test(`when intent is ${intent}, then directive contains implementation-team references`, () => {
        const result = activateImplementationTeamRoutingDirective(intent, enabledConfig)
        expect(result).toContain("implementation-team")
        expect(result).toContain("executor")
        expect(result).toContain("Reviewers")
      })

      test(`when intent is ${intent}, then directive mentions review rounds`, () => {
        const result = activateImplementationTeamRoutingDirective(intent, enabledConfig)
        expect(result).toContain("review rounds")
      })
    }
  })

  describe("given bypassing intents with enabled config", () => {
    const bypassingIntents: ImplementationIntent[] = [
      "docs",
      "research",
      "planning",
      "evaluation",
      "explanation",
      "investigation",
    ]

    const enabledConfig: ResolvedImplementationTeamConfig = {
      enabled: true,
      executor: { category: "unspecified-high" },
      roles: [],
      maxOrdinaryRounds: 2,
      escalation: { enabled: true },
      resourceCaps: {
        maxTotalSpawnedTasks: 50,
        maxReviewersPerRole: 5,
        maxRoles: 3,
      },
      passPolicy: { requireAllRolesPass: true },
      blockerPolicy: { anyBlockerFailsRole: true },
      defaultRoles: true,
    }

    for (const intent of bypassingIntents) {
      test(`when intent is ${intent}, then returns null`, () => {
        const result = activateImplementationTeamRoutingDirective(intent, enabledConfig)
        expect(result).toBeNull()
      })
    }
  })

  describe("given config.enabled is false", () => {
    const allIntents: ImplementationIntent[] = [
      "implementation",
      "fix",
      "build",
      "refactor",
      "optimization",
      "docs",
      "research",
      "planning",
      "evaluation",
      "explanation",
      "investigation",
    ]

    const disabledConfig: ResolvedImplementationTeamConfig = {
      enabled: false,
      executor: { category: "unspecified-high" },
      roles: [],
      maxOrdinaryRounds: 2,
      escalation: { enabled: true },
      resourceCaps: {
        maxTotalSpawnedTasks: 50,
        maxReviewersPerRole: 5,
        maxRoles: 3,
      },
      passPolicy: { requireAllRolesPass: true },
      blockerPolicy: { anyBlockerFailsRole: true },
      defaultRoles: true,
    }

    for (const intent of allIntents) {
      test(`when intent is ${intent} and config.enabled is false, then returns null`, () => {
        const result = activateImplementationTeamRoutingDirective(intent, disabledConfig)
        expect(result).toBeNull()
      })
    }
  })

  describe("given directive content", () => {
    const enabledConfig: ResolvedImplementationTeamConfig = {
      enabled: true,
      executor: { category: "unspecified-high" },
      roles: [],
      maxOrdinaryRounds: 2,
      escalation: { enabled: true },
      resourceCaps: {
        maxTotalSpawnedTasks: 50,
        maxReviewersPerRole: 5,
        maxRoles: 3,
      },
      passPolicy: { requireAllRolesPass: true },
      blockerPolicy: { anyBlockerFailsRole: true },
      defaultRoles: true,
    }

    test("when called with implementation intent, then directive is imperative and declarative", () => {
      const result = activateImplementationTeamRoutingDirective("implementation", enabledConfig)
      expect(result).toContain("use the implementation-team workflow")
    })

    test("when called with fix intent, then directive mentions executor role", () => {
      const result = activateImplementationTeamRoutingDirective("fix", enabledConfig)
      expect(result).toContain("executor")
    })

    test("when called with build intent, then directive mentions reviewer roles", () => {
      const result = activateImplementationTeamRoutingDirective("build", enabledConfig)
      expect(result).toContain("Reviewers")
      expect(result).toContain("spec-fidelity")
      expect(result).toContain("code-quality")
      expect(result).toContain("risk-regression")
    })

    test("when called with refactor intent, then directive mentions escalation judge", () => {
      const result = activateImplementationTeamRoutingDirective("refactor", enabledConfig)
      expect(result).toContain("Escalation judge")
    })

    test("when called with optimization intent, then directive specifies max review rounds", () => {
      const result = activateImplementationTeamRoutingDirective("optimization", enabledConfig)
      expect(result).toContain("Maximum 2 ordinary review rounds")
    })
  })
})

describe("getImplementationTeamRoutingDirective", () => {
  describe("given qualifying intent with enabled config", () => {
    test("when intent is implementation, then returns same result as activate function", () => {
      const config: ResolvedImplementationTeamConfig = {
        enabled: true,
        executor: { category: "unspecified-high" },
        roles: [],
        maxOrdinaryRounds: 2,
        escalation: { enabled: true },
        resourceCaps: {
          maxTotalSpawnedTasks: 50,
          maxReviewersPerRole: 5,
          maxRoles: 3,
        },
        passPolicy: { requireAllRolesPass: true },
        blockerPolicy: { anyBlockerFailsRole: true },
        defaultRoles: true,
      }

      const activateResult = activateImplementationTeamRoutingDirective("implementation", config)
      const getterResult = getImplementationTeamRoutingDirective("implementation", config)
      expect(getterResult).toBe(activateResult)
    })
  })

  describe("given bypassing intent with enabled config", () => {
    test("when intent is research, then returns null like activate function", () => {
      const config: ResolvedImplementationTeamConfig = {
        enabled: true,
        executor: { category: "unspecified-high" },
        roles: [],
        maxOrdinaryRounds: 2,
        escalation: { enabled: true },
        resourceCaps: {
          maxTotalSpawnedTasks: 50,
          maxReviewersPerRole: 5,
          maxRoles: 3,
        },
        passPolicy: { requireAllRolesPass: true },
        blockerPolicy: { anyBlockerFailsRole: true },
        defaultRoles: true,
      }

      const activateResult = activateImplementationTeamRoutingDirective("research", config)
      const getterResult = getImplementationTeamRoutingDirective("research", config)
      expect(getterResult).toBeNull()
      expect(getterResult).toBe(activateResult)
    })
  })
})

describe("ROUTING_DIRECTIVE_TEMPLATE", () => {
  test("contains implementation-team workflow reference", () => {
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("Implementation Team Workflow")
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("implementation-team workflow")
  })

  test("mentions executor role", () => {
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("executor")
  })

  test("mentions reviewer roles with specific checks", () => {
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("Reviewers")
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("spec-fidelity")
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("code-quality")
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("risk-regression")
  })

  test("mentions escalation judge", () => {
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("Escalation judge")
  })

  test("specifies maximum ordinary review rounds", () => {
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("Maximum 2 ordinary review rounds")
  })

  test("is a non-empty string", () => {
    expect(ROUTING_DIRECTIVE_TEMPLATE.length).toBeGreaterThan(0)
  })

  test("is imperative and declarative in style", () => {
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("use the")
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("Delegate to the executor")
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("Reviewers check")
    expect(ROUTING_DIRECTIVE_TEMPLATE).toContain("Maximum")
  })
})

describe("complete 11-intent routing coverage", () => {
  const ALL_INTENTS: ImplementationIntent[] = [
    "implementation",
    "fix",
    "build",
    "refactor",
    "optimization",
    "docs",
    "research",
    "planning",
    "evaluation",
    "explanation",
    "investigation",
  ]

  const enabledConfig: ResolvedImplementationTeamConfig = {
    enabled: true,
    executor: { category: "unspecified-high" },
    roles: [],
    maxOrdinaryRounds: 2,
    escalation: { enabled: true },
    resourceCaps: {
      maxTotalSpawnedTasks: 50,
      maxReviewersPerRole: 5,
      maxRoles: 3,
    },
    passPolicy: { requireAllRolesPass: true },
    blockerPolicy: { anyBlockerFailsRole: true },
    defaultRoles: true,
  }

  const disabledConfig: ResolvedImplementationTeamConfig = {
    enabled: false,
    executor: { category: "unspecified-high" },
    roles: [],
    maxOrdinaryRounds: 2,
    escalation: { enabled: true },
    resourceCaps: {
      maxTotalSpawnedTasks: 50,
      maxReviewersPerRole: 5,
      maxRoles: 3,
    },
    passPolicy: { requireAllRolesPass: true },
    blockerPolicy: { anyBlockerFailsRole: true },
    defaultRoles: true,
  }

  test("all 11 intents have correct routing with enabled config", () => {
    const expectedRouting: Record<ImplementationIntent, boolean> = {
      implementation: true,
      fix: true,
      build: true,
      refactor: true,
      optimization: true,
      docs: false,
      research: false,
      planning: false,
      evaluation: false,
      explanation: false,
      investigation: false,
    }

    for (const [intent, shouldRoute] of Object.entries(expectedRouting)) {
      const directive = activateImplementationTeamRoutingDirective(intent as ImplementationIntent, enabledConfig)
      if (shouldRoute) {
        expect(
          directive,
          `Intent "${intent}" should route through implementation-team`,
        ).not.toBeNull()
        expect(typeof directive).toBe("string")
        expect(directive).toContain("implementation-team")
      } else {
        expect(
          directive,
          `Intent "${intent}" should bypass implementation-team`,
        ).toBeNull()
      }
    }
  })

  test("build and fix intents route through implementation-team with enabled config", () => {
    const buildDirective = activateImplementationTeamRoutingDirective("build", enabledConfig)
    const fixDirective = activateImplementationTeamRoutingDirective("fix", enabledConfig)

    expect(buildDirective).not.toBeNull()
    expect(fixDirective).not.toBeNull()
    expect(buildDirective).toContain("implementation-team")
    expect(fixDirective).toContain("implementation-team")
  })

  test("research, docs, planning, and explanation intents bypass implementation-team with enabled config", () => {
    expect(activateImplementationTeamRoutingDirective("research", enabledConfig)).toBeNull()
    expect(activateImplementationTeamRoutingDirective("docs", enabledConfig)).toBeNull()
    expect(activateImplementationTeamRoutingDirective("planning", enabledConfig)).toBeNull()
    expect(activateImplementationTeamRoutingDirective("explanation", enabledConfig)).toBeNull()
  })

  test("config enabled=false bypasses all 11 intents", () => {
    for (const intent of ALL_INTENTS) {
      expect(
        activateImplementationTeamRoutingDirective(intent, disabledConfig),
        `Intent "${intent}" with config.enabled=false should bypass`,
      ).toBeNull()
    }
  })

  test("getImplementationTeamRoutingDirective is alias for activateImplementationTeamRoutingDirective for all intents", () => {
    for (const intent of ALL_INTENTS) {
      const activateResult = activateImplementationTeamRoutingDirective(intent, enabledConfig)
      const getterResult = getImplementationTeamRoutingDirective(intent, enabledConfig)
      expect(getterResult).toBe(activateResult)
    }
  })

  test("routing directive contains required workflow components for activation intents", () => {
    const directive = activateImplementationTeamRoutingDirective("implementation", enabledConfig)
    expect(directive).toContain("executor")
    expect(directive).toContain("Reviewers")
    expect(directive).toContain("Escalation judge")
    expect(directive).toContain("review rounds")
  })

  test("routing directive does not contain implementation-team reference for bypass intents", () => {
    const bypassIntents: ImplementationIntent[] = [
      "docs",
      "research",
      "planning",
      "evaluation",
      "explanation",
      "investigation",
    ]
    for (const intent of bypassIntents) {
      const directive = activateImplementationTeamRoutingDirective(intent, enabledConfig)
      expect(directive).toBeNull()
    }
  })

  test("investigation intent bypasses implementation-team (not paired with fix)", () => {
    expect(activateImplementationTeamRoutingDirective("investigation", enabledConfig)).toBeNull()
  })

  test("optimization intent routes through implementation-team with correct directive", () => {
    const directive = activateImplementationTeamRoutingDirective("optimization", enabledConfig)
    expect(directive).not.toBeNull()
    expect(directive).toContain("Maximum 2 ordinary review rounds")
  })
})
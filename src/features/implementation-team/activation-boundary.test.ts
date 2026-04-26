import { describe, expect, test } from "bun:test"
import {
  shouldActivateImplementationTeam,
  getBypassReason,
  ALWAYS_ACTIVATE,
  ALWAYS_BYPASS,
  type ImplementationIntent,
} from "./activation-boundary"

describe("shouldActivateImplementationTeam", () => {
  describe("given intents that should always activate", () => {
    const activateIntents: ImplementationIntent[] = [
      "implementation",
      "fix",
      "build",
      "refactor",
      "optimization",
    ]

    for (const intent of activateIntents) {
      test(`when intent is ${intent}, then returns true`, () => {
        expect(shouldActivateImplementationTeam(intent)).toBe(true)
      })
    }
  })

  describe("given intents that should always bypass", () => {
    const bypassIntents: ImplementationIntent[] = [
      "docs",
      "research",
      "planning",
      "evaluation",
      "explanation",
      "investigation",
    ]

    for (const intent of bypassIntents) {
      test(`when intent is ${intent}, then returns false`, () => {
        expect(shouldActivateImplementationTeam(intent)).toBe(false)
      })
    }
  })

  describe("given config override", () => {
    test("when config.enabled is false, then returns false regardless of intent", () => {
      const intents: ImplementationIntent[] = [
        "implementation",
        "fix",
        "build",
        "refactor",
        "optimization",
      ]

      for (const intent of intents) {
        expect(shouldActivateImplementationTeam(intent, { enabled: false })).toBe(false)
      }
    })

    test("when config.enabled is true, then behaves normally", () => {
      expect(shouldActivateImplementationTeam("implementation", { enabled: true })).toBe(true)
      expect(shouldActivateImplementationTeam("research", { enabled: true })).toBe(false)
    })

    test("when config is ResolvedImplementationTeamConfig with enabled=false, then returns false", () => {
      const resolvedConfig = { enabled: false } as const
      expect(shouldActivateImplementationTeam("implementation", resolvedConfig)).toBe(false)
    })

    test("when config is ResolvedImplementationTeamConfig with enabled=true, then behaves normally", () => {
      const resolvedConfig = { enabled: true } as const
      expect(shouldActivateImplementationTeam("implementation", resolvedConfig)).toBe(true)
      expect(shouldActivateImplementationTeam("research", resolvedConfig)).toBe(false)
    })

    test("when config is undefined, then uses default logic", () => {
      expect(shouldActivateImplementationTeam("implementation", undefined)).toBe(true)
      expect(shouldActivateImplementationTeam("research", undefined)).toBe(false)
    })
  })

  describe("given ambiguous intents", () => {
    test("when intent is investigation, then returns false (investigation alone does not activate)", () => {
      expect(shouldActivateImplementationTeam("investigation")).toBe(false)
    })
  })
})

describe("getBypassReason", () => {
  describe("given intents that should bypass", () => {
    test("when intent is docs, then returns descriptive reason", () => {
      const reason = getBypassReason("docs")
      expect(reason).not.toBeNull()
      expect(reason).toContain("Documentation-only work")
    })

    test("when intent is research, then returns descriptive reason", () => {
      const reason = getBypassReason("research")
      expect(reason).not.toBeNull()
      expect(reason).toContain("Research and exploration")
    })

    test("when intent is planning, then returns descriptive reason", () => {
      const reason = getBypassReason("planning")
      expect(reason).not.toBeNull()
      expect(reason).toContain("Planning and architecture design")
    })

    test("when intent is evaluation, then returns descriptive reason", () => {
      const reason = getBypassReason("evaluation")
      expect(reason).not.toBeNull()
      expect(reason).toContain("Evaluation and assessment")
    })

    test("when intent is explanation, then returns descriptive reason", () => {
      const reason = getBypassReason("explanation")
      expect(reason).not.toBeNull()
      expect(reason).toContain("Pure explanation and teaching")
    })

    test("when intent is investigation, then returns descriptive reason", () => {
      const reason = getBypassReason("investigation")
      expect(reason).not.toBeNull()
      expect(reason).toContain("Investigation and debugging")
    })
  })

  describe("given intents that should activate", () => {
    const activateIntents: ImplementationIntent[] = [
      "implementation",
      "fix",
      "build",
      "refactor",
      "optimization",
    ]

    for (const intent of activateIntents) {
      test(`when intent is ${intent}, then returns null`, () => {
        expect(getBypassReason(intent)).toBeNull()
      })
    }
  })
})

describe("ALWAYS_ACTIVATE set", () => {
  test("contains expected intents", () => {
    expect(ALWAYS_ACTIVATE.has("implementation")).toBe(true)
    expect(ALWAYS_ACTIVATE.has("fix")).toBe(true)
    expect(ALWAYS_ACTIVATE.has("build")).toBe(true)
    expect(ALWAYS_ACTIVATE.has("refactor")).toBe(true)
    expect(ALWAYS_ACTIVATE.has("optimization")).toBe(true)
  })

  test("does not contain bypass intents", () => {
    expect(ALWAYS_ACTIVATE.has("docs")).toBe(false)
    expect(ALWAYS_ACTIVATE.has("research")).toBe(false)
    expect(ALWAYS_ACTIVATE.has("planning")).toBe(false)
    expect(ALWAYS_ACTIVATE.has("evaluation")).toBe(false)
    expect(ALWAYS_ACTIVATE.has("explanation")).toBe(false)
    expect(ALWAYS_ACTIVATE.has("investigation")).toBe(false)
  })
})

describe("ALWAYS_BYPASS set", () => {
  test("contains expected intents", () => {
    expect(ALWAYS_BYPASS.has("docs")).toBe(true)
    expect(ALWAYS_BYPASS.has("research")).toBe(true)
    expect(ALWAYS_BYPASS.has("planning")).toBe(true)
    expect(ALWAYS_BYPASS.has("evaluation")).toBe(true)
    expect(ALWAYS_BYPASS.has("explanation")).toBe(true)
    expect(ALWAYS_BYPASS.has("investigation")).toBe(true)
  })

  test("does not contain activation intents", () => {
    expect(ALWAYS_BYPASS.has("implementation")).toBe(false)
    expect(ALWAYS_BYPASS.has("fix")).toBe(false)
    expect(ALWAYS_BYPASS.has("build")).toBe(false)
    expect(ALWAYS_BYPASS.has("refactor")).toBe(false)
    expect(ALWAYS_BYPASS.has("optimization")).toBe(false)
  })
})

describe("complete 11-intent classification coverage", () => {
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

  test("ALWAYS_ACTIVATE and ALWAYS_BYPASS are mutually exclusive and cover all 11 intents", () => {
    for (const intent of ALL_INTENTS) {
      const activates = ALWAYS_ACTIVATE.has(intent)
      const bypasses = ALWAYS_BYPASS.has(intent)
      expect(
        activates || bypasses,
        `Intent "${intent}" must be in either ALWAYS_ACTIVATE or ALWAYS_BYPASS`,
      ).toBe(true)
    }

    for (const intent of ALL_INTENTS) {
      const activates = ALWAYS_ACTIVATE.has(intent)
      const bypasses = ALWAYS_BYPASS.has(intent)
      expect(
        !(activates && bypasses),
        `Intent "${intent}" cannot be in both ALWAYS_ACTIVATE and ALWAYS_BYPASS`,
      ).toBe(true)
    }
  })

  test("all 11 intents are classified with correct shouldActivate result", () => {
    const expectedActivation: Record<ImplementationIntent, boolean> = {
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

    for (const [intent, expected] of Object.entries(expectedActivation)) {
      expect(
        shouldActivateImplementationTeam(intent as ImplementationIntent),
        `Intent "${intent}" shouldActivate should be ${expected}`,
      ).toBe(expected)
    }
  })

  test("all 11 intents have corresponding bypass reason behavior", () => {
    const shouldHaveReason: Record<ImplementationIntent, boolean> = {
      implementation: false,
      fix: false,
      build: false,
      refactor: false,
      optimization: false,
      docs: true,
      research: true,
      planning: true,
      evaluation: true,
      explanation: true,
      investigation: true,
    }

    for (const [intent, hasReason] of Object.entries(shouldHaveReason)) {
      const reason = getBypassReason(intent as ImplementationIntent)
      if (hasReason) {
        expect(reason, `Intent "${intent}" should have a bypass reason`).not.toBeNull()
        expect(typeof reason).toBe("string")
        expect(reason!.length).toBeGreaterThan(0)
      } else {
        expect(reason, `Intent "${intent}" should have null bypass reason`).toBeNull()
      }
    }
  })

  test("build and fix intents activate implementation-team and have no bypass reason", () => {
    expect(shouldActivateImplementationTeam("build")).toBe(true)
    expect(shouldActivateImplementationTeam("fix")).toBe(true)
    expect(getBypassReason("build")).toBeNull()
    expect(getBypassReason("fix")).toBeNull()
  })

  test("research, docs, planning, and explanation intents bypass implementation-team with descriptive reasons", () => {
    expect(shouldActivateImplementationTeam("research")).toBe(false)
    expect(shouldActivateImplementationTeam("docs")).toBe(false)
    expect(shouldActivateImplementationTeam("planning")).toBe(false)
    expect(shouldActivateImplementationTeam("explanation")).toBe(false)

    expect(getBypassReason("research")).toContain("Research")
    expect(getBypassReason("docs")).toContain("Documentation")
    expect(getBypassReason("planning")).toContain("Planning")
    expect(getBypassReason("explanation")).toContain("explanation")
  })

  test("config enabled=false bypasses all intents regardless of classification", () => {
    const disabledConfig = { enabled: false }
    for (const intent of ALL_INTENTS) {
      expect(
        shouldActivateImplementationTeam(intent, disabledConfig),
        `Intent "${intent}" with config.enabled=false should bypass`,
      ).toBe(false)
    }
  })

  test("config enabled=true preserves normal classification behavior", () => {
    const enabledConfig = { enabled: true }
    expect(shouldActivateImplementationTeam("build", enabledConfig)).toBe(true)
    expect(shouldActivateImplementationTeam("fix", enabledConfig)).toBe(true)
    expect(shouldActivateImplementationTeam("research", enabledConfig)).toBe(false)
    expect(shouldActivateImplementationTeam("docs", enabledConfig)).toBe(false)
  })

  test("investigation intent bypasses standalone (not paired with fix)", () => {
    expect(shouldActivateImplementationTeam("investigation")).toBe(false)
    expect(getBypassReason("investigation")).toContain("Investigation")
  })
})
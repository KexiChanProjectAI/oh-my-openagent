import { describe, expect, test } from "bun:test"
import { aggregateGlobal } from "./global-aggregator"
import type { RoleAggregateVerdict } from "./schemas"

// Helper to create a minimal RoleAggregateVerdict
function makeRoleVerdict(overrides: Partial<RoleAggregateVerdict> & { role: string; pass: boolean }): RoleAggregateVerdict {
  return {
    round: 1,
    reviewer_count: 1,
    malformed_count: 0,
    blocker_count: 0,
    deduped_findings: [],
    reviewer_lineage: [],
    ...overrides,
  }
}

describe("#given all roles pass", () => {
  test("when multiple roles pass, returns global pass true", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: true }),
      makeRoleVerdict({ role: "security", pass: true }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(true)
    expect(result.failed_roles).toEqual([])
    expect(result.executor_patch_brief.unresolved_blockers).toEqual([])
    expect(result.executor_patch_brief.failed_role_ids).toEqual([])
  })

  test("when single role passes, returns global pass true", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: true }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(true)
    expect(result.failed_roles).toEqual([])
  })
})

describe("#given no roles", () => {
  test("when roleVerdicts is empty, returns global pass true", () => {
    const result = aggregateGlobal(1, [])

    expect(result.pass).toBe(true)
    expect(result.failed_roles).toEqual([])
    expect(result.executor_patch_brief.unresolved_blockers).toEqual([])
    expect(result.executor_patch_brief.failed_role_ids).toEqual([])
  })
})

describe("#given one role fails", () => {
  test("when single role fails, returns global pass false", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: false }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toEqual(["reviewer"])
    expect(result.executor_patch_brief.failed_role_ids).toEqual(["reviewer"])
  })

  test("when failing role has BLOCKER findings, includes them in executor patch brief", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({
        role: "security",
        pass: false,
        deduped_findings: [
          {
            id: "finding-1",
            description: "SQL injection vulnerability",
            severity: "BLOCKER",
            category: "security",
          },
        ],
      }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toEqual(["security"])
    expect(result.executor_patch_brief.unresolved_blockers).toHaveLength(1)
    expect(result.executor_patch_brief.unresolved_blockers[0].id).toBe("finding-1")
    expect(result.executor_patch_brief.execution_round).toBe(1)
  })

  test("when failing role has only MAJOR/MINOR findings, unresolved_blockers is empty", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({
        role: "reviewer",
        pass: false,
        deduped_findings: [
          {
            id: "finding-2",
            description: "Code style issue",
            severity: "MAJOR",
            category: "maintainability",
          },
        ],
      }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toEqual(["reviewer"])
    expect(result.executor_patch_brief.unresolved_blockers).toEqual([])
  })
})

describe("#given multiple roles fail", () => {
  test("when two roles fail, includes both in failed_roles", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: false }),
      makeRoleVerdict({ role: "security", pass: false }),
    ]

    const result = aggregateGlobal(2, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toContain("reviewer")
    expect(result.failed_roles).toContain("security")
    expect(result.failed_roles).toHaveLength(2)
    expect(result.executor_patch_brief.failed_role_ids).toEqual(["reviewer", "security"])
  })

  test("when failed roles share same BLOCKER finding, deduplicates by id", () => {
    const sharedFinding = {
      id: "shared-blocker",
      description: "Critical bug in shared module",
      severity: "BLOCKER" as const,
      category: "correctness" as const,
    }

    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({
        role: "reviewer",
        pass: false,
        deduped_findings: [sharedFinding],
      }),
      makeRoleVerdict({
        role: "security",
        pass: false,
        deduped_findings: [sharedFinding],
      }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.executor_patch_brief.unresolved_blockers).toHaveLength(1)
    expect(result.executor_patch_brief.unresolved_blockers[0].id).toBe("shared-blocker")
  })

  test("when failed roles have different BLOCKER findings, includes all", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({
        role: "reviewer",
        pass: false,
        deduped_findings: [
          {
            id: "blocker-1",
            description: "Bug in reviewer",
            severity: "BLOCKER",
            category: "correctness",
          },
        ],
      }),
      makeRoleVerdict({
        role: "security",
        pass: false,
        deduped_findings: [
          {
            id: "blocker-2",
            description: "Vulnerability in security",
            severity: "BLOCKER",
            category: "security",
          },
        ],
      }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.executor_patch_brief.unresolved_blockers).toHaveLength(2)
    const blockerIds = result.executor_patch_brief.unresolved_blockers.map((f) => f.id)
    expect(blockerIds).toContain("blocker-1")
    expect(blockerIds).toContain("blocker-2")
  })
})

describe("#given role with malformed_count", () => {
  test("when role has malformed_count > 0 but pass is true, still fails globally", () => {
    // This edge case should not happen with correct implementation,
    // but we treat malformed_count > 0 as failure regardless
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: true, malformed_count: 1 }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toEqual(["reviewer"])
  })

  test("when one role passes and one has malformed_count, global fails", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: true, malformed_count: 0 }),
      makeRoleVerdict({ role: "security", pass: true, malformed_count: 2 }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toEqual(["security"])
  })
})

describe("#given round number", () => {
  test("passes round number through to result and executor patch brief", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: false }),
    ]

    const result = aggregateGlobal(5, roleVerdicts)

    expect(result.round).toBe(5)
    expect(result.executor_patch_brief.execution_round).toBe(5)
  })
})

describe("#given role_aggregates preservation", () => {
  test("preserves original role aggregates in result", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({
        role: "reviewer",
        pass: true,
        reviewer_count: 3,
        blocker_count: 0,
      }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.role_aggregates).toHaveLength(1)
    expect(result.role_aggregates[0].role).toBe("reviewer")
    expect(result.role_aggregates[0].reviewer_count).toBe(3)
  })
})

// ============================================================================
// Tests: 3+ roles with mixed results
// ============================================================================

describe("#given three or more roles with mixed pass/fail", () => {
  test("when all three pass, returns global pass true", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: true }),
      makeRoleVerdict({ role: "security", pass: true }),
      makeRoleVerdict({ role: "performance", pass: true }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(true)
    expect(result.failed_roles).toEqual([])
    expect(result.role_aggregates).toHaveLength(3)
  })

  test("when one of three fails, returns global pass false", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: true }),
      makeRoleVerdict({ role: "security", pass: false }),
      makeRoleVerdict({ role: "performance", pass: true }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toEqual(["security"])
    expect(result.failed_roles).toHaveLength(1)
  })

  test("when two of three fail, includes both in failed_roles", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: false }),
      makeRoleVerdict({ role: "security", pass: true }),
      makeRoleVerdict({ role: "performance", pass: false }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toContain("reviewer")
    expect(result.failed_roles).toContain("performance")
    expect(result.failed_roles).toHaveLength(2)
  })

  test("when all three fail, includes all in failed_roles", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({ role: "reviewer", pass: false }),
      makeRoleVerdict({ role: "security", pass: false }),
      makeRoleVerdict({ role: "performance", pass: false }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toEqual(["reviewer", "security", "performance"])
    expect(result.failed_roles).toHaveLength(3)
  })

  test("when mixed pass/fail with blockers, collects all blockers from failed roles", () => {
    const roleVerdicts: RoleAggregateVerdict[] = [
      makeRoleVerdict({
        role: "reviewer",
        pass: true,
        blocker_count: 0,
        deduped_findings: [],
      }),
      makeRoleVerdict({
        role: "security",
        pass: false,
        blocker_count: 1,
        deduped_findings: [
          {
            id: "sec-blocker-1",
            description: "SQL injection",
            severity: "BLOCKER",
            category: "security",
          },
        ],
      }),
      makeRoleVerdict({
        role: "performance",
        pass: false,
        blocker_count: 1,
        deduped_findings: [
          {
            id: "perf-blocker-1",
            description: "Memory leak",
            severity: "BLOCKER",
            category: "performance",
          },
        ],
      }),
    ]

    const result = aggregateGlobal(1, roleVerdicts)

    expect(result.pass).toBe(false)
    expect(result.failed_roles).toEqual(["security", "performance"])
    expect(result.executor_patch_brief.unresolved_blockers).toHaveLength(2)
    const blockerIds = result.executor_patch_brief.unresolved_blockers.map((f) => f.id)
    expect(blockerIds).toContain("sec-blocker-1")
    expect(blockerIds).toContain("perf-blocker-1")
  })
})

// ============================================================================
// Tests: empty roles array edge case
// ============================================================================

describe("#given empty roles array", () => {
  test("when no roles provided, returns global pass true with empty arrays", () => {
    const result = aggregateGlobal(1, [])

    expect(result.pass).toBe(true)
    expect(result.failed_roles).toEqual([])
    expect(result.role_aggregates).toEqual([])
    expect(result.executor_patch_brief.unresolved_blockers).toEqual([])
    expect(result.executor_patch_brief.failed_role_ids).toEqual([])
    expect(result.executor_patch_brief.execution_round).toBe(1)
  })
})
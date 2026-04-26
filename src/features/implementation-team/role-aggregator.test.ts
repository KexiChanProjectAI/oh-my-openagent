import { describe, expect, test } from "bun:test"
import type { Finding, MalformedVerdict, ReviewerVerdict } from "./schemas"
import { aggregateRole } from "./role-aggregator"

// ============================================================================
// Test Helpers
// ============================================================================

function makeReviewerVerdict(overrides: Partial<ReviewerVerdict> = {}): ReviewerVerdict {
  const defaultVerdict: ReviewerVerdict = {
    schema_version: "1.0",
    run_id: "run-1",
    round: 1,
    role: "test-role",
    reviewer_id: "reviewer-0",
    model_id: "gpt-4o",
    verdict: "PASS",
    severity: "NONE",
    blocker_count: 0,
    findings: [],
    summary: "All good",
    timestamp: new Date().toISOString(),
  }
  return { ...defaultVerdict, ...overrides }
}

function makeMalformedVerdict(overrides: Partial<MalformedVerdict> = {}): MalformedVerdict {
  const defaultMalformed: MalformedVerdict = {
    is_malformed: true,
    raw_output: "invalid json",
    error_type: "invalid_json",
    role: "test-role",
  }
  return { ...defaultMalformed, ...overrides }
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const defaultFinding: Finding = {
    id: "finding-1",
    description: "Test finding",
    severity: "MINOR",
    category: "correctness",
  }
  return { ...defaultFinding, ...overrides }
}

// ============================================================================
// Tests: Empty verdicts array
// ============================================================================

describe("#given empty verdicts array", () => {
  test("should return pass=true with zero counts", () => {
    const result = aggregateRole("test-role", 1, [])

    expect(result.role).toBe("test-role")
    expect(result.round).toBe(1)
    expect(result.pass).toBe(true)
    expect(result.reviewer_count).toBe(0)
    expect(result.malformed_count).toBe(0)
    expect(result.blocker_count).toBe(0)
    expect(result.deduped_findings).toHaveLength(0)
    expect(result.reviewer_lineage).toHaveLength(0)
  })
})

// ============================================================================
// Tests: All PASS verdicts with no findings
// ============================================================================

describe("#given all PASS verdicts with no findings", () => {
  test("should return pass=true", () => {
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeReviewerVerdict({ reviewer_id: "reviewer-0", verdict: "PASS", findings: [] }),
      makeReviewerVerdict({ reviewer_id: "reviewer-1", verdict: "PASS", findings: [] }),
    ]

    const result = aggregateRole("test-role", 1, verdicts)

    expect(result.pass).toBe(true)
    expect(result.reviewer_count).toBe(2)
    expect(result.malformed_count).toBe(0)
    expect(result.blocker_count).toBe(0)
    expect(result.deduped_findings).toHaveLength(0)
  })
})

// ============================================================================
// Tests: Mixed verdicts with one BLOCKER
// ============================================================================

describe("#given mixed verdicts and one BLOCKER finding", () => {
  test("should return pass=false due to blocker", () => {
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeReviewerVerdict({
        reviewer_id: "reviewer-0",
        verdict: "PASS",
        severity: "NONE",
        findings: [],
      }),
      makeReviewerVerdict({
        reviewer_id: "reviewer-1",
        verdict: "FAIL",
        severity: "BLOCKER",
        blocker_count: 1,
        findings: [makeFinding({ id: "blocker-1", severity: "BLOCKER", description: "Critical issue" })],
      }),
    ]

    const result = aggregateRole("test-role", 1, verdicts)

    expect(result.pass).toBe(false)
    expect(result.blocker_count).toBe(1)
    expect(result.malformed_count).toBe(0)
    expect(result.deduped_findings).toHaveLength(1)
    expect(result.deduped_findings[0].id).toBe("blocker-1")
  })
})

// ============================================================================
// Tests: Multiple reviewers find same issue (dedup)
// ============================================================================

describe("#given multiple reviewers find same finding id", () => {
  test("should dedupe findings by id", () => {
    const sameFinding = makeFinding({ id: "shared-issue", description: "Same issue found by multiple" })

    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeReviewerVerdict({
        reviewer_id: "reviewer-0",
        verdict: "FAIL",
        severity: "MAJOR",
        findings: [sameFinding],
      }),
      makeReviewerVerdict({
        reviewer_id: "reviewer-1",
        verdict: "FAIL",
        severity: "MAJOR",
        findings: [sameFinding],
      }),
      makeReviewerVerdict({
        reviewer_id: "reviewer-2",
        verdict: "FAIL",
        severity: "MAJOR",
        findings: [sameFinding],
      }),
    ]

    const result = aggregateRole("test-role", 1, verdicts)

    expect(result.deduped_findings).toHaveLength(1)
    expect(result.deduped_findings[0].id).toBe("shared-issue")
    expect(result.blocker_count).toBe(0) // MAJOR is not a blocker
  })
})

// ============================================================================
// Tests: All malformed verdicts
// ============================================================================

describe("#given all malformed verdicts", () => {
  test("should return pass=false and malformed_count=N", () => {
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeMalformedVerdict({ error_type: "invalid_json" }),
      makeMalformedVerdict({ error_type: "missing_fields" }),
      makeMalformedVerdict({ error_type: "parse_error" }),
    ]

    const result = aggregateRole("test-role", 1, verdicts)

    expect(result.pass).toBe(false)
    expect(result.reviewer_count).toBe(3)
    expect(result.malformed_count).toBe(3)
    expect(result.blocker_count).toBe(0)
    expect(result.deduped_findings).toHaveLength(0)
    expect(result.reviewer_lineage).toHaveLength(3)
    expect(result.reviewer_lineage.every((l) => l.malformed)).toBe(true)
    expect(result.reviewer_lineage.every((l) => l.verdict === "FAIL")).toBe(true)
  })
})

// ============================================================================
// Tests: Mixed valid and malformed verdicts
// ============================================================================

describe("#given mixed valid and malformed verdicts", () => {
  test("should aggregate valid findings and mark pass=false due to malformed", () => {
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeReviewerVerdict({
        reviewer_id: "reviewer-0",
        verdict: "PASS",
        findings: [makeFinding({ id: "finding-1", severity: "MINOR" })],
      }),
      makeMalformedVerdict({ error_type: "timeout" }),
      makeReviewerVerdict({
        reviewer_id: "reviewer-2",
        verdict: "FAIL",
        severity: "MAJOR",
        findings: [makeFinding({ id: "finding-2", severity: "MAJOR" })],
      }),
    ]

    const result = aggregateRole("test-role", 1, verdicts)

    expect(result.pass).toBe(false) // Malformed causes non-pass
    expect(result.malformed_count).toBe(1)
    expect(result.reviewer_count).toBe(3)
    expect(result.deduped_findings).toHaveLength(2)
  })
})

// ============================================================================
// Tests: Single reviewer with PASS but BLOCKER in findings
// ============================================================================

describe("#given single reviewer with PASS verdict but BLOCKER in findings", () => {
  test("should return pass=false due to blocker finding", () => {
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeReviewerVerdict({
        reviewer_id: "reviewer-0",
        verdict: "PASS", // verdict says PASS
        severity: "BLOCKER", // but severity is BLOCKER
        blocker_count: 1,
        findings: [makeFinding({ id: "blocker-1", severity: "BLOCKER" })],
      }),
    ]

    const result = aggregateRole("test-role", 1, verdicts)

    expect(result.pass).toBe(false) // Blocker causes failure
    expect(result.blocker_count).toBe(1)
    expect(result.malformed_count).toBe(0)
  })
})

// ============================================================================
// Tests: Reviewer lineage preservation
// ============================================================================

describe("#given multiple valid verdicts", () => {
  test("should preserve reviewer lineage with correct data", () => {
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeReviewerVerdict({
        reviewer_id: "reviewer-0",
        model_id: "gpt-4o",
        verdict: "PASS",
        findings: [],
      }),
      makeReviewerVerdict({
        reviewer_id: "reviewer-1",
        model_id: "claude-sonnet",
        verdict: "FAIL",
        findings: [makeFinding({ id: "issue-1", severity: "MAJOR" })],
      }),
    ]

    const result = aggregateRole("test-role", 2, verdicts)

    expect(result.reviewer_lineage).toHaveLength(2)
    expect(result.reviewer_lineage[0]).toEqual({
      reviewer_id: "reviewer-0",
      model_id: "gpt-4o",
      verdict: "PASS",
      malformed: false,
    })
    expect(result.reviewer_lineage[1]).toEqual({
      reviewer_id: "reviewer-1",
      model_id: "claude-sonnet",
      verdict: "FAIL",
      malformed: false,
    })
  })
})

// ============================================================================
// Tests: Complex mixed scenario
// ============================================================================

describe("#given complex scenario with blockers, majors, and dedup", () => {
  test("should correctly aggregate all findings and determine pass=false", () => {
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      // Reviewer 0: PASS, no issues
      makeReviewerVerdict({
        reviewer_id: "reviewer-0",
        verdict: "PASS",
        findings: [],
      }),
      // Reviewer 1: FAIL with a blocker
      makeReviewerVerdict({
        reviewer_id: "reviewer-1",
        verdict: "FAIL",
        severity: "BLOCKER",
        blocker_count: 1,
        findings: [
          makeFinding({ id: "blocker-1", severity: "BLOCKER", description: "Critical bug" }),
        ],
      }),
      // Reviewer 2: FAIL with major issue (duplicate of reviewer 1's finding - should dedupe)
      makeReviewerVerdict({
        reviewer_id: "reviewer-2",
        verdict: "FAIL",
        severity: "MAJOR",
        findings: [
          makeFinding({ id: "blocker-1", severity: "BLOCKER", description: "Same critical bug" }), // duplicate
          makeFinding({ id: "major-1", severity: "MAJOR", description: "Major issue" }),
        ],
      }),
      // Reviewer 3: Malformed
      makeMalformedVerdict({ error_type: "timeout" }),
    ]

    const result = aggregateRole("test-role", 1, verdicts)

    // Should fail due to blocker and malformed
    expect(result.pass).toBe(false)
    expect(result.blocker_count).toBe(1) // deduplicated to 1
    expect(result.malformed_count).toBe(1)
    expect(result.reviewer_count).toBe(4)

    // 2 unique findings (blocker-1 deduplicated, major-1 added)
    expect(result.deduped_findings).toHaveLength(2)
    expect(result.deduped_findings.find((f) => f.id === "blocker-1")).toBeDefined()
    expect(result.deduped_findings.find((f) => f.id === "major-1")).toBeDefined()

    // Lineage: 3 valid entries + 1 malformed
    expect(result.reviewer_lineage).toHaveLength(4)
    expect(result.reviewer_lineage.filter((l) => l.malformed)).toHaveLength(1)
    expect(result.reviewer_lineage.filter((l) => !l.malformed)).toHaveLength(3)
  })
})

// ============================================================================
// Tests: Finding dedupe - same id different severity (keeps first)
// ============================================================================

describe("#given same finding id with different severity from multiple reviewers", () => {
  test("should keep first occurrence and not overwrite", () => {
    // First reviewer reports MAJOR, second reports BLOCKER - should keep MAJOR (first)
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeReviewerVerdict({
        reviewer_id: "reviewer-0",
        verdict: "FAIL",
        severity: "MAJOR",
        findings: [makeFinding({ id: "issue-x", severity: "MAJOR", description: "Major issue" })],
      }),
      makeReviewerVerdict({
        reviewer_id: "reviewer-1",
        verdict: "FAIL",
        severity: "BLOCKER",
        findings: [makeFinding({ id: "issue-x", severity: "BLOCKER", description: "Blocker issue" })],
      }),
    ]

    const result = aggregateRole("test-role", 1, verdicts)

    // Should have 1 finding (deduped)
    expect(result.deduped_findings).toHaveLength(1)
    // First occurrence is MAJOR (not BLOCKER)
    expect(result.deduped_findings[0].severity).toBe("MAJOR")
    expect(result.deduped_findings[0].id).toBe("issue-x")
    // blocker_count should be 0 since first (MAJOR) was stored
    expect(result.blocker_count).toBe(0)
  })
})

// ============================================================================
// Tests: Many duplicates (stress test for dedup)
// ============================================================================

describe("#given many reviewers reporting same findings", () => {
  test("should dedupe efficiently with many duplicates", () => {
    const sharedFinding = makeFinding({ id: "shared-issue", severity: "MINOR" })
    const uniqueFindings = [
      makeFinding({ id: "unique-1", severity: "MINOR" }),
      makeFinding({ id: "unique-2", severity: "MAJOR" }),
      makeFinding({ id: "unique-3", severity: "BLOCKER" }),
    ]

    // Create 10 reviewers all reporting the same shared finding + some unique ones
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = Array.from({ length: 10 }, (_, i) => {
      const findings = i === 0 ? [sharedFinding, ...uniqueFindings] : [sharedFinding]
      return makeReviewerVerdict({
        reviewer_id: `reviewer-${i}`,
        verdict: "FAIL",
        severity: i === 5 ? "BLOCKER" : "MINOR",
        findings,
      })
    })

    const result = aggregateRole("test-role", 1, verdicts)

    // Should have 4 unique findings total (shared-issue + 3 unique)
    expect(result.deduped_findings).toHaveLength(4)
    expect(result.reviewer_count).toBe(10)
    // shared-issue appears in all 10 reviewers but deduped to 1
    // unique-1, unique-2, unique-3 only in reviewer-0
    const ids = result.deduped_findings.map((f) => f.id)
    expect(ids).toContain("shared-issue")
    expect(ids).toContain("unique-1")
    expect(ids).toContain("unique-2")
    expect(ids).toContain("unique-3")
    // blocker_count should be 1 (unique-3 is BLOCKER from reviewer-0)
    expect(result.blocker_count).toBe(1)
  })
})

// ============================================================================
// Tests: Role and round are passed through correctly
// ============================================================================

describe("#given roleId and round parameters", () => {
  test("should pass through role and round correctly", () => {
    const verdicts: Array<ReviewerVerdict | MalformedVerdict> = [
      makeReviewerVerdict({ reviewer_id: "reviewer-0", verdict: "PASS", findings: [] }),
    ]

    const result = aggregateRole("code-quality", 3, verdicts)

    expect(result.role).toBe("code-quality")
    expect(result.round).toBe(3)
  })
})
import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"
import {
  EscalationJudgeVerdictSchema,
  FindingSchema,
  GlobalAggregateVerdictSchema,
  isMalformedVerdict,
  isValidReviewerVerdict,
  MalformedVerdictSchema,
  ReviewerLineageSchema,
  ReviewerVerdictSchema,
  RoleAggregateVerdictSchema,
  validateReviewerVerdict,
  type RoleAggregateVerdict,
} from "./schemas"

describe("FindingSchema", () => {
  describe("#given valid finding", () => {
    test("#when parsed #then returns correct values", () => {
      const finding = {
        id: "FIND-001",
        description: "Null pointer risk in user lookup",
        severity: "BLOCKER",
        category: "correctness",
      }

      const result = FindingSchema.parse(finding)

      expect(result.id).toBe("FIND-001")
      expect(result.description).toBe("Null pointer risk in user lookup")
      expect(result.severity).toBe("BLOCKER")
      expect(result.category).toBe("correctness")
      expect(result.file_ref).toBeUndefined()
    })
  })

  describe("#given finding with optional file_ref", () => {
    test("#when parsed #then returns correct value", () => {
      const finding = {
        id: "FIND-002",
        description: "SQL injection vulnerability",
        severity: "BLOCKER",
        category: "security",
        file_ref: "src/db/queries.ts:42",
      }

      const result = FindingSchema.parse(finding)

      expect(result.file_ref).toBe("src/db/queries.ts:42")
    })
  })

  describe("#given invalid severity", () => {
    test("#when parsed #then throws ZodError", () => {
      const finding = {
        id: "FIND-003",
        description: "Minor issue",
        severity: "CRITICAL",
        category: "correctness",
      }

      expect(() => FindingSchema.parse(finding)).toThrow(ZodError)
    })
  })

  describe("#given all valid severity values", () => {
    test("#when parsed with BLOCKER #then returns correct severity", () => {
      const finding = {
        id: "FIND-004",
        description: "Blocker issue",
        severity: "BLOCKER",
        category: "correctness",
      }
      const result = FindingSchema.parse(finding)
      expect(result.severity).toBe("BLOCKER")
    })

    test("#when parsed with MAJOR #then returns correct severity", () => {
      const finding = {
        id: "FIND-005",
        description: "Major issue",
        severity: "MAJOR",
        category: "correctness",
      }
      const result = FindingSchema.parse(finding)
      expect(result.severity).toBe("MAJOR")
    })

    test("#when parsed with MINOR #then returns correct severity", () => {
      const finding = {
        id: "FIND-006",
        description: "Minor issue",
        severity: "MINOR",
        category: "correctness",
      }
      const result = FindingSchema.parse(finding)
      expect(result.severity).toBe("MINOR")
    })
  })

  describe("#given all valid category values", () => {
    const validCategories = ["correctness", "maintainability", "risk", "performance", "security"] as const

    test("#when parsed with each valid category #then returns correct category", () => {
      for (const category of validCategories) {
        const finding = {
          id: `FIND-${category}`,
          description: `${category} issue`,
          severity: "MINOR",
          category,
        }
        const result = FindingSchema.parse(finding)
        expect(result.category).toBe(category)
      }
    })
  })

  describe("#given invalid category", () => {
    test("#when parsed #then throws ZodError", () => {
      const finding = {
        id: "FIND-007",
        description: "Bad category",
        severity: "MINOR",
        category: "ux", // invalid - should be "maintainability"
      }

      expect(() => FindingSchema.parse(finding)).toThrow(ZodError)
    })
  })
})

describe("ReviewerVerdictSchema", () => {
  const validVerdict = {
    schema_version: "1.0",
    run_id: "run-123",
    round: 1,
    role: "spec-fidelity",
    reviewer_id: "rev-001",
    model_id: "claude-opus-4-7",
    verdict: "PASS" as const,
    severity: "NONE" as const,
    blocker_count: 0,
    findings: [],
    summary: "All specifications met correctly",
    timestamp: "2026-04-26T10:00:00Z",
  }

  describe("#given valid reviewer verdict", () => {
    test("#when parsed #then returns correct values", () => {
      const result = ReviewerVerdictSchema.parse(validVerdict)

      expect(result.schema_version).toBe("1.0")
      expect(result.run_id).toBe("run-123")
      expect(result.round).toBe(1)
      expect(result.role).toBe("spec-fidelity")
      expect(result.verdict).toBe("PASS")
      expect(result.blocker_count).toBe(0)
      expect(result.findings).toEqual([])
    })
  })

  describe("#given verdict with findings", () => {
    test("#when parsed #then returns findings correctly", () => {
      const verdictWithFindings = {
        ...validVerdict,
        verdict: "FAIL" as const,
        severity: "MAJOR" as const,
        blocker_count: 1,
        findings: [
          {
            id: "FIND-001",
            description: "Incorrect return type",
            severity: "BLOCKER" as const,
            category: "correctness" as const,
            file_ref: "src/api/types.ts",
          },
        ],
      }

      const result = ReviewerVerdictSchema.parse(verdictWithFindings)

      expect(result.verdict).toBe("FAIL")
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].severity).toBe("BLOCKER")
    })
  })

  describe("#given invalid schema_version", () => {
    test("#when parsed #then throws ZodError", () => {
      const invalid = { ...validVerdict, schema_version: "2.0" }

      expect(() => ReviewerVerdictSchema.parse(invalid)).toThrow(ZodError)
    })
  })

  describe("#given negative round", () => {
    test("#when parsed #then throws ZodError", () => {
      const invalid = { ...validVerdict, round: -1 }

      expect(() => ReviewerVerdictSchema.parse(invalid)).toThrow(ZodError)
    })
  })

  describe("#given negative blocker_count", () => {
    test("#when parsed #then throws ZodError", () => {
      const invalid = { ...validVerdict, blocker_count: -5 }

      expect(() => ReviewerVerdictSchema.parse(invalid)).toThrow(ZodError)
    })
  })
})

describe("ReviewerLineageSchema", () => {
  describe("#given valid lineage entry", () => {
    test("#when parsed #then returns correct values", () => {
      const lineage = {
        reviewer_id: "rev-001",
        model_id: "gpt-5.4",
        verdict: "PASS" as const,
        malformed: false,
      }

      const result = ReviewerLineageSchema.parse(lineage)

      expect(result.reviewer_id).toBe("rev-001")
      expect(result.malformed).toBe(false)
    })
  })

  describe("#given malformed reviewer in lineage", () => {
    test("#when parsed #then malformed flag is true", () => {
      const lineage = {
        reviewer_id: "rev-002",
        model_id: "claude-opus-4-7",
        verdict: "FAIL" as const,
        malformed: true,
      }

      const result = ReviewerLineageSchema.parse(lineage)

      expect(result.malformed).toBe(true)
    })
  })
})

describe("RoleAggregateVerdictSchema", () => {
  const validRoleAggregate = {
    role: "code-quality",
    round: 2,
    pass: true,
    reviewer_count: 3,
    malformed_count: 0,
    blocker_count: 0,
    deduped_findings: [],
    reviewer_lineage: [
      {
        reviewer_id: "rev-001",
        model_id: "gpt-5.4",
        verdict: "PASS" as const,
        malformed: false,
      },
      {
        reviewer_id: "rev-002",
        model_id: "claude-opus-4-7",
        verdict: "PASS" as const,
        malformed: false,
      },
    ],
  }

  describe("#given valid role aggregate with blockers", () => {
    test("#when parsed #then pass is false when blockers exist", () => {
      const aggregateWithBlockers = {
        ...validRoleAggregate,
        pass: false,
        blocker_count: 2,
        deduped_findings: [
          {
            id: "FIND-001",
            description: "Memory leak in cache",
            severity: "BLOCKER" as const,
            category: "correctness" as const,
          },
          {
            id: "FIND-002",
            description: "Race condition",
            severity: "BLOCKER" as const,
            category: "risk" as const,
          },
        ],
      }

      const result = RoleAggregateVerdictSchema.parse(aggregateWithBlockers)

      expect(result.pass).toBe(false)
      expect(result.blocker_count).toBe(2)
      expect(result.deduped_findings).toHaveLength(2)
    })
  })

  describe("#given role aggregate with malformed reviewers", () => {
    test("#when parsed #then malformed_count is tracked", () => {
      const aggregateWithMalformed = {
        ...validRoleAggregate,
        malformed_count: 1,
        reviewer_lineage: [
          {
            reviewer_id: "rev-001",
            model_id: "gpt-5.4",
            verdict: "PASS" as const,
            malformed: false,
          },
          {
            reviewer_id: "rev-002",
            model_id: "claude-opus-4-7",
            verdict: "FAIL" as const,
            malformed: true,
          },
        ],
      }

      const result = RoleAggregateVerdictSchema.parse(aggregateWithMalformed)

      expect(result.malformed_count).toBe(1)
      expect(result.reviewer_lineage[1].malformed).toBe(true)
    })
  })

  describe("#given zero reviewer_count", () => {
    test("#when parsed #then throws ZodError", () => {
      const invalid = { ...validRoleAggregate, reviewer_count: 0 }

      expect(() => RoleAggregateVerdictSchema.parse(invalid)).toThrow(ZodError)
    })
  })
})

describe("GlobalAggregateVerdictSchema", () => {
  const validRoleAgg: RoleAggregateVerdict = {
    role: "spec-fidelity",
    round: 1,
    pass: true,
    reviewer_count: 2,
    malformed_count: 0,
    blocker_count: 0,
    deduped_findings: [],
    reviewer_lineage: [],
  }

  describe("#given global pass (all roles pass)", () => {
    test("#when parsed #then pass is true", () => {
      const globalAgg = {
        pass: true,
        round: 1,
        failed_roles: [],
        role_aggregates: [validRoleAgg],
        executor_patch_brief: {
          unresolved_blockers: [],
          failed_role_ids: [],
          execution_round: 1,
        },
      }

      const result = GlobalAggregateVerdictSchema.parse(globalAgg)

      expect(result.pass).toBe(true)
      expect(result.failed_roles).toEqual([])
    })
  })

  describe("#given global fail (one role fails)", () => {
    test("#when parsed #then pass is false and failed_roles populated", () => {
      const failedRoleAgg = { ...validRoleAgg, role: "code-quality", pass: false }
      const globalAgg = {
        pass: false,
        round: 1,
        failed_roles: ["code-quality"],
        role_aggregates: [validRoleAgg, failedRoleAgg],
        executor_patch_brief: {
          unresolved_blockers: [
            {
              id: "FIND-001",
              description: "Critical bug",
              severity: "BLOCKER" as const,
              category: "correctness" as const,
            },
          ],
          failed_role_ids: ["code-quality"],
          execution_round: 1,
        },
      }

      const result = GlobalAggregateVerdictSchema.parse(globalAgg)

      expect(result.pass).toBe(false)
      expect(result.failed_roles).toEqual(["code-quality"])
      expect(result.role_aggregates).toHaveLength(2)
    })
  })
})

describe("EscalationJudgeVerdictSchema", () => {
  describe("#given approve verdict", () => {
    test("#when parsed #then returns approve", () => {
      const verdict = {
        verdict: "approve" as const,
        reasoning: "All mandatory changes have been addressed",
        mandatory_changes: [],
      }

      const result = EscalationJudgeVerdictSchema.parse(verdict)

      expect(result.verdict).toBe("approve")
      expect(result.mandatory_changes).toEqual([])
    })
  })

  describe("#given revise-once-mandatory verdict", () => {
    test("#when parsed #then returns revise with mandatory changes", () => {
      const verdict = {
        verdict: "revise-once-mandatory" as const,
        reasoning: "Security hardening incomplete",
        mandatory_changes: [
          {
            id: "MC-001",
            description: "Add CSRF tokens to all forms",
            role: "security",
            priority: "mandatory" as const,
          },
          {
            id: "MC-002",
            description: "Enable rate limiting",
            role: "security",
            priority: "recommended" as const,
          },
        ],
      }

      const result = EscalationJudgeVerdictSchema.parse(verdict)

      expect(result.verdict).toBe("revise-once-mandatory")
      expect(result.mandatory_changes).toHaveLength(2)
      expect(result.mandatory_changes[0].priority).toBe("mandatory")
      expect(result.mandatory_changes[1].priority).toBe("recommended")
    })
  })

  describe("#given reject-escalate-human verdict", () => {
    test("#when parsed #then returns reject", () => {
      const verdict = {
        verdict: "reject-escalate-human" as const,
        reasoning: "Fundamental architectural issues require human review",
        mandatory_changes: [],
      }

      const result = EscalationJudgeVerdictSchema.parse(verdict)

      expect(result.verdict).toBe("reject-escalate-human")
    })
  })

  describe("#given invalid verdict type", () => {
    test("#when parsed #then throws ZodError", () => {
      const invalid = {
        verdict: "maybe" as unknown as "approve",
        reasoning: "test",
        mandatory_changes: [],
      }

      expect(() => EscalationJudgeVerdictSchema.parse(invalid)).toThrow(ZodError)
    })
  })
})

describe("MalformedVerdictSchema", () => {
  describe("#given valid malformed verdict", () => {
    test("#when parsed #then returns correct values", () => {
      const malformed = {
        is_malformed: true,
        raw_output: '{"schema_version": "1.0"', // truncated JSON
        error_type: "invalid_json" as const,
        role: "spec-fidelity",
      }

      const result = MalformedVerdictSchema.parse(malformed)

      expect(result.is_malformed).toBe(true)
      expect(result.error_type).toBe("invalid_json")
    })
  })

  describe("#given parse_error error_type", () => {
    test("#when parsed #then returns correct error type", () => {
      const malformed = {
        is_malformed: true,
        raw_output: "Model output was garbled",
        error_type: "parse_error" as const,
        role: "code-quality",
      }

      const result = MalformedVerdictSchema.parse(malformed)

      expect(result.error_type).toBe("parse_error")
    })
  })

  describe("#given timeout error_type", () => {
    test("#when parsed #then returns correct error type", () => {
      const malformed = {
        is_malformed: true,
        raw_output: "",
        error_type: "timeout" as const,
        role: "risk-regression",
      }

      const result = MalformedVerdictSchema.parse(malformed)

      expect(result.error_type).toBe("timeout")
    })
  })

  describe("#given is_malformed is false", () => {
    test("#when parsed #then throws ZodError", () => {
      const invalid = {
        is_malformed: false,
        raw_output: "",
        error_type: "invalid_json" as const,
        role: "spec-fidelity",
      }

      expect(() => MalformedVerdictSchema.parse(invalid)).toThrow(ZodError)
    })
  })
})

describe("validateReviewerVerdict", () => {
  const validVerdict = {
    schema_version: "1.0",
    run_id: "run-123",
    round: 1,
    role: "spec-fidelity",
    reviewer_id: "rev-001",
    model_id: "claude-opus-4-7",
    verdict: "PASS" as const,
    severity: "NONE" as const,
    blocker_count: 0,
    findings: [],
    summary: "All specs met",
    timestamp: "2026-04-26T10:00:00Z",
  }

  describe("#given valid reviewer verdict object", () => {
    test("#when validated #then returns valid ReviewerVerdict", () => {
      const result = validateReviewerVerdict(validVerdict)

      expect(isValidReviewerVerdict(result)).toBe(true)
      expect(isMalformedVerdict(result)).toBe(false)
    })
  })

  describe("#given valid JSON string", () => {
    test("#when validated #then returns valid ReviewerVerdict", () => {
      const jsonString = JSON.stringify(validVerdict)
      const result = validateReviewerVerdict(jsonString)

      expect(isValidReviewerVerdict(result)).toBe(true)
    })
  })

  describe("#given invalid JSON string", () => {
    test("#when validated #then returns MalformedVerdict with invalid_json", () => {
      const result = validateReviewerVerdict('{"schema_version": "1.0"')

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("invalid_json")
      }
    })
  })

  describe("#given missing essential fields", () => {
    test("#when validated #then returns MalformedVerdict with missing_fields", () => {
      const incomplete = {
        schema_version: "1.0",
        run_id: "run-123",
        // missing: round, role, verdict, timestamp
      }

      const result = validateReviewerVerdict(incomplete)

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("missing_fields")
      }
    })
  })

  describe("#given empty output (empty summary and no findings)", () => {
    test("#when validated #then returns MalformedVerdict with empty_output", () => {
      const emptyOutput = {
        schema_version: "1.0",
        run_id: "run-123",
        round: 1,
        role: "spec-fidelity",
        reviewer_id: "rev-001",
        model_id: "claude-opus-4-7",
        verdict: "PASS" as const,
        severity: "NONE" as const,
        blocker_count: 0,
        findings: [],
        summary: "   ",
        timestamp: "2026-04-26T10:00:00Z",
      }

      const result = validateReviewerVerdict(emptyOutput)

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("empty_output")
      }
    })
  })

  describe("#given non-object raw input", () => {
    test("#when validated #then returns MalformedVerdict with parse_error", () => {
      const result = validateReviewerVerdict(42)

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("parse_error")
      }
    })
  })

  describe("#given null input", () => {
    test("#when validated #then returns MalformedVerdict with parse_error", () => {
      const result = validateReviewerVerdict(null)

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("parse_error")
      }
    })
  })
})

describe("isMalformedVerdict", () => {
  describe("#given MalformedVerdict object", () => {
    test("#when checked #then returns true", () => {
      const malformed = {
        is_malformed: true,
        raw_output: "some raw output",
        error_type: "timeout" as const,
        role: "spec-fidelity",
      }

      expect(isMalformedVerdict(malformed)).toBe(true)
    })
  })

  describe("#given valid ReviewerVerdict object", () => {
    test("#when checked #then returns false", () => {
      const valid = {
        schema_version: "1.0",
        run_id: "run-123",
        round: 1,
        role: "spec-fidelity",
        reviewer_id: "rev-001",
        model_id: "claude-opus-4-7",
        verdict: "PASS" as const,
        severity: "NONE" as const,
        blocker_count: 0,
        findings: [],
        summary: "All specs met",
        timestamp: "2026-04-26T10:00:00Z",
      }

      expect(isMalformedVerdict(valid)).toBe(false)
    })
  })

  describe("#given primitive value", () => {
    test("#when checked #then returns false", () => {
      expect(isMalformedVerdict("string")).toBe(false)
      expect(isMalformedVerdict(123)).toBe(false)
      expect(isMalformedVerdict(undefined)).toBe(false)
    })
  })
})

describe("isValidReviewerVerdict", () => {
  describe("#given valid ReviewerVerdict object", () => {
    test("#when checked #then returns true", () => {
      const valid = {
        schema_version: "1.0",
        run_id: "run-123",
        round: 1,
        role: "spec-fidelity",
        reviewer_id: "rev-001",
        model_id: "claude-opus-4-7",
        verdict: "PASS" as const,
        severity: "NONE" as const,
        blocker_count: 0,
        findings: [],
        summary: "All specs met",
        timestamp: "2026-04-26T10:00:00Z",
      }

      expect(isValidReviewerVerdict(valid)).toBe(true)
    })
  })

  describe("#given MalformedVerdict object", () => {
    test("#when checked #then returns false", () => {
      const malformed = {
        is_malformed: true,
        raw_output: "some raw output",
        error_type: "timeout" as const,
        role: "spec-fidelity",
      }

      expect(isValidReviewerVerdict(malformed)).toBe(false)
    })
  })

  describe("#given invalid verdict (missing required fields)", () => {
    test("#when checked #then returns false", () => {
      const invalid = {
        schema_version: "1.0",
        run_id: "run-123",
        // missing required fields
      }

      expect(isValidReviewerVerdict(invalid)).toBe(false)
    })
  })
})
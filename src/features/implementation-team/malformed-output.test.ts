import { describe, expect, test } from "bun:test"
import {
  classifyReviewerOutput,
  isReviewerCancelled,
  isReviewerTimeout,
  isMalformedVerdict,
  isValidReviewerVerdict,
} from "./malformed-output"

// Valid verdict for reuse in tests
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

describe("isReviewerTimeout", () => {
  describe("#given string containing 'timed out'", () => {
    test("#when checked #then returns true", () => {
      expect(isReviewerTimeout("Task timed out after 120 seconds")).toBe(true)
    })
  })

  describe("#given string containing 'timeout'", () => {
    test("#when checked #then returns true", () => {
      expect(isReviewerTimeout("Review process timeout exceeded")).toBe(true)
    })
  })

  describe("#given string with mixed case 'TIMED OUT'", () => {
    test("#when checked #then returns true", () => {
      expect(isReviewerTimeout("Task TIMED OUT")).toBe(true)
    })
  })

  describe("#given background task result with status 'timeout'", () => {
    test("#when checked #then returns true", () => {
      const taskResult = { status: "timeout" }
      expect(isReviewerTimeout(taskResult)).toBe(true)
    })
  })

  describe("#given background task result with status 'error' and timeout in output", () => {
    test("#when checked #then returns true", () => {
      const taskResult = {
        status: "error",
        output: "",
        error: "Process timed out after 60s",
      }
      expect(isReviewerTimeout(taskResult)).toBe(true)
    })
  })

  describe("#given background task result with status 'error' and timeout in output field", () => {
    test("#when checked #then returns true", () => {
      const taskResult = {
        status: "error",
        output: "Task timed out during execution",
        error: "",
      }
      expect(isReviewerTimeout(taskResult)).toBe(true)
    })
  })

  describe("#given background task result with status 'completed'", () => {
    test("#when checked #then returns false", () => {
      const taskResult = { status: "completed", output: "some output" }
      expect(isReviewerTimeout(taskResult)).toBe(false)
    })
  })

  describe("#given background task result with status 'error' without timeout keyword", () => {
    test("#when checked #then returns false", () => {
      const taskResult = { status: "error", error: "Something went wrong" }
      expect(isReviewerTimeout(taskResult)).toBe(false)
    })
  })

  describe("#given valid verdict object", () => {
    test("#when checked #then returns false", () => {
      expect(isReviewerTimeout(validVerdict)).toBe(false)
    })
  })

  describe("#given null input", () => {
    test("#when checked #then returns false", () => {
      expect(isReviewerTimeout(null)).toBe(false)
    })
  })

  describe("#given undefined input", () => {
    test("#when checked #then returns false", () => {
      expect(isReviewerTimeout(undefined)).toBe(false)
    })
  })
})

describe("isReviewerCancelled", () => {
  describe("#given string containing 'cancelled'", () => {
    test("#when checked #then returns true", () => {
      expect(isReviewerCancelled("Task was cancelled by user")).toBe(true)
    })
  })

  describe("#given string containing 'canceled' (American spelling)", () => {
    test("#when checked #then returns true", () => {
      expect(isReviewerCancelled("Process canceled")).toBe(true)
    })
  })

  describe("#given string with mixed case 'CANCELLED'", () => {
    test("#when checked #then returns true", () => {
      expect(isReviewerCancelled("Task CANCELLED")).toBe(true)
    })
  })

  describe("#given background task result with status 'cancelled'", () => {
    test("#when checked #then returns true", () => {
      const taskResult = { status: "cancelled" }
      expect(isReviewerCancelled(taskResult)).toBe(true)
    })
  })

  describe("#given background task result with status 'completed'", () => {
    test("#when checked #then returns false", () => {
      const taskResult = { status: "completed", output: "some output" }
      expect(isReviewerCancelled(taskResult)).toBe(false)
    })
  })

  describe("#given background task result with status 'error'", () => {
    test("#when checked #then returns false", () => {
      const taskResult = { status: "error", error: "Some error" }
      expect(isReviewerCancelled(taskResult)).toBe(false)
    })
  })

  describe("#given valid verdict object", () => {
    test("#when checked #then returns false", () => {
      expect(isReviewerCancelled(validVerdict)).toBe(false)
    })
  })

  describe("#given null input", () => {
    test("#when checked #then returns false", () => {
      expect(isReviewerCancelled(null)).toBe(false)
    })
  })

  describe("#given undefined input", () => {
    test("#when checked #then returns false", () => {
      expect(isReviewerCancelled(undefined)).toBe(false)
    })
  })
})

describe("classifyReviewerOutput", () => {
  describe("#given valid verdict object", () => {
    test("#when classified #then returns valid ReviewerVerdict", () => {
      const result = classifyReviewerOutput(validVerdict, "spec-fidelity")

      expect(isValidReviewerVerdict(result)).toBe(true)
      expect(isMalformedVerdict(result)).toBe(false)
    })
  })

  describe("#given valid JSON string", () => {
    test("#when classified #then returns valid ReviewerVerdict", () => {
      const jsonString = JSON.stringify(validVerdict)
      const result = classifyReviewerOutput(jsonString, "spec-fidelity")

      expect(isValidReviewerVerdict(result)).toBe(true)
    })
  })

  describe("#given string containing 'timed out'", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'timeout'", () => {
      const result = classifyReviewerOutput("Task timed out after 120 seconds", "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("timeout")
        expect(result.role).toBe("spec-fidelity")
      }
    })
  })

  describe("#given background task result with status 'timeout'", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'timeout'", () => {
      const taskResult = { status: "timeout" }
      const result = classifyReviewerOutput(taskResult, "code-quality")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("timeout")
        expect(result.role).toBe("code-quality")
      }
    })
  })

  describe("#given string containing 'cancelled'", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'cancellation'", () => {
      const result = classifyReviewerOutput("Task was cancelled by user", "risk-regression")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("cancellation")
        expect(result.role).toBe("risk-regression")
      }
    })
  })

  describe("#given background task result with status 'cancelled'", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'cancellation'", () => {
      const taskResult = { status: "cancelled" }
      const result = classifyReviewerOutput(taskResult, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("cancellation")
      }
    })
  })

  describe("#given invalid JSON string", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'invalid_json'", () => {
      const result = classifyReviewerOutput('{"schema_version": "1.0"', "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("invalid_json")
      }
    })
  })

  describe("#given missing essential fields", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'missing_fields'", () => {
      const incomplete = {
        schema_version: "1.0",
        run_id: "run-123",
        // missing: round, role, verdict, timestamp
      }

      const result = classifyReviewerOutput(incomplete, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("missing_fields")
      }
    })
  })

  describe("#given empty output (empty summary and no findings)", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'empty_output'", () => {
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

      const result = classifyReviewerOutput(emptyOutput, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("empty_output")
      }
    })
  })

  describe("#given null input", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'parse_error'", () => {
      const result = classifyReviewerOutput(null, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("parse_error")
        expect(result.raw_output).toBe("")
      }
    })
  })

  describe("#given undefined input", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'parse_error'", () => {
      const result = classifyReviewerOutput(undefined, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("parse_error")
        expect(result.raw_output).toBe("")
      }
    })
  })

  describe("#given number input", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'parse_error'", () => {
      const result = classifyReviewerOutput(42, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("parse_error")
        expect(result.raw_output).toBe("42")
      }
    })
  })

  describe("#given boolean input", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'parse_error'", () => {
      const result = classifyReviewerOutput(true, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("parse_error")
        expect(result.raw_output).toBe("true")
      }
    })
  })

  describe("#given empty string", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'invalid_json'", () => {
      const result = classifyReviewerOutput("", "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("invalid_json")
      }
    })
  })

  describe("#given whitespace-only string", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'invalid_json'", () => {
      const result = classifyReviewerOutput("   \n\t  ", "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("invalid_json")
      }
    })
  })

  describe("#given partial valid JSON (truncated)", () => {
    test("#when classified #then returns MalformedVerdict with error_type 'invalid_json'", () => {
      // JSON.parse would fail on truncated JSON
      const result = classifyReviewerOutput('{"schema_version": "1.0", "run_id": "run', "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("invalid_json")
      }
    })
  })

  describe("#given background task result with status 'error' (non-timeout)", () => {
    test("#when classified #then delegates to validateReviewerVerdict", () => {
      const taskResult = {
        status: "error",
        output: "Something went wrong",
        error: "Some error message",
      }
      const result = classifyReviewerOutput(taskResult, "spec-fidelity")

      // Should not be timeout since error message doesn't contain timeout keyword
      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        // Could be parse_error or missing_fields depending on the output content
        expect(result.error_type).toMatch(/^(parse_error|missing_fields|invalid_json)$/)
      }
    })
  })

  describe("#given background task result with status 'completed' and valid JSON output", () => {
    test("#when classified #then returns valid ReviewerVerdict", () => {
      const taskResult = {
        status: "completed",
        output: JSON.stringify(validVerdict),
      }
      const result = classifyReviewerOutput(taskResult, "spec-fidelity")

      expect(isValidReviewerVerdict(result)).toBe(true)
    })
  })

  describe("#given roleId is preserved in MalformedVerdict", () => {
    test("#when output is malformed #then role matches input roleId", () => {
      const result = classifyReviewerOutput("invalid", "my-custom-role")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.role).toBe("my-custom-role")
      }
    })
  })

  describe("#given roleId is preserved in valid ReviewerVerdict", () => {
    test("#when output is valid #then role matches verdict's role field", () => {
      const result = classifyReviewerOutput(validVerdict, "my-custom-role")

      expect(isValidReviewerVerdict(result)).toBe(true)
      if (isValidReviewerVerdict(result)) {
        // Role from the verdict itself, not the input parameter
        expect(result.role).toBe("spec-fidelity")
      }
    })
  })

  describe("#given raw_output contains the original string", () => {
    test("#when output is malformed string #then raw_output matches input", () => {
      const inputString = "Task timed out after 120 seconds"
      const result = classifyReviewerOutput(inputString, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.raw_output).toBe(inputString)
      }
    })
  })

  describe("#given raw_output contains stringified object", () => {
    test("#when output is malformed object #then raw_output is JSON stringified", () => {
      const inputObject = { status: "timeout" }
      const result = classifyReviewerOutput(inputObject, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.raw_output).toBe(JSON.stringify(inputObject))
      }
    })
  })

  describe("#given priority: timeout checked before cancellation", () => {
    test("#when string contains both timeout and cancelled #then returns timeout", () => {
      const input = "Task timed out and was cancelled"
      const result = classifyReviewerOutput(input, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("timeout")
      }
    })
  })

  describe("#given timeout signal in background task error field", () => {
    test("#when error contains timeout keyword #then returns timeout", () => {
      const taskResult = {
        status: "error",
        error: "Reviewer process timed out: maximum execution time exceeded",
      }
      const result = classifyReviewerOutput(taskResult, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("timeout")
      }
    })
  })

  describe("#given cancelled status takes priority over parse error", () => {
    test("#when status is cancelled #then returns cancellation not parse_error", () => {
      const taskResult = { status: "cancelled" }
      const result = classifyReviewerOutput(taskResult, "spec-fidelity")

      expect(isMalformedVerdict(result)).toBe(true)
      if (isMalformedVerdict(result)) {
        expect(result.error_type).toBe("cancellation")
      }
    })
  })
})

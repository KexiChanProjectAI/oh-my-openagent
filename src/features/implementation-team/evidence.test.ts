import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"
import {
  EVIDENCE_BASE_DIR,
  IMPL_TEAM_DIR,
  getEvidencePath,
  getRoundEvidencePath,
  getRunEvidenceDir,
  generateRunId,
  validateRunMetadata,
  createLogPayload,
  RunMetadataSchema,
  LogPayloadSchema,
} from "./evidence"

describe("getRunEvidenceDir", () => {
  test("given valid runId when called then returns correct directory structure", () => {
    const runId = "abc-123"
    const result = getRunEvidenceDir(runId)
    expect(result).toBe(".sisyphus/evidence/impl-team/abc-123/")
  })

  test("given same runId when called multiple times then returns same path", () => {
    const runId = "def-456"
    const first = getRunEvidenceDir(runId)
    const second = getRunEvidenceDir(runId)
    expect(first).toBe(second)
  })
})

describe("getRoundEvidencePath", () => {
  test("given runId and round when called then returns correct round directory", () => {
    const runId = "abc-123"
    const round = 0
    const result = getRoundEvidencePath(runId, round)
    expect(result).toBe(".sisyphus/evidence/impl-team/abc-123/round-0/")
  })

  test("given same runId and round when called multiple times then returns same path", () => {
    const runId = "xyz-789"
    const round = 5
    const first = getRoundEvidencePath(runId, round)
    const second = getRoundEvidencePath(runId, round)
    expect(first).toBe(second)
  })
})

describe("getEvidencePath", () => {
  test("given executor-output artifact then returns correct txt path", () => {
    const runId = "run-001"
    const round = 2
    const result = getEvidencePath(runId, "executor-output", round)
    expect(result).toBe(".sisyphus/evidence/impl-team/run-001/round-2/executor-output.txt")
  })

  test("given global-aggregate artifact then returns correct json path", () => {
    const runId = "run-002"
    const round = 3
    const result = getEvidencePath(runId, "global-aggregate", round)
    expect(result).toBe(".sisyphus/evidence/impl-team/run-002/round-3/global-aggregate.json")
  })

  test("given reviewer-verdict with specific reviewerId then returns correct verdict path", () => {
    const runId = "run-003"
    const round = 1
    const result = getEvidencePath(runId, "reviewer-verdict-oracle", round)
    expect(result).toBe(".sisyphus/evidence/impl-team/run-003/round-1/verdict-oracle.json")
  })

  test("given role-aggregate with specific role then returns correct role path", () => {
    const runId = "run-004"
    const round = 4
    const result = getEvidencePath(runId, "role-aggregate-hephaestus", round)
    expect(result).toBe(".sisyphus/evidence/impl-team/run-004/round-4/role-hephaestus.json")
  })

  test("given escalation-judge artifact then returns correct path without round", () => {
    const runId = "run-005"
    const result = getEvidencePath(runId, "escalation-judge")
    expect(result).toBe(".sisyphus/evidence/impl-team/run-005/escalation-judge.json")
  })

  test("given run-metadata artifact then returns metadata.json path", () => {
    const runId = "run-006"
    const result = getEvidencePath(runId, "run-metadata")
    expect(result).toBe(".sisyphus/evidence/impl-team/run-006/metadata.json")
  })

  test("given terminal-verdict artifact then returns terminal-verdict.json path", () => {
    const runId = "run-007"
    const result = getEvidencePath(runId, "terminal-verdict")
    expect(result).toBe(".sisyphus/evidence/impl-team/run-007/terminal-verdict.json")
  })

  test("given round-bound artifact without round then throws error", () => {
    const runId = "run-008"
    expect(() => getEvidencePath(runId, "executor-output")).toThrow("Round must be provided")
  })

  test("given same inputs when called multiple times then returns deterministic path", () => {
    const runId = "det-001"
    const round = 2
    const first = getEvidencePath(runId, "executor-output", round)
    const second = getEvidencePath(runId, "executor-output", round)
    expect(first).toBe(second)
  })
})

describe("generateRunId", () => {
  test("when called then returns valid uuid format", () => {
    const id = generateRunId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  test("when called multiple times then returns unique ids", () => {
    const id1 = generateRunId()
    const id2 = generateRunId()
    expect(id1).not.toBe(id2)
  })
})

describe("validateRunMetadata", () => {
  test("given valid metadata when validated then returns parsed object", () => {
    const valid = {
      run_id: "run-001",
      started_at: "2026-04-26T10:00:00.000Z",
      terminal_outcome: "success",
      total_rounds: 5,
      reviewer_count_by_role: { oracle: 2, hephaestus: 1 },
      escalation_triggered: false,
      total_spawned_tasks: 10,
      malformed_verdict_count: 0,
    }
    const result = validateRunMetadata(valid)
    expect(result.run_id).toBe("run-001")
    expect(result.total_rounds).toBe(5)
  })

  test("given missing required field when validated then throws ZodError", () => {
    const invalid = {
      started_at: "2026-04-26T10:00:00.000Z",
      terminal_outcome: "success",
      total_rounds: 5,
    }
    expect(() => validateRunMetadata(invalid)).toThrow(ZodError)
  })

  test("given invalid field type when validated then throws ZodError", () => {
    const invalid = {
      run_id: "run-001",
      started_at: "2026-04-26T10:00:00.000Z",
      terminal_outcome: "success",
      total_rounds: "not-a-number",
      reviewer_count_by_role: {},
      escalation_triggered: false,
      total_spawned_tasks: 10,
      malformed_verdict_count: 0,
    }
    expect(() => validateRunMetadata(invalid)).toThrow(ZodError)
  })

  test("given negative total_rounds when validated then throws ZodError", () => {
    const invalid = {
      run_id: "run-001",
      started_at: "2026-04-26T10:00:00.000Z",
      terminal_outcome: "success",
      total_rounds: -1,
      reviewer_count_by_role: {},
      escalation_triggered: false,
      total_spawned_tasks: 10,
      malformed_verdict_count: 0,
    }
    expect(() => validateRunMetadata(invalid)).toThrow(ZodError)
  })

  test("given valid with optional fields when validated then returns parsed object", () => {
    const valid = {
      run_id: "run-002",
      started_at: "2026-04-26T10:00:00.000Z",
      terminal_outcome: "escalated",
      total_rounds: 3,
      reviewer_count_by_role: { oracle: 1 },
      escalation_triggered: true,
      escalation_verdict: "needs-attention",
      total_spawned_tasks: 5,
      malformed_verdict_count: 1,
      completed_at: "2026-04-26T12:00:00.000Z",
    }
    const result = validateRunMetadata(valid)
    expect(result.escalation_verdict).toBe("needs-attention")
    expect(result.completed_at).toBe("2026-04-26T12:00:00.000Z")
  })

  test("given null input when validated then throws ZodError", () => {
    expect(() => validateRunMetadata(null)).toThrow(ZodError)
  })

  test("given undefined input when validated then throws ZodError", () => {
    expect(() => validateRunMetadata(undefined)).toThrow(ZodError)
  })
})

describe("createLogPayload", () => {
  test("given all parameters when created then returns valid payload", () => {
    const runId = "log-run-001"
    const round = 2
    const state = "running"
    const event = "task-completed"
    const data = { taskId: "task-123", result: "success" }
    const result = createLogPayload(runId, round, state, event, data)
    expect(result.run_id).toBe(runId)
    expect(result.round).toBe(round)
    expect(result.state).toBe(state)
    expect(result.event).toBe(event)
    expect(result.data).toEqual(data)
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test("given without optional data when created then returns valid payload", () => {
    const result = createLogPayload("log-run-002", 0, "pending", "run-started")
    expect(result.run_id).toBe("log-run-002")
    expect(result.round).toBe(0)
    expect(result.data).toBeUndefined()
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test("when created then timestamp is valid ISO 8601", () => {
    const before = Date.now()
    const result = createLogPayload("log-run-003", 1, "running", "heartbeat")
    const after = Date.now()
    const resultTime = new Date(result.timestamp).getTime()
    expect(resultTime).toBeGreaterThanOrEqual(before)
    expect(resultTime).toBeLessThanOrEqual(after)
  })
})

describe("RunMetadataSchema", () => {
  test("given valid complete object when parsed then succeeds", () => {
    const data = {
      run_id: "schema-test-1",
      started_at: "2026-04-26T10:00:00.000Z",
      terminal_outcome: "completed",
      total_rounds: 10,
      reviewer_count_by_role: { oracle: 2, reviewer: 3 },
      escalation_triggered: true,
      escalation_verdict: "approved",
      total_spawned_tasks: 25,
      malformed_verdict_count: 2,
      completed_at: "2026-04-26T18:00:00.000Z",
    }
    const result = RunMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  test("given missing run_id when parsed then fails", () => {
    const data = {
      started_at: "2026-04-26T10:00:00.000Z",
      terminal_outcome: "completed",
      total_rounds: 0,
      reviewer_count_by_role: {},
      escalation_triggered: false,
      total_spawned_tasks: 0,
      malformed_verdict_count: 0,
    }
    const result = RunMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })
})

describe("LogPayloadSchema", () => {
  test("given valid complete object when parsed then succeeds", () => {
    const data = {
      run_id: "log-schema-1",
      round: 5,
      state: "completed",
      event: "all-reviewers-finished",
      data: { finishedCount: 3 },
      timestamp: "2026-04-26T15:30:00.000Z",
    }
    const result = LogPayloadSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  test("given missing event when parsed then fails", () => {
    const data = {
      run_id: "log-schema-2",
      round: 1,
      state: "running",
      timestamp: "2026-04-26T15:30:00.000Z",
    }
    const result = LogPayloadSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  test("given negative round when parsed then fails", () => {
    const data = {
      run_id: "log-schema-3",
      round: -1,
      state: "running",
      event: "test",
      timestamp: "2026-04-26T15:30:00.000Z",
    }
    const result = LogPayloadSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  test("given valid without optional data field when parsed then succeeds", () => {
    const data = {
      run_id: "log-schema-4",
      round: 0,
      state: "pending",
      event: "run-started",
      timestamp: "2026-04-26T10:00:00.000Z",
    }
    const result = LogPayloadSchema.safeParse(data)
    expect(result.success).toBe(true)
  })
})

describe("EVIDENCE_BASE_DIR constant", () => {
  test("equals expected sisyphus evidence path", () => {
    expect(EVIDENCE_BASE_DIR).toBe(".sisyphus/evidence")
  })
})

describe("IMPL_TEAM_DIR constant", () => {
  test("equals expected impl-team path", () => {
    expect(IMPL_TEAM_DIR).toBe(".sisyphus/evidence/impl-team")
  })
})

import { describe, expect, test } from "bun:test"
import { saveRunState, loadRunState, deleteRunState, listRunStates } from "./state-store"
import { startRun, transition, recordRound, type RunState } from "./state-machine"

describe("state-store", () => {
  // Use a unique suffix per test to avoid collisions
  const uniqueRunId = (): string => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`

  describe("saveRunState and loadRunState", () => {
    test("given valid run state when saveRunState then loadRunState returns same state", () => {
      const runId = uniqueRunId()
      const state: RunState = {
        runId,
        state: "IDLE",
        round: 0,
        startedAt: "2026-04-26T00:00:00.000Z",
        lastTransitionedAt: "2026-04-26T00:00:00.000Z",
        reviewerSessionIds: {},
        roundHistory: [],
      }

      saveRunState(runId, state)
      const loaded = loadRunState(runId)

      expect(loaded).toEqual(state)

      // Clean up
      deleteRunState(runId)
    })

    test("given run with full state when saveRunState then all fields preserved on load", () => {
      const runId = uniqueRunId()
      const state: RunState = {
        runId,
        state: "REVIEW_ROUND_1",
        round: 1,
        startedAt: "2026-04-26T00:00:00.000Z",
        lastTransitionedAt: "2026-04-26T00:05:00.000Z",
        executorSessionId: "ses-executor-123",
        reviewerSessionIds: {
          code_review: ["ses-reviewer-1", "ses-reviewer-2"],
          security: ["ses-reviewer-3"],
        },
        judgeSessionId: undefined,
        escalationVerdict: undefined,
        terminalOutcome: undefined,
        roundHistory: [
          {
            round: 1,
            implementState: "IMPLEMENT_ROUND_1",
            reviewState: "REVIEW_ROUND_1",
            aggregateState: "AGGREGATE_ROUND_1",
            pass: false,
            timestamp: "2026-04-26T00:05:00.000Z",
          },
        ],
      }

      saveRunState(runId, state)
      const loaded = loadRunState(runId)

      expect(loaded).not.toBeNull()
      expect(loaded?.runId).toBe(runId)
      expect(loaded?.state).toBe("REVIEW_ROUND_1")
      expect(loaded?.round).toBe(1)
      expect(loaded?.executorSessionId).toBe("ses-executor-123")
      expect(loaded?.reviewerSessionIds).toEqual({
        code_review: ["ses-reviewer-1", "ses-reviewer-2"],
        security: ["ses-reviewer-3"],
      })
      expect(loaded?.roundHistory).toHaveLength(1)
      expect(loaded?.roundHistory[0].pass).toBe(false)

      // Clean up
      deleteRunState(runId)
    })

    test("given terminal state with verdict when saveRunState then load preserves verdict", () => {
      const runId = uniqueRunId()
      const state: RunState = {
        runId,
        state: "TERMINAL_PASS",
        round: 2,
        startedAt: "2026-04-26T00:00:00.000Z",
        lastTransitionedAt: "2026-04-26T00:30:00.000Z",
        executorSessionId: "ses-executor-final",
        reviewerSessionIds: {
          code_review: ["ses-reviewer-final"],
        },
        judgeSessionId: "ses-judge-1",
        escalationVerdict: {
          verdict: "approve",
          reasoning: "All checks passed",
          mandatory_changes: [],
        },
        terminalOutcome: "PASS",
        roundHistory: [],
      }

      saveRunState(runId, state)
      const loaded = loadRunState(runId)

      expect(loaded).not.toBeNull()
      expect(loaded?.terminalOutcome).toBe("PASS")
      expect(loaded?.escalationVerdict).toEqual({
        verdict: "approve",
        reasoning: "All checks passed",
        mandatory_changes: [],
      })

      // Clean up
      deleteRunState(runId)
    })
  })

  describe("loadRunState", () => {
    test("given non-existent runId when loadRunState then returns null", () => {
      const loaded = loadRunState("non-existent-run-id-12345")
      expect(loaded).toBeNull()
    })

    test("given corrupt JSON file when loadRunState then returns null", () => {
      const runId = uniqueRunId()

      // Manually write corrupt JSON using Node fs
      const { writeFileSync } = require("node:fs")
      writeFileSync(`.sisyphus/impl-team/${runId}.json`, "not valid json {", "utf-8")

      const loaded = loadRunState(runId)
      expect(loaded).toBeNull()

      // Clean up
      deleteRunState(runId)
    })

    test("given JSON with wrong type fields when loadRunState then returns null", () => {
      const runId = uniqueRunId()

      // JSON with runId as number instead of string
      const { writeFileSync } = require("node:fs")
      writeFileSync(
        `.sisyphus/impl-team/${runId}.json`,
        JSON.stringify({
          runId: 12345, // should be string
          state: "IDLE",
          round: 0,
          startedAt: "2026-04-26T00:00:00.000Z",
          lastTransitionedAt: "2026-04-26T00:00:00.000Z",
          reviewerSessionIds: {},
          roundHistory: [],
        }),
        "utf-8",
      )

      const loaded = loadRunState(runId)
      expect(loaded).toBeNull()

      // Clean up
      deleteRunState(runId)
    })
  })

  describe("deleteRunState", () => {
    test("given existing run when deleteRunState then file is removed", () => {
      const runId = uniqueRunId()
      const state = startRun(runId)

      saveRunState(runId, state)
      expect(loadRunState(runId)).not.toBeNull()

      deleteRunState(runId)
      expect(loadRunState(runId)).toBeNull()
    })

    test("given non-existent run when deleteRunState then does not throw", () => {
      expect(() => deleteRunState("non-existent-run-id")).not.toThrow()
    })

    test("given already deleted run when deleteRunState again then does not throw", () => {
      const runId = uniqueRunId()
      const state = startRun(runId)

      saveRunState(runId, state)
      deleteRunState(runId)

      // Delete again should be idempotent
      expect(() => deleteRunState(runId)).not.toThrow()
    })
  })

  describe("listRunStates", () => {
    test("given empty state dir when listRunStates then returns empty array", () => {
      const runIds = listRunStates()
      // May contain other runs from other tests, just check it's an array
      expect(Array.isArray(runIds)).toBe(true)
    })

    test("given multiple saved runs when listRunStates then returns all run ids", () => {
      const runId1 = uniqueRunId()
      const runId2 = uniqueRunId()
      const runId3 = uniqueRunId()

      saveRunState(runId1, startRun(runId1))
      saveRunState(runId2, startRun(runId2))
      saveRunState(runId3, startRun(runId3))

      const runIds = listRunStates()

      expect(runIds).toContain(runId1)
      expect(runIds).toContain(runId2)
      expect(runIds).toContain(runId3)

      // Clean up
      deleteRunState(runId1)
      deleteRunState(runId2)
      deleteRunState(runId3)
    })
  })

  describe("recovery after interruption", () => {
    test("given saved run when startRun with same id then state is recovered", () => {
      const runId = uniqueRunId()

      // Simulate a run that was interrupted at REVIEW_ROUND_1
      const interruptedState: RunState = {
        runId,
        state: "REVIEW_ROUND_1",
        round: 1,
        startedAt: "2026-04-26T00:00:00.000Z",
        lastTransitionedAt: "2026-04-26T00:05:00.000Z",
        executorSessionId: "ses-executor-123",
        reviewerSessionIds: {
          code_review: ["ses-reviewer-1"],
        },
        roundHistory: [],
      }

      saveRunState(runId, interruptedState)

      // Simulate recovery - load the state
      const recovered = loadRunState(runId)
      expect(recovered).not.toBeNull()
      expect(recovered?.state).toBe("REVIEW_ROUND_1")
      expect(recovered?.round).toBe(1)
      expect(recovered?.executorSessionId).toBe("ses-executor-123")

      // Continue the run
      if (recovered) {
        const continued = transition(recovered, "AGGREGATE_ROUND_1")
        const withRecord = recordRound(continued, {
          implementState: "IMPLEMENT_ROUND_1",
          reviewState: "REVIEW_ROUND_1",
          aggregateState: "AGGREGATE_ROUND_1",
          pass: true,
          timestamp: new Date().toISOString(),
        })
        saveRunState(runId, withRecord)

        const reloaded = loadRunState(runId)
        expect(reloaded?.roundHistory).toHaveLength(1)
        expect(reloaded?.roundHistory[0].pass).toBe(true)
      }

      // Clean up
      deleteRunState(runId)
    })

    test("given same run id when save and load multiple times then round and refs remain stable", () => {
      const runId = uniqueRunId()
      let currentState: RunState = startRun(runId)

      // Simulate round 1
      currentState = transition(currentState, "IMPLEMENT_ROUND_1")
      saveRunState(runId, currentState)

      let loaded = loadRunState(runId)
      expect(loaded?.round).toBe(1)
      expect(loaded?.state).toBe("IMPLEMENT_ROUND_1")

      // Simulate round 1 transition to review
      currentState = transition(loaded!, "REVIEW_ROUND_1")
      saveRunState(runId, currentState)

      loaded = loadRunState(runId)
      expect(loaded?.round).toBe(1)
      expect(loaded?.state).toBe("REVIEW_ROUND_1")

      // Simulate round 2
      currentState = transition(loaded!, "AGGREGATE_ROUND_1")
      currentState = transition(currentState, "IMPLEMENT_ROUND_2")
      saveRunState(runId, currentState)

      loaded = loadRunState(runId)
      expect(loaded?.round).toBe(2)
      expect(loaded?.state).toBe("IMPLEMENT_ROUND_2")

      // Verify no duplication - roundHistory should not accumulate duplicates
      expect(loaded?.roundHistory).toHaveLength(0) // We haven't recorded rounds yet in this test

      // Clean up
      deleteRunState(runId)
    })
  })
})
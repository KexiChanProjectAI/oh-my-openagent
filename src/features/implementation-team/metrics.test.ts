import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createMetricsCollector, createRunLogger, runLogger, type TerminalOutcome } from "./metrics"
import { createLogPayload } from "./evidence"

const logMock = mock(() => {})

mock.module("../../shared/logger", () => ({
  log: logMock,
}))

describe("MetricsCollector", () => {
  describe("recordRun", () => {
    test("when recordRun called then totalRuns increments", () => {
      // given
      const collector = createMetricsCollector()
      expect(collector.totalRuns).toBe(0)

      // when
      collector.recordRun()
      collector.recordRun()
      collector.recordRun()

      // then
      expect(collector.totalRuns).toBe(3)
    })

    test("when recordRun called once then totalRuns is 1", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordRun()

      // then
      expect(collector.totalRuns).toBe(1)
    })
  })

  describe("recordEscalation", () => {
    test("when recordEscalation called then escalationTriggerCount increments", () => {
      // given
      const collector = createMetricsCollector()
      expect(collector.escalationTriggerCount).toBe(0)

      // when
      collector.recordEscalation()

      // then
      expect(collector.escalationTriggerCount).toBe(1)
    })

    test("when recordEscalation called multiple times then count increments correctly", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordEscalation()
      collector.recordEscalation()
      collector.recordEscalation()

      // then
      expect(collector.escalationTriggerCount).toBe(3)
    })
  })

  describe("recordMalformedVerdict", () => {
    test("when recordMalformedVerdict called then malformedVerdictCount increments", () => {
      // given
      const collector = createMetricsCollector()
      expect(collector.malformedVerdictCount).toBe(0)

      // when
      collector.recordMalformedVerdict()

      // then
      expect(collector.malformedVerdictCount).toBe(1)
    })

    test("when recordMalformedVerdict called twice then count is 2", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordMalformedVerdict()
      collector.recordMalformedVerdict()

      // then
      expect(collector.malformedVerdictCount).toBe(2)
    })
  })

  describe("recordUnresolvedBlockers", () => {
    test("when recordUnresolvedBlockers called for round 1 then count is tracked", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordUnresolvedBlockers(1, 3)

      // then
      expect(collector.unresolvedBlockerCountByRound[1]).toBe(3)
    })

    test("when recordUnresolvedBlockers called multiple times for same round then accumulates", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordUnresolvedBlockers(2, 2)
      collector.recordUnresolvedBlockers(2, 5)

      // then
      expect(collector.unresolvedBlockerCountByRound[2]).toBe(7)
    })

    test("when recordUnresolvedBlockers called for different rounds then tracks separately", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordUnresolvedBlockers(1, 3)
      collector.recordUnresolvedBlockers(2, 4)

      // then
      expect(collector.unresolvedBlockerCountByRound[1]).toBe(3)
      expect(collector.unresolvedBlockerCountByRound[2]).toBe(4)
    })
  })

  describe("recordReviewerFanOut", () => {
    test("when recordReviewerFanOut called for a role then count is tracked", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordReviewerFanOut("oracle", 2)

      // then
      expect(collector.reviewerFanOut["oracle"]).toBe(2)
    })

    test("when recordReviewerFanOut called multiple times for same role then accumulates", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordReviewerFanOut("hephaestus", 1)
      collector.recordReviewerFanOut("hephaestus", 3)

      // then
      expect(collector.reviewerFanOut["hephaestus"]).toBe(4)
    })

    test("when recordReviewerFanOut called for different roles then tracks separately", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordReviewerFanOut("oracle", 2)
      collector.recordReviewerFanOut("hephaestus", 1)

      // then
      expect(collector.reviewerFanOut["oracle"]).toBe(2)
      expect(collector.reviewerFanOut["hephaestus"]).toBe(1)
    })
  })

  describe("recordTerminalOutcome", () => {
    test("when recordTerminalOutcome called with TERMINAL_PASS then distribution updates", () => {
      // given
      const collector = createMetricsCollector()
      expect(collector.terminalOutcomeDistribution["TERMINAL_PASS"]).toBe(0)

      // when
      collector.recordTerminalOutcome("TERMINAL_PASS")

      // then
      expect(collector.terminalOutcomeDistribution["TERMINAL_PASS"]).toBe(1)
    })

    test("when recordTerminalOutcome called for multiple outcomes then distribution is correct", () => {
      // given
      const collector = createMetricsCollector()

      // when
      collector.recordTerminalOutcome("TERMINAL_PASS")
      collector.recordTerminalOutcome("TERMINAL_PASS")
      collector.recordTerminalOutcome("TERMINAL_FAIL_BLOCKED")

      // then
      expect(collector.terminalOutcomeDistribution["TERMINAL_PASS"]).toBe(2)
      expect(collector.terminalOutcomeDistribution["TERMINAL_FAIL_BLOCKED"]).toBe(1)
      expect(collector.terminalOutcomeDistribution["TERMINAL_ESCALATED_PASS"]).toBe(0)
    })
  })

  describe("snapshot", () => {
    test("when snapshot called then returns current state copy", () => {
      // given
      const collector = createMetricsCollector()
      collector.recordRun()
      collector.recordEscalation()
      collector.recordMalformedVerdict()
      collector.recordUnresolvedBlockers(1, 5)
      collector.recordReviewerFanOut("oracle", 2)
      collector.recordTerminalOutcome("TERMINAL_PASS")

      // when
      const snap = collector.snapshot()

      // then
      expect(snap.totalRuns).toBe(1)
      expect(snap.escalationTriggerCount).toBe(1)
      expect(snap.malformedVerdictCount).toBe(1)
      expect(snap.unresolvedBlockerCountByRound[1]).toBe(5)
      expect(snap.reviewerFanOut["oracle"]).toBe(2)
      expect(snap.terminalOutcomeDistribution["TERMINAL_PASS"]).toBe(1)
    })

    test("when snapshot returned then modifying it does not affect collector", () => {
      // given
      const collector = createMetricsCollector()
      collector.recordUnresolvedBlockers(1, 5)

      // when
      const snap = collector.snapshot()
      snap.unresolvedBlockerCountByRound[1] = 999

      // then
      expect(collector.unresolvedBlockerCountByRound[1]).toBe(5)
    })
  })
})

describe("runLogger", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  test("when runLogger called then log receives structured payload with run_id", () => {
    // given
    const runId = "test-run-123"
    const round = 1
    const state = "IMPLEMENT_ROUND_1"
    const event = "run_started"

    // when
    runLogger(runId, round, state, event)

    // then
    expect(logMock).toHaveBeenCalledTimes(1)
    const loggedArg = logMock.mock.calls[0][0] as string
    const loggedData = logMock.mock.calls[0][1] as { run_id: string; round: number; state: string; event: string }
    expect(loggedData.run_id).toBe(runId)
  })

  test("when runLogger called then log receives structured payload with round", () => {
    // given
    const runId = "test-run-456"
    const round = 2

    // when
    runLogger(runId, round, "REVIEW_ROUND_1", "reviewers_launched")

    // then
    const loggedData = logMock.mock.calls[0][1] as { run_id: string; round: number; state: string; event: string }
    expect(loggedData.round).toBe(round)
  })

  test("when runLogger called then log receives structured payload with state", () => {
    // given
    const runId = "test-run-789"
    const state = "AGGREGATE_ROUND_1"

    // when
    runLogger(runId, 1, state, "global_aggregated")

    // then
    const loggedData = logMock.mock.calls[0][1] as { run_id: string; round: number; state: string; event: string }
    expect(loggedData.state).toBe(state)
  })

  test("when runLogger called then log receives structured payload with event", () => {
    // given
    const runId = "test-run-abc"
    const event = "escalation_triggered"

    // when
    runLogger(runId, 2, "CONVERGENCE_CHECK", event)

    // then
    const loggedData = logMock.mock.calls[0][1] as { run_id: string; round: number; state: string; event: string }
    expect(loggedData.event).toBe(event)
  })

  test("when runLogger called with data then payload includes data field", () => {
    // given
    const runId = "test-run-data"
    const data = { reviewerCount: 3, pass: true }

    // when
    runLogger(runId, 1, "REVIEW_ROUND_1", "reviewers_launched", data)

    // then
    const loggedData = logMock.mock.calls[0][1] as { run_id: string; data?: Record<string, unknown> }
    expect(loggedData.data).toEqual(data)
  })

  test("when runLogger called then payload includes timestamp", () => {
    // given
    const runId = "test-run-time"

    // when
    runLogger(runId, 0, "IDLE", "run_started")

    // then
    const loggedData = logMock.mock.calls[0][1] as { timestamp: string }
    expect(loggedData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test("when runLogger called with run_started event then formats correct message", () => {
    // given
    const runId = "test-run-msg"

    // when
    runLogger(runId, 1, "IMPLEMENT_ROUND_1", "run_started")

    // then
    const loggedMessage = logMock.mock.calls[0][0] as string
    expect(loggedMessage).toBe("[impl-team] run_started")
  })

  test("when runLogger called with escalation_triggered event then formats correct message", () => {
    // given
    const runId = "test-run-escalate"

    // when
    runLogger(runId, 2, "CONVERGENCE_CHECK", "escalation_triggered")

    // then
    const loggedMessage = logMock.mock.calls[0][0] as string
    expect(loggedMessage).toBe("[impl-team] escalation_triggered")
  })
})

describe("createRunLogger", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  test("when createRunLogger called then returns bound logger with runId", () => {
    // given
    const boundLog = createRunLogger("fixed-run-id")

    // when
    boundLog(1, "IMPLEMENT_ROUND_1", "executor_launched")

    // then
    const loggedData = logMock.mock.calls[0][1] as { run_id: string }
    expect(loggedData.run_id).toBe("fixed-run-id")
  })

  test("when bound logger called then round is passed correctly", () => {
    // given
    const boundLog = createRunLogger("bound-run")

    // when
    boundLog(2, "REVIEW_ROUND_2", "reviewers_launched")

    // then
    const loggedData = logMock.mock.calls[0][1] as { round: number }
    expect(loggedData.round).toBe(2)
  })
})

describe("TerminalOutcome distribution integration", () => {
  test("when multiple runs with different outcomes recorded then distribution is accurate", () => {
    // given
    const collector = createMetricsCollector()

    // when - simulate 5 runs with various outcomes
    collector.recordRun()
    collector.recordTerminalOutcome("TERMINAL_PASS")

    collector.recordRun()
    collector.recordTerminalOutcome("TERMINAL_PASS")

    collector.recordRun()
    collector.recordTerminalOutcome("TERMINAL_FAIL_BLOCKED")

    collector.recordRun()
    collector.recordEscalation()
    collector.recordTerminalOutcome("TERMINAL_ESCALATED_PASS")

    collector.recordRun()
    collector.recordTerminalOutcome("TERMINAL_CANCELLED")

    // then
    const snap = collector.snapshot()
    expect(snap.totalRuns).toBe(5)
    expect(snap.escalationTriggerCount).toBe(1)
    expect(snap.terminalOutcomeDistribution["TERMINAL_PASS"]).toBe(2)
    expect(snap.terminalOutcomeDistribution["TERMINAL_FAIL_BLOCKED"]).toBe(1)
    expect(snap.terminalOutcomeDistribution["TERMINAL_ESCALATED_PASS"]).toBe(1)
    expect(snap.terminalOutcomeDistribution["TERMINAL_CANCELLED"]).toBe(1)
  })

  test("when malformed verdicts accumulate across rounds then count is correct", () => {
    // given
    const collector = createMetricsCollector()

    // when
    collector.recordMalformedVerdict()
    collector.recordMalformedVerdict()
    collector.recordMalformedVerdict()

    // then
    expect(collector.malformedVerdictCount).toBe(3)
  })
})

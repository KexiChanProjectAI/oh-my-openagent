/**
 * Implementation Team Role Aggregator
 *
 * Aggregates reviewer verdicts within a role, validates them, dedupes overlapping
 * findings, and determines the role's pass/fail status.
 */

import type {
  Finding,
  MalformedVerdict,
  ReviewerLineage,
  ReviewerVerdict,
  RoleAggregateVerdict,
} from "./schemas"
import { isMalformedVerdict, isValidReviewerVerdict } from "./schemas"

// ============================================================================
// Role Aggregate Function
// ============================================================================

/**
 * Aggregate all reviewer verdicts within a role.
 *
 * - Deduplicates findings by `id` field
 * - Any BLOCKER verdict causes `pass === false`
 * - Malformed verdicts contribute malformed status but cannot create false pass
 * - Preserves finding lineage and reviewer contributions
 */
export function aggregateRole(
  roleId: string,
  round: number,
  verdicts: Array<ReviewerVerdict | MalformedVerdict>,
): RoleAggregateVerdict {
  // Initialize aggregate with defaults
  const lineage: ReviewerLineage[] = []
  const findingsMap = new Map<string, Finding>()
  let malformedCount = 0
  let blockerCount = 0

  for (const verdict of verdicts) {
    if (isMalformedVerdict(verdict)) {
      // Malformed verdict: increment count, add malformed lineage entry
      malformedCount++
      lineage.push({
        reviewer_id: "",
        model_id: "",
        verdict: "FAIL",
        malformed: true,
      })
    } else if (isValidReviewerVerdict(verdict)) {
      // Valid verdict: process findings and track lineage
      lineage.push({
        reviewer_id: verdict.reviewer_id,
        model_id: verdict.model_id,
        verdict: verdict.verdict,
        malformed: false,
      })

      // Add findings to dedup map (skip if id already exists)
      for (const finding of verdict.findings) {
        if (!findingsMap.has(finding.id)) {
          findingsMap.set(finding.id, finding)
        }
      }
    }
  }

  // Count blockers from deduped findings
  for (const finding of findingsMap.values()) {
    if (finding.severity === "BLOCKER") {
      blockerCount++
    }
  }

  // Determine pass/fail
  // pass is false if: blocker_count > 0 OR malformed_count > 0
  // pass is true only if: no blockers AND no malformed verdicts
  const pass = blockerCount === 0 && malformedCount === 0

  return {
    role: roleId,
    round,
    pass,
    reviewer_count: verdicts.length,
    malformed_count: malformedCount,
    blocker_count: blockerCount,
    deduped_findings: Array.from(findingsMap.values()),
    reviewer_lineage: lineage,
  }
}
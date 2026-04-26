/**
 * Implementation Team - Malformed Output Handler
 *
 * Deterministic handling for invalid JSON, missing fields, partial verdicts,
 * background task failures, and reviewer timeouts.
 *
 * Invalid reviewer output must surface as malformed and block false pass states.
 */

import {
  type MalformedVerdict,
  type ReviewerVerdict,
  validateReviewerVerdict,
  isMalformedVerdict,
} from "./schemas"

// ============================================================================
// Background Task Result Types
// ============================================================================

/**
 * Standard background task result shape from background-agent
 */
interface BackgroundTaskResult {
  status: string
  output?: string
  error?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Detect timeout signals in raw background task output.
 *
 * Checks for:
 * - Background task result with "timeout" or "error" status containing timeout keywords
 * - String containing "timed out" or "timeout" keywords
 */
export function isReviewerTimeout(raw: unknown): boolean {
  // String timeout detection
  if (typeof raw === "string") {
    const lower = raw.toLowerCase()
    return lower.includes("timed out") || lower.includes("timeout")
  }

  // Background task result object detection
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>

    // Check for background task result with status field
    if (typeof obj.status === "string") {
      const status = obj.status.toLowerCase()

      // Status indicates timeout (error status may be timeout-related)
      if (status === "timeout") {
        return true
      }

      // Error status with timeout keyword in output/error
      if (status === "error") {
        const output = typeof obj.output === "string" ? obj.output : ""
        const error = typeof obj.error === "string" ? obj.error : ""
        const combined = (output + " " + error).toLowerCase()
        return combined.includes("timed out") || combined.includes("timeout")
      }
    }
  }

  return false
}

/**
 * Detect cancellation signals in raw background task output.
 *
 * Checks for:
 * - Background task result with "cancelled" status
 * - String containing "cancelled" or "canceled"
 */
export function isReviewerCancelled(raw: unknown): boolean {
  // String cancellation detection
  if (typeof raw === "string") {
    const lower = raw.toLowerCase()
    return lower.includes("cancelled") || lower.includes("canceled")
  }

  // Background task result object detection
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>

    // Check for background task result with cancelled status
    if (typeof obj.status === "string") {
      const status = obj.status.toLowerCase()
      return status === "cancelled"
    }
  }

  return false
}

/**
 * Convert raw output to string for storage in MalformedVerdict.
 */
function toRawOutputString(raw: unknown): string {
  if (typeof raw === "string") {
    return raw
  }
  if (raw === null || raw === undefined) {
    return ""
  }
  // For objects (including BackgroundTaskResult), stringify
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

// ============================================================================
// Main Classification Function
// ============================================================================

/**
 * Check if raw is a background task result object (has status field).
 */
function isBackgroundTaskResult(raw: unknown): raw is BackgroundTaskResult {
  return typeof raw === "object" && raw !== null && "status" in raw
}

/**
 * Classify raw reviewer output as valid ReviewerVerdict or MalformedVerdict.
 *
 * Detection order:
 * 1. Background task result with status "completed" -> extract output and validate
 * 2. Timeout signals -> MalformedVerdict with error_type "timeout"
 * 3. Cancellation signals -> MalformedVerdict with error_type "cancellation"
 * 4. Defensive: handle null, undefined, numbers, booleans as parse_error
 * 5. Delegate to validateReviewerVerdict for JSON/field validation
 *
 * @param raw - Raw output from reviewer (string, object, null, undefined, etc.)
 * @param roleId - The role ID for the reviewer
 * @returns Either a valid ReviewerVerdict or a MalformedVerdict
 */
export function classifyReviewerOutput(raw: unknown, roleId: string): ReviewerVerdict | MalformedVerdict {
  // Step 0: Handle background task result with status "completed"
  // Extract the output field and validate it as the verdict
  if (isBackgroundTaskResult(raw) && raw.status === "completed") {
    // Extract output from completed background task
    const extractedOutput = raw.output ?? null
    // Recursively classify the extracted output
    const result = classifyReviewerOutput(extractedOutput, roleId)
    // If the extracted output is malformed, wrap it with the full task result as raw_output
    if (isMalformedVerdict(result)) {
      return {
        is_malformed: true,
        raw_output: toRawOutputString(raw),
        error_type: result.error_type,
        role: roleId,
      }
    }
    return result
  }

  // Step 1: Check for timeout signals (highest priority)
  if (isReviewerTimeout(raw)) {
    return {
      is_malformed: true,
      raw_output: toRawOutputString(raw),
      error_type: "timeout",
      role: roleId,
    }
  }

  // Step 2: Check for cancellation signals
  if (isReviewerCancelled(raw)) {
    return {
      is_malformed: true,
      raw_output: toRawOutputString(raw),
      error_type: "cancellation",
      role: roleId,
    }
  }

  // Step 3: Defensive handling for non-object types that will fail validation
  // null, undefined, numbers, booleans cannot be valid JSON verdicts
  if (raw === null || raw === undefined) {
    return {
      is_malformed: true,
      raw_output: toRawOutputString(raw),
      error_type: "parse_error",
      role: roleId,
    }
  }

  if (typeof raw === "number" || typeof raw === "boolean") {
    return {
      is_malformed: true,
      raw_output: toRawOutputString(raw),
      error_type: "parse_error",
      role: roleId,
    }
  }

  // Step 4: Delegate to validateReviewerVerdict for JSON/field validation
  // This handles:
  // - Invalid JSON strings -> invalid_json
  // - Missing essential fields -> missing_fields
  // - Empty output (empty summary, no findings) -> empty_output
  // - Schema parse errors -> parse_error
  // - Valid verdicts -> ReviewerVerdict
  const result = validateReviewerVerdict(raw)

  // If validation returned malformed, override role with input roleId
  if (isMalformedVerdict(result)) {
    return {
      ...result,
      role: roleId,
    }
  }

  return result
}

// ============================================================================
// Re-export utilities for consumers
// ============================================================================

export { isMalformedVerdict, isValidReviewerVerdict } from "./schemas"

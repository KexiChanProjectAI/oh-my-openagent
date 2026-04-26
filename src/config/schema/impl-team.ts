import { z } from "zod"
import { FallbackModelsSchema } from "./fallback-models"

const ReviewerConfigSchema = z.object({
  model: z.string(),
  category: z.string().optional(),
})

const RoleConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  reviewers: z.array(ReviewerConfigSchema),
  blocker_policy: z.string().optional(),
})

const ExecutorConfigSchema = z.object({
  category: z.string(),
  model: z.string().optional(),
  fallback_models: FallbackModelsSchema.optional(),
})

const EscalationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  model: z.string().optional(),
  category: z.string().optional(),
  fallback_models: FallbackModelsSchema.optional(),
})

const ResourceCapsConfigSchema = z.object({
  max_total_spawned_tasks: z.number().int().min(1).default(50),
  max_reviewers_per_role: z.number().int().min(1).default(5),
  max_roles: z.number().int().min(1).default(3),
})

const PassPolicyConfigSchema = z.object({
  require_all_roles_pass: z.boolean().default(true),
})

const BlockerPolicyConfigSchema = z.object({
  any_blocker_fails_role: z.boolean().default(true),
})

export const ImplementationTeamConfigSchema = z.object({
  enabled: z.boolean().default(true),
  executor: ExecutorConfigSchema.optional(),
  roles: z.array(RoleConfigSchema).optional(),
  max_ordinary_rounds: z.number().int().min(1).max(5).default(2),
  escalation: EscalationConfigSchema.optional(),
  resource_caps: ResourceCapsConfigSchema.optional().default({}),
  pass_policy: PassPolicyConfigSchema.optional().default({}),
  blocker_policy: BlockerPolicyConfigSchema.optional().default({}),
})

export type ImplementationTeamConfig = z.infer<typeof ImplementationTeamConfigSchema>
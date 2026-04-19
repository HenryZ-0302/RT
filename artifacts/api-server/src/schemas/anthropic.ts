import { z } from "zod";

const systemBlockSchema = z.object({
  type: z.string(),
  text: z.string(),
}).passthrough();

const adaptiveThinkingSchema = z.object({
  type: z.literal("adaptive"),
  display: z.enum(["summarized", "omitted"]).optional(),
}).passthrough();

const enabledThinkingSchema = z.object({
  type: z.literal("enabled"),
  budget_tokens: z.number().int().gte(1),
  display: z.enum(["summarized", "omitted"]).optional(),
}).passthrough();

export const anthropicMessagesBodySchema = z.object({
  model: z.string().optional(),
  messages: z.array(z.unknown()).min(1),
  system: z.union([z.string(), z.array(systemBlockSchema)]).optional(),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().gte(1).optional(),
  temperature: z.number().optional(),
  thinking: z.union([adaptiveThinkingSchema, enabledThinkingSchema]).optional(),
}).passthrough();

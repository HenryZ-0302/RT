import { z } from "zod";

const contentPartSchema = z.object({
  type: z.string(),
}).passthrough();

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }).passthrough(),
}).passthrough();

const toolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.unknown().optional(),
  }).passthrough(),
}).passthrough();

export const chatCompletionBodySchema = z.object({
  model: z.string().optional(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([z.string(), z.array(contentPartSchema), z.null()]),
    tool_calls: z.array(toolCallSchema).optional(),
    tool_call_id: z.string().optional(),
  }).passthrough()).min(1),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().gte(1).optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: z.unknown().optional(),
}).passthrough();

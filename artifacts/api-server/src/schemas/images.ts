import { z } from "zod";

const looseRecordSchema = z.record(z.string(), z.unknown());

export const openAiImageGenerationBodySchema = z.object({
  model: z.string().optional(),
  prompt: z.string().optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  n: z.number().int().gte(1).optional(),
  size: z.string().optional(),
  response_format: z.string().optional(),
}).passthrough();

export const geminiNativeImageBodySchema = z.object({
  prompt: z.string().optional(),
  image: z.string().optional(),
  images: z.array(z.string()).optional(),
  n: z.number().int().gte(1).optional(),
  size: z.string().optional(),
  response_format: z.string().optional(),
  contents: z.unknown().optional(),
  config: looseRecordSchema.optional(),
}).passthrough();

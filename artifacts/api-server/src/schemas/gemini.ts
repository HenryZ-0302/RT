import { z } from "zod";

const looseRecordSchema = z.record(z.string(), z.unknown());

export const geminiNativeGenerateContentBodySchema = z.object({
  contents: z.unknown().optional(),
  config: looseRecordSchema.optional(),
  generationConfig: looseRecordSchema.optional(),
  systemInstruction: z.unknown().optional(),
  safetySettings: z.unknown().optional(),
  tools: z.unknown().optional(),
  toolConfig: z.unknown().optional(),
  cachedContent: z.string().optional(),
}).passthrough();

import { z } from "zod";

export const createBackendBodySchema = z.object({
  url: z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), {
    message: "must be an http or https URL",
  }),
});

export const updateBackendBodySchema = z.object({
  enabled: z.boolean(),
});

export const batchUpdateBackendsBodySchema = z.object({
  labels: z.array(z.string()).min(1),
  enabled: z.boolean(),
});

export const updateRoutingBodySchema = z.object({
  localEnabled: z.boolean().optional(),
  localFallback: z.boolean().optional(),
  fakeStream: z.boolean().optional(),
}).refine((value) =>
  value.localEnabled !== undefined
  || value.localFallback !== undefined
  || value.fakeStream !== undefined,
{
  message: "at least one routing field is required",
});

export const updateModelsBodySchema = z.object({
  ids: z.array(z.string()).min(1).optional(),
  group: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  enabled: z.boolean(),
}).refine((value) => value.ids !== undefined || value.group !== undefined || value.provider !== undefined, {
  message: "ids, group, or provider is required",
});

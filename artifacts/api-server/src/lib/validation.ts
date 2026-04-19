import { type Response } from "express";
import { type ZodTypeAny } from "zod";

function formatIssues(issues: Array<{ path: Array<string | number>; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "body";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseRequestBody<TSchema extends ZodTypeAny>(
  res: Response,
  schema: TSchema,
  body: unknown,
): import("zod").infer<TSchema> | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  res.status(400).json({
    error: {
      message: `Invalid request body: ${formatIssues(result.error.issues)}`,
      type: "invalid_request_error",
    },
  });
  return null;
}

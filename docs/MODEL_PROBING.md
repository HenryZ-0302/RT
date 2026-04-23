# Replit AI Integrations Model Probing

This flow turns “which models are actually usable in the current Replit project” into a repeatable probe, instead of relying only on guesses or stale model lists.

## Command

After deployment and after the Replit AI Integrations env vars are configured, run:

```bash
pnpm --filter @workspace/api-server run probe:models
```

The script writes:

- `artifacts/api-server/reports/model-probe.latest.json`
- `artifacts/api-server/reports/model-probe.latest.md`

It only generates reports. It does not automatically rewrite `artifacts/api-server/src/services/modelRegistry.ts`.

## Probe Methods

- OpenAI
  - `chat/completions`
  - `images/generations`
  - reserves `audio/speech`
- Anthropic
  - `messages`
- Gemini
  - must use `@google/genai`
  - text probing uses `generateContent`
  - image probing prefers `generateImages`, then falls back to image-mode `generateContent`
- OpenRouter
  - OpenAI-compatible `chat/completions`

## Result Classification

- `200`: available
- `UNSUPPORTED_MODEL` / `not a valid model ID` / `Unknown model` / `404 deployment not exist`: not currently whitelisted by Replit
- `404 Publisher Model not found`: current Replit project has no access
- missing `AI_INTEGRATIONS_*` env vars: unconfigured
- other network or proxy errors: manual review needed

## Candidate Sources

The script merges candidates in this order:

1. Current registry baseline
   - `artifacts/api-server/src/services/modelRegistry.ts`
2. Local supplemental candidates
   - `artifacts/api-server/config/model-probe-candidates.json`
3. OpenRouter public directory
   - `https://openrouter.ai/api/v1/models`

OpenAI, Anthropic, and Gemini do not currently have a stable enumerable directory in this flow, so they mostly rely on the current baseline plus hand-added candidates.

## How To Read The Report

The Markdown report is grouped into:

- configured providers
- newly available models
- currently registered models that are no longer available
- models that failed and need review
- per-provider totals

Recommended workflow:

1. Run `probe:models` after deployment.
2. Read `model-probe.latest.md`.
3. Confirm which newly available models are worth adding.
4. Confirm which registered models appear stale.
5. Update `modelRegistry.ts` only after manual review.

## Adding New Guesses

If you want to test new candidate IDs, add them to:

- `artifacts/api-server/config/model-probe-candidates.json`

Do not add them directly to the registry first.

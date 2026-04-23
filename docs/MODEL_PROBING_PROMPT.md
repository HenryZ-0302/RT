# Replit AI Integrations Model Discovery Prompt

Use this prompt when you want an Agent to discover which Replit AI Integrations models are actually usable in the current workspace, without relying on a repo script.

## Prompt

```text
Please determine which Replit AI Integrations models are actually usable in this workspace.

Scope:
- OpenAI
- Anthropic
- Gemini
- OpenRouter

Rules:
1. Use the real Replit AI Integrations environment variables already present in the workspace:
   - AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY
   - AI_INTEGRATIONS_ANTHROPIC_BASE_URL / AI_INTEGRATIONS_ANTHROPIC_API_KEY
   - AI_INTEGRATIONS_GEMINI_BASE_URL / AI_INTEGRATIONS_GEMINI_API_KEY
   - AI_INTEGRATIONS_OPENROUTER_BASE_URL / AI_INTEGRATIONS_OPENROUTER_API_KEY
2. Do not modify repository files.
3. Do not add or update any model registry automatically.
4. Use real minimal requests to probe model availability.
5. For Gemini, do not use raw fetch against `:generateContent` if the Replit proxy rejects that path; use the supported SDK path instead.
6. For OpenRouter, you may enumerate candidates from `https://openrouter.ai/api/v1/models`.
7. For OpenAI / Anthropic / Gemini, use the current repo model list plus any clearly justified new candidate IDs you want to test.
8. Report progress in Chinese during execution.
9. If a provider is unconfigured, report that clearly and continue with the others.
10. Do not silently create workflows or edit setup files as part of this task.

Result format:
- Configured providers
- Newly confirmed usable models
- Currently registered but no longer usable models
- Models that failed and need manual review
- Per-provider counts
- Exact commands or code snippets you used for probing

Error interpretation:
- 200 = usable
- UNSUPPORTED_MODEL / not a valid model ID / Unknown model / 404 deployment not exist = not currently whitelisted by Replit
- 404 Publisher Model not found = current Replit project has no access
- Missing env vars = unconfigured
- Other network or proxy errors = manual review needed

Important:
- Prefer accuracy over speed.
- Use isolated, minimal probing requests.
- Do not leave behind temporary repo changes.
```

## Notes

- This file replaces the old repository probe script workflow.
- Keep the probing process agent-driven and explicit instead of embedding that logic into the repo.

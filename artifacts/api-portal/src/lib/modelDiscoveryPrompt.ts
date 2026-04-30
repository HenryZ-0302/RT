export const MODEL_DISCOVERY_PROMPT_PATH = "docs/MODEL_PROBING_PROMPT.md";

export const MODEL_DISCOVERY_PROMPT = `Please determine which Replit AI Integrations models are actually usable in this workspace.

Scope:
- OpenAI
- Anthropic
- Gemini
- OpenRouter

Hard rules:
1. Use the real Replit AI Integrations environment variables already present in the workspace:
   - AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY
   - AI_INTEGRATIONS_ANTHROPIC_BASE_URL / AI_INTEGRATIONS_ANTHROPIC_API_KEY
   - AI_INTEGRATIONS_GEMINI_BASE_URL / AI_INTEGRATIONS_GEMINI_API_KEY
   - AI_INTEGRATIONS_OPENROUTER_BASE_URL / AI_INTEGRATIONS_OPENROUTER_API_KEY
2. Do not modify repository files, do not add/update the model registry, and do not create workflows.
3. Do the whole run in one planned pass. Do not do repeated discovery/probing loops.
4. Use real minimal requests:
   - OpenAI: \`/v1/chat/completions\` for chat, \`/v1/images/generations\` for image, reserve \`/v1/audio/speech\` only if testing audio models.
   - Anthropic: \`/v1/messages\`.
   - Gemini: use the supported \`@google/genai\` SDK path for \`generateContent\` / \`generateImages\`; do not use raw fetch against \`:generateContent\` if Replit rejects that path.
   - OpenRouter: OpenAI-compatible \`/chat/completions\`.
5. If a provider is unconfigured, mark it as \`unconfigured\` and continue with the others.
6. Report progress in Chinese during execution, but keep the final result machine-usable.

Execution plan:
1. Read \`artifacts/api-server/src/services/modelRegistry.ts\` and build the registered baseline by provider:
   - OpenAI: \`OPENAI_CHAT_MODELS\` + \`OPENAI_IMAGE_MODELS\`
   - Anthropic: \`ANTHROPIC_BASE_MODELS\`
   - Gemini: \`GEMINI_BASE_MODELS\` + \`GEMINI_IMAGE_MODELS\`
   - OpenRouter: \`OPENROUTER_FEATURED\`
2. For OpenRouter:
   - Fetch \`https://openrouter.ai/api/v1/models\`.
   - Diff the returned IDs against \`OPENROUTER_FEATURED\`.
   - Add all unregistered returned IDs as new candidates.
   - Probe candidates against \`$AI_INTEGRATIONS_OPENROUTER_BASE_URL\` with concurrency 5.
3. For OpenAI:
   - Try \`$AI_INTEGRATIONS_OPENAI_BASE_URL/models\` first.
   - If enumeration works, diff returned IDs against the OpenAI registered baseline and add unregistered IDs as candidates.
   - If enumeration is unavailable or incomplete, add a clearly labeled fallback list of known/new OpenAI candidate IDs and probe them.
4. For Anthropic and Gemini:
   - Add clearly labeled fallback lists of known/new candidate IDs from official docs, release notes, user-supplied lists, or naming families already present in the registry.
   - Probe these candidates through their direct Replit integration, not through OpenRouter.
5. Add every currently registered model to the same probe queue so stale registered models are detected.
6. Deduplicate by \`provider + modelId + probeKind\`, then run the full queue once with concurrency 5.

Candidate table requirements before probing:
- provider
- modelId
- probeKind (\`chat\` / \`image\` / \`audio\` if applicable)
- source (\`registered\`, \`openrouter-directory\`, \`provider-models-endpoint\`, \`official-doc-candidate\`, \`user-supplied-candidate\`)
- alreadyRegistered (\`true\` / \`false\`)

Result format:
- Configured providers
- Candidate counts by provider and source before probing
- Four tables:
  - registered usable
  - registered unavailable
  - newly discovered usable
  - candidate unavailable / manual review
- Per-provider counts and total duration
- Exact commands or code snippets used for probing

Output requirements:
- For every newly confirmed usable model, output the full exact model ID. Do not use summaries like "Qwen 12 variants" unless the full IDs are also listed.
- Do not recommend adding a model unless it has a full exact ID and a successful probe result.
- Separate direct OpenAI/Anthropic/Gemini results from OpenRouter results. Do not treat \`openai/*\` through OpenRouter as the same as direct OpenAI.
- If OpenRouter returns a routed or resolved model name, include both requested ID and resolved ID when available.
- End with a concise "safe to add to registry" list containing only unregistered, successfully probed, full exact IDs.

Error interpretation:
- 200 = usable
- UNSUPPORTED_MODEL / not a valid model ID / Unknown model / 404 deployment not exist = not currently whitelisted by Replit
- 404 Publisher Model not found = current Replit project has no access
- Missing env vars = unconfigured
- Other network or proxy errors = manual review needed

Important:
- Prefer accuracy over speed.
- Use isolated, minimal probing requests.
- Do not leave behind temporary repo changes.`;

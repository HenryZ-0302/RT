# Replit AI Integrations 模型探活

这套流程的目标是把“到底哪些模型真的能在当前 Replit 项目里用”这件事做成可重复执行的探活，而不是只靠旧清单或猜测。

## 命令入口

在完成部署并确认四家集成已配置后，运行：

```bash
pnpm --filter @workspace/api-server run probe:models
```

脚本会生成两份报告：

- `artifacts/api-server/reports/model-probe.latest.json`
- `artifacts/api-server/reports/model-probe.latest.md`

默认只生成报告，不会自动修改 `artifacts/api-server/src/services/modelRegistry.ts`。

## 探活方式

- OpenAI
  - `chat/completions`
  - `images/generations`
  - 预留 `audio/speech`
- Anthropic
  - `messages`
- Gemini
  - 必须走 `@google/genai` SDK
  - 文本探活用 `generateContent`
  - 图片探活优先用 `generateImages`，不可用时退回 SDK 的 `generateContent` 图片模态
- OpenRouter
  - OpenAI-compatible `chat/completions`

## 错误判定

- `200`：可用
- `UNSUPPORTED_MODEL` / `not a valid model ID` / `Unknown model` / `404 deployment not exist`：Replit 当前未收录
- `404 Publisher Model not found`：当前 Replit 项目无访问权限
- 缺少 `AI_INTEGRATIONS_*` 环境变量：未配置
- 其他网络或代理异常：待人工复核

## 候选来源

脚本会按这个顺序合并候选模型：

1. 当前注册表基线
   - 来源：`artifacts/api-server/src/services/modelRegistry.ts`
2. 本地手工补充候选
   - 来源：`artifacts/api-server/config/model-probe-candidates.json`
3. OpenRouter 公共目录
   - 来源：`https://openrouter.ai/api/v1/models`

OpenAI、Anthropic、Gemini 三家没有稳定可枚举目录时，就主要靠“当前基线 + 你手工补的新候选”。

## 报告怎么看

Markdown 报告固定分成几块：

- 本次已配置的 provider
- 新发现可用模型
- 当前注册但已不可用模型
- 探测失败待复核模型
- 每家 provider 的总数统计

推荐流程：

1. 部署后先跑一次 `probe:models`
2. 看 `model-probe.latest.md`
3. 确认哪些是新可用模型，哪些是旧模型已失效
4. 再决定是否手动更新 `modelRegistry.ts`

## 手工补充候选

如果你想试新模型，不要直接改注册表，先把候选写进：

- `artifacts/api-server/config/model-probe-candidates.json`

按 provider 和 probe kind 分类追加，例如：

```json
{
  "openai": {
    "chat": ["gpt-next-x"],
    "image": [],
    "audio": []
  },
  "anthropic": {
    "chat": ["claude-opus-next"]
  },
  "gemini": {
    "chat": ["gemini-next-pro"],
    "image": []
  },
  "openrouter": {
    "chat": []
  }
}
```

这样可以先探活，再决定是否并进正式模型表。

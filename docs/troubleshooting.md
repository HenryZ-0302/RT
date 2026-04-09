# 常见问题排查指南

---

## 问题一：一直转圈 / 加载不停

**症状：** 发送消息后，客户端一直显示加载动画，没有任何回复出现。

**可能原因及解决方案：**

### 1. 客户端开启了流式但不支持 SSE
部分客户端在流式模式下需要特殊配置。

**发给 Agent 的修复提示词：**
```
我的 AI 代理在流式模式下一直加载不回复。请检查以下内容：
1. 确认 SSE 响应头是否正确设置：Content-Type: text/event-stream、X-Accel-Buffering: no
2. 确认每个数据块在写入后立即调用了 flush()
3. 确认流式结束时发送了 "data: [DONE]\n\n" 并调用了 res.end()
4. Claude 流式是否有 keepalive 心跳防止连接超时
修复后重启服务并测试。
```

### 2. 所有后端节点都挂掉了
主代理无法连接任何后端时请求会挂起。

**排查方法：**
- 打开门户页，查看 Usage Statistics 面板，检查各节点 health 是否为绿色
- 或调用接口：
```bash
curl https://你的域名/v1/models \
  -H "Authorization: Bearer 你的SERVICE_ACCESS_KEY"
```
返回的 `friends` 列表中若全部为 `"down"` 则是此问题。

**解决：** 等待 30 秒让自动健康检测恢复，或重启 API Server。

### 3. 请求超时（模型响应太慢）
Claude 扩展思考模式、长文本生成有时需要数十秒。

**解决：**
- 客户端超时时间调长到 120 秒以上
- 非紧急任务改用非流式模式（`"stream": false`）

---

## 问题二：回复为空 / 内容缺失

**症状：** 收到响应但内容是空字符串，或只有一部分内容。

**可能原因及解决方案：**

### 1. Claude 模型使用了扩展思考，客户端不识别 `<thinking>` 标签
客户端可能把 `<thinking>...</thinking>` 之后的内容截断或忽略。

**解决：**
- 改用不带 `-thinking` 的模型（如 `claude-opus-4-6`）
- 或在客户端配置中开启"显示完整原始内容"

### 2. OpenAI 流式 chunk 格式被客户端过滤
**发给 Agent 的修复提示词：**
```
我的代理返回的流式响应内容为空。请检查：
1. OpenAI 流式请求是否加了 stream_options: { include_usage: true }
2. 最后一个包含 usage 的 chunk 格式是否标准（choices 数组不为空）
3. 非内容 chunk（如只有 usage 字段的 chunk）是否影响了客户端解析
如有问题请修复并测试。
```

### 3. max_tokens 设置过小
模型在生成完整回复前就被截断。

**解决：** 在请求中加大 `max_tokens`，Claude 模型建议至少设置 `4096`。

---

## 问题三：鉴权失败 / 401 错误

**症状：** 收到 `401 Unauthorized` 或 `"Invalid API key"` 错误。

**检查清单：**
1. `SERVICE_ACCESS_KEY` 的值前后是否有多余空格
2. 客户端填写的 API Key 是否和 `SERVICE_ACCESS_KEY` **完全一致**（区分大小写）
3. 请求头格式是否正确：`Authorization: Bearer <你的密钥>`（Bearer 后面有空格）
4. 朋友节点的 `SERVICE_ACCESS_KEY` 是否和主代理一致

**测试命令：**
```bash
curl https://你的域名/v1/models \
  -H "Authorization: Bearer 你的SERVICE_ACCESS_KEY"
# 返回模型列表 = 密钥正确
# 返回 401 = 密钥错误
```

---

## 问题四：朋友节点显示 down / 无法连接

**症状：** 门户页统计面板中朋友节点一直显示红色。

**排查步骤：**

1. **确认朋友的服务已发布（Deploy）**，不能只是开发模式运行
2. **直接测试朋友节点：**
```bash
curl https://朋友的域名/v1/models \
  -H "Authorization: Bearer 共用的SERVICE_ACCESS_KEY"
```
3. 若返回 401：朋友的 `SERVICE_ACCESS_KEY` 和你的不一致，让朋友检查 Secrets
4. 若连接超时：朋友的服务可能未启动或域名有误
5. 若一切正常但主代理仍显示 down：重启主代理 API Server，等待 30 秒重新探测

---

## 问题五：CherryStudio / 客户端获取不到模型列表

**症状：** 点击「Fetch Models」按钮后提示失败或列表为空。

**检查清单：**
1. Base URL 末尾**不要加斜杠**，正确格式：`https://你的域名`
2. API Key 填写的是 `SERVICE_ACCESS_KEY` 的值，不是 Replit 的账号密码
3. 部分客户端会自动在 Base URL 后拼接 `/v1`，如果填写时已包含 `/v1` 则会变成 `/v1/v1` 导致失败
   - 正确：`https://你的域名`（不含 /v1）
   - 错误：`https://你的域名/v1`

**验证 Base URL 是否正确：**
```bash
# 将 <BASE_URL> 替换为你在客户端填写的地址
curl <BASE_URL>/v1/models \
  -H "Authorization: Bearer 你的SERVICE_ACCESS_KEY"
```

---

## 问题六：Token 统计显示为 0

**症状：** 门户页统计面板中 Prompt tk / Completion tk 一直是 0。

**原因：** 统计数据存在内存中，**服务重启后清零**。这是正常现象，重启后发送几条消息后数字会重新累积。

若重启后依然为 0，检查：
- 是否使用了流式模式（streaming）——OpenAI 流式需要客户端支持 `stream_options`
- Claude 非流式模式的 token 统计是否正常（测试一次非流式请求）

---

## 问题七：413 Request Entity Too Large

**症状：** 发送带图片的消息，或发送很长的对话历史时，收到 `413` 错误。

**原因：** 请求体超过了服务器的大小限制。

**解决方案：**

### 1. 代理服务器 body 限制不够大
**发给 Agent 的修复提示词：**
```
我的代理返回 413 错误。请将 Express 的 body-parser 限制从当前值调大到至少 100mb：
app.use(express.json({ limit: "100mb" }));
修改后重启服务。
```

### 2. 图片 base64 太大
单张图片 base64 编码后体积是原始文件的约 1.33 倍。建议：
- 发送前压缩图片至 1MB 以下
- 或改用图片 URL（`https://...`）而非 base64 内嵌

### 3. 对话历史太长
长对话的历史消息累积导致请求体过大。建议：
- 在客户端中开启「裁剪历史」或「最大上下文」限制
- 或手动清除历史，开启新对话

---

## 问题八：404 Not Found

**症状：** 收到 `404` 错误，提示路径不存在。

**常见原因及解决：**

### 1. Base URL 拼接了多余路径
部分客户端会在 Base URL 后自动追加 `/v1`，如果你填写时已经带了 `/v1` 就会变成 `/v1/v1`。

| 填写方式 | 实际请求路径 | 是否正确 |
|----------|-------------|---------|
| `https://你的域名` | `/v1/chat/completions` | ✅ 正确 |
| `https://你的域名/v1` | `/v1/v1/chat/completions` | ❌ 错误 |

**解决：** Base URL 只填域名，不加 `/v1`。

### 2. 访问了不存在的端点
本代理只支持以下接口：

| 接口 | 方法 |
|------|------|
| `/v1/models` | GET |
| `/v1/chat/completions` | POST |
| `/v1/stats` | GET |
| `/api/healthz` | GET |

访问其他路径（如 `/v1/embeddings`、`/v1/images/generations`）会返回 404，这些功能暂不支持。

### 3. 朋友节点的域名填错
检查 `FRIEND_PROXY_URL_N` 是否包含多余路径：

- ✅ 正确：`https://friend-proxy-node.replit.app`
- ❌ 错误：`https://friend-proxy-node.replit.app/v1`

---

## 问题九：500 Internal Server Error

**症状：** 收到 `500` 错误，或错误信息为 `"Unknown error"` / `"server_error"`。

**排查步骤：**

### 1. AI Integrations 未开启或配额耗尽
这是 500 最常见的原因。检查方法：
```bash
curl https://你的域名/v1/chat/completions \
  -H "Authorization: Bearer 你的SERVICE_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}],"stream":false}'
```
若错误信息包含 `quota`、`rate limit`、`insufficient_quota`，说明账号配额不足。

**解决：**
- 检查 Replit 账号的 AI 配额是否耗尽
- 等待配额重置，或让其他朋友节点分担请求

### 2. 模型名称不在支持列表中
发送了不支持的模型名会导致 500。

**支持的模型名（完整列表）：**
```
gpt-5.2 / gpt-5-mini / gpt-5-nano / o4-mini / o3
claude-opus-4-6 / claude-sonnet-4-6 / claude-haiku-4-5
claude-opus-4-6-thinking / claude-sonnet-4-6-thinking
```

不在此列表中的模型名会被自动替换为 `gpt-5.2`，但若模型名格式错误导致转发失败则返回 500。

### 3. 请求体格式错误
`messages` 数组格式不符合 OpenAI 规范（如 role 字段缺失、content 为 null）。

**发给 Agent 的修复提示词：**
```
我的代理返回 500 错误。请在 POST /v1/chat/completions 路由中加入请求体校验：
1. 检查 messages 是否为非空数组
2. 检查每条消息是否有合法的 role（user/assistant/system）和非空 content
3. 校验失败时返回 400 而不是让错误传播到 500
修改后重启服务。
```

### 4. 朋友节点的 AI Integrations 未绑定
若请求被路由到朋友节点，而朋友没有开启 AI Integrations，会返回 500。

**解决：** 让对应朋友检查其 Replit 项目中 AI Integrations 是否已启用（OpenAI + Anthropic 都需要开启）。

---

## 通用排查命令

```bash
# 1. 检查服务是否在线
curl https://你的域名/api/healthz

# 2. 检查模型列表（顺带验证鉴权）
curl https://你的域名/v1/models \
  -H "Authorization: Bearer 你的SERVICE_ACCESS_KEY"

# 3. 查看各节点用量统计
curl https://你的域名/v1/stats \
  -H "Authorization: Bearer 你的SERVICE_ACCESS_KEY"

# 4. 发一条最简单的测试消息（非流式）
curl https://你的域名/v1/chat/completions \
  -H "Authorization: Bearer 你的SERVICE_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}],"stream":false}'

# 5. 测试流式
curl https://你的域名/v1/chat/completions \
  -H "Authorization: Bearer 你的SERVICE_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

import { useState } from "react";

const SECTIONS = [
  {
    title: "服务概览",
    content: `Unified Service Layer 是一个统一访问层，用来收敛访问入口、访问控制、运行状态、兼容接口和运维能力。

默认门户优先展示中性的服务别名接口：
- GET /api/service/status
- GET /api/service/bootstrap
- GET /api/service/catalog
- POST /api/service/chat
- POST /api/service/messages

旧的兼容接口仍然保留，适合已有客户端继续使用：
- GET /v1/models
- POST /v1/chat/completions
- POST /v1/messages`,
  },
  {
    title: "访问控制",
    content: `服务访问密钥优先读取 SERVICE_ACCESS_KEY，旧变量 PROXY_API_KEY 仍然兼容。

支持三种认证方式：
1. Authorization: Bearer <key>
2. x-api-key: <key>
3. ?key=<key>（主要用于日志流等简单调试场景）

门户文案默认使用“服务访问密钥”，但旧客户端与旧变量名不会失效。`,
  },
  {
    title: "运维接口",
    content: `推荐使用下列中性别名接口：
- GET /api/service/metrics
- GET /api/service/logs
- GET /api/service/logs/stream
- GET|PATCH /api/service/routing
- GET|PATCH /api/service/models
- GET|POST|PATCH|DELETE /api/service/backends
- GET|POST /api/service/settings/compatibility
- GET /api/service/release
- GET /api/service/release/status
- POST /api/service/release/apply

这些接口和旧的 /v1/admin/*、/update/*、/settings/* 行为等价。`,
  },
  {
    title: "兼容性说明",
    content: `现有核心能力没有变化：
- 旧版 OpenAI 兼容调用仍可继续走 /v1/chat/completions
- 旧版模型目录仍可继续走 /v1/models
- 旧版 Claude Messages 调用仍可继续走 /v1/messages

如果你在使用已有客户端或脚本，不需要立即迁移；门户只是默认改成了更中性的入口名称。`,
  },
  {
    title: "快速示例",
    content: `Catalog:
curl https://your-app.example.com/api/service/catalog \\
  -H "Authorization: Bearer YOUR_SERVICE_ACCESS_KEY"

Chat:
curl https://your-app.example.com/api/service/chat \\
  -H "Authorization: Bearer YOUR_SERVICE_ACCESS_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"Hello!"}]}'

兼容客户端也可以继续使用 /v1/chat/completions 与 /v1/models。`,
  },
];

export default function PageDocs() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  const toggle = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 8px" }}>
        以下内容聚焦服务入口、兼容接口与运维能力，默认按中性服务命名展示。
      </p>
      {SECTIONS.map((section, index) => (
        <div
          key={section.title}
          style={{
            background: "rgba(0,0,0,0.25)",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          <button
            onClick={() => toggle(index)}
            style={{
              width: "100%",
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#e2e8f0",
              fontSize: "14px",
              fontWeight: 600,
              textAlign: "left",
            }}
          >
            <span>{section.title}</span>
            <span
              style={{
                transform: expanded.has(index) ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
                fontSize: "12px",
                color: "#64748b",
              }}
            >
              &#9654;
            </span>
          </button>
          {expanded.has(index) && (
            <div
              style={{
                padding: "0 16px 16px",
                color: "#94a3b8",
                fontSize: "13px",
                lineHeight: "1.8",
                whiteSpace: "pre-wrap",
                borderTop: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              {section.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const USER_ID_PARAM = "userId";

// Tools that operate against per-user platform namespaces must receive a stable userId.
// In our multi-agent setup, we set agentId=userId and route by WhatsApp sender -> agentId.
const PLATFORM_TOOLS = new Set([
  "vault_get",
  "vault_list",
  "vault_set",
  "vault_share",
  "otp_request",
  "stuck_escalate",
  "checkpoint_save",
  "checkpoint_resume",
  "deploy",
  "account_create",
]);

export default {
  id: "platform-userid-injector",
  name: "Platform UserId Injector",
  description: "Injects userId into platform tools using the routed agentId.",
  register(api: OpenClawPluginApi) {
    api.on("before_tool_call", (event, ctx) => {
      const agentId = typeof ctx.agentId === "string" ? ctx.agentId.trim() : "";
      if (!agentId) {
        return;
      }
      const toolName = ctx.toolName || event.toolName;
      if (!PLATFORM_TOOLS.has(toolName)) {
        return;
      }
      const params = event.params ?? {};
      const existing = (params as Record<string, unknown>)[USER_ID_PARAM];
      if (typeof existing === "string" && existing.trim()) {
        return;
      }
      return {
        params: {
          ...params,
          [USER_ID_PARAM]: agentId,
        },
      };
    });
  },
};


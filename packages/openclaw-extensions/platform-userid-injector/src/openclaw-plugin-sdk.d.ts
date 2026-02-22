declare module "openclaw/plugin-sdk" {
  export type BeforeToolCallEvent = {
    toolName: string;
    params?: unknown;
  };

  export type BeforeToolCallContext = {
    agentId?: string;
    toolName?: string;
  };

  export type BeforeToolCallResult =
    | void
    | {
        params?: Record<string, unknown>;
      };

  export type OpenClawPluginApi = {
    on: (
      eventName: "before_tool_call",
      handler: (
        event: BeforeToolCallEvent,
        ctx: BeforeToolCallContext,
      ) => BeforeToolCallResult,
    ) => void;
  };
}


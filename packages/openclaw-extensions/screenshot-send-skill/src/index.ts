import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const ScreenshotSendSchema = Type.Object({
  to: Type.Optional(Type.String({ description: "WhatsApp number to send to." })),
  caption: Type.Optional(Type.String({ description: "Caption to send with screenshot." })),
  path: Type.Optional(Type.String({ description: "Existing local screenshot path." })),
  targetId: Type.Optional(Type.String({ description: "Browser target id." })),
  fullPage: Type.Optional(Type.Boolean({ description: "Capture full page screenshot." })),
  ref: Type.Optional(Type.String({ description: "Element ref for screenshot." })),
  element: Type.Optional(Type.String({ description: "Element selector for screenshot." })),
  type: Type.Optional(Type.Union([Type.Literal("png"), Type.Literal("jpeg")])),
  profile: Type.Optional(Type.String({ description: "Browser profile name." })),
  accountId: Type.Optional(Type.String({ description: "WhatsApp account id override." })),
});

type BrowserScreenshotAction = (
  baseUrl: string | undefined,
  opts: {
    targetId?: string;
    fullPage?: boolean;
    ref?: string;
    element?: string;
    type?: "png" | "jpeg";
    profile?: string;
  },
) => Promise<{ path: string }>;

const resolveBrowserActions = async (): Promise<{ browserScreenshotAction: BrowserScreenshotAction }> => {
  const modulePath = fileURLToPath(import.meta.url);
  let cursor = path.dirname(modulePath);
  for (let i = 0; i < 8; i += 1) {
    const distCandidate = path.join(cursor, "dist", "browser", "client-actions-core.js");
    const srcCandidate = path.join(cursor, "src", "browser", "client-actions-core.js");
    const srcTsCandidate = path.join(cursor, "src", "browser", "client-actions-core.ts");
    for (const candidate of [distCandidate, srcCandidate, srcTsCandidate]) {
      if (fs.existsSync(candidate)) {
        const mod = await import(pathToFileURL(candidate).href);
        if (typeof mod.browserScreenshotAction === "function") {
          return mod as { browserScreenshotAction: BrowserScreenshotAction };
        }
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error("OpenClaw browser actions not found");
};

export default {
  id: "screenshot-send-skill",
  name: "Screenshot Sender",
  description: "Capture and send screenshots via WhatsApp.",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "screenshot_send",
      label: "Screenshot Send",
      description: "Capture a screenshot (optional) and send it via WhatsApp.",
      parameters: ScreenshotSendSchema,
      async execute(_toolCallId: string, params: any) {
        const to = typeof params.to === "string" ? params.to.trim() : "";
        if (!to) {
          throw new Error("to required");
        }

        let screenshotPath =
          typeof params.path === "string" && params.path.trim() ? params.path.trim() : "";
        if (!screenshotPath) {
          const { browserScreenshotAction } = await resolveBrowserActions();
          const result = await browserScreenshotAction(undefined, {
            targetId: typeof params.targetId === "string" ? params.targetId : undefined,
            fullPage: Boolean(params.fullPage),
            ref: typeof params.ref === "string" ? params.ref : undefined,
            element: typeof params.element === "string" ? params.element : undefined,
            type: params.type === "jpeg" ? "jpeg" : "png",
            profile: typeof params.profile === "string" ? params.profile : undefined,
          });
          screenshotPath = result.path;
        }

        const caption = typeof params.caption === "string" ? params.caption : "";
        const mediaRoot = path.dirname(screenshotPath);
        await api.runtime.channel.whatsapp.sendMessageWhatsApp(to, caption, {
          verbose: false,
          mediaUrl: screenshotPath,
          mediaLocalRoots: [mediaRoot],
          accountId: typeof params.accountId === "string" ? params.accountId : undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: `Screenshot sent to ${to}.`,
            },
          ],
          details: { path: screenshotPath },
        };
      },
    });
  },
};

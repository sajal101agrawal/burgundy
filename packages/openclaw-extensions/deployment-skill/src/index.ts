import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const DeploySchema = Type.Object({
  provider: Type.Optional(Type.String({ description: "Target provider (aws, gcp, vercel, etc)." })),
  projectPath: Type.Optional(Type.String({ description: "Local path to project." })),
  target: Type.Optional(Type.String({ description: "Deployment target/environment." })),
  notes: Type.Optional(Type.String({ description: "Additional deployment notes." })),
  userId: Type.Optional(Type.String({ description: "Optional user id override." })),
});

const execFileAsync = promisify(execFile);

function resolvePlatformApi(userIdOverride?: string): { baseUrl: string; userId: string; token?: string } {
  const baseUrl = process.env.PLATFORM_API_URL?.trim();
  const userId = userIdOverride?.trim() || process.env.PLATFORM_USER_ID?.trim();
  if (!baseUrl || !userId) {
    throw new Error("PLATFORM_API_URL and PLATFORM_USER_ID are required");
  }
  const token = process.env.PLATFORM_INTERNAL_TOKEN?.trim();
  return { baseUrl, userId, token: token || undefined };
}

async function platformAskConfirm(userId: string, message: string, timeoutSeconds = 600): Promise<boolean> {
  const { baseUrl, token } = resolvePlatformApi(userId);
  const res = await fetch(`${baseUrl}/internal/user-ask`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ userId, message, type: "confirm", timeoutSeconds }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`platform_user_ask_failed:${res.status}${text ? `:${text}` : ""}`);
  }
  const payload = (await res.json()) as { response?: string };
  const answer = (payload.response || "").trim().toLowerCase();
  return ["y", "yes", "ok", "okay", "confirm", "confirmed"].includes(answer);
}

async function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, timeout: 20 * 60_000, maxBuffer: 10 * 1024 * 1024 });
    return { code: 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") };
  } catch (err) {
    const e = err as any;
    const stdout = String(e?.stdout ?? "");
    const stderr = String(e?.stderr ?? e?.message ?? "");
    const code = typeof e?.code === "number" ? e.code : 1;
    return { code, stdout, stderr };
  }
}

async function resolveProjectDir(input?: string): Promise<string> {
  const candidate = (input && input.trim()) || process.env.OPENCLAW_WORKSPACE?.trim() || process.cwd();
  const resolved = path.resolve(candidate);
  const st = await fs.stat(resolved).catch(() => null);
  if (!st?.isDirectory()) {
    throw new Error(`projectPath not found: ${resolved}`);
  }
  return resolved;
}

export default {
  id: "deployment-skill",
  name: "Deployment",
  description: "Deployment workflows (dev-grade).",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "deploy",
      label: "Deploy",
      description:
        "Deploy an application to a cloud provider. Currently supports Vercel deploys (requires VERCEL_TOKEN).",
      parameters: DeploySchema,
      async execute(_toolCallId, params) {
        const userId = typeof (params as any).userId === "string" ? String((params as any).userId).trim() : "";
        if (!userId) {
          throw new Error("userId required (pass userId or set PLATFORM_USER_ID)");
        }
        const provider = typeof params.provider === "string" ? params.provider.trim().toLowerCase() : "";
        const target = typeof params.target === "string" ? params.target.trim() : "";
        const notes = typeof params.notes === "string" ? params.notes.trim() : "";
        const projectDir = await resolveProjectDir(typeof params.projectPath === "string" ? params.projectPath : undefined);

        if (!provider) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Missing `provider`. Try: { provider: \"vercel\", projectPath: \"/workspace\", target: \"prod\" }.\n" +
                  "Supported providers right now: vercel.",
              },
            ],
            details: { provider: null, projectDir },
          };
        }

        if (provider !== "vercel") {
          return {
            content: [
              {
                type: "text",
                text:
                  `Provider '${provider}' is not supported yet in this dev build.\n` +
                  "Supported providers right now: vercel.\n" +
                  "If you want AWS/GCP/DO flows next, tell me which one and how you want credentials stored (vault vs env).",
              },
            ],
            details: { provider, projectDir },
          };
        }

        const token = process.env.VERCEL_TOKEN?.trim() || "";
        if (!token) {
          return {
            content: [
              {
                type: "text",
                text:
                  "VERCEL_TOKEN is not set.\n" +
                  "Set it in your environment (docker compose env) before running deploy.\n" +
                  "Example: VERCEL_TOKEN=... docker compose -f infra/docker/docker-compose.yml up -d --build openclaw",
              },
            ],
            details: { provider, projectDir, missing: ["VERCEL_TOKEN"] },
          };
        }

        const ok = await platformAskConfirm(
          userId,
          `Deploy this project via Vercel${target ? ` (${target})` : ""}?` +
            `${notes ? `\nNotes: ${notes}` : ""}` +
            `\nProject: ${projectDir}\nReply YES to proceed.`,
          900,
        );
        if (!ok) {
          return {
            content: [{ type: "text", text: "Cancelled (no confirmation received)." }],
            details: { provider, projectDir, cancelled: true },
          };
        }

        // Minimal vercel deploy: relies on existing project config inside the folder.
        const version = await run("npx", ["--yes", "vercel", "--version"], projectDir);
        if (version.code !== 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Failed to run `vercel` CLI.\n" +
                  (version.stderr || version.stdout || "Unknown error"),
              },
            ],
            details: { provider, projectDir, step: "vercel-version", version },
          };
        }

        const args = [
          "--yes",
          "vercel",
          "deploy",
          "--prod",
          "--token",
          token,
          "--confirm",
        ];
        const deployed = await run("npx", args, projectDir);
        const output = `${deployed.stdout}\n${deployed.stderr}`.trim();
        if (deployed.code !== 0) {
          return {
            content: [
              {
                type: "text",
                text: "Vercel deploy failed.\n" + (output || `exit ${deployed.code}`),
              },
            ],
            details: { provider, projectDir, step: "vercel-deploy", deployed },
          };
        }

        const vercelUrlRe = new RegExp("https?://\\\\S+vercel\\\\.app\\\\S*", "i");
        const anyUrlRe = new RegExp("https?://\\\\S+", "i");
        const urlMatch = output.match(vercelUrlRe) || output.match(anyUrlRe);
        const url = urlMatch?.[0] ?? null;
        return {
          content: [
            {
              type: "text",
              text:
                `Deployed via Vercel.\n` +
                (url ? `URL: ${url}\n` : "") +
                `Output:\n${output.slice(-2000)}`,
            },
          ],
          details: { provider, projectDir, url, vercelVersion: version.stdout.trim() },
        };
      },
    });
  },
};

# OpenClaw Fork

This directory is reserved for the OpenClaw git subtree.

To add the subtree:

```
git subtree add --prefix packages/openclaw-fork https://github.com/openclaw/openclaw main --squash
```

After adding the subtree, apply the platform modifications described in the technical spec:

- `src/auto-reply/reply.ts` pending listener + interrupt classifier hook
- `src/config/zod-schema.ts` support `OPENCLAW_CONFIG_JSON`
- WhatsApp adapter internal HTTP endpoint for pre-routed messages
- `src/cli/commands/gateway.ts` respect `OPENCLAW_WORKSPACE`
- `pnpm-workspace.yaml` include `/skills/*`

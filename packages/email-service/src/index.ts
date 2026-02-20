import Fastify from "fastify";
import { logger } from "@concierge/logger";

const app = Fastify({ logger: logger as any });

app.post("/email/inbound", async (request) => {
  const payload = request.body as { to: string; subject: string; body: string };
  app.log.info({ payload }, "email inbound stub");
  return { ok: true };
});

const port = Number.parseInt(process.env.PORT || "3004", 10);
app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error, "email service failed to start");
  process.exit(1);
});

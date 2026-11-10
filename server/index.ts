import { existsSync } from "node:fs";
import { createGameServer } from "./app.js";
import { OpenAiGm, RulesGm } from "./gm.js";
import { z } from "zod";
if (existsSync(".env")) process.loadEnvFile(".env");
const config = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    AI_TIMEOUT_MS: z.coerce.number().int().min(100).max(20000).default(12000),
    DISCONNECT_GRACE_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(3600000)
      .default(60000),
    AI_CALL_LIMIT: z.coerce.number().int().min(0).max(10000).default(100),
    AI_TOKEN_BUDGET: z.coerce
      .number()
      .int()
      .min(0)
      .max(10000000)
      .default(300000),
    COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  })
  .parse(process.env);
const gm = process.env.OPENAI_API_KEY
  ? new OpenAiGm(
      {
        key: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        timeoutMs: config.AI_TIMEOUT_MS,
      },
      (usage) =>
        console.info(
          JSON.stringify({
            kind: "ai-usage",
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
            at: new Date().toISOString(),
            usage,
          }),
        ),
    )
  : new RulesGm();
const server = createGameServer({
  dbPath: process.env.DB_PATH ?? "./data/game.sqlite",
  gm,
  origin: process.env.PUBLIC_ORIGIN,
  secure: config.COOKIE_SECURE === "true",
  graceMs: config.DISCONNECT_GRACE_MS,
  aiCalls: config.AI_CALL_LIMIT,
  aiTokens: config.AI_TOKEN_BUDGET,
});
const port = config.PORT;
server.http.listen(port, process.env.HOST ?? "0.0.0.0", () =>
  console.info(
    `Mistbound running on port ${port} (${gm.mode === "live" ? "AI configured — not yet verified" : "RULES DEMO — no AI key"})`,
  ),
);
async function shutdown() {
  await server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

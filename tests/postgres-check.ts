// Run only against a disposable database whose name ends in _test.
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  migrate,
  getAppSetting,
  saveAppSetting,
} from "../src/services/db.service";
import {
  AIConfigManager,
  type AIConfig,
} from "../src/services/ai-config.service";
import { createAISettingsRoutes } from "../src/api/ai-settings.controller";
import { createAdminAuth } from "../src/services/admin-auth.service";
import { createConsoleRoutes } from "../src/services/console.service";

const database = new URL(
  Bun.env.DATABASE_URL || "postgres://localhost/missing",
);
assert(
  database.pathname.endsWith("_test"),
  "Use a disposable DATABASE_URL ending in _test",
);
await migrate(1);
const store = {
  load: () => getAppSetting("ai"),
  save: (value: AIConfig) => saveAppSetting("ai", value),
};
const defaults = {
  baseUrl: "https://provider.example/v1",
  apiKey: "",
  model: "before",
  embeddingModel: "embedding",
};
const manager = new AIConfigManager(store, defaults);
await manager.initialize();
const origin = "https://integration.example";
const auth = createAdminAuth({
  credentials: () => ({
    username: "integration",
    password: "integration-only",
  }),
  publicUrl: origin,
});
const app = new Hono();
app.route("/", createConsoleRoutes(auth));
app.use("/api/v1/*", auth.middleware);
app.route("/api/v1/settings/ai", createAISettingsRoutes(manager));
assert.equal((await app.request(origin + "/api/v1/settings/ai")).status, 401);
const login = await app.request(origin + "/api/auth/login", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "integration",
    password: "integration-only",
  }),
});
assert.equal(login.status, 200);
const Cookie = login.headers.get("set-cookie")!.split(";")[0]!;
const headers = { Cookie, Origin: origin, "Content-Type": "application/json" };
const save = await app.request(origin + "/api/v1/settings/ai", {
  method: "PUT",
  headers,
  body: JSON.stringify({
    ...defaults,
    apiKey: "integration-secret",
    model: "after",
  }),
});
assert.equal(save.status, 200);
assert(!(await save.text()).includes("integration-secret"));
const restarted = new AIConfigManager(store, defaults);
await restarted.initialize();
assert.equal(restarted.current().model, "after");
assert.equal(restarted.current().apiKey, "integration-secret");
const read = await app.request(origin + "/api/v1/settings/ai", {
  headers: { Cookie },
});
assert.equal(read.status, 200);
assert(!(await read.text()).includes("integration-secret"));
for (const route of ["/dashboard", "/settings/ai"]) {
  const page = await app.request(origin + route, { headers: { Cookie } });
  assert.equal(page.status, 200);
  assert(page.headers.get("content-type")?.includes("text/html"));
}
assert.equal(
  (await app.request(origin + "/api/auth/logout", { method: "POST", headers }))
    .status,
  200,
);
assert.equal(
  (await app.request(origin + "/api/v1/settings/ai", { headers: { Cookie } }))
    .status,
  401,
);
console.log("POSTGRES_CONFIG_PERSISTENCE_AND_AUTH_ROUTES_PASSED");
process.exit(0);

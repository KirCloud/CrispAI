import { expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createConsoleRoutes,
  mountOriginalConsole,
  ORIGINAL_DIR,
  CONSOLE_ASSET_PREFIX,
  CONSOLE_DIR,
  consoleAssetVersion,
} from "../src/services/console.service";
import { createAdminAuth } from "../src/services/admin-auth.service";

test("original dashboard and editor keep their markup with an independent extension; AI settings and login stay protected", async () => {
  const auth = createAdminAuth({
    credentials: () => ({ username: "admin", password: "test-password" }),
    publicUrl: "http://localhost",
  });
  const app = new Hono().route("/", createConsoleRoutes(auth));
  mountOriginalConsole(app, auth);
  const login = await app.request("http://localhost/login");
  expect(login.status).toBe(200);
  expect(await login.text()).toContain('id="login-form"');
  expect(login.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  for (const asset of ["console.css", "console.js", "extension.js"])
    expect(
      (await app.request("http://localhost/console-assets/" + asset)).status,
    ).toBe(200);
  for (const page of [
    "/dashboard",
    "/dashboard/",
    "/settings/ai",
    "/settings/ai/",
  ])
    expect((await app.request("http://localhost" + page)).status).toBe(302);
  const response = await app.request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-password" }),
  });
  const Cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  expect(
    (await app.request("http://localhost/settings/ai", { headers: { Cookie } }))
      .status,
  ).toBe(200);
  for (const page of ["/dashboard", "/dashboard/project/?id=test"]) {
    const response = await app.request("http://localhost" + page, {
      headers: { Cookie },
    });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(CONSOLE_ASSET_PREFIX + "/extension.js");
    expect(html).toContain("/_next/static/");
    expect(html).not.toContain('class="sidebar"');
  }
  expect(
    await Bun.file(ORIGINAL_DIR + "/dashboard/index.html").text(),
  ).not.toContain("/console-assets/extension.js");
  expect(
    (await app.request("http://localhost/api/console/ai-panel")).status,
  ).toBe(401);
  const fragment = await app.request("http://localhost/api/console/ai-panel", {
    headers: { Cookie },
  });
  expect(fragment.status).toBe(200);
  expect(await fragment.text()).toContain('id="ai-form"');
});

test("versioned console modules share a cache-safe path and change when UI or scripts change", async () => {
  const auth = createAdminAuth({
    credentials: () => ({ username: "admin", password: "test-password" }),
    publicUrl: "http://localhost",
  });
  const app = new Hono().route("/", createConsoleRoutes(auth));
  const login = await (await app.request("http://localhost/login")).text();
  expect(login).toContain(CONSOLE_ASSET_PREFIX + "/console.js");
  expect(login).not.toContain("?v=3");
  for (const asset of [
    "console.js",
    "site-api.js",
    "extension.js",
    "console.css",
  ]) {
    const response = await app.request(
      "http://localhost" + CONSOLE_ASSET_PREFIX + "/" + asset,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    const source = await response.text();
    if (asset === "extension.js")
      expect(source).toContain('from "./console.js"');
    if (asset === "console.js")
      expect(source).toContain('from "./site-api.js"');
  }
  expect(
    (await app.request("http://localhost/console-assets/old-build/console.js"))
      .status,
  ).toBe(404);
  const { mkdtemp, cp, appendFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const folder = await mkdtemp(path.join(tmpdir(), "crisp-console-assets-"));
  try {
    await cp(CONSOLE_DIR, folder, { recursive: true });
    const before = consoleAssetVersion(folder);
    await appendFile(
      path.join(folder, "assets/site-api.js"),
      "\n// changed release\n",
    );
    expect(consoleAssetVersion(folder)).not.toBe(before);
    const scriptChange = consoleAssetVersion(folder);
    await appendFile(
      path.join(folder, "ai-panel.html"),
      "\n<!-- changed controls -->\n",
    );
    expect(consoleAssetVersion(folder)).not.toBe(scriptChange);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

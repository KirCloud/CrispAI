import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { createConsoleRoutes } from "../src/services/console.service";
import { createAdminAuth } from "../src/services/admin-auth.service";

let root: string;
const auth = createAdminAuth({
  credentials: () => ({ username: "admin", password: "test-password" }),
  publicUrl: "http://localhost",
});

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "crisp-console-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(
    path.join(root, "index.html"),
    '<!doctype html><div id="root"></div><script type="module" src="/assets/index-abc.js"></script>',
  );
  await writeFile(path.join(root, "assets/index-abc.js"), "export {};");
  await writeFile(path.join(root, "theme-init.js"), "void 0;");
});
afterAll(() => rm(root, { recursive: true, force: true }));

const app = () => new Hono().route("/", createConsoleRoutes(auth, root));
const signIn = async (server: Hono) => {
  const response = await server.request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-password" }),
  });
  return response.headers.get("set-cookie")!.split(";")[0]!;
};

test("console pages require a session and serve the single-page app with a strict CSP", async () => {
  const server = app();
  for (const page of ["/dashboard", "/dashboard/project?id=x", "/settings/ai"]) {
    const response = await server.request("http://localhost" + page);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toStartWith("/login?next=");
  }
  const login = await server.request("http://localhost/login");
  expect(login.status).toBe(200);
  expect(await login.text()).toContain('id="root"');

  const Cookie = await signIn(server);
  for (const page of ["/dashboard", "/dashboard/project?id=x", "/settings/ai"]) {
    const response = await server.request("http://localhost" + page, {
      headers: { Cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const csp = response.headers.get("content-security-policy")!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(await response.text()).toContain("/assets/index-abc.js");
  }
  const signedInLogin = await server.request(
    "http://localhost/login?next=/settings/ai",
    { headers: { Cookie } },
  );
  expect(signedInLogin.headers.get("location")).toBe("/settings/ai");
});

test("hashed assets are public and immutable while unknown assets 404", async () => {
  const server = app();
  const asset = await server.request("http://localhost/assets/index-abc.js");
  expect(asset.status).toBe(200);
  expect(asset.headers.get("cache-control")).toContain("immutable");
  expect((await server.request("http://localhost/theme-init.js")).status).toBe(200);
  const missing = await server.request("http://localhost/assets/missing.js");
  expect(missing.status).toBe(404);
  expect(missing.headers.get("cache-control")).toBeNull();
});

test("old trailing-slash URLs from the upstream export redirect and keep their query", async () => {
  const response = await app().request(
    "http://localhost/dashboard/project/?id=abc",
  );
  expect(response.status).toBe(301);
  expect(response.headers.get("location")).toBe("/dashboard/project?id=abc");
});

test("a missing build answers with a clear error instead of a blank page", async () => {
  const empty = await mkdtemp(path.join(tmpdir(), "crisp-console-empty-"));
  try {
    const server = new Hono().route("/", createConsoleRoutes(auth, empty));
    const response = await server.request("http://localhost/login");
    expect(response.status).toBe(503);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

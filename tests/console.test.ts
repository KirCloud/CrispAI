import { expect, test } from "bun:test";
import { createConsoleRoutes } from "../src/services/console.service";
import { createAdminAuth } from "../src/services/admin-auth.service";

test("login assets are public, console pages require a session, and legacy editor is left to the static fallback", async () => {
  const auth = createAdminAuth({
    credentials: () => ({ username: "admin", password: "test-password" }),
    publicUrl: "http://localhost",
  });
  const app = createConsoleRoutes(auth);
  const login = await app.request("http://localhost/login");
  expect(login.status).toBe(200);
  expect(await login.text()).toContain('id="login-form"');
  expect(login.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  for (const asset of ["console.css", "console.js"])
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
  expect(
    (
      await app.request("http://localhost/dashboard/project/?id=test", {
        headers: { Cookie },
      })
    ).status,
  ).toBe(404);
});

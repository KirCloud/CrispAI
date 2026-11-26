import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card, CardBody, CardHeader, Input } from "@heroui/react";
import { RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { request } from "../api";

export function LoginPage() {
  const [params] = useSearchParams();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { redirect } = await request<{ redirect: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: {
            username: username.trim(),
            password,
            next: params.get("next") || "/dashboard",
          },
        },
      );
      location.replace(redirect);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-2" shadow="sm">
        <CardHeader className="flex flex-col items-start gap-1">
          <img src="/logo.png" alt="" width={40} height={40} className="mb-2" />
          <h1 className="text-xl font-semibold">登录 CrispAI</h1>
          <p className="text-small text-default-400">使用管理员账号管理客服项目</p>
        </CardHeader>
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <Input
              label="账号"
              labelPlacement="outside"
              placeholder="admin"
              variant="bordered"
              autoComplete="username"
              value={username}
              onValueChange={setUsername}
              isRequired
            />
            <Input
              label="密码"
              labelPlacement="outside"
              placeholder="输入管理员密码"
              variant="bordered"
              autoComplete="current-password"
              type={visible ? "text" : "password"}
              value={password}
              onValueChange={setPassword}
              isRequired
              autoFocus
              endContent={
                <button
                  type="button"
                  className="text-default-400"
                  aria-label={visible ? "隐藏密码" : "显示密码"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? (
                    <RiEyeOffLine className="h-4 w-4" />
                  ) : (
                    <RiEyeLine className="h-4 w-4" />
                  )}
                </button>
              }
            />
            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="bg-foreground text-background"
              isLoading={busy}
            >
              登录
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}

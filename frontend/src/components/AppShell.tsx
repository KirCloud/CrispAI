import { useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import {
  BreadcrumbItem,
  Breadcrumbs,
  Button,
  Link,
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  Tooltip,
} from "@heroui/react";
import {
  RiDashboardLine,
  RiFileList3Line,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiRobot2Line,
  RiSunLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { api, projectQuery, request } from "../api";
import { hasUnsavedChanges, useUnsavedChangesGuard } from "../dirty";
import type { Project } from "../types";
import { notify } from "./ui";

function useTheme() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.classList.toggle("light", !next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };
  return { dark, toggle };
}

function Trail() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const id = pathname === "/dashboard/project" ? params.get("id") : null;
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<Project>(projectQuery(id!)),
    enabled: Boolean(id),
  });
  const icon = "h-4 w-4";
  return (
    <Breadcrumbs size="lg" classNames={{ list: "flex-nowrap" }}>
      <BreadcrumbItem href="/dashboard" startContent={<RiDashboardLine className={icon} />}>
        仪表盘
      </BreadcrumbItem>
      {id && (
        <BreadcrumbItem startContent={<RiFileList3Line className={icon} />}>
          <span className="max-w-40 truncate">{project.data?.name ?? "项目管理"}</span>
        </BreadcrumbItem>
      )}
      {pathname === "/settings/ai" && (
        <BreadcrumbItem startContent={<RiRobot2Line className={icon} />}>
          模型服务
        </BreadcrumbItem>
      )}
    </Breadcrumbs>
  );
}

export function AppShell() {
  useUnsavedChangesGuard();
  const theme = useTheme();
  const [leaving, setLeaving] = useState(false);
  const logout = async () => {
    if (hasUnsavedChanges() && !confirm("有未保存的修改，确定退出登录吗？"))
      return;
    setLeaving(true);
    try {
      await request("/api/auth/logout", { method: "POST", body: {} });
      location.replace("/login");
    } catch (error) {
      setLeaving(false);
      notify.error(error);
    }
  };
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar maxWidth="lg" isBordered classNames={{ wrapper: "gap-2" }}>
        <NavbarBrand className="grow-0 basis-auto">
          <Link href="/dashboard" color="foreground" className="gap-2">
            <img src="/logo.png" alt="" width={32} height={32} />
            <span className="hidden font-bold sm:inline">CrispAI</span>
          </Link>
        </NavbarBrand>
        <NavbarContent justify="center" className="hidden min-w-0 sm:flex">
          <Trail />
        </NavbarContent>
        <NavbarContent justify="end" className="grow-0 basis-auto gap-1">
          <NavbarItem>
            <Tooltip content="模型服务">
              <Button
                as={Link}
                href="/settings/ai"
                isIconOnly
                variant="light"
                aria-label="模型服务"
              >
                <RiRobot2Line className="h-5 w-5" />
              </Button>
            </Tooltip>
          </NavbarItem>
          <NavbarItem>
            <Button
              isIconOnly
              variant="light"
              aria-label="切换明暗主题"
              onPress={theme.toggle}
            >
              {theme.dark ? (
                <RiSunLine className="h-5 w-5" />
              ) : (
                <RiMoonLine className="h-5 w-5" />
              )}
            </Button>
          </NavbarItem>
          <NavbarItem>
            <Tooltip content="退出登录">
              <Button
                isIconOnly
                variant="light"
                aria-label="退出登录"
                isLoading={leaving}
                onPress={logout}
              >
                <RiLogoutBoxRLine className="h-5 w-5" />
              </Button>
            </Tooltip>
          </NavbarItem>
        </NavbarContent>
      </Navbar>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      <footer className="py-6 text-center text-small text-default-400">
        CrispAI · KirCloud
      </footer>
    </div>
  );
}

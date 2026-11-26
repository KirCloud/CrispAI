import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useHref,
  useNavigate,
} from "react-router-dom";
import { HeroUIProvider, ToastProvider } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./api";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { ProjectPage } from "./pages/project/ProjectPage";
import { ModelSettingsPage } from "./pages/ModelSettings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status > 0) && count < 2,
    },
  },
});

function Providers() {
  const navigate = useNavigate();
  return (
    <HeroUIProvider navigate={navigate} useHref={useHref} locale="zh-CN">
      <ToastProvider placement="top-center" toastOffset={12} />
      <Outlet />
    </HeroUIProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Providers />,
    children: [
      { path: "/login", element: <LoginPage /> },
      {
        element: <AppShell />,
        children: [
          { path: "/dashboard", element: <DashboardPage /> },
          { path: "/dashboard/project", element: <ProjectPage /> },
          { path: "/settings/ai", element: <ModelSettingsPage /> },
        ],
      },
      { path: "*", element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

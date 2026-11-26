import { useEffect } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Skeleton, Tab, Tabs } from "@heroui/react";
import { RiAiGenerate, RiBook2Line, RiListCheck, RiMessage3Line, RiSettings3Line } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, projectQuery } from "../../api";
import { notify } from "../../components/ui";
import type { Project } from "../../types";
import { AITab } from "./AITab";
import { GeneralTab } from "./GeneralTab";
import { KeywordTab } from "./KeywordTab";
import { KnowledgeTab } from "./KnowledgeTab";
import { OptionsTab } from "./OptionsTab";

const tabs = [
  { key: "general", label: "基础设置", Icon: RiSettings3Line, Panel: GeneralTab },
  { key: "keyword", label: "自动回复", Icon: RiMessage3Line, Panel: KeywordTab },
  { key: "ai", label: "智能回复", Icon: RiAiGenerate, Panel: AITab },
  { key: "knowledge", label: "知识库", Icon: RiBook2Line, Panel: KnowledgeTab },
  { key: "options", label: "选项管理", Icon: RiListCheck, Panel: OptionsTab },
] as const;

export function ProjectPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const id = params.get("id") ?? "";
  const selected = tabs.some((tab) => tab.key === params.get("tab")) ? params.get("tab")! : "general";
  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.get<Project>(projectQuery(id)),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (project.error instanceof ApiError && [400, 404].includes(project.error.status)) {
      notify.error(project.error);
      navigate("/dashboard", { replace: true });
    }
  }, [project.error, navigate]);

  if (!id) return <Navigate to="/dashboard" replace />;

  return (
    <Tabs
      fullWidth
      aria-label="项目设置"
      selectedKey={selected}
      destroyInactiveTabPanel={false}
      classNames={{ tabList: "overflow-x-auto", panel: "px-0 pt-4" }}
      onSelectionChange={(key) =>
        setParams(
          (current) => {
            current.set("tab", String(key));
            return current;
          },
          { replace: true },
        )
      }
    >
      {tabs.map(({ key, label, Icon, Panel }) => (
        <Tab
          key={key}
          title={
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </span>
          }
        >
          {project.data ? (
            <Panel project={project.data} />
          ) : project.isError ? (
            <p className="py-20 text-center text-default-400">{(project.error as Error).message}</p>
          ) : (
            <Skeleton className="h-96 rounded-large" />
          )}
        </Tab>
      ))}
    </Tabs>
  );
}

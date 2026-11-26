import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  Chip,
  Input,
  Link,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  useDisclosure,
} from "@heroui/react";
import {
  RiAddLargeLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiFolderAddLine,
  RiGlobalLine,
  RiTelegram2Line,
  RiUpload2Line,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../components/ui";
import type { AIConfig, Project } from "../types";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold text-default-900 lg:text-3xl">{title}</h1>
        <p className="text-small text-default-400 lg:text-medium">{description}</p>
      </div>
      {children && <div className="flex flex-wrap gap-3">{children}</div>}
    </header>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const icon = "h-4 w-4";
  return (
    <Card
      as={Link}
      href={`/dashboard/project?id=${project.id}`}
      isHoverable
      isPressable
      className="w-full border-2 border-default/20"
    >
      <CardBody className="flex flex-row items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          {project.botIcon ? (
            <img src={project.botIcon} alt="" className="h-10 w-10 rounded-small object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-small bg-default-200" />
          )}
          <h3 className="truncate text-lg font-semibold">{project.name}</h3>
        </div>
        <Chip
          size="sm"
          variant="flat"
          color={project.enabled ? "success" : "danger"}
          startContent={
            project.enabled ? (
              <RiCheckboxCircleLine className={icon} />
            ) : (
              <RiCloseCircleLine className={icon} />
            )
          }
        >
          {project.enabled ? "已启用" : "已禁用"}
        </Chip>
      </CardBody>
      <CardFooter className="flex flex-wrap gap-2">
        <Chip
          size="sm"
          variant="flat"
          color={project.websiteId ? "primary" : "warning"}
          startContent={<RiGlobalLine className={icon} />}
        >
          {project.websiteId ? "已绑定网站" : "未绑定网站"}
        </Chip>
        <Chip
          size="sm"
          variant="flat"
          color={project.telegramId ? "primary" : "warning"}
          startContent={<RiTelegram2Line className={icon} />}
        >
          {project.telegramId ? "已绑定 Telegram" : "未绑定 Telegram"}
        </Chip>
        {project.enableAI && (
          <Chip size="sm" variant="flat" color="secondary">
            AI 回复
          </Chip>
        )}
      </CardFooter>
    </Card>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/api/v1/projects"),
  });
  const ai = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => api.get<AIConfig>("/api/v1/settings/ai"),
  });
  const create = useDisclosure();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const createProject = async () => {
    if (!name.trim()) return notify.error("请输入项目名称");
    setCreating(true);
    try {
      const { data } = await api.post<{ data: { id: string }[] }>(
        "/api/v1/createProject",
        { name: name.trim() },
      );
      notify.success("项目已创建");
      navigate(`/dashboard/project?id=${data[0]!.id}`);
    } catch (error) {
      notify.error(error);
      setCreating(false);
    }
  };

  const importProject = async (selected: File) => {
    setImporting(true);
    try {
      let body: unknown;
      try {
        body = JSON.parse(await selected.text());
      } catch {
        throw new Error("不是有效的项目导出文件");
      }
      const result = await api.post<{ data: { id: string }; warnings?: string[] }>(
        "/api/v1/importProject",
        body,
      );
      notify.success("项目已导入");
      for (const warning of result.warnings ?? []) notify.warning(warning);
      navigate(`/dashboard/project?id=${result.data.id}`);
    } catch (error) {
      notify.error(error);
    } finally {
      setImporting(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <>
      <PageHeader title="仪表盘" description="管理 Crisp 客服项目">
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void importProject(selected);
          }}
        />
        <Button
          variant="flat"
          isLoading={importing}
          startContent={!importing && <RiUpload2Line className="h-4 w-4" />}
          onPress={() => file.current?.click()}
        >
          导入项目
        </Button>
        <Button
          className="bg-foreground text-background"
          startContent={<RiAddLargeLine className="h-4 w-4" />}
          onPress={create.onOpen}
        >
          创建项目
        </Button>
      </PageHeader>

      {ai.data && !ai.data.configured && (
        <Alert
          className="mb-6"
          color="warning"
          title="还没有配置模型服务"
          description="AI 回复需要先填写对话接口和模型。"
          endContent={
            <Button as={Link} href="/settings/ai" size="sm" color="warning" variant="flat">
              去配置
            </Button>
          }
        />
      )}

      {projects.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-28 rounded-large" />
          ))}
        </div>
      ) : projects.data?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="my-40 text-center">
          <RiFolderAddLine className="mx-auto h-16 w-16 text-default-400" />
          <h3 className="mt-2 font-semibold text-default-900">
            {projects.isError ? "项目列表读取失败" : "你还没有项目"}
          </h3>
          <p className="mt-1 text-default-500">
            {projects.isError
              ? (projects.error as Error).message
              : "点击右上角创建一个新项目"}
          </p>
        </div>
      )}

      <Modal
        isOpen={create.isOpen}
        onOpenChange={create.onOpenChange}
        onClose={() => setName("")}
        backdrop="blur"
        isDismissable={!creating}
      >
        <ModalContent>
          {(close) => (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createProject();
              }}
            >
              <ModalHeader>为项目起一个名字</ModalHeader>
              <ModalBody>
                <Input
                  autoFocus
                  variant="bordered"
                  placeholder="请输入项目名称"
                  value={name}
                  onValueChange={setName}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" isDisabled={creating} onPress={close}>
                  取消
                </Button>
                <Button
                  type="submit"
                  className="bg-foreground text-background"
                  isLoading={creating}
                >
                  创建
                </Button>
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

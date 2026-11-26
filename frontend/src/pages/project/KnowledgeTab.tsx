import { useState } from "react";
import {
  Button,
  Chip,
  Input,
  Link,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
  Tooltip,
  useDisclosure,
} from "@heroui/react";
import { RiAddLine, RiDeleteBin2Line, RiEdit2Line, RiRefreshLine, RiSettings3Line } from "@remixicon/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, scoped } from "../../api";
import { notify, PanelCard, Section, SettingRow, successSwitch } from "../../components/ui";
import type { AIConfig, KnowledgeEntry, KnowledgeSource } from "../../types";
import { formatTime, type TabProps } from "./shared";

const modeText = {
  full: (chars: number) => `全文模式：回复时把资料原文交给模型，每次最多 ${chars.toLocaleString()} 字符`,
  vector: () => "向量检索：回复时检索最相关的 3 条资料",
  off: () => "知识库未启用：资料会保留，但不参与回复",
};

function EntryEditor({
  projectId,
  entry,
  isOpen,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  entry?: KnowledgeEntry;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [opened, setOpened] = useState<KnowledgeEntry | undefined | null>(null);
  if (isOpen && opened !== entry) {
    setOpened(entry);
    setName(entry?.name ?? "");
    setRaw(entry?.raw ?? "");
  }
  if (!isOpen && opened !== null) setOpened(null);

  const save = async (close: () => void) => {
    if (!name.trim() || !raw.trim()) return notify.error("请填写名称和内容");
    setSaving(true);
    try {
      await api.post("/api/v1/saveProjectPayload", {
        project_id: projectId,
        ...(entry && { payload_id: entry.id }),
        params: { name: name.trim(), raw },
      });
      await onSaved();
      notify.success("知识库条目已保存");
      close();
    } catch (error) {
      notify.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl" scrollBehavior="inside" backdrop="blur" isDismissable={!saving}>
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>{entry ? "编辑条目" : "添加条目"}</ModalHeader>
            <ModalBody>
              <Input label="名称" labelPlacement="outside" placeholder="例如：如何续费" variant="bordered" isRequired value={name} onValueChange={setName} />
              <Textarea
                label="内容"
                labelPlacement="outside"
                placeholder="写给模型看的资料原文"
                variant="bordered"
                isRequired
                minRows={10}
                maxRows={30}
                value={raw}
                onValueChange={setRaw}
                description={`${raw.length.toLocaleString()} 字符`}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" isDisabled={saving} onPress={close}>
                取消
              </Button>
              <Button className="bg-foreground text-background" isLoading={saving} onPress={() => save(close)}>
                保存
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function SourceEditor({
  projectId,
  source,
  isOpen,
  onOpenChange,
}: {
  projectId: string;
  source: KnowledgeSource | null | undefined;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const empty = { apiUrl: "", docsUrl: "", authorization: "", intervalMinutes: "60", enabled: true };
  const [form, setForm] = useState(empty);
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  if (isOpen && !opened) {
    setOpened(true);
    setForm(
      source
        ? { apiUrl: source.apiUrl, docsUrl: source.docsUrl, authorization: "", intervalMinutes: String(source.intervalMinutes), enabled: source.enabled }
        : empty,
    );
  }
  if (!isOpen && opened) setOpened(false);
  const set = (patch: Partial<typeof form>) => setForm((value) => ({ ...value, ...patch }));
  const interval = Number(form.intervalMinutes);
  const intervalInvalid = !Number.isInteger(interval) || interval < 15 || interval > 10080;

  const save = async (close: () => void) => {
    if (intervalInvalid) return notify.error("同步间隔需在 15～10080 分钟之间");
    setSaving(true);
    try {
      const { data } = await api.put<{ data: KnowledgeSource }>(scoped("/api/v1/knowledge/source", projectId), {
        apiUrl: form.apiUrl.trim(),
        docsUrl: form.docsUrl.trim(),
        enabled: form.enabled,
        intervalMinutes: interval,
        ...(form.authorization.trim() && { authorization: form.authorization.trim() }),
      });
      client.setQueryData(["knowledge-source", projectId], data);
      notify.success("文档来源已保存");
      close();
    } catch (error) {
      notify.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="xl" backdrop="blur" isDismissable={!saving}>
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="flex flex-col">
              文档同步来源
              <span className="text-small font-normal text-default-400">读取 V2Board 风格的 knowledge/fetch 接口，只更新有变化的条目</span>
            </ModalHeader>
            <ModalBody>
              <Input label="文档 API 地址" labelPlacement="outside" placeholder="https://example.com/api/v1/admin/knowledge/fetch" variant="bordered" type="url" value={form.apiUrl} onValueChange={(apiUrl) => set({ apiUrl })} />
              <Input label="教程页面地址" labelPlacement="outside" placeholder="https://example.com/#/docs" description="模型引导访客查看原文时使用" variant="bordered" type="url" value={form.docsUrl} onValueChange={(docsUrl) => set({ docsUrl })} />
              <Input
                label="Authorization 令牌"
                labelPlacement="outside"
                placeholder={source?.hasAuthorization ? "已保存，留空不修改" : "完整的 Authorization 值"}
                description="只保存在服务器，建议使用只读令牌"
                variant="bordered"
                type="password"
                autoComplete="off"
                value={form.authorization}
                onValueChange={(authorization) => set({ authorization })}
              />
              <div className="flex items-end gap-4">
                <Input
                  className="w-40"
                  label="同步间隔"
                  labelPlacement="outside"
                  variant="bordered"
                  inputMode="numeric"
                  value={form.intervalMinutes}
                  onValueChange={(intervalMinutes) => set({ intervalMinutes })}
                  isInvalid={intervalInvalid}
                  endContent={<span className="whitespace-nowrap text-small text-default-400">分钟</span>}
                />
                <Switch classNames={successSwitch} isSelected={form.enabled} onValueChange={(enabled) => set({ enabled })} className="mb-2">
                  定时同步
                </Switch>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" isDisabled={saving} onPress={close}>
                取消
              </Button>
              <Button className="bg-foreground text-background" isLoading={saving} onPress={() => save(close)}>
                保存
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export function KnowledgeTab({ project }: TabProps) {
  const client = useQueryClient();
  const model = useQuery({
    queryKey: ["ai-settings"],
    queryFn: () => api.get<AIConfig>("/api/v1/settings/ai"),
  });
  const entries = useQuery({
    queryKey: ["payloads", project.id],
    queryFn: () => api.get<KnowledgeEntry[]>(scoped("/api/v1/payloads", project.id)),
  });
  const source = useQuery({
    queryKey: ["knowledge-source", project.id],
    queryFn: () => api.get<KnowledgeSource | null>(scoped("/api/v1/knowledge/source", project.id)),
    refetchInterval: (query) => (query.state.data?.syncing ? 3000 : false),
  });
  const editor = useDisclosure();
  const sourceEditor = useDisclosure();
  const [editing, setEditing] = useState<KnowledgeEntry>();
  const [deleting, setDeleting] = useState<string>();
  const [indexing, setIndexing] = useState<{ done: number; total: number }>();
  const [syncing, setSyncing] = useState(false);
  const reload = () => client.invalidateQueries({ queryKey: ["payloads", project.id] });

  const mode = model.data?.knowledgeMode ?? "full";
  const list = entries.data ?? [];
  const pending = list.filter((entry) => !entry.indexed);

  const remove = async (entry: KnowledgeEntry) => {
    if (!confirm(`删除条目「${entry.name}」？`)) return;
    setDeleting(entry.id);
    try {
      await api.post("/api/v1/deleteProjectPayload", { payload_id: entry.id });
      await reload();
      notify.success("已删除");
    } catch (error) {
      notify.error(error);
    } finally {
      setDeleting(undefined);
    }
  };

  const index = async (targets: KnowledgeEntry[]) => {
    setIndexing({ done: 0, total: targets.length });
    let failed = 0;
    for (const [position, entry] of targets.entries()) {
      try {
        await api.post("/api/v1/knowledge/index", { project_id: project.id, payload_id: entry.id });
      } catch (error) {
        failed++;
        if (failed === 1) notify.error(error);
      }
      setIndexing({ done: position + 1, total: targets.length });
    }
    await reload();
    setIndexing(undefined);
    if (!failed) notify.success(`已生成 ${targets.length} 条向量`);
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { message } = await api.post(scoped("/api/v1/knowledge/source/sync", project.id), {});
      notify.success(message);
      await client.invalidateQueries({ queryKey: ["knowledge-source", project.id] });
    } catch (error) {
      notify.error(error);
    } finally {
      setSyncing(false);
    }
  };

  const sourceStatus = source.data
    ? source.data.syncing
      ? "正在同步…"
      : [
          source.data.enabled ? `每 ${source.data.intervalMinutes} 分钟同步` : "定时同步已关闭",
          source.data.lastSuccess && `上次成功 ${formatTime(source.data.lastSuccess)}`,
          source.data.lastMessage,
        ]
          .filter(Boolean)
          .join(" · ")
    : "未配置，可从 V2Board 自动同步教程";

  return (
    <PanelCard
      title="知识库"
      description={
        <>
          {modeText[mode](model.data?.knowledgeMaxChars ?? 16000)}{" "}
          <Link href="/settings/ai" size="sm" className="text-small">
            更改
          </Link>
        </>
      }
      actions={
        <Button
          className="bg-foreground text-background"
          startContent={<RiAddLine className="h-4 w-4" />}
          onPress={() => {
            setEditing(undefined);
            editor.onOpen();
          }}
        >
          添加条目
        </Button>
      }
    >
      <SettingRow title="文档同步" description={sourceStatus}>
        <div className="flex gap-2">
          {source.data && (
            <Button
              variant="flat"
              isLoading={syncing || source.data.syncing}
              startContent={!(syncing || source.data.syncing) && <RiRefreshLine className="h-4 w-4" />}
              onPress={syncNow}
            >
              立即同步
            </Button>
          )}
          <Button variant="flat" startContent={<RiSettings3Line className="h-4 w-4" />} onPress={sourceEditor.onOpen}>
            {source.data ? "设置" : "配置来源"}
          </Button>
        </div>
      </SettingRow>

      {mode === "vector" && (
        <SettingRow
          title="向量索引"
          description={
            indexing
              ? `正在生成 ${indexing.done} / ${indexing.total}`
              : `已索引 ${list.length - pending.length} / ${list.length} 条；更换向量模型后需全部重新生成`
          }
        >
          {indexing ? (
            <Progress aria-label="生成进度" className="w-full sm:w-56" value={(indexing.done / indexing.total) * 100} />
          ) : (
            <div className="flex gap-2">
              <Button variant="flat" isDisabled={!list.length} onPress={() => index(list)}>
                全部重新生成
              </Button>
              <Button color="primary" variant="flat" isDisabled={!pending.length} onPress={() => index(pending)}>
                生成待索引（{pending.length}）
              </Button>
            </div>
          )}
        </SettingRow>
      )}

      <Section title={`资料条目（${list.length}）`}>
        <Table
          aria-label="知识库条目"
          removeWrapper
          classNames={{ base: "overflow-x-auto rounded-medium bg-content2 p-2", td: "align-top" }}
        >
          <TableHeader>
            <TableColumn>名称</TableColumn>
            <TableColumn>内容</TableColumn>
            <TableColumn className="w-40">更新时间</TableColumn>
            <TableColumn className="w-24" align="end">
              操作
            </TableColumn>
          </TableHeader>
          <TableBody
            isLoading={entries.isPending}
            loadingContent="正在读取…"
            emptyContent={entries.isError ? (entries.error as Error).message : "还没有资料，点击右上角添加"}
          >
            {list.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <div className="flex max-w-56 flex-col items-start gap-1">
                    <span className="font-medium">{entry.name}</span>
                    <div className="flex gap-1">
                      {entry.synced && (
                        <Chip size="sm" variant="flat" color="primary">
                          同步
                        </Chip>
                      )}
                      {mode === "vector" && !entry.indexed && (
                        <Chip size="sm" variant="flat" color="warning">
                          待索引
                        </Chip>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="line-clamp-2 max-w-md text-small text-default-500" title={entry.raw}>
                    {entry.raw}
                  </p>
                </TableCell>
                <TableCell className="whitespace-nowrap text-small text-default-500">{formatTime(entry.created_at)}</TableCell>
                <TableCell>
                  {entry.synced ? (
                    <span className="text-tiny text-default-400">由同步维护</span>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Tooltip content="编辑">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          aria-label="编辑"
                          onPress={() => {
                            setEditing(entry);
                            editor.onOpen();
                          }}
                        >
                          <RiEdit2Line className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="删除" color="danger">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="danger"
                          aria-label="删除"
                          isLoading={deleting === entry.id}
                          onPress={() => remove(entry)}
                        >
                          <RiDeleteBin2Line className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <EntryEditor projectId={project.id} entry={editing} isOpen={editor.isOpen} onOpenChange={editor.onOpenChange} onSaved={reload} />
      <SourceEditor projectId={project.id} source={source.data} isOpen={sourceEditor.isOpen} onOpenChange={sourceEditor.onOpenChange} />
    </PanelCard>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Select, SelectItem, Textarea } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, scoped } from "../../api";
import type { OptionCard, Project, Trigger, TriggerType } from "../../types";

const same = <T,>(value: T) => value;

// `prepare` decorates the server value for editing (e.g. list keys) and
// `strip` removes those decorations again before comparing.
export function useDraft<S, D = S>(
  server: S,
  prepare: (value: S) => D = same as (value: S) => D,
  strip: (value: D) => S = same as (value: D) => S,
) {
  const snapshot = JSON.stringify(server);
  const [draft, setDraft] = useState<D>(() => prepare(server));
  useEffect(() => {
    setDraft(prepare(JSON.parse(snapshot)));
  }, [snapshot]);
  const dirty = useMemo(
    () => JSON.stringify(strip(draft)) !== snapshot,
    [draft, snapshot],
  );
  const reset = () => setDraft(prepare(JSON.parse(snapshot)));
  return [draft, setDraft, dirty, reset] as const;
}

export function useOptionCards(projectId: string) {
  return useQuery({
    queryKey: ["options", projectId],
    queryFn: () =>
      api.get<OptionCard[]>(scoped("/api/v1/options", projectId)),
  });
}

export function useRefreshProject(projectId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["project", projectId] }),
      client.invalidateQueries({ queryKey: ["projects"] }),
    ]);
}

export type TabProps = { project: Project };

const triggerLabels: Record<TriggerType, string> = {
  none: "无动作",
  text: "回复文字",
  option: "回复选项卡片",
  closeAI: "关闭智能回复",
};

export function cleanTrigger<T extends Trigger>(trigger: T): T {
  const { text, optionId, ...rest } = trigger;
  return {
    ...rest,
    ...(trigger.type === "text" ? { text } : {}),
    ...(trigger.type === "option" ? { optionId } : {}),
  } as T;
}

export function TriggerFields({
  value,
  onChange,
  options,
  types = ["none", "text", "option", "closeAI"],
  labelPlacement = "inside",
}: {
  value: Trigger;
  onChange: (value: Trigger) => void;
  options: OptionCard[];
  types?: TriggerType[];
  labelPlacement?: "inside" | "outside";
}) {
  return (
    <>
      <Select
        className="w-full sm:w-48"
        label="触发动作"
        labelPlacement={labelPlacement}
        variant="bordered"
        disallowEmptySelection
        selectedKeys={[value.type]}
        onSelectionChange={(keys) => {
          const type = Array.from(keys)[0] as TriggerType | undefined;
          if (type) onChange({ ...value, type });
        }}
      >
        {types.map((type) => (
          <SelectItem key={type}>{triggerLabels[type]}</SelectItem>
        ))}
      </Select>
      {value.type === "text" && (
        <Textarea
          className="w-full sm:w-64"
          label="回复文字"
          labelPlacement={labelPlacement}
          placeholder="请输入回复文字"
          variant="bordered"
          minRows={1}
          maxRows={4}
          value={value.text ?? ""}
          onValueChange={(text) => onChange({ ...value, text })}
        />
      )}
      {value.type === "option" && (
        <Select
          className="w-full sm:w-64"
          label="选项卡片"
          labelPlacement={labelPlacement}
          placeholder={options.length ? "选择卡片" : "请先在「选项管理」创建"}
          variant="bordered"
          isDisabled={!options.length}
          selectedKeys={value.optionId ? [value.optionId] : []}
          onSelectionChange={(keys) => {
            const optionId = Array.from(keys)[0] as string | undefined;
            if (optionId) onChange({ ...value, optionId });
          }}
          items={options.filter((option) => option.id)}
        >
          {(option) => <SelectItem key={option.id!}>{option.name}</SelectItem>}
        </Select>
      )}
    </>
  );
}

export function formatTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

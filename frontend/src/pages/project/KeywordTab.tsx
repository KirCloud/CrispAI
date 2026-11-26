import { useMemo, useState } from "react";
import { Button, Input, Switch } from "@heroui/react";
import { RiAddLine, RiDeleteBin2Line, RiDraggable } from "@remixicon/react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../api";
import { useDirty } from "../../dirty";
import { notify, PanelCard, SettingRow, successSwitch } from "../../components/ui";
import type { Keyword, OptionCard } from "../../types";
import { cleanTrigger, TriggerFields, useDraft, useOptionCards, useRefreshProject, type TabProps } from "./shared";

type Row = Keyword & { key: string };

const isValidPattern = (pattern: string) => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

function KeywordRow({
  row,
  matched,
  options,
  onChange,
  onRemove,
}: {
  row: Row;
  matched: boolean;
  options: OptionCard[];
  onChange: (row: Row) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key });
  const invalid = row.keyword !== "" && !isValidPattern(row.keyword);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex flex-col gap-3 rounded-medium bg-content2 p-3 sm:flex-row sm:items-start"
    >
      <div className="flex flex-1 items-start gap-2">
        <button
          type="button"
          className="mt-4 cursor-grab touch-none text-default-400"
          aria-label="拖动排序"
          {...attributes}
          {...listeners}
        >
          <RiDraggable className="h-5 w-5" />
        </button>
        <Input
          label="关键词（正则）"
          variant="bordered"
          color={matched ? "success" : "default"}
          classNames={{ inputWrapper: matched ? "border-success data-[hover=true]:border-success" : "" }}
          value={row.keyword}
          onValueChange={(keyword) => onChange({ ...row, keyword })}
          isInvalid={invalid}
          errorMessage="不是合法的正则表达式"
        />
      </div>
      <TriggerFields value={row} onChange={(trigger) => onChange({ ...row, ...trigger })} options={options} />
      {(row.type === "none" || row.type === "closeAI") && <div className="hidden sm:block sm:w-64" />}
      <Button isIconOnly color="danger" variant="light" aria-label="删除关键词" className="self-end sm:mt-2 sm:self-start" onPress={onRemove}>
        <RiDeleteBin2Line className="h-4 w-4" />
      </Button>
    </li>
  );
}

let nextKey = 0;
const withKeys = (rows: Keyword[]): Row[] => rows.map((row) => ({ ...row, key: `k${nextKey++}` }));
type Server = { enabled: boolean; rows: Keyword[] };
const prepare = (value: Server) => ({ ...value, rows: withKeys(value.rows) });
const strip = (value: { enabled: boolean; rows: Row[] }): Server => ({
  ...value,
  rows: value.rows.map(({ key, ...row }) => row),
});

export function KeywordTab({ project }: TabProps) {
  const refresh = useRefreshProject(project.id);
  const options = useOptionCards(project.id);
  const [draft, setDraft, dirty, reset] = useDraft(
    { enabled: project.enableKeyword, rows: project.keyword ?? [] },
    prepare,
    strip,
  );
  useDirty(dirty);
  const keyed = draft.rows;
  const [probe, setProbe] = useState("");
  const [saving, setSaving] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const update = (rows: Row[]) => setDraft((value) => ({ ...value, rows }));
  const matchedIndex = useMemo(() => {
    if (!probe) return -1;
    return keyed.findIndex((row) => row.keyword && isValidPattern(row.keyword) && new RegExp(row.keyword).test(probe));
  }, [probe, keyed]);

  const save = async () => {
    const rows = strip(draft).rows.filter((row) => row.keyword.trim());
    if (rows.some((row) => !isValidPattern(row.keyword))) return notify.error("有关键词不是合法的正则表达式");
    if (rows.some((row) => row.type === "text" && !row.text?.trim())) return notify.error("有关键词未填写回复文字");
    if (rows.some((row) => row.type === "option" && !row.optionId)) return notify.error("有关键词未选择选项卡片");
    setSaving(true);
    try {
      await api.post("/api/v1/saveProjectKeyword", {
        project_id: project.id,
        enable: draft.enabled,
        data: rows.map(cleanTrigger),
      });
      await refresh();
      notify.success("自动回复已保存");
    } catch (error) {
      notify.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelCard
      title="关键词自动回复"
      description="收到消息后按顺序匹配关键词，命中第一条即执行，不再交给 AI"
      actions={
        <>
          {dirty && (
            <Button variant="light" onPress={reset} isDisabled={saving}>
              撤销修改
            </Button>
          )}
          <Button className="bg-foreground text-background" isDisabled={!dirty} isLoading={saving} onPress={save}>
            保存设置
          </Button>
        </>
      }
    >
      <SettingRow inline title="启用关键词回复" description="不调用模型，没有 API 费用">
        <Switch
          classNames={successSwitch}
          isSelected={draft.enabled}
          onValueChange={(enabled) => setDraft((value) => ({ ...value, enabled }))}
          aria-label="启用关键词回复"
        />
      </SettingRow>
      <SettingRow
        title="测试匹配"
        description={
          probe
            ? matchedIndex >= 0
              ? `命中第 ${matchedIndex + 1} 条关键词`
              : "没有命中，将交给智能回复"
            : "输入一句访客消息，查看会命中哪条关键词"
        }
      >
        <Input className="w-full sm:w-72" variant="bordered" placeholder="例如：怎么续费" value={probe} onValueChange={setProbe} aria-label="测试消息" isClearable onClear={() => setProbe("")} />
      </SettingRow>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          const from = keyed.findIndex((row) => row.key === active.id);
          const to = keyed.findIndex((row) => row.key === over.id);
          update(arrayMove(keyed, from, to));
        }}
      >
        <SortableContext items={keyed.map((row) => row.key)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {keyed.map((row, index) => (
              <KeywordRow
                key={row.key}
                row={row}
                matched={index === matchedIndex}
                options={options.data ?? []}
                onChange={(next) => update(keyed.map((item) => (item.key === row.key ? next : item)))}
                onRemove={() => update(keyed.filter((item) => item.key !== row.key))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {keyed.length === 0 && <p className="py-6 text-center text-small text-default-400">还没有关键词</p>}
      <Button
        variant="flat"
        className="self-start"
        startContent={<RiAddLine className="h-4 w-4" />}
        isDisabled={keyed.length >= 100}
        onPress={() => update([...keyed, ...withKeys([{ keyword: "", type: "none" }])])}
      >
        添加关键词{keyed.length >= 100 && "（已达 100 条上限）"}
      </Button>
    </PanelCard>
  );
}

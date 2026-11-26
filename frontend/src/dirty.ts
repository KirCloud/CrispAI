import { useEffect, useId, useSyncExternalStore } from "react";
import { useBlocker } from "react-router-dom";

const dirty = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const hasUnsavedChanges = () => dirty.size > 0;

export function useDirty(isDirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (isDirty) dirty.add(id);
    else dirty.delete(id);
    emit();
    return () => {
      dirty.delete(id);
      emit();
    };
  }, [id, isDirty]);
}

export function useUnsavedChangesGuard() {
  const anyDirty = useSyncExternalStore(subscribe, hasUnsavedChanges);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      anyDirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (confirm("有未保存的修改，确定离开吗？")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", handler);
    return () => removeEventListener("beforeunload", handler);
  }, [anyDirty]);
}

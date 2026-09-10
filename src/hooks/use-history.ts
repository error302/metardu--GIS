/**
 * React binding for CommandHistory — mirrors the store's version counter so
 * undo/redo re-renders, while the document itself stays a single immutable
 * reference.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CommandHistory } from "../core/history";

export function useHistoryState<T>(initial: T, initialLabel = "Initial state") {
  const storeRef = useRef<CommandHistory<T> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new CommandHistory<T>(initial, initialLabel);
  }
  const store = storeRef.current;

  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  const push = useCallback(
    (next: T, label: string) => {
      store.push(next, label);
      rerender();
    },
    [store, rerender]
  );

  const reset = useCallback(
    (next: T, label = "Initial state") => {
      store.reset(next, label);
      rerender();
    },
    [store, rerender]
  );

  const undo = useCallback(() => {
    const restored = store.undo();
    rerender();
    return restored;
  }, [store, rerender]);

  const redo = useCallback(() => {
    const restored = store.redo();
    rerender();
    return restored;
  }, [store, rerender]);

  // Global keyboard shortcuts. Editable targets keep their native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (editable) return;

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    state: store.state,
    push,
    reset,
    undo,
    redo,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    undoLabel: store.undoLabel,
    redoLabel: store.redoLabel,
  };
}

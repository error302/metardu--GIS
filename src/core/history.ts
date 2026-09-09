/**
 * Command history over a single immutable document state.
 *
 * A bounded, label-carrying undo/redo stack. The document (PipelineResult)
 * is treated immutably: every mutation pushes a new snapshot reference, so
 * undo/redo is a pointer move. The project file format already models this
 * state shape — this formalizes the discipline.
 */

export interface HistoryEntry<T> {
  state: T;
  label: string;
}

export class CommandHistory<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private current: HistoryEntry<T>;

  constructor(initial: T, label = "Initial state", private cap = 50) {
    this.current = { state: initial, label };
  }

  get state(): T {
    return this.current.state;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Label of the action undo would reverse (the current entry). */
  get undoLabel(): string | null {
    return this.current.label;
  }

  /** Label of the action redo would re-apply. */
  get redoLabel(): string | null {
    return this.future.length > 0 ? this.future[this.future.length - 1].label : null;
  }

  /** Record a new state produced by a named command. Discards the redo branch. */
  push(state: T, label: string): void {
    this.past.push(this.current);
    if (this.past.length > this.cap) this.past.shift();
    this.current = { state, label };
    this.future = [];
  }

  /** Replace the document wholesale (new scenario, opened file) — history resets. */
  reset(state: T, label = "Initial state"): void {
    this.past = [];
    this.future = [];
    this.current = { state, label };
  }

  undo(): T | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.current);
    this.current = prev;
    return this.current.state;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    return this.current.state;
  }
}

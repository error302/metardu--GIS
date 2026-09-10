/**
 * MetaRDU GIS Studio - Command History & Undo/Redo Engine
 * Pure client-side state history manager for geometric editing and CAD operations.
 */

export interface HistoryState<T> {
  description: string;
  data: T;
  timestamp: number;
}

export class HistoryManager<T> {
  private undoStack: HistoryState<T>[] = [];
  private redoStack: HistoryState<T>[] = [];
  private maxHistory: number;

  constructor(maxHistory: number = 50) {
    this.maxHistory = maxHistory;
  }

  /**
   * Push the prior state onto the undo stack before applying a mutation.
   * Clears the redo stack upon new user action.
   */
  public push(description: string, data: T): void {
    // Deep clone data to avoid mutation references
    const snapshot: HistoryState<T> = {
      description,
      data: JSON.parse(JSON.stringify(data)),
      timestamp: Date.now(),
    };

    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Undo to the previous state.
   */
  public undo(currentState: T): { state: T; description: string } | null {
    if (this.undoStack.length === 0) return null;

    // Save current state to redo stack
    this.redoStack.push({
      description: "Current State",
      data: JSON.parse(JSON.stringify(currentState)),
      timestamp: Date.now(),
    });

    const previous = this.undoStack.pop()!;
    return {
      state: previous.data,
      description: previous.description,
    };
  }

  /**
   * Redo an undone state.
   */
  public redo(currentState: T): { state: T; description: string } | null {
    if (this.redoStack.length === 0) return null;

    // Save current state to undo stack
    this.undoStack.push({
      description: "Pre-Redo State",
      data: JSON.parse(JSON.stringify(currentState)),
      timestamp: Date.now(),
    });

    const next = this.redoStack.pop()!;
    return {
      state: next.data,
      description: next.description,
    };
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

// 软件工厂缩小版 · Task 进度 store（SSE task.update / stage.gate 联动）
import { create } from "zustand";

export interface TaskRuntime {
  status: string;
  progress?: number;
  latencyMs?: number;
}

export interface GateInfo {
  from: string;
  to: string;
  blocked?: boolean;
  finalized?: boolean;
  report?: any;
}

interface TaskState {
  tasks: Record<string, TaskRuntime>;
  lastGate: GateInfo | null;
  /** SSE task.update。 */
  update: (id: string, status: string, progress?: number) => void;
  /** SSE stage.gate。 */
  gate: (g: GateInfo) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: {},
  lastGate: null,
  update: (id, status, progress) =>
    set((s) => ({ tasks: { ...s.tasks, [id]: { status, progress } } })),
  gate: (g) => set({ lastGate: g }),
}));

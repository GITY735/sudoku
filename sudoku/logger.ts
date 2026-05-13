import type { SolveStep } from "./trace";
import type { TechniquePriority } from "./types";

// ============================================================
// Logger — 求解过程输出抽象（由宿主注入）
// ============================================================

/**
 * Logger 定义了求解过程的生命周期回调。
 *
 * 框架不关心输出方式是 console / Web UI / 文件 —
 * 由调用方注入具体实现。
 */
export interface Logger {
  /** 求解开始，puzzle 为 81 字符题目串 */
  onSolveStart(puzzle: string): void;

  /** 每步推导成功时回调 */
  onStep(step: SolveStep): void;

  /** 某优先级层级全部技巧均无发现 */
  onLevelExhausted(priority: TechniquePriority): void;

  /** 求解结束，solved 表示是否成功填满 */
  onSolveEnd(steps: readonly SolveStep[], solved: boolean): void;

  /** 回溯开始（不可教学区域入口） */
  onBacktrackStart(depth: number): void;

  /** 回溯过程中的一次猜测 */
  onBacktrackGuess(step: SolveStep): void;

  /** 回溯退出 */
  onBacktrackEnd(solved: boolean): void;
}

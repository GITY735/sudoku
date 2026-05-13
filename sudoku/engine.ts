import type { SolveStep } from "./trace";
import type { Logger } from "./logger";

// ============================================================
// SolveEngine — 求解主循环入口
// ============================================================

/**
 * 求解引擎。
 *
 * 驱动主循环：按 TechniquePriority 层级遍历技巧，
 * 每次推导成功即回到最简单技巧重试（符合人类教学顺序）。
 */
export interface SolveEngine {
  /** 注入 Logger（求解前调用） */
  setLogger(logger: Logger): void;

  /**
   * 求解给定题目。
   *
   * @param puzzle   81 字符题目串，如 "530070000600195000..."
   * @param maxDepth 回溯最大深度，-1 表示不限制
   * @returns 求解步骤序列（教学轨迹）
   */
  solve(puzzle: string, maxDepth?: number): readonly SolveStep[];

  /** 废弃当前求解状态 */
  abort(): void;
}

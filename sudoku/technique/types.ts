import type { TechniquePriority, TechniqueCategory, SolveStepOutcome, CellCoord } from "../types";
import type { CandidateDelta, CandidateSnapshot } from "../candidate";
import type { BoardReadonly } from "../board";

// ============================================================
// TechniqueResult — 单次技巧执行的返回值
// ============================================================

export interface TechniqueResult {
  /** 技巧唯一标识（如 "naked-single"） */
  readonly techniqueId: string;

  /** 技巧名称（中文，教学展示用） */
  readonly techniqueName: string;

  readonly priority: TechniquePriority;

  readonly category: TechniqueCategory;

  readonly outcome: SolveStepOutcome;

  /** 候选数变更 */
  readonly delta: CandidateDelta;

  /** 参与推导的格（用于教学高亮） */
  readonly involvedCells: readonly CellCoord[];

  /** 推导依据：完整自然语言句子（教学直接展示） */
  readonly description: string;
}

// ============================================================
// Technique — 所有技巧模块的统一接口
// ============================================================

/**
 * 每条技巧实现此接口。
 *
 * 约束：
 *   - apply 是纯函数：不修改 board 或 candidates 参数
 *   - 返回 null 表示"该技巧在当前盘面无任何发现"（不应抛异常）
 *   - TechniqueResult.description 必须是完整句子（供教学直接展示）
 */
export interface Technique {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly priority: TechniquePriority;
  readonly category: TechniqueCategory;

  /**
   * 尝试在当前盘面上应用该技巧。
   *
   * @returns TechniqueResult 若有所发现
   * @returns null 若该技巧无任何发现（不产生步骤、不改变状态）
   */
  apply(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null;
}

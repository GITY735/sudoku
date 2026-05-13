import type {
  TechniquePriority,
  TechniqueCategory,
  CellCoord,
  Digit,
} from "./types";
import { TechniquePriority as TP, TechniqueCategory as TC, formatCoord } from "./types";
import type { CandidateDelta, CandidateSnapshot } from "./candidate";
import type { BoardReadonly } from "./board";
import type { Board } from "./board";
import type { CandidateManager } from "./candidate";
import type { TechniqueResult } from "./technique/types";

// ============================================================
// SolveStep — 教学轨迹的不可变单元
// ============================================================

/**
 * 每条 SolveStep 对应一次成功的推导：
 * 一个技巧在一个时刻的发现及其产生的盘面变更。
 *
 * Engine 每推进一次推导即生成一条 SolveStep，
 * 全部步骤构成可回放的求解轨迹。
 */
export interface SolveStep {
  /** 步骤序号（从 1 开始） */
  readonly stepNumber: number;

  readonly techniqueId: string;
  readonly techniqueName: string;
  readonly priority: TechniquePriority;
  readonly category: TechniqueCategory;

  /** 该步骤操作前的盘面快照 */
  readonly boardBefore: BoardReadonly;

  /** 该步骤操作后的盘面快照 */
  readonly boardAfter: BoardReadonly;

  /** 该步骤操作前的候选数快照 */
  readonly candidatesBefore: CandidateSnapshot;

  /** 该步骤操作后的候选数快照 */
  readonly candidatesAfter: CandidateSnapshot;

  /** 本轮候选数变更 */
  readonly delta: CandidateDelta;

  /** 参与推导的格坐标（教学高亮） */
  readonly involvedCells: readonly CellCoord[];

  /** 教学说明文本 */
  readonly description: string;

  /** 是否为回溯猜测步骤 */
  readonly isBacktrack: boolean;

  /** 回溯深度（仅 isBacktrack 时有效） */
  readonly backtrackDepth: number;
}

// ============================================================
// StepRecorder — 步骤记录器
// ============================================================

const PRIORITY_LABEL: Record<number, string> = {
  [TP.Basic]: "基本",
  [TP.Pair]: "数对",
  [TP.Triple]: "三数组",
  [TP.Quad]: "四数组",
  [TP.BasicFish]: "基础鱼",
  [TP.IntermediateChain]: "中级链",
  [TP.AdvancedChain]: "高级链",
  [TP.BruteForce]: "回溯",
};

const CATEGORY_LABEL: Record<string, string> = {
  [TC.Placement]: "填值",
  [TC.Elimination]: "消数",
  [TC.Coloring]: "染色",
  [TC.Chain]: "链",
  [TC.BruteForce]: "回溯",
};

export class StepRecorder {
  private _steps: SolveStep[] = [];
  private _board: Board;
  private _candidates: CandidateManager;

  constructor(board: Board, candidates: CandidateManager) {
    this._board = board;
    this._candidates = candidates;
  }

  // ================================================================
  // 记录
  // ================================================================

  /**
   * 从 TechniqueResult 创建一条 SolveStep。
   *
   * 调用时机：Engine 已执行 Board.place / CandidateManager.applyDelta 之后。
   * 此方法捕捉操作后的盘面和候选数快照。
   */
  commit(result: TechniqueResult, boardBefore: BoardReadonly, candidatesBefore: CandidateSnapshot): SolveStep {
    const step: SolveStep = {
      stepNumber: this._steps.length + 1,
      techniqueId: result.techniqueId,
      techniqueName: result.techniqueName,
      priority: result.priority,
      category: result.category,
      boardBefore,
      boardAfter: this._board.clone(),
      candidatesBefore,
      candidatesAfter: this._candidates.snapshot(),
      delta: result.delta,
      involvedCells: result.involvedCells,
      description: result.description,
      isBacktrack: false,
      backtrackDepth: 0,
    };
    this._steps.push(step);
    return step;
  }

  /**
   * 记录回溯猜测步骤。
   */
  commitBacktrack(
    depth: number,
    guess: { coord: CellCoord; digit: Digit },
    boardBefore: BoardReadonly,
    candidatesBefore: CandidateSnapshot,
    description: string,
  ): SolveStep {
    const step: SolveStep = {
      stepNumber: this._steps.length + 1,
      techniqueId: "backtrack-guess",
      techniqueName: "回溯猜测",
      priority: TP.BruteForce,
      category: TC.BruteForce,
      boardBefore,
      boardAfter: this._board.clone(),
      candidatesBefore,
      candidatesAfter: this._candidates.snapshot(),
      delta: {
        placement: { coord: guess.coord, digit: guess.digit },
        eliminations: [],
        contradictions: [],
        nakedSingles: [],
      },
      involvedCells: [guess.coord],
      description,
      isBacktrack: true,
      backtrackDepth: depth,
    };
    this._steps.push(step);
    return step;
  }

  // ================================================================
  // 查询
  // ================================================================

  get steps(): readonly SolveStep[] {
    return this._steps;
  }

  get stepCount(): number {
    return this._steps.length;
  }

  lastStep(): SolveStep | undefined {
    return this._steps[this._steps.length - 1];
  }

  // ================================================================
  // 纯文本输出（无需外部 Formatter 时的兜底）
  // ================================================================

  /**
   * 生成可阅读的解题轨迹文本。
   */
  toText(): string {
    if (this._steps.length === 0) return "(无步骤)";

    const lines: string[] = [];
    lines.push(`解题轨迹 — 共 ${this._steps.length} 步`);
    lines.push("");

    for (const s of this._steps) {
      const prio = PRIORITY_LABEL[s.priority] ?? `L${s.priority}`;
      const cat = CATEGORY_LABEL[s.category] ?? s.category;
      const prefix = s.isBacktrack ? "  [回溯] " : "  ";

      lines.push(`第 ${s.stepNumber} 步${prefix}[${s.techniqueName} · ${prio} · ${cat}]`);

      if (s.delta.placement) {
        const p = s.delta.placement;
        lines.push(`    填值: ${formatCoord(p.coord)} ← ${p.digit}`);
      }

      if (s.delta.eliminations.length > 0) {
        const items = s.delta.eliminations.map(
          (e) => `${formatCoord(e.coord)}·${e.digit}`,
        );
        // 每行最多 10 个
        for (let i = 0; i < items.length; i += 10) {
          const chunk = items.slice(i, i + 10).join(", ");
          const label = i === 0 ? "    消去: " : "          ";
          lines.push(label + chunk);
        }
      }

      if (s.delta.nakedSingles.length > 0) {
        const items = s.delta.nakedSingles.map(
          (n) => `${formatCoord(n.coord)}→${n.digit}`,
        );
        lines.push(`    出现裸单一: ${items.join(", ")}`);
      }

      if (s.delta.contradictions.length > 0) {
        const items = s.delta.contradictions.map(
          (c) => formatCoord(c),
        );
        lines.push(`    ⚠ 矛盾: ${items.join(", ")}`);
      }

      lines.push(`    依据: ${s.description}`);
      lines.push("");
    }

    return lines.join("\n");
  }
}

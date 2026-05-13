import { Board } from "./board";
import { CandidateManager } from "./candidate";
import { mergeDeltas } from "./candidate";
import { TechniqueManager } from "./technique/manager";
import {
  NakedSingleTechnique,
  HiddenSingleTechnique,
  NakedPairTechnique,
  HiddenPairTechnique,
  PointingPairTechnique,
  NakedTripleTechnique,
  HiddenTripleTechnique,
  BoxLineTechnique,
  NakedQuadTechnique,
  HiddenQuadTechnique,
  XWingTechnique,
  SwordfishTechnique,
  JellyfishTechnique,
  YWingTechnique,
  XYZWingTechnique,
  SimpleColoringTechnique,
  XYChainTechnique,
  MedusaTechnique,
  AICTechnique,
  EmptyRectangleTechnique,
  UniqueRectangleTechnique,
  ForcingChainTechnique,
} from "./technique";
import { StepRecorder } from "./trace";
import { TraceFormatter } from "./trace-formatter";
import type { SolveStep } from "./trace";
import type { Logger } from "./logger";
import type { SolveEngine } from "./engine";
import type { TechniqueResult } from "./technique/types";
import type { CandidateDelta } from "./candidate";
import type { BoardReadonly } from "./board";
import type { CandidateSnapshot } from "./candidate";

// ============================================================
// SudokuEngine
// ============================================================

export class SudokuEngine implements SolveEngine {
  private _mgr: TechniqueManager;
  private _logger: Logger | null = null;
  private _aborted = false;

  constructor(mgr: TechniqueManager) {
    this._mgr = mgr;
  }

  setLogger(logger: Logger): void {
    this._logger = logger;
  }

  solve(puzzle: string, _maxDepth: number = -1): readonly SolveStep[] {
    this._aborted = false;

    const board = new Board(puzzle);
    const cm = new CandidateManager(board);
    const rec = new StepRecorder(board, cm);

    this._logger?.onSolveStart(puzzle);

    this._mgr.setEvents({
      onLevelExhausted: (priority) => {
        this._logger?.onLevelExhausted(priority);
      },
    });

    while (!board.isSolved() && !this._aborted) {
      const candidatesBefore = cm.snapshot();
      const boardBefore = board.clone();

      const result = this._mgr.next(board, candidatesBefore);

      if (!result) {
        break;
      }

      const appliedDelta = this._apply(board, cm, result);

      const mergedResult: TechniqueResult = {
        ...result,
        delta: appliedDelta,
      };

      rec.commit(mergedResult, boardBefore, candidatesBefore);
      this._logger?.onStep(rec.lastStep()!);
    }

    const steps = rec.steps;
    this._logger?.onSolveEnd(steps, board.isSolved());

    return steps;
  }

  abort(): void {
    this._aborted = true;
  }

  // ================================================================
  // 内部：应用结果
  // ================================================================

  private _apply(
    board: Board,
    cm: CandidateManager,
    result: TechniqueResult,
  ): CandidateDelta {
    const deltas: CandidateDelta[] = [result.delta];

    // 填值 → 传播
    if (result.delta.placement) {
      const { coord, digit } = result.delta.placement;
      board.place(coord, digit);
      const propagationDelta = cm.setValue(coord, digit);
      deltas.push(propagationDelta);
    }
    // 纯消数
    else if (result.delta.eliminations.length > 0) {
      cm.applyDelta(result.delta);
    }

    return mergeDeltas(deltas);
  }
}

// ============================================================
// 便捷工厂
// ============================================================

/** 创建预注册 3 条基础技巧的引擎。 */
export function createEngine(): SudokuEngine {
  const mgr = new TechniqueManager();
  // Basic (0)
  mgr.register(new NakedSingleTechnique());
  mgr.register(new HiddenSingleTechnique());
  // Pair (1)
  mgr.register(new NakedPairTechnique());
  mgr.register(new HiddenPairTechnique());
  mgr.register(new PointingPairTechnique());
  // Triple (2)
  mgr.register(new NakedTripleTechnique());
  mgr.register(new HiddenTripleTechnique());
  mgr.register(new BoxLineTechnique());
  // Quad (3)
  mgr.register(new NakedQuadTechnique());
  mgr.register(new HiddenQuadTechnique());
  // BasicFish (4)
  mgr.register(new XWingTechnique());
  mgr.register(new SwordfishTechnique());
  mgr.register(new JellyfishTechnique());
  // IntermediateChain (5)
  mgr.register(new YWingTechnique());
  mgr.register(new XYZWingTechnique());
  mgr.register(new SimpleColoringTechnique());
  // AdvancedChain (6)
  mgr.register(new XYChainTechnique());
  mgr.register(new MedusaTechnique());
  mgr.register(new AICTechnique());
  mgr.register(new EmptyRectangleTechnique());
  mgr.register(new UniqueRectangleTechnique());
  mgr.register(new ForcingChainTechnique());
  return new SudokuEngine(mgr);
}

/**
 * 一键求解，返回中文教学轨迹文本。
 * 高级技巧可通过 `engine` 参数注册后使用。
 */
export function solve(puzzle: string, engine?: SudokuEngine): string {
  const eng = engine ?? createEngine();
  const steps = eng.solve(puzzle);

  if (steps.length === 0) {
    return "(无步骤)";
  }

  const fmt = new TraceFormatter(steps);
  return fmt.detailed() + "\n" + fmt.summary();
}

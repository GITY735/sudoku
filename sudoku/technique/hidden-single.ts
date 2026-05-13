import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// HiddenSingleFinding
// ============================================================

interface HiddenSingleFinding {
  coord: CellCoord;
  digit: Digit;
  unitType: "row" | "col" | "box";
  unitIndex: number;
}

const UNIT_LABEL: Record<string, string> = {
  row: "行",
  col: "列",
  box: "宫",
};

// ============================================================
// HiddenSingleTechnique
// ============================================================

/**
 * 摒除法 (Hidden Single)。
 *
 * 规则：在某行/列/宫中，一个数字只出现在一格候选数中，
 * 则该格必为此数字。
 */
export class HiddenSingleTechnique implements Technique {
  readonly id = "hidden-single";
  readonly name = "摒除法";
  readonly nameEn = "Hidden Single";
  readonly priority = TechniquePriority.Basic;
  readonly category = TechniqueCategory.Placement;

  // ================================================================
  // Technique 接口
  // ================================================================

  apply(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null {
    const findings = this.detect(board, candidates);
    if (findings.length === 0) return null;

    const target = findings[0]!;
    return this.buildResult(target, board, candidates);
  }

  // ================================================================
  // 检测
  // ================================================================

  /**
   * 扫描全部 27 个单元（9 行 + 9 列 + 9 宫），
   * 返回所有 Hidden Single 发现。
   */
  detect(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): HiddenSingleFinding[] {
    const results: HiddenSingleFinding[] = [];

    // 行
    for (let i = 0; i < 9; i++) {
      this._scanUnit("row", i as RowIndex, board, candidates, results);
    }

    // 列
    for (let i = 0; i < 9; i++) {
      this._scanUnit("col", i as ColIndex, board, candidates, results);
    }

    // 宫
    for (let i = 0; i < 9; i++) {
      this._scanUnit("box", i as BoxIndex, board, candidates, results);
    }

    return results;
  }

  /**
   * 在指定单元（行/列/宫）中检测隐藏唯一。
   * 有 → 返回找到的格和数字；无 → 返回 null。
   */
  detectInUnit(
    unitType: "row" | "col" | "box",
    unitIndex: number,
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): HiddenSingleFinding | null {
    const results: HiddenSingleFinding[] = [];
    this._scanUnit(unitType, unitIndex, board, candidates, results);
    return results[0] ?? null;
  }

  /**
   * 在指定格所在的所有单元中检测：该格是否有数字仅在此格出现。
   * 返回找到的第一个隐藏唯一，无则 null。
   */
  detectForCell(
    coord: CellCoord,
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): HiddenSingleFinding | null {
    if (board.getCell(coord).value !== 0) return null;

    const cellDigits = candidates.getDigits(coord);
    const box = board.getCell(coord).box;

    for (const digit of cellDigits) {
      // 检查该行
      const rowPos = candidates.getDigitPositionsInUnit(digit, "row", coord[0]);
      if (rowPos.length === 1) {
        return { coord, digit, unitType: "row", unitIndex: coord[0] };
      }

      // 检查该列
      const colPos = candidates.getDigitPositionsInUnit(digit, "col", coord[1]);
      if (colPos.length === 1) {
        return { coord, digit, unitType: "col", unitIndex: coord[1] };
      }

      // 检查该宫
      const boxPos = candidates.getDigitPositionsInUnit(digit, "box", box);
      if (boxPos.length === 1) {
        return { coord, digit, unitType: "box", unitIndex: box };
      }
    }

    return null;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  /**
   * 生成自然语言教学说明。
   */
  explanation(finding: HiddenSingleFinding): string {
    const { coord, digit, unitType, unitIndex } = finding;
    const label = UNIT_LABEL[unitType] ?? unitType;
    const index = unitIndex + 1; // 展示用 1-based

    return `在第 ${index} ${label}，数字 ${digit} 只能出现在 ${formatCoord(coord)}`;
  }

  // ================================================================
  // 内部
  // ================================================================

  private _scanUnit(
    unitType: "row" | "col" | "box",
    unitIndex: number,
    _board: BoardReadonly,
    candidates: CandidateSnapshot,
    out: HiddenSingleFinding[],
  ): void {
    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      const positions = candidates.getDigitPositionsInUnit(
        digit,
        unitType,
        unitIndex,
      );
      if (positions.length === 1) {
        out.push({
          coord: positions[0]!,
          digit,
          unitType,
          unitIndex,
        });
      }
    }
  }

  private buildResult(
    finding: HiddenSingleFinding,
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult {
    const { coord, digit } = finding;
    const peers = board.getPeers(coord);

    // 预计算：填入此数字后消去的候选数
    const affectedPeers: CellCoord[] = [];
    for (const p of peers) {
      if (candidates.has(p, digit)) {
        affectedPeers.push(p);
      }
    }

    const description = this.explanation(finding);

    return {
      techniqueId: this.id,
      techniqueName: this.name,
      priority: this.priority,
      category: this.category,
      outcome: SolveStepOutcome.Progressed,
      delta: {
        placement: { coord, digit },
        eliminations: affectedPeers.map((p) => ({ coord: p, digit })),
        contradictions: [],
        nakedSingles: [],
      },
      involvedCells: positionsInUnit(finding.unitType, finding.unitIndex).filter(
        (c) => candidates.has(c, finding.digit),
      ),
      description,
    };
  }
}

// ============================================================
// 工具：获取某单元的全部格坐标
// ============================================================

function positionsInUnit(
  unitType: "row" | "col" | "box",
  index: number,
): CellCoord[] {
  const coords: CellCoord[] = [];
  if (unitType === "row") {
    for (let c = 0; c < 9; c++) {
      coords.push([index as RowIndex, c as ColIndex]);
    }
  } else if (unitType === "col") {
    for (let r = 0; r < 9; r++) {
      coords.push([r as RowIndex, index as ColIndex]);
    }
  } else {
    const sr = Math.floor(index / 3) * 3;
    const sc = (index % 3) * 3;
    for (let r = sr; r < sr + 3; r++) {
      for (let c = sc; c < sc + 3; c++) {
        coords.push([r as RowIndex, c as ColIndex]);
      }
    }
  }
  return coords;
}

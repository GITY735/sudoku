import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// PointingPairFinding
// ============================================================

interface PointingPairFinding {
  /** 被区块指向的数字 */
  digit: Digit;
  /** 所在宫索引 */
  boxIndex: BoxIndex;
  /** 区块所在的行/列类型 */
  lineType: "row" | "col";
  /** 区块所在的行/列索引 */
  lineIndex: number;
  /** 宫内包含该数字的格（区块格） */
  boxCells: CellCoord[];
  /** 将被消去该候选数的格（同行/列但不在本宫内） */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// PointingPairTechnique
// ============================================================

/**
 * 区块摒除 (Pointing Pair / Intersection Removal)。
 *
 * 规则：在某宫中，一个数字的所有候选数都局限于同一行（或同一列），
 * 则该行（或列）中其他宫的同数字候选数可被消去。
 *
 * 优先级：Pair (1)，归类：Elimination。
 */
export class PointingPairTechnique implements Technique {
  readonly id = "pointing-pair";
  readonly name = "区块摒除";
  readonly nameEn = "Pointing Pair";
  readonly priority = TechniquePriority.Pair;
  readonly category = TechniqueCategory.Elimination;

  // ================================================================
  // Technique 接口
  // ================================================================

  apply(
    _board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null {
    const findings = this.detect(candidates);
    if (findings.length === 0) return null;

    findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
    return this.buildResult(findings[0]!);
  }

  // ================================================================
  // 检测
  // ================================================================

  /**
   * 扫描全部 9 个宫，返回所有区块摒除发现。
   */
  detect(candidates: CandidateSnapshot): PointingPairFinding[] {
    const results: PointingPairFinding[] = [];

    for (let i = 0; i < 9; i++) {
      this._scanBox(i as BoxIndex, candidates, results);
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: PointingPairFinding): string {
    const { digit, boxIndex, lineType, lineIndex } = finding;
    const boxLabel = boxIndex + 1;
    const lineLabel = lineType === "row" ? "行" : "列";
    const lineIdx = lineIndex + 1;

    return (
      `在第 ${boxLabel} 宫，数字 ${digit} ` +
      `只能出现在第 ${lineIdx} ${lineLabel}，` +
      `因此可从第 ${lineIdx} ${lineLabel}其他格中消去 ${digit}`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  private _scanBox(
    boxIndex: BoxIndex,
    candidates: CandidateSnapshot,
    out: PointingPairFinding[],
  ): void {
    const coords = this._getUnitCoords("box", boxIndex);

    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      const boxCells: CellCoord[] = [];
      for (const coord of coords) {
        if (candidates.has(coord, digit)) {
          boxCells.push(coord);
        }
      }

      if (boxCells.length === 0) continue;

      // 检查是否所有格在同一行
      const rows = new Set(boxCells.map((c) => c[0]));
      if (rows.size === 1) {
        const row = boxCells[0]![0] as RowIndex;
        const eliminations = this._collectLineEliminations(
          "row",
          row,
          boxIndex,
          digit,
          candidates,
        );
        if (eliminations.length > 0) {
          out.push({
            digit,
            boxIndex,
            lineType: "row",
            lineIndex: row,
            boxCells,
            eliminations,
          });
        }
      }

      // 检查是否所有格在同一列
      const cols = new Set(boxCells.map((c) => c[1]));
      if (cols.size === 1) {
        const col = boxCells[0]![1] as ColIndex;
        const eliminations = this._collectLineEliminations(
          "col",
          col,
          boxIndex,
          digit,
          candidates,
        );
        if (eliminations.length > 0) {
          out.push({
            digit,
            boxIndex,
            lineType: "col",
            lineIndex: col,
            boxCells,
            eliminations,
          });
        }
      }
    }
  }

  /**
   * 收集同行/列但不在目标宫内的待消去格。
   */
  private _collectLineEliminations(
    lineType: "row" | "col",
    lineIndex: number,
    boxIndex: BoxIndex,
    digit: Digit,
    candidates: CandidateSnapshot,
  ): { coord: CellCoord; digit: Digit }[] {
    const eliminations: { coord: CellCoord; digit: Digit }[] = [];
    const lineCoords = this._getUnitCoords(lineType, lineIndex);

    for (const coord of lineCoords) {
      // 通过行列坐标计算宫索引
      const cb = Math.floor(coord[0] / 3) * 3 + Math.floor(coord[1] / 3);
      if (cb === boxIndex) continue; // 跳过本宫
      if (candidates.has(coord, digit)) {
        eliminations.push({ coord, digit });
      }
    }

    return eliminations;
  }

  private _getUnitCoords(
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

  private buildResult(finding: PointingPairFinding): TechniqueResult {
    return {
      techniqueId: this.id,
      techniqueName: this.name,
      priority: this.priority,
      category: this.category,
      outcome: SolveStepOutcome.Progressed,
      delta: {
        placement: null,
        eliminations: finding.eliminations,
        contradictions: [],
        nakedSingles: [],
      },
      involvedCells: finding.boxCells,
      description: this.explanation(finding),
    };
  }
}

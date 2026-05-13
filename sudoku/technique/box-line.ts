import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// BoxLineFinding
// ============================================================

interface BoxLineFinding {
  /** 被归约的数字 */
  digit: Digit;
  /** 行或列 */
  lineType: "row" | "col";
  /** 行/列索引 */
  lineIndex: number;
  /** 该行/列中候选数所在宫索引 */
  boxIndex: BoxIndex;
  /** 行/列中包含该数字的格（均在同一宫内） */
  lineCells: CellCoord[];
  /** 宫内但不在该行/列中、将被消去的格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// BoxLineTechnique
// ============================================================

/**
 * 行列区块删减法 (Box-Line Reduction / Locked Candidates Type 2)。
 *
 * 规则：在某行/列中，一个数字的所有候选数都局限于同一宫，
 * 则该宫中不在该行/列的其他格的该数字候选数可被消去。
 *
 * 优先级：Triple (2)，归类：Elimination。
 */
export class BoxLineTechnique implements Technique {
  readonly id = "box-line";
  readonly name = "行列区块删减法";
  readonly nameEn = "Box-Line Reduction";
  readonly priority = TechniquePriority.Triple;
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
   * 扫描全部 9 行和 9 列，返回所有行列区块发现。
   */
  detect(candidates: CandidateSnapshot): BoxLineFinding[] {
    const results: BoxLineFinding[] = [];

    for (let i = 0; i < 9; i++) {
      this._scanLine("row", i as RowIndex, candidates, results);
      this._scanLine("col", i as ColIndex, candidates, results);
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: BoxLineFinding): string {
    const { digit, lineType, lineIndex, boxIndex } = finding;
    const lineLabel = lineType === "row" ? "行" : "列";
    const lineIdx = lineIndex + 1;
    const boxLabel = boxIndex + 1;

    return (
      `在第 ${lineIdx} ${lineLabel}，数字 ${digit} ` +
      `只能出现在第 ${boxLabel} 宫，` +
      `因此可从第 ${boxLabel} 宫其他格中消去 ${digit}`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  private _scanLine(
    lineType: "row" | "col",
    lineIndex: number,
    candidates: CandidateSnapshot,
    out: BoxLineFinding[],
  ): void {
    const coords = this._getUnitCoords(lineType, lineIndex);

    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      const lineCells: CellCoord[] = [];
      for (const coord of coords) {
        if (candidates.has(coord, digit)) {
          lineCells.push(coord);
        }
      }

      if (lineCells.length === 0) continue;

      // 计算每个格所在的宫索引，检查是否全部在同一宫
      const boxSet = new Set(
        lineCells.map(
          (c) => Math.floor(c[0] / 3) * 3 + Math.floor(c[1] / 3),
        ),
      );

      if (boxSet.size !== 1) continue;

      const boxIndex = lineCells[0]!
        ? (Math.floor(lineCells[0]![0] / 3) * 3 +
            Math.floor(lineCells[0]![1] / 3))
        : 0;

      // 消去：该宫内不在本行/列的其他格
      const eliminations = this._collectBoxEliminations(
        boxIndex as BoxIndex,
        lineType,
        lineIndex,
        digit,
        candidates,
      );

      if (eliminations.length > 0) {
        out.push({
          digit,
          lineType,
          lineIndex,
          boxIndex: boxIndex as BoxIndex,
          lineCells,
          eliminations,
        });
      }
    }
  }

  /**
   * 收集目标宫内不在指定行/列中的待消去格。
   */
  private _collectBoxEliminations(
    boxIndex: BoxIndex,
    lineType: "row" | "col",
    lineIndex: number,
    digit: Digit,
    candidates: CandidateSnapshot,
  ): { coord: CellCoord; digit: Digit }[] {
    const eliminations: { coord: CellCoord; digit: Digit }[] = [];
    const boxCoords = this._getUnitCoords("box", boxIndex);

    for (const coord of boxCoords) {
      // 跳过行/列内的格
      if (lineType === "row" && coord[0] === lineIndex) continue;
      if (lineType === "col" && coord[1] === lineIndex) continue;
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

  private buildResult(finding: BoxLineFinding): TechniqueResult {
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
      involvedCells: finding.lineCells,
      description: this.explanation(finding),
    };
  }
}

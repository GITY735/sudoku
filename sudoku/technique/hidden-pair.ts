import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import { CandidateMask as CM } from "../types";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// HiddenPairFinding
// ============================================================

interface HiddenPairFinding {
  /** 构成隐性数对的两个数字 */
  digits: [Digit, Digit];
  /** 所在单元类型 */
  unitType: "row" | "col" | "box";
  /** 单元索引 */
  unitIndex: number;
  /** 构成隐性数对的两格 */
  pairCells: [CellCoord, CellCoord];
  /** 这两格中将被消去的其他候选数 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

const UNIT_LABEL: Record<string, string> = {
  row: "行",
  col: "列",
  box: "宫",
};

// ============================================================
// HiddenPairTechnique
// ============================================================

/**
 * 隐性数对 (Hidden Pair)。
 *
 * 规则：在某行/列/宫中，两个数字只出现在完全相同的两格候选数中，
 * 则这两格的其他候选数均可消去，仅保留这两个数字。
 *
 * 优先级：Pair (1)，归类：Elimination。
 */
export class HiddenPairTechnique implements Technique {
  readonly id = "hidden-pair";
  readonly name = "隐性数对";
  readonly nameEn = "Hidden Pair";
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
   * 扫描全部 27 个单元，返回所有隐性数对发现。
   */
  detect(candidates: CandidateSnapshot): HiddenPairFinding[] {
    const results: HiddenPairFinding[] = [];

    for (let i = 0; i < 9; i++) {
      this._scanUnit("row", i as RowIndex, candidates, results);
      this._scanUnit("col", i as ColIndex, candidates, results);
      this._scanUnit("box", i as BoxIndex, candidates, results);
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: HiddenPairFinding): string {
    const { digits, unitType, unitIndex, pairCells } = finding;
    const label = UNIT_LABEL[unitType] ?? unitType;
    const idx = unitIndex + 1;
    const [d1, d2] = digits;
    const cell0Label = formatCoord(pairCells[0]!);
    const cell1Label = formatCoord(pairCells[1]!);

    return (
      `在第 ${idx} ${label}，数字 ${d1} 和 ${d2} ` +
      `只能出现在 ${cell0Label} 和 ${cell1Label}，` +
      `形成隐性数对，因此这两格的其他候选数可被消去`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  private _scanUnit(
    unitType: "row" | "col" | "box",
    unitIndex: number,
    candidates: CandidateSnapshot,
    out: HiddenPairFinding[],
  ): void {
    const coords = this._getUnitCoords(unitType, unitIndex);

    // 对每个数字，收集其在该单元中出现的位置
    const digitCellMap = new Map<Digit, CellCoord[]>();
    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      const cells: CellCoord[] = [];
      for (const coord of coords) {
        if (candidates.has(coord, digit)) {
          cells.push(coord);
        }
      }
      digitCellMap.set(digit, cells);
    }

    // 筛选恰好出现在两格的数字
    const entries = [...digitCellMap.entries()].filter(
      ([, cells]) => cells.length === 2,
    );

    if (entries.length < 2) return;

    // 寻找出现位置完全相同的数字对
    for (let a = 0; a < entries.length; a++) {
      for (let b = a + 1; b < entries.length; b++) {
        const [digitA, cellsA] = entries[a]!;
        const [digitB, cellsB] = entries[b]!;

        const setA = new Set(cellsA.map((c) => `${c[0]},${c[1]}`));
        const sameCells =
          cellsB.length === 2 &&
          cellsB.every((c) => setA.has(`${c[0]},${c[1]}`));

        if (!sameCells) continue;

        const pairCells: [CellCoord, CellCoord] = [cellsA[0]!, cellsA[1]!];
        const hiddenDigits: [Digit, Digit] = [digitA, digitB];
        const hiddenMask = CM.fromDigits([digitA, digitB]);

        // 消去：这两格中非隐性数对的其他候选数
        const eliminations: { coord: CellCoord; digit: Digit }[] = [];
        for (const coord of pairCells) {
          const cellMask = candidates.getMask(coord);
          for (let d = 1; d <= 9; d++) {
            if (CM.has(cellMask, d) && !CM.has(hiddenMask, d)) {
              eliminations.push({ coord, digit: d as Digit });
            }
          }
        }

        if (eliminations.length > 0) {
          out.push({
            digits: hiddenDigits,
            unitType,
            unitIndex,
            pairCells,
            eliminations,
          });
        }
      }
    }
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

  private buildResult(finding: HiddenPairFinding): TechniqueResult {
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
      involvedCells: finding.pairCells,
      description: this.explanation(finding),
    };
  }
}

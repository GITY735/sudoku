import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex, CandidateMask } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, ALL_DIGITS, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import { CandidateMask as CM } from "../types";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// HiddenTripleFinding
// ============================================================

interface HiddenTripleFinding {
  /** 构成隐性三数组的三个数字 */
  digits: [Digit, Digit, Digit];
  /** 所在单元类型 */
  unitType: "row" | "col" | "box";
  /** 单元索引 */
  unitIndex: number;
  /** 构成隐性三数组的三格 */
  tripleCells: [CellCoord, CellCoord, CellCoord];
  /** 这三格中将被消去的其他候选数 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

const UNIT_LABEL: Record<string, string> = {
  row: "行",
  col: "列",
  box: "宫",
};

// ============================================================
// HiddenTripleTechnique
// ============================================================

/**
 * 隐性三数组 (Hidden Triple)。
 *
 * 规则：在某行/列/宫中，三个数字的候选位置恰好被限制在三格内，
 * 则这三格中除了这三个数字外的其他候选数均可消去。
 *
 * 优先级：Triple (2)，归类：Elimination。
 */
export class HiddenTripleTechnique implements Technique {
  readonly id = "hidden-triple";
  readonly name = "隐性三数组";
  readonly nameEn = "Hidden Triple";
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

  detect(candidates: CandidateSnapshot): HiddenTripleFinding[] {
    const results: HiddenTripleFinding[] = [];

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

  explanation(finding: HiddenTripleFinding): string {
    const { digits, unitType, unitIndex, tripleCells, eliminations } = finding;
    const label = UNIT_LABEL[unitType] ?? unitType;
    const idx = unitIndex + 1;

    const cellDesc = tripleCells
      .map((c) => formatCoord(c))
      .join("、");
    const [d1, d2, d3] = digits;

    return (
      `在第 ${idx} ${label}，数字 ${d1}、${d2}、${d3} 的候选位置恰好限制在 ` +
      `${cellDesc} 三格内，形成隐性三数组，` +
      `因此这三格中可消去 ${eliminations.length} 个非 {${d1}, ${d2}, ${d3}} 的候选数`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  private _scanUnit(
    unitType: "row" | "col" | "box",
    unitIndex: number,
    candidates: CandidateSnapshot,
    out: HiddenTripleFinding[],
  ): void {
    const coords = this._getUnitCoords(unitType, unitIndex);

    // 遍历所有三个数字的组合 C(9,3) = 84
    for (let i1 = 0; i1 < 7; i1++) {
      const d1 = ALL_DIGITS[i1]!;
      for (let i2 = i1 + 1; i2 < 8; i2++) {
        const d2 = ALL_DIGITS[i2]!;
        for (let i3 = i2 + 1; i3 < 9; i3++) {
          const d3 = ALL_DIGITS[i3]!;

          // 收集包含 d1、d2 或 d3 的所有格
          const cellSet = new Set<string>();
          const tripleCells: CellCoord[] = [];

          for (const coord of coords) {
            const mask = candidates.getMask(coord);
            if (mask === 0) continue;
            if (CM.has(mask, d1) || CM.has(mask, d2) || CM.has(mask, d3)) {
              cellSet.add(`${coord[0]},${coord[1]}`);
              tripleCells.push(coord);
            }
          }

          // 恰好三格 → 隐性三数组
          if (tripleCells.length !== 3) continue;

          const digits: [Digit, Digit, Digit] = [d1, d2, d3];
          const digitMask = CM.union(CM.union(CM.fromDigits([d1]), CM.fromDigits([d2])), CM.fromDigits([d3]));

          // 计算消去：这三格中非 d1/d2/d3 的候选数
          const eliminations: { coord: CellCoord; digit: Digit }[] = [];
          for (const cell of tripleCells) {
            const mask = candidates.getMask(cell);
            const toRemove = CM.subtract(mask, digitMask);
            if (toRemove === 0) continue;
            for (const d of CM.toDigits(toRemove)) {
              eliminations.push({ coord: cell, digit: d });
            }
          }

          if (eliminations.length > 0) {
            out.push({
              digits,
              unitType,
              unitIndex,
              tripleCells: tripleCells as [CellCoord, CellCoord, CellCoord],
              eliminations,
            });
          }
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

  private buildResult(finding: HiddenTripleFinding): TechniqueResult {
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
      involvedCells: finding.tripleCells,
      description: this.explanation(finding),
    };
  }
}

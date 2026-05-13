import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex, CandidateMask } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, ALL_DIGITS, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import { CandidateMask as CM } from "../types";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// HiddenQuadFinding
// ============================================================

interface HiddenQuadFinding {
  /** 构成隐性四数组的四个数字 */
  digits: [Digit, Digit, Digit, Digit];
  /** 所在单元类型 */
  unitType: "row" | "col" | "box";
  /** 单元索引 */
  unitIndex: number;
  /** 构成隐性四数组的四格 */
  quadCells: [CellCoord, CellCoord, CellCoord, CellCoord];
  /** 这四格中将被消去的其他候选数 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

const UNIT_LABEL: Record<string, string> = {
  row: "行",
  col: "列",
  box: "宫",
};

// ============================================================
// HiddenQuadTechnique
// ============================================================

/**
 * 隐性四数组 (Hidden Quad)。
 *
 * 规则：在某行/列/宫中，四个数字的候选位置恰好被限制在四格内，
 * 则这四格中除了这四个数字以外的其他候选数均可消去。
 *
 * 优先级：Quad (3)，归类：Elimination。
 */
export class HiddenQuadTechnique implements Technique {
  readonly id = "hidden-quad";
  readonly name = "隐性四数组";
  readonly nameEn = "Hidden Quad";
  readonly priority = TechniquePriority.Quad;
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

  detect(candidates: CandidateSnapshot): HiddenQuadFinding[] {
    const results: HiddenQuadFinding[] = [];

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

  explanation(finding: HiddenQuadFinding): string {
    const { digits, unitType, unitIndex, quadCells, eliminations } = finding;
    const label = UNIT_LABEL[unitType] ?? unitType;
    const idx = unitIndex + 1;

    const cellDesc = quadCells
      .map((c) => formatCoord(c))
      .join("、");
    const [d1, d2, d3, d4] = digits;

    return (
      `在第 ${idx} ${label}，数字 ${d1}、${d2}、${d3}、${d4} 的候选位置恰好限制在 ` +
      `${cellDesc} 四格内，形成隐性四数组，` +
      `因此这四格中可消去 ${eliminations.length} 个非 {${d1}, ${d2}, ${d3}, ${d4}} 的候选数`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  private _scanUnit(
    unitType: "row" | "col" | "box",
    unitIndex: number,
    candidates: CandidateSnapshot,
    out: HiddenQuadFinding[],
  ): void {
    const coords = this._getUnitCoords(unitType, unitIndex);

    // 遍历所有四个数字的组合 C(9,4) = 126
    for (let i1 = 0; i1 < 6; i1++) {
      const d1 = ALL_DIGITS[i1]!;
      for (let i2 = i1 + 1; i2 < 7; i2++) {
        const d2 = ALL_DIGITS[i2]!;
        for (let i3 = i2 + 1; i3 < 8; i3++) {
          const d3 = ALL_DIGITS[i3]!;
          for (let i4 = i3 + 1; i4 < 9; i4++) {
            const d4 = ALL_DIGITS[i4]!;

            // 收集包含 d1、d2、d3 或 d4 的所有格
            const quadCells: CellCoord[] = [];

            for (const coord of coords) {
              const mask = candidates.getMask(coord);
              if (mask === 0) continue;
              if (
                CM.has(mask, d1) ||
                CM.has(mask, d2) ||
                CM.has(mask, d3) ||
                CM.has(mask, d4)
              ) {
                quadCells.push(coord);
              }
            }

            // 恰好四格 → 隐性四数组
            if (quadCells.length !== 4) continue;

            const digits: [Digit, Digit, Digit, Digit] = [d1, d2, d3, d4];
            const digitMask = CM.fromDigits([d1, d2, d3, d4]);

            // 计算消去：这四格中非 d1/d2/d3/d4 的候选数
            const eliminations: { coord: CellCoord; digit: Digit }[] = [];
            for (const cell of quadCells) {
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
                quadCells: quadCells as [CellCoord, CellCoord, CellCoord, CellCoord],
                eliminations,
              });
            }
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

  private buildResult(finding: HiddenQuadFinding): TechniqueResult {
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
      involvedCells: finding.quadCells,
      description: this.explanation(finding),
    };
  }
}

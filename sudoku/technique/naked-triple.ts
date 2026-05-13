import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex, CandidateMask } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import { CandidateMask as CM } from "../types";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// NakedTripleFinding
// ============================================================

interface NakedTripleFinding {
  /** 构成三数组的三个数字 */
  digits: [Digit, Digit, Digit];
  /** 所在单元类型 */
  unitType: "row" | "col" | "box";
  /** 单元索引 */
  unitIndex: number;
  /** 构成三数组的三格 */
  tripleCells: [CellCoord, CellCoord, CellCoord];
  /** 该单元内将被消去这三个候选数的其他格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

const UNIT_LABEL: Record<string, string> = {
  row: "行",
  col: "列",
  box: "宫",
};

// ============================================================
// NakedTripleTechnique
// ============================================================

/**
 * 显性三数组 (Naked Triple)。
 *
 * 规则：在某行/列/宫中，三格的候选数并集恰好为三个数字，
 * 则该单元的其他格可消去这三个候选数。
 *
 * 优先级：Triple (2)，归类：Elimination。
 */
export class NakedTripleTechnique implements Technique {
  readonly id = "naked-triple";
  readonly name = "显性三数组";
  readonly nameEn = "Naked Triple";
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

  detect(candidates: CandidateSnapshot): NakedTripleFinding[] {
    const results: NakedTripleFinding[] = [];

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

  explanation(finding: NakedTripleFinding): string {
    const { digits, unitType, unitIndex, tripleCells, eliminations } = finding;
    const label = UNIT_LABEL[unitType] ?? unitType;
    const idx = unitIndex + 1;

    const cellDesc = tripleCells
      .map((c) => formatCoord(c))
      .join("、");
    const [d1, d2, d3] = digits;

    return (
      `在第 ${idx} ${label}，${cellDesc}` +
      ` 三格的候选数并集为 {${d1}, ${d2}, ${d3}}，形成显性三数组，` +
      `因此该${label}其他 ${eliminations.length} 处可消去 ${d1}、${d2}、${d3}`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  private _scanUnit(
    unitType: "row" | "col" | "box",
    unitIndex: number,
    candidates: CandidateSnapshot,
    out: NakedTripleFinding[],
  ): void {
    const coords = this._getUnitCoords(unitType, unitIndex);

    // 收集候选数在 2~3 之间的空格（1 个的是裸单一，≥4 的不可能在三数组中）
    const eligible: { coord: CellCoord; mask: CandidateMask }[] = [];
    for (const coord of coords) {
      const cnt = candidates.count(coord);
      if (cnt < 2 || cnt > 3) continue;
      eligible.push({ coord, mask: candidates.getMask(coord) });
    }

    if (eligible.length < 3) return;

    // 枚举所有三格组合
    const n = eligible.length;
    for (let a = 0; a < n - 2; a++) {
      for (let b = a + 1; b < n - 1; b++) {
        for (let c = b + 1; c < n; c++) {
          const maskA = eligible[a]!.mask;
          const maskB = eligible[b]!.mask;
          const maskC = eligible[c]!.mask;

          // 三格候选数并集
          const union = CM.union(CM.union(maskA, maskB), maskC);
          const unionSize = CM.size(union);

          // 并集恰好 3 个数字 → 显性三数组
          if (unionSize !== 3) continue;

          const digits = CM.toDigits(union) as [Digit, Digit, Digit];
          const tripleCells: [CellCoord, CellCoord, CellCoord] = [
            eligible[a]!.coord,
            eligible[b]!.coord,
            eligible[c]!.coord,
          ];

          // 计算消去：该单元中不在三数组中的其他格
          const eliminations: { coord: CellCoord; digit: Digit }[] = [];
          const tripleSet = new Set(
            tripleCells.map((t) => `${t[0]},${t[1]}`),
          );

          for (const coord of coords) {
            if (tripleSet.has(`${coord[0]},${coord[1]}`)) continue;
            for (const d of digits) {
              if (candidates.has(coord, d)) {
                eliminations.push({ coord, digit: d });
              }
            }
          }

          if (eliminations.length > 0) {
            out.push({ digits, unitType, unitIndex, tripleCells, eliminations });
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

  private buildResult(finding: NakedTripleFinding): TechniqueResult {
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

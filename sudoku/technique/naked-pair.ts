import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// NakedPairFinding
// ============================================================

interface NakedPairFinding {
  /** 构成数对的两个数字 */
  digits: [Digit, Digit];
  /** 数对所在的单元类型 */
  unitType: "row" | "col" | "box";
  /** 单元索引 */
  unitIndex: number;
  /** 构成数对的两格 */
  pairCells: [CellCoord, CellCoord];
  /** 该单元内将被消去这两个候选数的其他格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

const UNIT_LABEL: Record<string, string> = {
  row: "行",
  col: "列",
  box: "宫",
};

// ============================================================
// NakedPairTechnique
// ============================================================

/**
 * 显性数对 (Naked Pair)。
 *
 * 规则：在某行/列/宫中，两格的候选数完全相同且恰好为两个数字，
 * 则该单元的其他格可消去这两个候选数。
 *
 * 优先级：Pair (1)，归类：Elimination。
 */
export class NakedPairTechnique implements Technique {
  readonly id = "naked-pair";
  readonly name = "显性数对";
  readonly nameEn = "Naked Pair";
  readonly priority = TechniquePriority.Pair;
  readonly category = TechniqueCategory.Elimination;

  // ================================================================
  // Technique 接口
  // ================================================================

  apply(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null {
    const findings = this.detect(candidates);
    if (findings.length === 0) return null;

    // 优先返回消去数最多的发现
    findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
    return this.buildResult(findings[0]!);
  }

  // ================================================================
  // 检测
  // ================================================================

  /**
   * 扫描全部 27 个单元，返回所有显性数对发现。
   */
  detect(candidates: CandidateSnapshot): NakedPairFinding[] {
    const results: NakedPairFinding[] = [];

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

  explanation(finding: NakedPairFinding): string {
    const { digits, unitType, unitIndex, pairCells, eliminations } = finding;
    const label = UNIT_LABEL[unitType] ?? unitType;
    const idx = unitIndex + 1;
    const [d1, d2] = digits;
    const cell0Label = formatCoord(pairCells[0]!);
    const cell1Label = formatCoord(pairCells[1]!);

    return (
      `在第 ${idx} ${label}，${cell0Label} 和 ${cell1Label}` +
      ` 共同拥有候选数 {${d1}, ${d2}}，形成显性数对，` +
      `因此该${label}其他 ${eliminations.length} 处可消去 ${d1} 和 ${d2}`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  private _scanUnit(
    unitType: "row" | "col" | "box",
    unitIndex: number,
    candidates: CandidateSnapshot,
    out: NakedPairFinding[],
  ): void {
    // 收集该单元中候选数恰好为 2 的空格，按掩码分组
    const byMask = new Map<number, CellCoord[]>();
    const coords = this._getUnitCoords(unitType, unitIndex);

    for (const coord of coords) {
      const count = candidates.count(coord);
      if (count !== 2) continue;
      const mask = candidates.getMask(coord);
      let group = byMask.get(mask);
      if (!group) {
        group = [];
        byMask.set(mask, group);
      }
      group.push(coord);
    }

    // 完全相同的掩码恰好出现在 2 格 → 显性数对
    for (const [mask, group] of byMask) {
      if (group.length !== 2) continue;

      const digits = candidates.getDigits(group[0]!) as [Digit, Digit];
      const pairCells: [CellCoord, CellCoord] = [group[0]!, group[1]!];

      // 计算消去：该单元中既非数对格、又包含 d1 或 d2 的其他格
      const eliminations: { coord: CellCoord; digit: Digit }[] = [];
      const pairSet = new Set(pairCells.map((c) => `${c[0]},${c[1]}`));

      for (const coord of coords) {
        if (pairSet.has(`${coord[0]},${coord[1]}`)) continue;
        for (const d of digits) {
          if (candidates.has(coord, d)) {
            eliminations.push({ coord, digit: d });
          }
        }
      }

      if (eliminations.length > 0) {
        out.push({ digits, unitType, unitIndex, pairCells, eliminations });
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

  private buildResult(finding: NakedPairFinding): TechniqueResult {
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

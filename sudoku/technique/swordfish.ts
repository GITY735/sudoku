import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// SwordfishFinding
// ============================================================

interface SwordfishFinding {
  digit: Digit;
  /** 基准单元类型："row"=行Swordfish，"col"=列Swordfish */
  baseUnitType: "row" | "col";
  /** 三条基准行/列的索引 */
  baseIndices: [number, number, number];
  /** 三条覆盖列/行的索引 */
  coverIndices: [number, number, number];
  /** 构成Swordfish的格子（基格） */
  baseCells: CellCoord[];
  /** 将被消去候选数的格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// SwordfishTechnique
// ============================================================

/**
 * Swordfish（三链列）。
 *
 * 规则：当某数字在三行（列）中各自只能出现在 2~3 格，
 * 且这些格共享恰好三列（行），
 * 则这三列（行）的其他格可消去该数字。
 *
 * 优先级：BasicFish (4)，归类：Elimination。
 */
export class SwordfishTechnique implements Technique {
  readonly id = "swordfish";
  readonly name = "Swordfish";
  readonly nameEn = "Swordfish";
  readonly priority = TechniquePriority.BasicFish;
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
    const target = findings[0]!;
    return this.buildResult(target);
  }

  // ================================================================
  // 检测
  // ================================================================

  /**
   * 扫描全部 9 个数字，检测行 Swordfish 和列 Swordfish。
   */
  detect(candidates: CandidateSnapshot): SwordfishFinding[] {
    const results: SwordfishFinding[] = [];

    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      // 行 Swordfish
      this._detectInLines("row", digit, candidates, results);
      // 列 Swordfish
      this._detectInLines("col", digit, candidates, results);
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: SwordfishFinding): string {
    const { digit, baseUnitType, baseIndices, coverIndices, eliminations } =
      finding;
    const [b1, b2, b3] = baseIndices.map((i) => i + 1) as [
      number,
      number,
      number,
    ];
    const [c1, c2, c3] = coverIndices.map((i) => i + 1) as [
      number,
      number,
      number,
    ];
    const baseLabel = baseUnitType === "row" ? "行" : "列";
    const coverLabel = baseUnitType === "row" ? "列" : "行";

    return (
      `数字 ${digit} 在第 ${b1}、${b2}、${b3} ${baseLabel}只能出现在第 ${c1}、${c2}、${c3} ${coverLabel}` +
      `，形成 Swordfish，因此可从第 ${c1}、${c2}、${c3} ${coverLabel}` +
      `的其他 ${eliminations.length} 格中消去 ${digit}`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  /**
   * 在行或列方向检测 Swordfish。
   */
  private _detectInLines(
    baseType: "row" | "col",
    digit: Digit,
    candidates: CandidateSnapshot,
    out: SwordfishFinding[],
  ): void {
    // positionMap[i] = 该行/列中包含 digit 的列/行索引数组
    const positionMap: Map<number, number[]> = new Map();

    for (let i = 0; i < 9; i++) {
      const positions = candidates.getDigitPositionsInUnit(
        digit,
        baseType,
        i,
      );
      // Swordfish 要求 2 或 3 个位置
      if (positions.length >= 2 && positions.length <= 3) {
        const coverIdx =
          baseType === "row"
            ? positions.map((p) => p[1])
            : positions.map((p) => p[0]);
        positionMap.set(i, coverIdx);
      }
    }

    if (positionMap.size < 3) return;

    const entries = [...positionMap.entries()];

    // 尝试所有 3 个基点单元的组合
    for (let a = 0; a < entries.length; a++) {
      for (let b = a + 1; b < entries.length; b++) {
        for (let c = b + 1; c < entries.length; c++) {
          const [baseA, coverA] = entries[a]!;
          const [baseB, coverB] = entries[b]!;
          const [baseC, coverC] = entries[c]!;

          // 收集所有覆盖索引，检查是否恰好 3 个
          const allCover = new Set([...coverA, ...coverB, ...coverC]);
          if (allCover.size !== 3) continue;

          const coverSorted = [...allCover].sort((x, y) => x - y) as [
            number,
            number,
            number,
          ];
          const baseIndices: [number, number, number] = [baseA, baseB, baseC];

          // 构建基格坐标（交点处候选数存在的格子）
          const baseCells: CellCoord[] = [];
          for (const bi of baseIndices) {
            for (const ci of coverSorted) {
              const coord: CellCoord =
                baseType === "row"
                  ? [bi as RowIndex, ci as ColIndex]
                  : [ci as RowIndex, bi as ColIndex];
              if (candidates.has(coord, digit)) {
                baseCells.push(coord);
              }
            }
          }

          // 计算消去目标：cover 单元中不在基格上的其他格
          const eliminations: { coord: CellCoord; digit: Digit }[] = [];
          const coverType = baseType === "row" ? "col" : "row";
          const baseSet = new Set(baseIndices);

          for (const ci of coverSorted) {
            const allInCover = candidates.getDigitPositionsInUnit(
              digit,
              coverType,
              ci,
            );

            for (const coord of allInCover) {
              // 排除基格本身
              const unitIdx =
                baseType === "row" ? coord[0] : coord[1];
              if (!baseSet.has(unitIdx)) {
                eliminations.push({ coord, digit });
              }
            }
          }

          if (eliminations.length > 0) {
            out.push({
              digit,
              baseUnitType: baseType,
              baseIndices,
              coverIndices: coverSorted,
              baseCells,
              eliminations,
            });
          }
        }
      }
    }
  }

  private buildResult(finding: SwordfishFinding): TechniqueResult {
    const involvedCells: CellCoord[] = [...finding.baseCells];

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
      involvedCells,
      description: this.explanation(finding),
    };
  }
}

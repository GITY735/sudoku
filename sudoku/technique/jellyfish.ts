import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// JellyfishFinding
// ============================================================

interface JellyfishFinding {
  digit: Digit;
  /** 基准单元类型："row"=行Jellyfish，"col"=列Jellyfish */
  baseUnitType: "row" | "col";
  /** 四条基准行/列的索引 */
  baseIndices: [number, number, number, number];
  /** 四条覆盖列/行的索引 */
  coverIndices: [number, number, number, number];
  /** 构成Jellyfish的格子（基格） */
  baseCells: CellCoord[];
  /** 将被消去候选数的格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// JellyfishTechnique
// ============================================================

/**
 * Jellyfish（四链列）。
 *
 * 规则：当某数字在四行（列）中各自只能出现在 2~4 格，
 * 且这些格共享恰好四列（行），
 * 则这四列（行）的其他格可消去该数字。
 *
 * 优先级：BasicFish (4)，归类：Elimination。
 */
export class JellyfishTechnique implements Technique {
  readonly id = "jellyfish";
  readonly name = "Jellyfish";
  readonly nameEn = "Jellyfish";
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
   * 扫描全部 9 个数字，检测行 Jellyfish 和列 Jellyfish。
   */
  detect(candidates: CandidateSnapshot): JellyfishFinding[] {
    const results: JellyfishFinding[] = [];

    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      // 行 Jellyfish
      this._detectInLines("row", digit, candidates, results);
      // 列 Jellyfish
      this._detectInLines("col", digit, candidates, results);
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: JellyfishFinding): string {
    const { digit, baseUnitType, baseIndices, coverIndices, eliminations } =
      finding;
    const [b1, b2, b3, b4] = baseIndices.map((i) => i + 1) as [
      number,
      number,
      number,
      number,
    ];
    const [c1, c2, c3, c4] = coverIndices.map((i) => i + 1) as [
      number,
      number,
      number,
      number,
    ];
    const baseLabel = baseUnitType === "row" ? "行" : "列";
    const coverLabel = baseUnitType === "row" ? "列" : "行";

    return (
      `数字 ${digit} 在第 ${b1}、${b2}、${b3}、${b4} ${baseLabel}只能出现在第 ${c1}、${c2}、${c3}、${c4} ${coverLabel}` +
      `，形成 Jellyfish，因此可从第 ${c1}、${c2}、${c3}、${c4} ${coverLabel}` +
      `的其他 ${eliminations.length} 格中消去 ${digit}`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  /**
   * 在行或列方向检测 Jellyfish。
   */
  private _detectInLines(
    baseType: "row" | "col",
    digit: Digit,
    candidates: CandidateSnapshot,
    out: JellyfishFinding[],
  ): void {
    // positionMap[i] = 该行/列中包含 digit 的列/行索引数组
    const positionMap: Map<number, number[]> = new Map();

    for (let i = 0; i < 9; i++) {
      const positions = candidates.getDigitPositionsInUnit(
        digit,
        baseType,
        i,
      );
      // Jellyfish 要求 2~4 个位置
      if (positions.length >= 2 && positions.length <= 4) {
        const coverIdx =
          baseType === "row"
            ? positions.map((p) => p[1])
            : positions.map((p) => p[0]);
        positionMap.set(i, coverIdx);
      }
    }

    if (positionMap.size < 4) return;

    const entries = [...positionMap.entries()];

    // 尝试所有 4 个基点单元的组合
    for (let a = 0; a < entries.length; a++) {
      for (let b = a + 1; b < entries.length; b++) {
        for (let c = b + 1; c < entries.length; c++) {
          for (let d = c + 1; d < entries.length; d++) {
            const [baseA, coverA] = entries[a]!;
            const [baseB, coverB] = entries[b]!;
            const [baseC, coverC] = entries[c]!;
            const [baseD, coverD] = entries[d]!;

            // 收集所有覆盖索引，检查是否恰好 4 个
            const allCover = new Set([
              ...coverA,
              ...coverB,
              ...coverC,
              ...coverD,
            ]);
            if (allCover.size !== 4) continue;

            const coverSorted = [...allCover].sort((x, y) => x - y) as [
              number,
              number,
              number,
              number,
            ];
            const baseIndices: [number, number, number, number] = [
              baseA,
              baseB,
              baseC,
              baseD,
            ];

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
  }

  private buildResult(finding: JellyfishFinding): TechniqueResult {
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

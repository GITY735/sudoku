import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// XWingFinding
// ============================================================

interface XWingFinding {
  digit: Digit;
  /** 基准单元类型："row"=行X-Wing，"col"=列X-Wing */
  baseUnitType: "row" | "col";
  /** 两条基准行/列的索引 */
  baseIndices: [number, number];
  /** 两条覆盖列/行的索引 */
  coverIndices: [number, number];
  /** 构成 X 的 4 格 */
  baseCells: [CellCoord, CellCoord, CellCoord, CellCoord];
  /** 将被消去候选数的格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// XWingTechnique
// ============================================================

/**
 * X-Wing。
 *
 * 规则：当某数字在两行（列）中各自只能出现在相同的两列（行），
 * 则这两列（行）的其他格可消去该数字。
 *
 * 优先级：BasicFish (4)，归类：Elimination。
 */
export class XWingTechnique implements Technique {
  readonly id = "x-wing";
  readonly name = "X-Wing";
  readonly nameEn = "X-Wing";
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
   * 扫描全部 9 个数字，检测行 X-Wing 和列 X-Wing。
   */
  detect(candidates: CandidateSnapshot): XWingFinding[] {
    const results: XWingFinding[] = [];

    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      // 行 X-Wing
      this._detectInLines("row", digit, candidates, results);
      // 列 X-Wing
      this._detectInLines("col", digit, candidates, results);
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: XWingFinding): string {
    const { digit, baseUnitType, baseIndices, coverIndices, eliminations } =
      finding;
    const [b1, b2] = baseIndices.map((i) => i + 1) as [number, number];
    const [c1, c2] = coverIndices.map((i) => i + 1) as [number, number];
    const baseLabel = baseUnitType === "row" ? "行" : "列";
    const coverLabel = baseUnitType === "row" ? "列" : "行";

    return (
      `数字 ${digit} 在第 ${b1}${baseLabel}和第 ${b2}${baseLabel}` +
      `都只能出现在第 ${c1}${coverLabel}和第 ${c2}${coverLabel}` +
      `，形成 X-Wing，因此可从第 ${c1}、${c2}${coverLabel}` +
      `的其他 ${eliminations.length} 格中消去 ${digit}`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  /**
   * 在行或列方向检测 X-Wing。
   */
  private _detectInLines(
    baseType: "row" | "col",
    digit: Digit,
    candidates: CandidateSnapshot,
    out: XWingFinding[],
  ): void {
    // positionMap[i] = 该行/列中包含 digit 的列/行索引数组
    const positionMap: Map<number, number[]> = new Map();

    for (let i = 0; i < 9; i++) {
      const positions = candidates.getDigitPositionsInUnit(
        digit,
        baseType,
        i,
      );
      // X-Wing 要求恰好 2 个位置
      if (positions.length === 2) {
        // 存储列/行索引（而非坐标）
        const coverIdx =
          baseType === "row"
            ? [positions[0]![1], positions[1]![1]]
            : [positions[0]![0], positions[1]![0]];
        positionMap.set(i, coverIdx);
      }
    }

    if (positionMap.size < 2) return;

    // 在两两配对的行/列中寻找相同 cover 索引的组合
    const entries = [...positionMap.entries()];

    for (let a = 0; a < entries.length; a++) {
      for (let b = a + 1; b < entries.length; b++) {
        const [baseA, coverA] = entries[a]!;
        const [baseB, coverB] = entries[b]!;

        // 检查 cover 索引是否完全相同（顺序可能不同）
        const setA = new Set(coverA);
        const setB = new Set(coverB);
        if (setA.size !== 2 || setB.size !== 2) continue;

        const isMatch =
          setA.has(coverB[0]!) &&
          setA.has(coverB[1]!);

        if (!isMatch) continue;

        const coverSorted: [number, number] = [
          Math.min(coverA[0]!, coverA[1]!),
          Math.max(coverA[0]!, coverA[1]!),
        ];

        // 构建 4 个基格坐标
        const baseCells: [CellCoord, CellCoord, CellCoord, CellCoord] =
          baseType === "row"
            ? [
                [baseA as RowIndex, coverSorted[0] as ColIndex],
                [baseA as RowIndex, coverSorted[1] as ColIndex],
                [baseB as RowIndex, coverSorted[0] as ColIndex],
                [baseB as RowIndex, coverSorted[1] as ColIndex],
              ]
            : [
                [coverSorted[0] as RowIndex, baseA as ColIndex],
                [coverSorted[1] as RowIndex, baseA as ColIndex],
                [coverSorted[0] as RowIndex, baseB as ColIndex],
                [coverSorted[1] as RowIndex, baseB as ColIndex],
              ];

        // 计算消去目标：cover 单元中不在基格上的其他格
        const eliminations: { coord: CellCoord; digit: Digit }[] = [];
        const coverType = baseType === "row" ? "col" : "row";

        for (const ci of coverSorted) {
          const allInCover = candidates.getDigitPositionsInUnit(
            digit,
            coverType,
            ci,
          );

          for (const c of allInCover) {
            // 排除基格本身
            const isBaseCell = baseCells.some(
              (bc) => bc[0] === c[0] && bc[1] === c[1],
            );
            if (!isBaseCell) {
              eliminations.push({ coord: c, digit });
            }
          }
        }

        if (eliminations.length > 0) {
          out.push({
            digit,
            baseUnitType: baseType,
            baseIndices: [baseA, baseB],
            coverIndices: coverSorted,
            baseCells,
            eliminations,
          });
        }
      }
    }
  }

  private buildResult(finding: XWingFinding): TechniqueResult {
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

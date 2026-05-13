import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// UniqueRectangleFinding
// ============================================================

interface UniqueRectangleFinding {
  /** 两个数字 */
  digits: [Digit, Digit];
  /** 矩形四角（r1c1, r1c2, r2c1, r2c2） */
  corners: [CellCoord, CellCoord, CellCoord, CellCoord];
  /** UR 类型 */
  urType: 1 | 2;
  /** 被消去的候选数（在四角的第四格） */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// UniqueRectangleTechnique
// ============================================================

/**
 * 唯一矩形 (Unique Rectangle)。
 *
 * 基于"数独有唯一解"的前提：若四格形成矩形、跨越恰好两宫、
 * 且四格都含相同两个候选数 {X,Y}，则会导致多解（致命模式）。
 *
 * Type 1：三角为 {X,Y} 双值格，第四格含 {X,Y,...} → 从第四格消去 X 和 Y。
 * Type 2：两对顶角含额外候选数，且额外数相同 → 消去该数于共同可见格。
 */
export class UniqueRectangleTechnique implements Technique {
  readonly id = "unique-rectangle";
  readonly name = "唯一矩形";
  readonly nameEn = "Unique Rectangle";
  readonly priority = TechniquePriority.AdvancedChain;
  readonly category = TechniqueCategory.Elimination;

  apply(_board: BoardReadonly, candidates: CandidateSnapshot): TechniqueResult | null {
    const findings = this.detect(candidates);
    if (findings.length === 0) return null;
    findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
    return this.buildResult(findings[0]!);
  }

  // ================================================================
  // 检测
  // ================================================================

  detect(candidates: CandidateSnapshot): UniqueRectangleFinding[] {
    const results: UniqueRectangleFinding[] = [];

    // 对每对行
    for (let r1 = 0; r1 < 8; r1++) {
      for (let r2 = r1 + 1; r2 < 9; r2++) {
        // 对每对列
        for (let c1 = 0; c1 < 8; c1++) {
          for (let c2 = c1 + 1; c2 < 9; c2++) {
            const c11: CellCoord = [r1 as RowIndex, c1 as ColIndex];
            const c12: CellCoord = [r1 as RowIndex, c2 as ColIndex];
            const c21: CellCoord = [r2 as RowIndex, c1 as ColIndex];
            const c22: CellCoord = [r2 as RowIndex, c2 as ColIndex];

            // 必须跨越恰好 2 个宫（否则不构成致命模式）
            const boxes = new Set([
              this._boxOf(c11), this._boxOf(c12),
              this._boxOf(c21), this._boxOf(c22),
            ]);
            if (boxes.size !== 2) continue;

            // 找共同的候选数对 {X,Y}
            const cands = [
              candidates.getDigits(c11),
              candidates.getDigits(c12),
              candidates.getDigits(c21),
              candidates.getDigits(c22),
            ];

            // 全部至少含候选数
            if (cands.some((c) => c.length === 0)) continue;

            const pair = this._findCommonPair(cands);
            if (!pair) continue;

            const [x, y] = pair;

            // Type 1: 恰好 3 个格是双值 {x,y}，第 4 格有额外候选数
            const biValueCount = cands.filter(
              (c) => c.length === 2 && c.includes(x) && c.includes(y),
            ).length;

            if (biValueCount === 3) {
              // 找不是纯 {x,y} 的那个格
              const corners = [c11, c12, c21, c22];
              for (let i = 0; i < 4; i++) {
                const c = cands[i]!;
                if (!(c.length === 2 && c.includes(x) && c.includes(y))) {
                  // 该格含 x,y 及其他 → 消去 x,y
                  const elims: { coord: CellCoord; digit: Digit }[] = [];
                  if (c.includes(x)) elims.push({ coord: corners[i]!, digit: x });
                  if (c.includes(y)) elims.push({ coord: corners[i]!, digit: y });
                  if (elims.length > 0) {
                    results.push({
                      digits: pair,
                      corners: corners as [CellCoord, CellCoord, CellCoord, CellCoord],
                      urType: 1,
                      eliminations: elims,
                    });
                  }
                }
              }
            }

            // Type 2: 两个对顶角各有额外候选数，且共享某数字 z
            if (biValueCount === 2) {
              const corners = [c11, c12, c21, c22];
              const biIndices = [0, 1, 2, 3].filter(
                (i) => cands[i]!.length === 2 && cands[i]!.includes(x) && cands[i]!.includes(y),
              );
              if (biIndices.length === 2) {
                // 两个双值格必须是对顶角（不能同一行/列）
                const bi0 = corners[biIndices[0]!]!;
                const bi1 = corners[biIndices[1]!]!;
                if (bi0[0] !== bi1[0] && bi0[1] !== bi1[1]) {
                  // 两个非双值格的额外候选数
                  const extraIndices = [0, 1, 2, 3].filter((i) => !biIndices.includes(i));
                  const extras1 = cands[extraIndices[0]!]!.filter((d) => d !== x && d !== y);
                  const extras2 = cands[extraIndices[1]!]!.filter((d) => d !== x && d !== y);

                  // 找共同的额外数字
                  for (const z of extras1) {
                    if (extras2.includes(z)) {
                      // z 必须只出现在其中一格中（实际上 UR Type 2：z 是额外候选数的共同元素）
                      // 消去：所有能同时看到这两个非双值格的格子中的 z
                      // 简化：只记录找到的模式
                      const elims: { coord: CellCoord; digit: Digit }[] = [];
                      // 找同时看到两个非双值格的格子
                      for (let rr = 0; rr < 9; rr++) {
                        for (let cc = 0; cc < 9; cc++) {
                          const tc: CellCoord = [rr as RowIndex, cc as ColIndex];
                          if (corners.some((cn) => cn[0] === tc[0] && cn[1] === tc[1])) continue;
                          if (!candidates.has(tc, z as Digit)) continue;
                          const sees1 = this._arePeers(tc, corners[extraIndices[0]!]!);
                          const sees2 = this._arePeers(tc, corners[extraIndices[1]!]!);
                          if (sees1 && sees2) {
                            elims.push({ coord: tc, digit: z as Digit });
                          }
                        }
                      }
                      if (elims.length > 0) {
                        results.push({
                          digits: pair,
                          corners: corners as [CellCoord, CellCoord, CellCoord, CellCoord],
                          urType: 2,
                          eliminations: elims,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: UniqueRectangleFinding): string {
    const { digits, corners, urType } = finding;
    const [x, y] = digits;
    const cells = corners.map((c) => formatCoord(c)).join("、");

    if (urType === 1) {
      const target = finding.eliminations[0]!;
      return (
        `四格 ${cells} 形成唯一矩形 {${x},${y}}，` +
        `其中三角为纯双值格，第四格 ${formatCoord(target.coord)} 含额外候选，` +
        `为避免多解，可从该格消去 ${x} 和 ${y}`
      );
    } else {
      const z = finding.eliminations[0]!.digit;
      return (
        `四格 ${cells} 对顶角共享额外数字 ${z}，` +
        `形成唯一矩形 Type 2，可消去 ${finding.eliminations.length} 处 ${z}`
      );
    }
  }

  // ================================================================
  // 内部
  // ================================================================

  private _boxOf(c: CellCoord): number {
    return Math.floor(c[0] / 3) * 3 + Math.floor(c[1] / 3);
  }

  private _arePeers(a: CellCoord, b: CellCoord): boolean {
    if (a[0] === b[0] || a[1] === b[1]) return true;
    return this._boxOf(a) === this._boxOf(b);
  }

  /**
   * 从 4 组候选数中找共同包含的两个数字。
   * 返回 [x,y] 若每组都包含 x 和 y，否则 null。
   */
  private _findCommonPair(cands: readonly (readonly Digit[])[]): [Digit, Digit] | null {
    // 四个角的所有候选数取交集
    let common = new Set<Digit>(cands[0]);
    for (let i = 1; i < 4; i++) {
      common = new Set(cands[i]!.filter((d) => common.has(d)));
    }
    const arr = [...common];
    if (arr.length >= 2) {
      // 取前两个作为 pair
      return [arr[0]!, arr[1]!];
    }
    return null;
  }

  private buildResult(finding: UniqueRectangleFinding): TechniqueResult {
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
      involvedCells: finding.corners,
      description: this.explanation(finding),
    };
  }
}

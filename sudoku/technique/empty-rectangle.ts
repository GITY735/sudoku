import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// EmptyRectangleFinding
// ============================================================

interface EmptyRectangleFinding {
  digit: Digit;
  /** 空矩形所在的宫 */
  box: BoxIndex;
  /** 宫内包含 digit 的行集合（可能有 1-3 行） */
  boxRows: number[];
  /** 宫内包含 digit 的列集合（可能有 1-3 列） */
  boxCols: number[];
  /** 强链：行或列上恰好 2 个位置 */
  strongLink: {
    unitType: "row" | "col";
    unitIndex: number;
    /** 强链在宫内的端点 */
    inner: CellCoord;
    /** 强链在宫外的端点 */
    outer: CellCoord;
  };
  /** 消去目标格（位于 outer 所在行/列 与 boxCols/boxRows 的交点） */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// EmptyRectangleTechnique
// ============================================================

/**
 * 空矩形 (Empty Rectangle)。
 *
 * 规则：在某一宫中，数字 X 的候选数分布在某一行和某一列的交集形状内。
 * 结合行/列上的强链（共轭对），可消去强链另一端对应位置的 X。
 */
export class EmptyRectangleTechnique implements Technique {
  readonly id = "empty-rectangle";
  readonly name = "空矩形";
  readonly nameEn = "Empty Rectangle";
  readonly priority = TechniquePriority.IntermediateChain;
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

  detect(candidates: CandidateSnapshot): EmptyRectangleFinding[] {
    const results: EmptyRectangleFinding[] = [];

    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      // 对每个宫
      for (let box = 0; box < 9; box++) {
        const boxPositions = candidates.getDigitPositionsInUnit(digit, "box", box);
        if (boxPositions.length < 2 || boxPositions.length > 5) continue;

        // 收集宫内涉及的 row 和 col
        const boxRows = [...new Set(boxPositions.map((c) => c[0]))];
        const boxCols = [...new Set(boxPositions.map((c) => c[1]))];

        // 空矩形：候选分布在 ≥2 行和 ≥2 列，且 = boxPositions 恰好是这些行列的交集
        if (boxRows.length < 2 || boxCols.length < 2) continue;
        if (boxRows.length > 3 || boxCols.length > 3) continue;

        // 验证：所有 boxPositions 确实属于 boxRows × boxCols 的某子集
        // 且至少一行和一列是"空"的（即交集中有一些格子没有该候选数）
        const allRowColCombos = boxRows.length * boxCols.length;
        if (boxPositions.length === allRowColCombos) continue; // 不是 ER，是全满

        // 对每一行，尝试找强链
        for (const row of boxRows) {
          const rowPositions = candidates.getDigitPositionsInUnit(digit, "row", row);
          if (rowPositions.length !== 2) continue; // 需要共轭对

          // 强链一端在宫内，一端在宫外
          const inner = rowPositions.find((c) => this._inBox(c, box));
          const outer = rowPositions.find((c) => !this._inBox(c, box));
          if (!inner || !outer) continue;

          // 消去：outer 所在列与 boxCols 的交点（在 outer 行上）
          const outerCol = outer[1];
          for (const bc of boxCols) {
            // 跳过同一列和同一宫
            if (bc === outerCol) continue;
            const target: CellCoord = [outer[0] as RowIndex, bc as ColIndex];
            if (this._inBox(target, box)) continue;
            if (candidates.has(target, digit)) {
              const existing = results.find(
                (r) => r.digit === digit && r.box === box &&
                  r.eliminations.some((e) => e.coord[0] === target[0] && e.coord[1] === target[1]),
              );
              if (!existing) {
                results.push({
                  digit,
                  box: box as BoxIndex,
                  boxRows,
                  boxCols,
                  strongLink: { unitType: "row", unitIndex: row, inner, outer },
                  eliminations: [{ coord: target, digit }],
                });
              }
            }
          }

          // 同理：对每一列，尝试找强链
          for (const col of boxCols) {
            const colPositions = candidates.getDigitPositionsInUnit(digit, "col", col);
            if (colPositions.length !== 2) continue;
            const innerC = colPositions.find((c) => this._inBox(c, box));
            const outerC = colPositions.find((c) => !this._inBox(c, box));
            if (!innerC || !outerC) continue;

            const outerRow = outerC[0];
            for (const br of boxRows) {
              if (br === outerRow) continue;
              const targetC: CellCoord = [br as RowIndex, outerC[1] as ColIndex];
              if (this._inBox(targetC, box)) continue;
              if (candidates.has(targetC, digit)) {
                const existing = results.find(
                  (r) => r.digit === digit && r.box === box &&
                    r.eliminations.some((e) => e.coord[0] === targetC[0] && e.coord[1] === targetC[1]),
                );
                if (!existing) {
                  results.push({
                    digit,
                    box: box as BoxIndex,
                    boxRows,
                    boxCols,
                    strongLink: { unitType: "col", unitIndex: col, inner: innerC, outer: outerC },
                    eliminations: [{ coord: targetC, digit }],
                  });
                }
              }
            }
          }
        }
      }
    }

    // 合并同一模式的多条消去
    return this._mergeSamePattern(results);
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: EmptyRectangleFinding): string {
    const { digit, box, strongLink, eliminations } = finding;
    const unitLabel = strongLink.unitType === "row" ? "行" : "列";
    const unitIdx = strongLink.unitIndex + 1;
    const targets = eliminations.map((e) => formatCoord(e.coord)).join("、");

    return (
      `数字 ${digit} 在第 ${box + 1} 宫形成空矩形，配合第 ${unitIdx}${unitLabel}的强链` +
      ` ${formatCoord(strongLink.inner)}↔${formatCoord(strongLink.outer)}` +
      `，因此可从 ${targets} 消去 ${digit}`
    );
  }

  // ================================================================
  // 内部
  // ================================================================

  private _inBox(coord: CellCoord, box: number): boolean {
    const sr = Math.floor(box / 3) * 3;
    const sc = (box % 3) * 3;
    const [r, c] = coord;
    return r >= sr && r < sr + 3 && c >= sc && c < sc + 3;
  }

  /** 合并同一宫 + 同数字 + 同强链的多条消去到一条记录 */
  private _mergeSamePattern(findings: EmptyRectangleFinding[]): EmptyRectangleFinding[] {
    const groups = new Map<string, EmptyRectangleFinding>();
    for (const f of findings) {
      const key = `${f.digit}|${f.box}|${f.strongLink.unitType}|${f.strongLink.unitIndex}|${f.strongLink.outer[0]},${f.strongLink.outer[1]}`;
      const existing = groups.get(key);
      if (existing) {
        for (const e of f.eliminations) {
          if (!existing.eliminations.some((ex) => ex.coord[0] === e.coord[0] && ex.coord[1] === e.coord[1])) {
            existing.eliminations.push(e);
          }
        }
      } else {
        groups.set(key, { ...f, eliminations: [...f.eliminations] });
      }
    }
    return [...groups.values()];
  }

  private buildResult(finding: EmptyRectangleFinding): TechniqueResult {
    const involved: CellCoord[] = [
      ...finding.boxRows.flatMap((r) =>
        finding.boxCols.map((c) => [r as RowIndex, c as ColIndex] as CellCoord),
      ),
      finding.strongLink.inner,
      finding.strongLink.outer,
    ];

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
      involvedCells: involved,
      description: this.explanation(finding),
    };
  }
}

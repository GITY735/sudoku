import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// YWingFinding
// ============================================================

interface YWingFinding {
  pivot: CellCoord;
  pivotDigits: [Digit, Digit];
  pincer1: CellCoord;
  pincer1Digits: [Digit, Digit];
  pincer2: CellCoord;
  pincer2Digits: [Digit, Digit];
  /** 被消去的候选数及其所在格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// YWingTechnique
// ============================================================

/**
 * Y-Wing (又称 XY-Wing)。
 *
 * 规则：三格（枢轴、双翼）中：
 *   - 枢轴恰好有 2 个候选数 {x, y}
 *   - 翼 1 恰好有 2 个候选数 {x, z}，且是枢轴的同辈格
 *   - 翼 2 恰好有 2 个候选数 {y, z}，且是枢轴的同辈格
 *   - 翼 1 与翼 2 互不为同辈格
 * → 同时是双翼的同辈格可消去 z
 *
 * 优先级：IntermediateChain (5)，归类：Elimination。
 */
export class YWingTechnique implements Technique {
  readonly id = "y-wing";
  readonly name = "Y-Wing";
  readonly nameEn = "Y-Wing";
  readonly priority = TechniquePriority.IntermediateChain;
  readonly category = TechniqueCategory.Elimination;

  // ================================================================
  // Technique 接口
  // ================================================================

  apply(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null {
    const findings = this.detect(board, candidates);
    if (findings.length === 0) return null;

    findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
    return this.buildResult(findings[0]!);
  }

  // ================================================================
  // 检测
  // ================================================================

  /**
   * 扫描所有两候选数格，检测 Y-Wing 结构。
   */
  detect(board: BoardReadonly, candidates: CandidateSnapshot): YWingFinding[] {
    const results: YWingFinding[] = [];

    // 收集所有恰好 2 候选数的格
    const twoCandidateCells = this._findTwoCandidateCells(candidates);

    for (const pivot of twoCandidateCells) {
      const pivotDigits = candidates.getDigits(pivot);
      if (pivotDigits.length !== 2) continue;
      const [x, y] = pivotDigits as [Digit, Digit];

      // 在枢轴的同辈格中寻找潜在双翼
      const pivotPeers = board.getPeers(pivot);
      const groupXZ: { coord: CellCoord; z: Digit }[] = [];
      const groupYZ: { coord: CellCoord; z: Digit }[] = [];

      for (const peer of pivotPeers) {
        if (candidates.count(peer) !== 2) continue;
        const digits = candidates.getDigits(peer);
        if (digits.length !== 2) continue;
        const [d1, d2] = digits as [Digit, Digit];

        // {x, z} 其中 z ≠ x, y
        if (d1 === x && d2 !== x && d2 !== y) {
          groupXZ.push({ coord: peer, z: d2 });
        } else if (d2 === x && d1 !== x && d1 !== y) {
          groupXZ.push({ coord: peer, z: d1 });
        }
        // {y, z} 其中 z ≠ x, y
        else if (d1 === y && d2 !== x && d2 !== y) {
          groupYZ.push({ coord: peer, z: d2 });
        } else if (d2 === y && d1 !== x && d1 !== y) {
          groupYZ.push({ coord: peer, z: d1 });
        }
      }

      if (groupXZ.length === 0 || groupYZ.length === 0) continue;

      // 配对双翼：要求 z 相同，且双翼互不为同辈格
      for (const p1 of groupXZ) {
        const p1Peers = board.getPeers(p1.coord);
        const p1PeerSet = new Set(p1Peers.map((p) => `${p[0]},${p[1]}`));

        for (const p2 of groupYZ) {
          if (p1.z !== p2.z) continue;
          const z = p1.z;

          // 翼 1 与翼 2 互不为同辈格
          if (p1PeerSet.has(`${p2.coord[0]},${p2.coord[1]}`)) continue;

          // 寻找同时是双翼同辈格的单元格，消去 z
          const eliminations: { coord: CellCoord; digit: Digit }[] = [];
          const p2Peers = board.getPeers(p2.coord);

          for (const p2Peer of p2Peers) {
            if (p1PeerSet.has(`${p2Peer[0]},${p2Peer[1]}`)) {
              if (candidates.has(p2Peer, z)) {
                eliminations.push({ coord: p2Peer, digit: z });
              }
            }
          }

          if (eliminations.length > 0) {
            const p1Digits = [x, z].sort() as [Digit, Digit];
            const p2Digits = [y, z].sort() as [Digit, Digit];

            results.push({
              pivot,
              pivotDigits: [x, y],
              pincer1: p1.coord,
              pincer1Digits: p1Digits,
              pincer2: p2.coord,
              pincer2Digits: p2Digits,
              eliminations,
            });
          }
        }
      }
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: YWingFinding): string {
    const { pivot, pivotDigits, pincer1, pincer1Digits, pincer2, pincer2Digits, eliminations } =
      finding;
    const z = eliminations[0]!.digit;

    const pivotStr = `${formatCoord(pivot)} {${pivotDigits.join(", ")}}`;
    const p1Str = `${formatCoord(pincer1)} {${pincer1Digits.join(", ")}}`;
    const p2Str = `${formatCoord(pincer2)} {${pincer2Digits.join(", ")}}`;
    const elimStrs = eliminations.map((e) => formatCoord(e.coord)).join("、");

    return `${pivotStr} 为枢轴，${p1Str} 和 ${p2Str} 为双翼，因此 ${elimStrs} 可消去 ${z}`;
  }

  // ================================================================
  // 内部
  // ================================================================

  private _findTwoCandidateCells(candidates: CandidateSnapshot): CellCoord[] {
    const cells: CellCoord[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        if (candidates.count(coord) === 2) {
          cells.push(coord);
        }
      }
    }
    return cells;
  }

  private buildResult(finding: YWingFinding): TechniqueResult {
    const involvedCells: CellCoord[] = [finding.pivot, finding.pincer1, finding.pincer2];

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

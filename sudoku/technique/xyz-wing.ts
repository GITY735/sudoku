import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// XYZWingFinding
// ============================================================

interface XYZWingFinding {
  pivot: CellCoord;
  pivotDigits: [Digit, Digit, Digit];
  pincer1: CellCoord;
  pincer1Digits: [Digit, Digit];
  pincer2: CellCoord;
  pincer2Digits: [Digit, Digit];
  /** 要被消去的数字（枢轴第三个候选数） */
  z: Digit;
  /** 被消去的候选数及其所在格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// XYZWingTechnique
// ============================================================

/**
 * XYZ-Wing。
 *
 * 规则：三格（枢轴、双翼）中：
 *   - 枢轴恰好有 3 个候选数 {x, y, z}
 *   - 翼 1 恰好有 2 个候选数 {x, z}，且是枢轴的同辈格
 *   - 翼 2 恰好有 2 个候选数 {y, z}，且是枢轴的同辈格
 * → 同时是枢轴和双翼的同辈格可消去 z
 *
 * 优先级：IntermediateChain (5)，归类：Elimination。
 */
export class XYZWingTechnique implements Technique {
  readonly id = "xyz-wing";
  readonly name = "XYZ-Wing";
  readonly nameEn = "XYZ-Wing";
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
   * 扫描所有三候选数格，检测 XYZ-Wing 结构。
   */
  detect(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): XYZWingFinding[] {
    const results: XYZWingFinding[] = [];

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const pivot: CellCoord = [r as RowIndex, c as ColIndex];
        if (candidates.count(pivot) !== 3) continue;

        const pivotDigits = candidates.getDigits(pivot);
        if (pivotDigits.length !== 3) continue;
        const [x, y, z] = pivotDigits as [Digit, Digit, Digit];

        const pivotPeers = board.getPeers(pivot);
        const pivotPeerSet = new Set(pivotPeers.map((p) => `${p[0]},${p[1]}`));

        // 在枢轴的同辈格中寻找：恰好 {x, z} 的格（翼 1）
        const xzCells: CellCoord[] = [];
        // 恰好 {y, z} 的格（翼 2）
        const yzCells: CellCoord[] = [];

        for (const peer of pivotPeers) {
          if (candidates.count(peer) !== 2) continue;
          const digits = candidates.getDigits(peer);
          if (digits.length !== 2) continue;
          const [d1, d2] = digits as [Digit, Digit];

          // 检查是否为 {x, z}（x < z 由于候选数已排序）
          if (d1 === x && d2 === z) {
            xzCells.push(peer);
          }
          // 检查是否为 {y, z}（y < z 由于候选数已排序）
          else if (d1 === y && d2 === z) {
            yzCells.push(peer);
          }
        }

        if (xzCells.length === 0 || yzCells.length === 0) continue;

        // 配对双翼
        for (const p1 of xzCells) {
          const p1Peers = board.getPeers(p1);
          const p1PeerSet = new Set(p1Peers.map((p) => `${p[0]},${p[1]}`));

          for (const p2 of yzCells) {
            // 双翼不能是同一格
            if (p1[0] === p2[0] && p1[1] === p2[1]) continue;

            // 寻找同时是枢轴和双翼同辈格的单元格，消去 z
            const eliminations: { coord: CellCoord; digit: Digit }[] = [];
            const p2Peers = board.getPeers(p2);

            for (const p2Peer of p2Peers) {
              const key = `${p2Peer[0]},${p2Peer[1]}`;
              // 必须是枢轴、翼1、翼2 三者的共同同辈格
              if (pivotPeerSet.has(key) && p1PeerSet.has(key)) {
                if (candidates.has(p2Peer, z)) {
                  eliminations.push({ coord: p2Peer, digit: z });
                }
              }
            }

            if (eliminations.length > 0) {
              results.push({
                pivot,
                pivotDigits: [x, y, z],
                pincer1: p1,
                pincer1Digits: [x, z],
                pincer2: p2,
                pincer2Digits: [y, z],
                z,
                eliminations,
              });
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

  explanation(finding: XYZWingFinding): string {
    const { pivot, pivotDigits, pincer1, pincer1Digits, pincer2, pincer2Digits, eliminations } =
      finding;
    const z = finding.z;

    const pivotStr = `${formatCoord(pivot)} {${pivotDigits.join(", ")}}`;
    const p1Str = `${formatCoord(pincer1)} {${pincer1Digits.join(", ")}}`;
    const p2Str = `${formatCoord(pincer2)} {${pincer2Digits.join(", ")}}`;
    const elimStrs = eliminations.map((e) => formatCoord(e.coord)).join("、");

    return `${pivotStr} 为枢轴，${p1Str} 和 ${p2Str} 为双翼，因此 ${elimStrs} 可消去 ${z}`;
  }

  // ================================================================
  // 内部
  // ================================================================

  private buildResult(finding: XYZWingFinding): TechniqueResult {
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

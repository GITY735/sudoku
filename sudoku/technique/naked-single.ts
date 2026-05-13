import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

/**
 * 唯余法 (Naked Single)。
 *
 * 规则：当一格只剩一个候选数时，该数字就是该格的解。
 * 这是最基础、优先级最高的求解技巧。
 */
export class NakedSingleTechnique implements Technique {
  readonly id = "naked-single";
  readonly name = "唯余法";
  readonly nameEn = "Naked Single";
  readonly priority = TechniquePriority.Basic;
  readonly category = TechniqueCategory.Placement;

  // ================================================================
  // Technique 接口
  // ================================================================

  apply(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null {
    const findings = this.detect(board, candidates);
    if (findings.length === 0) return null;

    // 取第一个发现
    const target = findings[0]!;
    return this.buildResult(target, board, candidates);
  }

  // ================================================================
  // 检测
  // ================================================================

  /**
   * 扫描盘面，返回所有裸单一格的坐标。
   * 裸单一：空格且候选数恰好为 1。
   */
  detect(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): CellCoord[] {
    const results: CellCoord[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = board.getCell(r as RowIndex, c as ColIndex);
        if (cell.value !== 0) continue;
        if (candidates.count([r as RowIndex, c as ColIndex]) === 1) {
          results.push([r as RowIndex, c as ColIndex]);
        }
      }
    }
    return results;
  }

  /**
   * 在指定格中检测是否为裸单一。
   * 是 → 返回候选数字；否 → 返回 null。
   */
  detectAt(
    coord: CellCoord,
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): Digit | null {
    if (board.getCell(coord).value !== 0) return null;
    if (candidates.count(coord) !== 1) return null;
    return candidates.getDigits(coord)[0]!;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  /**
   * 生成自然语言教学说明。
   *
   * @param coord    裸单一格坐标
   * @param digit    唯一候选数字
   * @param peers    因其而消去候选数的同辈格（可选）
   */
  explanation(
    coord: CellCoord,
    digit: Digit,
    peersAffected?: readonly CellCoord[],
  ): string {
    let desc = `格 ${formatCoord(coord)} 只剩唯一候选数 ${digit}`;
    if (peersAffected && peersAffected.length > 0) {
      const sample = peersAffected.slice(0, 5);
      const items = sample.map((p) => formatCoord(p)).join("、");
      const suffix =
        peersAffected.length > 5
          ? `等 ${peersAffected.length} 格`
          : "";
      desc += `，填入后将消去 ${items}${suffix} 中的候选数 ${digit}`;
    }
    return desc;
  }

  // ================================================================
  // 内部
  // ================================================================

  private buildResult(
    coord: CellCoord,
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult {
    const digit = candidates.getDigits(coord)[0]!;
    const peers = board.getPeers(coord);

    // 预计算：填入此数字后，哪些同辈格会失去这一候选数
    const affectedPeers: CellCoord[] = [];
    for (const p of peers) {
      if (candidates.has(p, digit)) {
        affectedPeers.push(p);
      }
    }

    const description = this.explanation(coord, digit, affectedPeers);

    return {
      techniqueId: this.id,
      techniqueName: this.name,
      priority: this.priority,
      category: this.category,
      outcome: SolveStepOutcome.Progressed,
      delta: {
        placement: { coord, digit },
        eliminations: affectedPeers.map((p) => ({ coord: p, digit })),
        contradictions: [],
        nakedSingles: [],
      },
      involvedCells: [coord],
      description,
    };
  }
}

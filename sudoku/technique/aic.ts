import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// AICFinding
// ============================================================

interface AICFinding {
  /** 目标数字 */
  readonly digit: Digit;
  /** 强链连通分量中的节点列表（用于 involvedCells） */
  readonly componentCells: readonly CellCoord[];
  /** 将被消去的候选数 */
  readonly eliminations: readonly { readonly coord: CellCoord; readonly digit: Digit }[];
  /** 规则类型 */
  readonly ruleType: "same_color_peers" | "seen_by_both_colors";
  /** 用于 explanation 的上下文 */
  readonly detailColor: number;
}

// ============================================================
// AICTechnique
// ============================================================

/**
 * 交替推理链 (Alternating Inference Chain / Simple Coloring)。
 *
 * 规则：对单个数字构建强链（共轭对）图，进行二着色。
 * 若同色两格在同一单元内（可通过弱链连接）→ 该色全体消去。
 * 若未着色格同时看到某数字的两种颜色 → 该数字可从该格消去。
 *
 * 优先级：AdvancedChain (6)，归类：Chain。
 */
export class AICTechnique implements Technique {
  readonly id = "aic";
  readonly name = "交替推理链";
  readonly nameEn = "Alternating Inference Chain";
  readonly priority = TechniquePriority.AdvancedChain;
  readonly category = TechniqueCategory.Chain;

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
   * 对每个数字独立执行单数字着色分析。
   * 强链 = 共轭对（某数字在某单元中恰好出现在 2 格）。
   * 弱链 = 同单元内两格均有该数字。
   */
  detect(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): AICFinding[] {
    const results: AICFinding[] = [];
    const peerCache = this._buildPeerCache(board);

    for (const digit of ([1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[])) {
      const findings = this._analyzeDigit(digit, candidates, peerCache);
      for (const f of findings) {
        results.push(f);
      }
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: AICFinding): string {
    const { digit, ruleType, eliminations, detailColor } = finding;

    if (ruleType === "same_color_peers") {
      const colorName = detailColor === 0 ? "A" : "B";
      return (
        `交替推理链：数字 ${digit} 的着色链中，同色 (${colorName}) 两格在同一单元，` +
        `因此该色全部 ${eliminations.length} 处可消去 ${digit}`
      );
    }

    // seen_by_both_colors
    return (
      `交替推理链：数字 ${digit} 的着色链中，` +
      `有 ${eliminations.length} 格同时看到两种颜色，可消去 ${digit}`
    );
  }

  // ================================================================
  // 内部 — 单数字分析
  // ================================================================

  private _analyzeDigit(
    digit: Digit,
    candidates: CandidateSnapshot,
    peerCache: Map<string, Set<string>>,
  ): AICFinding[] {
    const results: AICFinding[] = [];

    // ---- 1. 收集该数字的所有候选格 ----
    const cellList: CellCoord[] = [];
    const cellIndex = new Map<string, number>();

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        if (candidates.has(coord, digit)) {
          const key = coordKey(coord);
          cellIndex.set(key, cellList.length);
          cellList.push(coord);
        }
      }
    }

    if (cellList.length < 2) return results;

    // ---- 2. 构建强链（共轭对）邻接表 ----
    const adj: number[][] = Array.from({ length: cellList.length }, () => []);

    const addEdge = (a: number, b: number) => {
      if (!adj[a]!.includes(b)) {
        adj[a]!.push(b);
        adj[b]!.push(a);
      }
    };

    // 扫描每个单元（行/列/宫），若恰好 2 格有该数字 → 共轭对
    for (let i = 0; i < 9; i++) {
      // 行
      this._addConjugatePair(digit, "row", i as RowIndex, candidates, cellIndex, addEdge);
      // 列
      this._addConjugatePair(digit, "col", i as ColIndex, candidates, cellIndex, addEdge);
      // 宫
      this._addConjugatePair(digit, "box", i as BoxIndex, candidates, cellIndex, addEdge);
    }

    // ---- 3. 对每个连通分量二着色 ----
    const colors = new Map<number, number>();
    const visited = new Set<number>();

    for (let i = 0; i < cellList.length; i++) {
      if (visited.has(i)) continue;

      const component: number[] = [];
      const queue: number[] = [i];
      colors.set(i, 0);
      visited.add(i);

      while (queue.length > 0) {
        const u = queue.shift()!;
        component.push(u);
        const uColor = colors.get(u)!;

        for (const v of adj[u]!) {
          if (!visited.has(v)) {
            visited.add(v);
            colors.set(v, 1 - uColor);
            queue.push(v);
          }
        }
      }

      if (component.length < 2) continue;

      // ---- 4. 规则 1：同色两格在同单元 → 该色全体消去 ----
      const sameColorResult = this._checkSameColorPeers(
        component, cellList, colors, digit, peerCache,
      );
      if (sameColorResult) {
        results.push(sameColorResult);
        continue;
      }

      // ---- 5. 规则 2：未着色格看到两种颜色 → 消去该数字 ----
      const seenBothResult = this._checkSeenByBothColors(
        component, cellList, colors, digit, candidates, peerCache,
      );
      if (seenBothResult) {
        results.push(seenBothResult);
      }
    }

    return results;
  }

  // ================================================================
  // 内部 — 共轭对
  // ================================================================

  private _addConjugatePair(
    digit: Digit,
    unitType: "row" | "col" | "box",
    index: number,
    candidates: CandidateSnapshot,
    cellIndex: Map<string, number>,
    addEdge: (a: number, b: number) => void,
  ): void {
    const positions = candidates.getDigitPositionsInUnit(digit, unitType, index);
    if (positions.length !== 2) return;
    const k1 = coordKey(positions[0]!);
    const k2 = coordKey(positions[1]!);
    const i1 = cellIndex.get(k1);
    const i2 = cellIndex.get(k2);
    if (i1 !== undefined && i2 !== undefined && i1 !== i2) {
      addEdge(i1, i2);
    }
  }

  // ================================================================
  // 内部 — 规则 1：同色同单元
  // ================================================================

  private _checkSameColorPeers(
    component: number[],
    cellList: CellCoord[],
    colors: Map<number, number>,
    digit: Digit,
    peerCache: Map<string, Set<string>>,
  ): AICFinding | null {
    // 按颜色分组格键
    const byColor: Set<string>[] = [new Set(), new Set()];
    for (const idx of component) {
      const key = coordKey(cellList[idx]!);
      byColor[colors.get(idx)!]!.add(key);
    }

    // 检查同色内是否有两格互为同辈
    for (const color of [0, 1]) {
      const colorSet = byColor[color]!;
      const keys = [...colorSet];
      for (let a = 0; a < keys.length; a++) {
        const peers = peerCache.get(keys[a]!)!;
        for (let b = a + 1; b < keys.length; b++) {
          if (peers.has(keys[b]!)) {
            // 同色两格在同一单元 → 该色全体候选消去
            const eliminations: { coord: CellCoord; digit: Digit }[] = [];
            for (const idx of component) {
              if (colors.get(idx)! === color) {
                eliminations.push({ coord: cellList[idx]!, digit });
              }
            }

            return {
              digit,
              componentCells: component.map((i) => cellList[i]!),
              eliminations,
              ruleType: "same_color_peers",
              detailColor: color,
            };
          }
        }
      }
    }

    return null;
  }

  // ================================================================
  // 内部 — 规则 2：看到两种颜色
  // ================================================================

  private _checkSeenByBothColors(
    component: number[],
    cellList: CellCoord[],
    colors: Map<number, number>,
    digit: Digit,
    candidates: CandidateSnapshot,
    peerCache: Map<string, Set<string>>,
  ): AICFinding | null {
    // 按颜色收集分量内所有格键
    const byColor: Set<string>[] = [new Set(), new Set()];
    for (const idx of component) {
      const key = coordKey(cellList[idx]!);
      byColor[colors.get(idx)!]!.add(key);
    }

    if (byColor[0]!.size === 0 || byColor[1]!.size === 0) return null;

    // 分量内格键集合（用于跳过）
    const componentKeys = new Set<string>();
    for (const idx of component) {
      componentKeys.add(coordKey(cellList[idx]!));
    }

    // 扫描所有拥有此数字的格
    const eliminations: { coord: CellCoord; digit: Digit }[] = [];

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        const ck = coordKey(coord);

        if (componentKeys.has(ck)) continue;
        if (!candidates.has(coord, digit)) continue;

        const peers = peerCache.get(ck);
        if (!peers) continue;

        let sees0 = false;
        let sees1 = false;
        for (const pk of peers) {
          if (byColor[0]!.has(pk)) sees0 = true;
          if (byColor[1]!.has(pk)) sees1 = true;
          if (sees0 && sees1) break;
        }

        if (sees0 && sees1) {
          eliminations.push({ coord, digit });
        }
      }
    }

    if (eliminations.length === 0) return null;

    return {
      digit,
      componentCells: component.map((i) => cellList[i]!),
      eliminations,
      ruleType: "seen_by_both_colors",
      detailColor: 0, // not meaningful for this rule
    };
  }

  // ================================================================
  // 内部 — 工具
  // ================================================================

  /** 为全部 81 格预计算同辈格键集合。 */
  private _buildPeerCache(board: BoardReadonly): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        const peers = board.getPeers(coord);
        const peerKeys = new Set(peers.map((p) => coordKey(p)));
        map.set(coordKey(coord), peerKeys);
      }
    }
    return map;
  }

  // ================================================================
  // 内部 — 结果构建
  // ================================================================

  private buildResult(finding: AICFinding): TechniqueResult {
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
      involvedCells: finding.componentCells,
      description: this.explanation(finding),
    };
  }
}

// ============================================================
// 坐标工具
// ============================================================

function coordKey(coord: CellCoord): string {
  return `${coord[0]},${coord[1]}`;
}

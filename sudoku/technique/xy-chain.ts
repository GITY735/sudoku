import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// XYChainFinding
// ============================================================

interface XYChainFinding {
  /** The digit shared by both ends of the chain (the elimination target) */
  readonly sharedDigit: Digit;
  /** Ordered chain of bivalue cells from start to end */
  readonly chain: readonly CellCoord[];
  /** Cells that see both ends and therefore can eliminate the shared digit */
  readonly eliminations: readonly { readonly coord: CellCoord; readonly digit: Digit }[];
}

// ============================================================
// XYChainTechnique
// ============================================================

/**
 * XY-Chain (XY链)。
 *
 * 规则：一条由双值格（恰好 2 个候选数）组成的链，
 * 相邻两格共享一个候选数，链的起点和终点共享同一个数字 z，
 * 则同时看到起点和终点的格可消去 z。
 *
 * 优先级：AdvancedChain (6)，归类：Chain。
 */
export class XYChainTechnique implements Technique {
  readonly id = "xy-chain";
  readonly name = "XY链";
  readonly nameEn = "XY-Chain";
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
   * 扫描全部双值格，搜索 XY-Chain。
   * 对每个双值格作为起点进行 DFS，链长度上限 12。
   */
  detect(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): XYChainFinding[] {
    const results: XYChainFinding[] = [];

    // 收集全部双值格
    const bivalueCells: { coord: CellCoord; digits: [Digit, Digit] }[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        const cnt = candidates.count(coord);
        if (cnt !== 2) continue;
        bivalueCells.push({
          coord,
          digits: candidates.getDigits(coord) as [Digit, Digit],
        });
      }
    }

    if (bivalueCells.length < 2) return results;

    // 建立同辈关系统一缓存
    const peerSet = this._buildPeerSet(board);

    // 建立邻接表：双值格之间若为同辈且共享候选数则相连
    const adj = new Map<string, { cell: CellCoord; sharedDigit: Digit }[]>();
    for (const cell of bivalueCells) {
      adj.set(coordKey(cell.coord), []);
    }
    for (let i = 0; i < bivalueCells.length; i++) {
      const a = bivalueCells[i]!;
      for (let j = i + 1; j < bivalueCells.length; j++) {
        const b = bivalueCells[j]!;
        if (!this._arePeers(a.coord, b.coord, peerSet)) continue;
        const shared = this._sharedDigit(a.digits, b.digits);
        if (shared === null) continue;
        adj.get(coordKey(a.coord))!.push({ cell: b.coord, sharedDigit: shared });
        adj.get(coordKey(b.coord))!.push({ cell: a.coord, sharedDigit: shared });
      }
    }

    // 从每个双值格出发 DFS
    for (const start of bivalueCells) {
      const [d0, d1] = start.digits;

      // 分别尝试两个数字作为消去目标 (x)
      this._dfsChain(
        start.coord, d0, d1, [start.coord],
        new Set([coordKey(start.coord)]),
        adj, candidates, peerSet, results, 12,
      );
      this._dfsChain(
        start.coord, d1, d0, [start.coord],
        new Set([coordKey(start.coord)]),
        adj, candidates, peerSet, results, 12,
      );
    }

    return this._deduplicateFindings(results);
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: XYChainFinding): string {
    const { sharedDigit, chain, eliminations } = finding;
    const chainDesc = chain
      .map((c) => formatCoord(c))
      .join(" → ");
    const startKey = formatCoord(chain[0]!);
    const endKey = formatCoord(chain[chain.length - 1]!);

    return (
      `XY链：${chainDesc}，起点 ${startKey} 和终点 ${endKey}` +
      ` 共享数字 ${sharedDigit}，因此同时看到这两端的` +
      ` ${eliminations.length} 处可消去 ${sharedDigit}`
    );
  }

  // ================================================================
  // 内部 — DFS 搜索
  // ================================================================

  /**
   * DFS 搜索 XY-Chain。
   *
   * @param targetDigit  起点/终点共享的数字 (x)，即消去目标
   * @param linkDigit    当前格连接下一格所使用的数字
   * @param chain        当前已访问的格序列
   * @param visited      已访问格的 key 集合
   */
  private _dfsChain(
    current: CellCoord,
    targetDigit: Digit,
    linkDigit: Digit,
    chain: CellCoord[],
    visited: Set<string>,
    adj: Map<string, { cell: CellCoord; sharedDigit: Digit }[]>,
    candidates: CandidateSnapshot,
    peerSet: Map<string, Set<string>>,
    out: XYChainFinding[],
    maxLen: number,
  ): void {
    if (chain.length >= maxLen) return;

    const currentKey = coordKey(current);
    const neighbors = adj.get(currentKey) ?? [];

    for (const { cell: next, sharedDigit: shared } of neighbors) {
      const nextKey = coordKey(next);
      if (visited.has(nextKey)) continue;

      // 必须通过 linkDigit 连接
      if (shared !== linkDigit) continue;

      const nextDigits = candidates.getDigits(next) as [Digit, Digit];
      const otherDigit =
        nextDigits[0] === linkDigit ? nextDigits[1]! : nextDigits[0]!;

      // 其他数等于目标数 → 成链
      if (otherDigit === targetDigit && chain.length >= 2) {
        const startCoord = chain[0]!;
        const eliminations = this._findEliminations(
          startCoord, next, targetDigit, candidates, peerSet, chain,
        );
        if (eliminations.length > 0) {
          out.push({
            sharedDigit: targetDigit,
            chain: [...chain, next],
            eliminations,
          });
        }
        continue;
      }

      // 继续搜索
      visited.add(nextKey);
      chain.push(next);
      this._dfsChain(
        next, targetDigit, otherDigit, chain, visited,
        adj, candidates, peerSet, out, maxLen,
      );
      chain.pop();
      visited.delete(nextKey);
    }
  }

  // ================================================================
  // 内部 — 消去计算
  // ================================================================

  /**
   * 找出同时看到起点和终点、且拥有目标数字的格。
   */
  private _findEliminations(
    start: CellCoord,
    end: CellCoord,
    digit: Digit,
    candidates: CandidateSnapshot,
    peerSet: Map<string, Set<string>>,
    chain: CellCoord[],
  ): { coord: CellCoord; digit: Digit }[] {
    const eliminations: { coord: CellCoord; digit: Digit }[] = [];
    const chainSet = new Set(chain.map((c) => coordKey(c)));
    const startPeers = peerSet.get(coordKey(start)) ?? new Set();
    const endPeers = peerSet.get(coordKey(end)) ?? new Set();

    for (const peerKey of startPeers) {
      if (!endPeers.has(peerKey)) continue;
      if (chainSet.has(peerKey)) continue;
      const [r, c] = peerKey.split(",").map(Number) as [number, number];
      const coord: CellCoord = [r as RowIndex, c as ColIndex];
      if (candidates.has(coord, digit)) {
        eliminations.push({ coord, digit });
      }
    }

    return eliminations;
  }

  // ================================================================
  // 内部 — 工具
  // ================================================================

  private _sharedDigit(a: [Digit, Digit], b: [Digit, Digit]): Digit | null {
    if (a[0] === b[0] || a[0] === b[1]) return a[0];
    if (a[1] === b[0] || a[1] === b[1]) return a[1];
    return null;
  }

  private _arePeers(
    a: CellCoord,
    b: CellCoord,
    peerSet: Map<string, Set<string>>,
  ): boolean {
    const peers = peerSet.get(coordKey(a));
    return peers ? peers.has(coordKey(b)) : false;
  }

  /**
   * 为全部 81 格预计算同辈格键集合。
   */
  private _buildPeerSet(board: BoardReadonly): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        const key = coordKey(coord);
        const peers = board.getPeers(coord);
        const peerKeys = new Set(peers.map((p) => coordKey(p)));
        map.set(key, peerKeys);
      }
    }
    return map;
  }

  /** 按链签名去重 */
  private _deduplicateFindings(findings: XYChainFinding[]): XYChainFinding[] {
    const seen = new Set<string>();
    const result: XYChainFinding[] = [];
    for (const f of findings) {
      const chainKeys = f.chain.map((c) => coordKey(c)).sort();
      const signature = `${f.sharedDigit}|${chainKeys.join(",")}`;
      if (!seen.has(signature)) {
        seen.add(signature);
        result.push(f);
      }
    }
    return result;
  }

  // ================================================================
  // 内部 — 结果构建
  // ================================================================

  private buildResult(finding: XYChainFinding): TechniqueResult {
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
      involvedCells: finding.chain,
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

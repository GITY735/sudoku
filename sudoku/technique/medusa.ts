import type { CellCoord, Digit, RowIndex, ColIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, boxIndex, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// MedusaNode
// ============================================================

interface MedusaNode {
  readonly coord: CellCoord;
  readonly digit: Digit;
}

// ============================================================
// MedusaFinding
// ============================================================

interface MedusaFinding {
  /** 将被消去的候选数列表 */
  readonly eliminations: readonly { readonly coord: CellCoord; readonly digit: Digit }[];
  /** 参与推导的格 */
  readonly involvedCells: readonly CellCoord[];
  /** 规则类型 */
  readonly ruleType: "two_same_color_in_cell" | "two_same_color_in_unit" | "seen_by_both_colors";
  /** 详细上下文信息（供 explanation 拼接） */
  readonly detailCell: CellCoord;
  readonly detailDigit: Digit;
  readonly detailUnitLabel: string;
  readonly detailUnitIndex: number;
}

// ============================================================
// MedusaTechnique
// ============================================================

/**
 * 三维美杜莎 (3D Medusa)。
 *
 * 规则：将全部强链（共轭对 + 双值格）建成一张图，进行二着色。
 * 若某格有两个同色候选数、或某数字在同一单元有两个同色位置，
 * 则该色全体候选数可消去。
 * 若未着色格同时看到某数字的两种颜色，则该数字可从该格消去。
 *
 * 优先级：AdvancedChain (6)，归类：Coloring。
 */
export class MedusaTechnique implements Technique {
  readonly id = "3d-medusa";
  readonly name = "三维美杜莎";
  readonly nameEn = "3D Medusa";
  readonly priority = TechniquePriority.AdvancedChain;
  readonly category = TechniqueCategory.Coloring;

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

  detect(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): MedusaFinding[] {
    const results: MedusaFinding[] = [];

    // ---- 1. 收集所有候选节点 ----
    const nodeList: MedusaNode[] = [];
    const nodeIndex = new Map<string, number>();

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        const digits = candidates.getDigits(coord);
        for (const d of digits) {
          const key = nodeKey(coord, d);
          nodeIndex.set(key, nodeList.length);
          nodeList.push({ coord, digit: d });
        }
      }
    }

    if (nodeList.length === 0) return results;

    // ---- 2. 构建强链邻接表 ----
    const adj: number[][] = Array.from({ length: nodeList.length }, () => []);

    const addEdge = (a: number, b: number) => {
      if (a !== b && !adj[a]!.includes(b)) {
        adj[a]!.push(b);
        adj[b]!.push(a);
      }
    };

    // 2a. 共轭对：每个数字在每个单元中恰好出现 2 次
    for (const digit of ([1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[])) {
      for (const unitType of ["row", "col", "box"] as const) {
        for (let idx = 0; idx < 9; idx++) {
          const positions = candidates.getDigitPositionsInUnit(
            digit,
            unitType,
            idx,
          );
          if (positions.length !== 2) continue;
          const k1 = nodeKey(positions[0]!, digit);
          const k2 = nodeKey(positions[1]!, digit);
          const i1 = nodeIndex.get(k1);
          const i2 = nodeIndex.get(k2);
          if (i1 !== undefined && i2 !== undefined) {
            addEdge(i1, i2);
          }
        }
      }
    }

    // 2b. 双值格：同一格内两个候选数强链
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        const cnt = candidates.count(coord);
        if (cnt !== 2) continue;
        const digits = candidates.getDigits(coord);
        const k1 = nodeKey(coord, digits[0]!);
        const k2 = nodeKey(coord, digits[1]!);
        const i1 = nodeIndex.get(k1);
        const i2 = nodeIndex.get(k2);
        if (i1 !== undefined && i2 !== undefined) {
          addEdge(i1, i2);
        }
      }
    }

    // ---- 3. 对每个连通分量二着色 ----
    const colors = new Map<number, number>();
    const visited = new Set<number>();

    for (let i = 0; i < nodeList.length; i++) {
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

      // ---- 4. 在分量中寻找消去 ----
      const finding = this._analyzeComponent(
        component, nodeList, colors, candidates, board,
      );
      if (finding) {
        results.push(finding);
      }
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: MedusaFinding): string {
    const { ruleType, eliminations, detailCell, detailDigit, detailUnitLabel, detailUnitIndex } =
      finding;

    if (ruleType === "two_same_color_in_cell") {
      return (
        `三维美杜莎着色：${formatCoord(detailCell)} 有两个同色候选数，` +
        `该色全体 ${eliminations.length} 个候选数可消去`
      );
    }

    if (ruleType === "two_same_color_in_unit") {
      const label = detailUnitLabel;
      const idx = detailUnitIndex + 1;
      return (
        `三维美杜莎着色：数字 ${detailDigit} 在第 ${idx} ${label} 有两个同色位置，` +
        `该色全体 ${eliminations.length} 个候选数可消去`
      );
    }

    // seen_by_both_colors
    return (
      `三维美杜莎着色：${formatCoord(detailCell)} 同时看到数字 ${detailDigit} 的两种颜色，` +
      `因此可消去该数字（共 ${eliminations.length} 处）`
    );
  }

  // ================================================================
  // 内部 — 分量分析
  // ================================================================

  private _analyzeComponent(
    component: number[],
    nodeList: MedusaNode[],
    colors: Map<number, number>,
    candidates: CandidateSnapshot,
    board: BoardReadonly,
  ): MedusaFinding | null {
    // 按格分组：cellKey → { color → [nodeIdx] }
    const cellColorMap = new Map<string, Map<number, number[]>>();
    // 按 (单元类型|索引|数字) 分组
    const unitDigitColorMap = new Map<string, Map<number, number[]>>();

    for (const idx of component) {
      const { coord, digit } = nodeList[idx]!;
      const color = colors.get(idx)!;
      const ck = coordKey(coord);

      // 格内分组
      if (!cellColorMap.has(ck)) {
        cellColorMap.set(ck, new Map([[0, []], [1, []]]));
      }
      cellColorMap.get(ck)!.get(color)!.push(idx);

      // 单元-数字分组
      const bx = boxIndex(coord[0], coord[1]);
      const units: { type: string; idx: number }[] = [
        { type: "row", idx: coord[0] },
        { type: "col", idx: coord[1] },
        { type: "box", idx: bx },
      ];
      for (const ut of units) {
        const key = `${ut.type}|${ut.idx}|${digit}`;
        if (!unitDigitColorMap.has(key)) {
          unitDigitColorMap.set(key, new Map([[0, []], [1, []]]));
        }
        unitDigitColorMap.get(key)!.get(color)!.push(idx);
      }
    }

    // ---- 规则 1：同一格两个同色候选数 → 该色全部消除 ----
    for (const [cellKey, colorGroups] of cellColorMap) {
      for (const color of [0, 1]) {
        const nodes = colorGroups.get(color)!;
        if (nodes.length < 2) continue;

        const detailCoord = parseCoord(cellKey);
        return this._buildColorElimination(
          component, nodeList, colors, color,
          "two_same_color_in_cell",
          detailCoord, nodeList[nodes[0]!]!.digit,
          "", 0,
        );
      }
    }

    // ---- 规则 2：同一数字同色在同一单元出现两次 → 该色全部消除 ----
    for (const [key, colorGroups] of unitDigitColorMap) {
      for (const color of [0, 1]) {
        const nodes = colorGroups.get(color)!;
        if (nodes.length < 2) continue;

        const [ut, uidxStr, dStr] = key.split("|") as [string, string, string];
        const unitLabel = ut === "row" ? "行" : ut === "col" ? "列" : "宫";
        return this._buildColorElimination(
          component, nodeList, colors, color,
          "two_same_color_in_unit",
          nodeList[nodes[0]!]!.coord,
          Number(dStr) as Digit,
          unitLabel,
          Number(uidxStr),
        );
      }
    }

    // ---- 规则 3：未着色格看到某数字两种颜色 → 消去该数字 ----
    // 每种数字按颜色收集它在分量中的位置
    const coloredByDigit = new Map<Digit, Map<number, Set<string>>>();
    for (const idx of component) {
      const { coord, digit } = nodeList[idx]!;
      const color = colors.get(idx)!;
      if (!coloredByDigit.has(digit)) {
        coloredByDigit.set(digit, new Map([[0, new Set()], [1, new Set()]]));
      }
      coloredByDigit.get(digit)!.get(color)!.add(coordKey(coord));
    }

    // 收集分量内所有格键（用于快速跳过）
    const componentCellKeys = new Set<string>();
    for (const idx of component) {
      componentCellKeys.add(coordKey(nodeList[idx]!.coord));
    }

    // 预计算同辈关系
    const peerCache = this._buildPeerCache(board);

    for (const [digit, colorMap] of coloredByDigit) {
      const set0 = colorMap.get(0)!;
      const set1 = colorMap.get(1)!;
      if (set0.size === 0 || set1.size === 0) continue;

      // 扫描所有拥有此数字的格
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const coord: CellCoord = [r as RowIndex, c as ColIndex];
          const ck = coordKey(coord);

          // 跳过分量内的格
          if (componentCellKeys.has(ck)) continue;
          // 必须拥有该数字
          if (!candidates.has(coord, digit)) continue;

          // 检查是否同时看到两种颜色
          const peers = peerCache.get(ck);
          if (!peers) continue;
          let sees0 = false;
          let sees1 = false;
          for (const pk of peers) {
            if (set0.has(pk)) sees0 = true;
            if (set1.has(pk)) sees1 = true;
            if (sees0 && sees1) break;
          }

          if (sees0 && sees1) {
            // 检查是否还有其他同类格
            const eliminations: { coord: CellCoord; digit: Digit }[] = [];

            for (let rr = 0; rr < 9; rr++) {
              for (let cc = 0; cc < 9; cc++) {
                const cc2: CellCoord = [rr as RowIndex, cc as ColIndex];
                const ck2 = coordKey(cc2);
                if (componentCellKeys.has(ck2)) continue;
                if (!candidates.has(cc2, digit)) continue;
                const p2 = peerCache.get(ck2);
                if (!p2) continue;
                let s0 = false;
                let s1 = false;
                for (const pk of p2) {
                  if (set0.has(pk)) s0 = true;
                  if (set1.has(pk)) s1 = true;
                  if (s0 && s1) break;
                }
                if (s0 && s1) {
                  eliminations.push({ coord: cc2, digit });
                }
              }
            }

            if (eliminations.length > 0) {
              const involved: CellCoord[] = [];
              for (const idx of component) {
                involved.push(nodeList[idx]!.coord);
              }

              return {
                eliminations,
                involvedCells: this._uniqueCoords(involved),
                ruleType: "seen_by_both_colors",
                detailCell: coord,
                detailDigit: digit,
                detailUnitLabel: "",
                detailUnitIndex: 0,
              };
            }
          }
        }
      }
    }

    return null;
  }

  // ================================================================
  // 内部 — 构建"整色消除"结果
  // ================================================================

  private _buildColorElimination(
    component: number[],
    nodeList: MedusaNode[],
    colors: Map<number, number>,
    badColor: number,
    ruleType: "two_same_color_in_cell" | "two_same_color_in_unit",
    detailCell: CellCoord,
    detailDigit: Digit,
    detailUnitLabel: string,
    detailUnitIndex: number,
  ): MedusaFinding {
    const eliminations: { coord: CellCoord; digit: Digit }[] = [];
    const involved: CellCoord[] = [];

    for (const idx of component) {
      const { coord, digit } = nodeList[idx]!;
      involved.push(coord);
      if (colors.get(idx)! === badColor) {
        eliminations.push({ coord, digit });
      }
    }

    return {
      eliminations,
      involvedCells: this._uniqueCoords(involved),
      ruleType,
      detailCell,
      detailDigit,
      detailUnitLabel,
      detailUnitIndex,
    };
  }

  // ================================================================
  // 内部 — 工具
  // ================================================================

  /** 为全部 81 格预计算同辈格键集合，缓存复用。 */
  private _buildPeerCache(board: BoardReadonly): Map<string, Set<string>> {
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

  /** 从坐标列表中按字符串键去重。 */
  private _uniqueCoords(coords: CellCoord[]): CellCoord[] {
    const seen = new Set<string>();
    const result: CellCoord[] = [];
    for (const c of coords) {
      const k = coordKey(c);
      if (!seen.has(k)) {
        seen.add(k);
        result.push(c);
      }
    }
    return result;
  }

  // ================================================================
  // 内部 — 结果构建
  // ================================================================

  private buildResult(finding: MedusaFinding): TechniqueResult {
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
      involvedCells: finding.involvedCells,
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

function nodeKey(coord: CellCoord, digit: Digit): string {
  return `${coord[0]},${coord[1]}:${digit}`;
}

function parseCoord(key: string): CellCoord {
  const [r, c] = key.split(",").map(Number) as [number, number];
  return [r as RowIndex, c as ColIndex];
}

import type { CellCoord, Digit, RowIndex, ColIndex, BoxIndex } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, boxIndex, formatCoord } from "../types";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// SimpleColoringFinding
// ============================================================

interface SimpleColoringFinding {
  digit: Digit;
  /** 矛盾类型（同色冲突），还是消去类型（未着色格受两色影响） */
  type: "contradiction" | "elimination";
  /** 着色为 0 的格 */
  color0Cells: CellCoord[];
  /** 着色为 1 的格 */
  color1Cells: CellCoord[];
  /** 被消去的候选数及其所在格 */
  eliminations: { coord: CellCoord; digit: Digit }[];
}

// ============================================================
// 工具函数（不依赖 BoardReadonly）
// ============================================================

/** 判断 a 与 b 是否处于同一单元（行/列/宫） */
function arePeers(a: CellCoord, b: CellCoord): boolean {
  if (a[0] === b[0]) return true; // 同行
  if (a[1] === b[1]) return true; // 同列
  const ba = boxIndex(a[0], a[1]);
  const bb = boxIndex(b[0], b[1]);
  return ba === bb; // 同宫
}

/** 判断格是否属于指定单元 */
function inUnit(
  coord: CellCoord,
  unitType: "row" | "col" | "box",
  index: number,
): boolean {
  switch (unitType) {
    case "row":
      return coord[0] === index;
    case "col":
      return coord[1] === index;
    case "box":
      return boxIndex(coord[0], coord[1]) === index;
  }
}

// ============================================================
// SimpleColoringTechnique
// ============================================================

/**
 * Simple Coloring (单色链 / 简单着色法)。
 *
 * 规则：针对单个数字，基于共轭对（强链）进行双色交替着色：
 *   - 若两同色格处于同一单元 → 矛盾，该色所有格可消去该数字
 *   - 若未着色格同时受两色影响 → 该格可消去该数字
 *
 * 本实现仅使用强链（共轭对）。共轭对 = 某单元内该数字恰好出现在两格。
 *
 * 优先级：IntermediateChain (5)，归类：Coloring。
 */
export class SimpleColoringTechnique implements Technique {
  readonly id = "simple-coloring";
  readonly name = "单色链";
  readonly nameEn = "Simple Coloring";
  readonly priority = TechniquePriority.IntermediateChain;
  readonly category = TechniqueCategory.Coloring;

  // ================================================================
  // Technique 接口
  // ================================================================

  apply(
    _board: unknown,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null {
    const findings = this.detect(candidates);
    if (findings.length === 0) return null;

    findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
    return this.buildResult(findings[0]!);
  }

  // ================================================================
  // 检测
  // ================================================================

  /**
   * 对每个数字依次执行单色链算法，返回所有发现。
   */
  detect(candidates: CandidateSnapshot): SimpleColoringFinding[] {
    const results: SimpleColoringFinding[] = [];

    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      // ---- 构建共轭对邻接表 ----
      const adj = this._buildConjugateGraph(digit, candidates);

      if (adj.size === 0) continue;

      // ---- 按连通分量逐分量处理 ----
      const visited = new Set<string>();

      for (const [node] of adj) {
        if (visited.has(node)) continue;

        // BFS 着色该分量
        const componentColors = this._bfsColor(adj, node, visited);

        if (componentColors.size < 2) continue;

        const color0: CellCoord[] = [];
        const color1: CellCoord[] = [];
        for (const [key, col] of componentColors) {
          const [r, c] = key.split(",").map(Number) as [number, number];
          const coord: CellCoord = [r as RowIndex, c as ColIndex];
          if (col === 0) color0.push(coord);
          else color1.push(coord);
        }

        // ---- 检查同色冲突 ----
        const conflictColor = this._findConflict(color0, color1);

        if (conflictColor !== null) {
          const badCells = conflictColor === 0 ? color0 : color1;
          const eliminations = badCells.map((c) => ({ coord: c, digit }));
          results.push({
            digit,
            type: "contradiction",
            color0Cells: color0,
            color1Cells: color1,
            eliminations,
          });
          // 一个数字找到一个矛盾即跳出（同一数字可能有多个分量，但逐分量返回第一个矛盾）
          break;
        }

        // ---- 无矛盾：检查未着色格是否受两色影响 ----
        const eliminations = this._findSeesBothColors(
          digit,
          color0,
          color1,
          candidates,
          componentColors,
        );

        if (eliminations.length > 0) {
          results.push({
            digit,
            type: "elimination",
            color0Cells: color0,
            color1Cells: color1,
            eliminations,
          });
          // 找到一个消去即跳出（该分量已有收获）
          break;
        }
      }
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: SimpleColoringFinding): string {
    const { digit, type, color0Cells, color1Cells, eliminations } = finding;

    if (type === "contradiction") {
      // 尝试找出一对冲突的同色格作为示例
      const badColorCells = eliminations.map((e) => e.coord);
      const [witnessA, witnessB, unitDesc] =
        this._findConflictWitness(badColorCells);

      if (witnessA && witnessB) {
        return (
          `数字 ${digit} 的单色链发现矛盾：` +
          `${formatCoord(witnessA)} 和 ${formatCoord(witnessB)}` +
          `同为色 A 且处于同一${unitDesc}，` +
          `因此所有色 A 的 ${eliminations.length} 格可消去 ${digit}`
        );
      }

      return (
        `数字 ${digit} 的单色链发现矛盾：色 A 中存在同单元冲突，` +
        `因此 ${eliminations.length} 格可消去 ${digit}`
      );
    }

    // 消去类型：找一对异色格作为示例
    const [colorWitness, elimWitness] = this._findEliminationWitness(
      color0Cells,
      color1Cells,
      eliminations,
    );

    if (colorWitness && elimWitness) {
      return (
        `数字 ${digit} 的单色链中，` +
        `${formatCoord(colorWitness[0])}（色 A）与 ` +
        `${formatCoord(colorWitness[1])}（色 B）为共轭对，` +
        `同时影响 ${formatCoord(elimWitness)}，` +
        `可消去 ${eliminations.length} 格中的 ${digit}`
      );
    }

    return (
      `数字 ${digit} 的单色链中，` +
      `${eliminations.length} 格同时受色 A 和色 B 影响，可消去 ${digit}`
    );
  }

  // ================================================================
  // 内部：共轭对图构建
  // ================================================================

  /**
   * 对指定数字，遍历 27 个单元，找出所有共轭对（该数字恰好出现两次），
   * 构建无向图邻接表。
   */
  private _buildConjugateGraph(
    digit: Digit,
    candidates: CandidateSnapshot,
  ): Map<string, Set<string>> {
    const adj = new Map<string, Set<string>>();
    const addEdge = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    };

    for (let i = 0; i < 9; i++) {
      // 行
      this._addConjugateIfExists(
        digit,
        "row",
        i as RowIndex,
        candidates,
        addEdge,
      );
      // 列
      this._addConjugateIfExists(
        digit,
        "col",
        i as ColIndex,
        candidates,
        addEdge,
      );
      // 宫
      this._addConjugateIfExists(
        digit,
        "box",
        i as BoxIndex,
        candidates,
        addEdge,
      );
    }

    return adj;
  }

  private _addConjugateIfExists(
    digit: Digit,
    unitType: "row" | "col" | "box",
    index: number,
    candidates: CandidateSnapshot,
    addEdge: (a: string, b: string) => void,
  ): void {
    const positions = candidates.getDigitPositionsInUnit(
      digit,
      unitType,
      index,
    );
    if (positions.length === 2) {
      const a = positions[0]!;
      const b = positions[1]!;
      addEdge(`${a[0]},${a[1]}`, `${b[0]},${b[1]}`);
    }
  }

  // ================================================================
  // 内部：BFS 着色
  // ================================================================

  /**
   * 从 start 开始 BFS 遍历连通分量，交替着色 0/1。
   * 将访问过的节点加入 visited，返回该分量的颜色映射。
   */
  private _bfsColor(
    adj: Map<string, Set<string>>,
    start: string,
    visited: Set<string>,
  ): Map<string, 0 | 1> {
    const colors = new Map<string, 0 | 1>();
    const queue: string[] = [start];
    colors.set(start, 0);
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentColor = colors.get(current)!;
      const neighbors = adj.get(current);

      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          colors.set(neighbor, (currentColor === 0 ? 1 : 0) as 0 | 1);
          queue.push(neighbor);
        }
      }
    }

    return colors;
  }

  // ================================================================
  // 内部：冲突检测
  // ================================================================

  /**
   * 检查 color0 或 color1 中是否存在两格处于同一单元。
   * 若存在，返回冲突的颜色；否则返回 null。
   */
  private _findConflict(
    color0: CellCoord[],
    color1: CellCoord[],
  ): 0 | 1 | null {
    const unitTypes = ["row", "col", "box"] as const;

    for (const unitType of unitTypes) {
      for (let i = 0; i < 9; i++) {
        let count0 = 0;
        let count1 = 0;

        for (const c0 of color0) {
          if (inUnit(c0, unitType, i)) count0++;
          if (count0 >= 2) return 0;
        }

        for (const c1 of color1) {
          if (inUnit(c1, unitType, i)) count1++;
          if (count1 >= 2) return 1;
        }
      }
    }

    return null;
  }

  // ================================================================
  // 内部：受两色影响的未着色格
  // ================================================================

  /**
   * 找出所有未着色、但同辈格中同时出现色 0 和色 1 的单元格。
   * 这些格可消去 digit。
   */
  private _findSeesBothColors(
    digit: Digit,
    color0: CellCoord[],
    color1: CellCoord[],
    candidates: CandidateSnapshot,
    colored: Map<string, 0 | 1>,
  ): { coord: CellCoord; digit: Digit }[] {
    // 预计算每个单元是否包含色 0 / 色 1
    const unitHasColor0 = this._buildUnitColorPresence(color0);
    const unitHasColor1 = this._buildUnitColorPresence(color1);

    const eliminations: { coord: CellCoord; digit: Digit }[] = [];

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        const key = `${r},${c}`;

        // 跳过已着色格
        if (colored.has(key)) continue;
        // 跳过不含该候选数的格
        if (!candidates.has(coord, digit)) continue;

        // 检查是否受两色影响
        const box = boxIndex(r, c);
        const sees0 =
          unitHasColor0.row[r]! ||
          unitHasColor0.col[c]! ||
          unitHasColor0.box[box]!;
        const sees1 =
          unitHasColor1.row[r]! ||
          unitHasColor1.col[c]! ||
          unitHasColor1.box[box]!;

        if (sees0 && sees1) {
          eliminations.push({ coord, digit });
        }
      }
    }

    return eliminations;
  }

  private _buildUnitColorPresence(cells: CellCoord[]): {
    row: boolean[];
    col: boolean[];
    box: boolean[];
  } {
    const row = Array<boolean>(9).fill(false);
    const col = Array<boolean>(9).fill(false);
    const box = Array<boolean>(9).fill(false);

    for (const cell of cells) {
      row[cell[0]] = true;
      col[cell[1]] = true;
      box[boxIndex(cell[0], cell[1])] = true;
    }

    return { row, col, box };
  }

  // ================================================================
  // 内部：教学示例查找
  // ================================================================

  /**
   * 从同色冲突的格中找出一对互为同辈格的例子。
   */
  private _findConflictWitness(
    badCells: CellCoord[],
  ): [CellCoord, CellCoord, string] | [null, null, string] {
    for (let i = 0; i < badCells.length; i++) {
      for (let j = i + 1; j < badCells.length; j++) {
        const a = badCells[i]!;
        const b = badCells[j]!;
        if (a[0] === b[0]) return [a, b, `行（第 ${a[0] + 1} 行）`];
        if (a[1] === b[1]) return [a, b, `列（第 ${a[1] + 1} 列）`];
        if (boxIndex(a[0], a[1]) === boxIndex(b[0], b[1]))
          return [a, b, `宫（第 ${boxIndex(a[0], a[1]) + 1} 宫）`];
      }
    }
    return [null, null, ""];
  }

  /**
   * 从消去格中找出一对异色格作为教学示例。
   */
  private _findEliminationWitness(
    color0: CellCoord[],
    color1: CellCoord[],
    eliminations: readonly { coord: CellCoord; digit: Digit }[],
  ): [[CellCoord, CellCoord], CellCoord] | [null, null] {
    if (eliminations.length === 0) return [null, null];

    for (const elim of eliminations) {
      const eCoord = elim.coord;
      // 找同辈的色 0 格
      const peer0 = color0.find((c) => arePeers(c, eCoord));
      // 找同辈的色 1 格
      const peer1 = color1.find((c) => arePeers(c, eCoord));
      if (peer0 && peer1) {
        return [[peer0, peer1], eCoord];
      }
    }

    return [null, null];
  }

  // ================================================================
  // 内部：构建结果
  // ================================================================

  private buildResult(finding: SimpleColoringFinding): TechniqueResult {
    const allColored: CellCoord[] = [
      ...finding.color0Cells,
      ...finding.color1Cells,
    ];
    const elimCoords = new Set(
      finding.eliminations.map((e) => `${e.coord[0]},${e.coord[1]}`),
    );
    for (const coord of allColored) {
      elimCoords.add(`${coord[0]},${coord[1]}`);
    }
    const involvedCells: CellCoord[] = Array.from(elimCoords).map(
      (s) => {
        const [r, c] = s.split(",").map(Number) as [number, number];
        return [r as RowIndex, c as ColIndex] as CellCoord;
      },
    );

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

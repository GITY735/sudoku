import { Board } from "./board";
import type { CellCoord, CandidateMask, Digit, RowIndex, ColIndex, BoxIndex } from "./types";
import { CandidateMask as CM, ALL_CANDIDATES_MASK, boxIndex } from "./types";

// ---- 索引解包 ----
function r(coord: CellCoord): number {
  return coord[0];
}
function c(coord: CellCoord): number {
  return coord[1];
}

// ============================================================
// CandidateDelta — 一次操作带来的候选数变更
// ============================================================

export interface CandidateDelta {
  /** 本次被填入的格与值（无填值时 null） */
  readonly placement: { readonly coord: CellCoord; readonly digit: Digit } | null;

  /** 本次被消去的候选数列表 */
  readonly eliminations: readonly { readonly coord: CellCoord; readonly digit: Digit }[];

  /** 消去后候选数缩为 0 的格（矛盾格） */
  readonly contradictions: readonly CellCoord[];

  /** 消去后候选数缩为 1 的格（裸单一候选项） */
  readonly nakedSingles: readonly { readonly coord: CellCoord; readonly digit: Digit }[];
}

/** 内部构建器：收集变更，最后 freeze */
class DeltaBuilder {
  placement: { coord: CellCoord; digit: Digit } | null = null;
  eliminations: { coord: CellCoord; digit: Digit }[] = [];
  contradictions: CellCoord[] = [];
  nakedSingles: { coord: CellCoord; digit: Digit }[] = [];

  isEmpty(): boolean {
    return (
      this.placement === null &&
      this.eliminations.length === 0 &&
      this.contradictions.length === 0 &&
      this.nakedSingles.length === 0
    );
  }

  build(): CandidateDelta {
    return {
      placement: this.placement,
      eliminations: this.eliminations,
      contradictions: this.contradictions,
      nakedSingles: this.nakedSingles,
    };
  }

  /** 将本构建器的内容移入另一个构建器 */
  drainInto(target: DeltaBuilder): void {
    if (this.placement) target.placement = this.placement;
    for (const e of this.eliminations) target.eliminations.push(e);
    for (const c of this.contradictions) target.contradictions.push(c);
    for (const n of this.nakedSingles) target.nakedSingles.push(n);
  }
}

// ============================================================
// CandidateSnapshot — 不可变只读快照
// ============================================================

export class CandidateSnapshot {
  private readonly _grid: readonly (readonly CandidateMask[])[];

  constructor(grid: readonly (readonly CandidateMask[])[]) {
    // 浅冻结每行 — Object.freeze 返回 readonly，需强制对齐外层类型
    const frozen = grid.map((row) => Object.freeze([...row])) as unknown as readonly (readonly CandidateMask[])[];
    this._grid = Object.freeze(frozen);
    Object.freeze(this);
  }

  get grid(): readonly (readonly CandidateMask[])[] {
    return this._grid;
  }

  getMask(coord: CellCoord): CandidateMask {
    return this._grid[r(coord)]![c(coord)]!;
  }

  getDigits(coord: CellCoord): readonly Digit[] {
    return CM.toDigits(this.getMask(coord));
  }

  has(coord: CellCoord, digit: Digit): boolean {
    return CM.has(this.getMask(coord), digit);
  }

  count(coord: CellCoord): number {
    return CM.size(this.getMask(coord));
  }

  /** 某行/列/宫中包含某候选数的所有格坐标 */
  getDigitPositionsInUnit(
    digit: Digit,
    unitType: "row" | "col" | "box",
    index: number,
  ): CellCoord[] {
    let coords: readonly CellCoord[] = [];
    switch (unitType) {
      case "row":
        coords = Board.rowCells(index as RowIndex);
        break;
      case "col":
        coords = Board.colCells(index as ColIndex);
        break;
      case "box":
        coords = Board.boxCells(index as BoxIndex);
        break;
    }
    return coords.filter((coord) => CM.has(this.getMask(coord), digit));
  }

  /** 深拷贝一份可变的 CandidateMask[][] 供重建 */
  toMutableGrid(): CandidateMask[][] {
    return this._grid.map((row) => [...row]);
  }
}

// ============================================================
// CandidateManager — 候选数管理器（传播核心）
// ============================================================

/**
 * 核心不变式（自动维护）：
 *   - 已填格 → 候选数掩码为 0（不参与候选推理）
 *   - 空格   → 候选数掩码不包含任何同行/列/宫已填数字
 *
 * setValue() 触发传播：将数字从 20 个同辈格的候选数中移除。
 * removeCandidate() 仅移除一格中的一个候选数。
 *
 * 所有修改方法返回 CandidateDelta，
 * 调用方可以将其包装为 SolveStep 中的教学记录。
 */
export class CandidateManager {
  private _grid: CandidateMask[][];
  private _board: Board;

  constructor(board: Board, initFromBoard: boolean = true) {
    this._board = board;
    this._grid = Array.from({ length: 9 }, () =>
      Array.from({ length: 9 }, () => 0),
    );
    if (initFromBoard) {
      this.initFromBoard();
    }
  }

  // ================================================================
  // 初始化
  // ================================================================

  /** 根据盘面已知值重置全部候选数 */
  initFromBoard(): CandidateDelta {
    const db = new DeltaBuilder();

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const cell = this._board.getCell(row as RowIndex, col as ColIndex);
        if (cell.value !== 0) {
          this._grid[row]![col] = 0;
        } else {
          this._grid[row]![col] = this._computeCandidates(row as RowIndex, col as ColIndex);
          const mask = this._grid[row]![col]!;
          if (CM.isSingle(mask)) {
            db.nakedSingles.push({
              coord: [row as RowIndex, col as ColIndex],
              digit: CM.soleDigit(mask),
            });
          }
        }
      }
    }

    return db.build();
  }

  // ================================================================
  // 核心操作：setValue — 置值并自动传播到同辈格
  // ================================================================

  /**
   * 在某格填入确定值。
   *
   * 自动传播：
   *   1. 该格候选数归零（值已确定，无候选含义）
   *   2. 遍历该格的 20 个同辈格，逐一移除此数字
   *   3. 如果同辈格的候选数因此缩为 1 或 0，记录到 delta
   *
   * 调用顺序：先 Board.place()，再调用此方法。
   */
  setValue(coord: CellCoord, digit: Digit): CandidateDelta {
    const db = new DeltaBuilder();

    // 该格候选数归零（值已确定，无需候选）
    this._grid[r(coord)]![c(coord)] = 0;

    // 传播：从 20 个同辈格中移除此数字
    const peers = this._board.getPeers(coord);
    for (const peer of peers) {
      const before = this._grid[r(peer)]![c(peer)]!;
      if (before === 0) continue; // 已填格，跳过

      const after = CM.remove(before, digit);
      if (after === before) continue; // 本来就不包含此数字

      this._grid[r(peer)]![c(peer)] = after;
      db.eliminations.push({ coord: peer, digit });

      if (after === 0) {
        db.contradictions.push(peer);
      } else if (CM.isSingle(after)) {
        db.nakedSingles.push({ coord: peer, digit: CM.soleDigit(after) });
      }
    }

    return db.build();
  }

  /**
   * setValue 的无传播版本：仅将该格候选数归零，返回清理前的候选数。
   * 用于回溯恢复后重新建立候选状态。
   */
  lockValue(coord: CellCoord): CandidateDelta {
    const db = new DeltaBuilder();
    this._grid[r(coord)]![c(coord)] = 0;
    return db.build();
  }

  // ================================================================
  // 核心操作：removeCandidate — 移除单个候选数
  // ================================================================

  /**
   * 从指定格中移除一个候选数。
   *
   * 与 setValue 不同，此方法不传播到同辈格 —
   * 仅移除一格中的一个候选数。
   * 技巧模块可利用此方法记录推导结果。
   */
  removeCandidate(coord: CellCoord, digit: Digit): CandidateDelta {
    const db = new DeltaBuilder();
    const mask = this._grid[r(coord)]![c(coord)]!;

    if (!CM.has(mask, digit)) {
      return db.build(); // 本来就不包含，返回空 delta
    }

    const after = CM.remove(mask, digit);
    this._grid[r(coord)]![c(coord)] = after;
    db.eliminations.push({ coord, digit });

    if (after === 0) {
      db.contradictions.push(coord);
    } else if (CM.isSingle(after)) {
      db.nakedSingles.push({ coord, digit: CM.soleDigit(after) });
    }

    return db.build();
  }

  /**
   * 从指定格中批量移除多个候选数。
   *
   * 合并为单次 delta 返回（避免逐条 removeCandidate 产生多条记录）。
   */
  removeCandidates(coord: CellCoord, digits: readonly Digit[]): CandidateDelta {
    const db = new DeltaBuilder();
    let mask = this._grid[r(coord)]![c(coord)]!;

    for (const d of digits) {
      if (CM.has(mask, d)) {
        mask = CM.remove(mask, d);
        db.eliminations.push({ coord, digit: d });
      }
    }

    if (db.eliminations.length === 0) return db.build();

    this._grid[r(coord)]![c(coord)] = mask;

    if (mask === 0) {
      db.contradictions.push(coord);
    } else if (CM.isSingle(mask)) {
      db.nakedSingles.push({ coord, digit: CM.soleDigit(mask) });
    }

    return db.build();
  }

  /**
   * 将一格收缩为仅保留给定数字的候选集。
   *
   * 等价于移除该格中除保留数字外的所有其他候选数。
   */
  restrictTo(coord: CellCoord, digits: readonly Digit[]): CandidateDelta {
    const keep = CM.fromDigits(digits);
    const current = this._grid[r(coord)]![c(coord)]!;
    const toRemove = CM.subtract(current, keep);
    if (toRemove === 0) return new DeltaBuilder().build();
    return this.removeCandidates(coord, CM.toDigits(toRemove));
  }

  // ================================================================
  // 批量传播 — 对多个同辈格同时清理
  // ================================================================

  /**
   * 从一组同辈格中，移除除了指定保留格之外的所有格的某候选数。
   *
   * 用途：当一个数字在行/列/宫内只能出现在某几个格中时，
   * 其他格可以移除此候选数。
   */
  removeDigitFromPeersExcept(
    peers: readonly CellCoord[],
    digit: Digit,
    keepCoords: readonly CellCoord[],
  ): CandidateDelta {
    const db = new DeltaBuilder();
    const keepSet = new Set(keepCoords.map((coord) => `${r(coord)},${c(coord)}`));

    for (const peer of peers) {
      if (keepSet.has(`${r(peer)},${c(peer)}`)) continue;
      const mask = this._grid[r(peer)]![c(peer)]!;
      if (mask === 0 || !CM.has(mask, digit)) continue;

      this._grid[r(peer)]![c(peer)] = CM.remove(mask, digit);
      db.eliminations.push({ coord: peer, digit });

      const after = this._grid[r(peer)]![c(peer)]!;
      if (after === 0) {
        db.contradictions.push(peer);
      } else if (CM.isSingle(after)) {
        db.nakedSingles.push({ coord: peer, digit: CM.soleDigit(after) });
      }
    }

    return db.build();
  }

  // ================================================================
  // Delta 应用 — 将技巧返回的 CandidateDelta 直接写入 _grid
  // ================================================================

  /**
   * 将已有的 CandidateDelta 批量应用到内部候选数网格。
   *
   * 与 removeCandidate / setValue 不同：
   *   - 不重复探测 nakedSingles / contradictions（delta 中已记录）
   *   - 不触发传播（传播已由之前的 setValue 完成）
   *
   * 用途：Engine 从 TechniqueResult 中取出 delta，回写进 CandidateManager。
   */
  applyDelta(delta: CandidateDelta): void {
    if (delta.placement) {
      this._grid[r(delta.placement.coord)]![c(delta.placement.coord)] = 0;
    }
    for (const e of delta.eliminations) {
      const mask = this._grid[r(e.coord)]![c(e.coord)]!;
      if (mask !== 0) {
        this._grid[r(e.coord)]![c(e.coord)] = CM.remove(mask, e.digit);
      }
    }
  }

  // ================================================================
  // 查询
  // ================================================================

  getMask(coord: CellCoord): CandidateMask {
    return this._grid[r(coord)]![c(coord)]!;
  }

  getDigits(coord: CellCoord): readonly Digit[] {
    return CM.toDigits(this.getMask(coord));
  }

  has(coord: CellCoord, digit: Digit): boolean {
    return CM.has(this.getMask(coord), digit);
  }

  count(coord: CellCoord): number {
    return CM.size(this.getMask(coord));
  }

  /** 某行/列/宫中包含某候选数的所有位置 */
  getDigitPositionsInUnit(
    digit: Digit,
    unitType: "row" | "col" | "box",
    index: number,
  ): CellCoord[] {
    let coords: readonly CellCoord[] = [];
    switch (unitType) {
      case "row":
        coords = Board.rowCells(index as RowIndex);
        break;
      case "col":
        coords = Board.colCells(index as ColIndex);
        break;
      case "box":
        coords = Board.boxCells(index as BoxIndex);
        break;
    }
    return coords.filter((coord) => CM.has(this.getMask(coord), digit));
  }

  /** 获取某单元（行/列/宫）中所有格的全部候选数出现位置（按数字分组） */
  getDigitMapForUnit(
    unitType: "row" | "col" | "box",
    index: number,
  ): Map<Digit, CellCoord[]> {
    let coords: readonly CellCoord[] = [];
    switch (unitType) {
      case "row":
        coords = Board.rowCells(index as RowIndex);
        break;
      case "col":
        coords = Board.colCells(index as ColIndex);
        break;
      case "box":
        coords = Board.boxCells(index as BoxIndex);
        break;
    }

    const map = new Map<Digit, CellCoord[]>();
    for (const d of ([1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[])) {
      const positions: CellCoord[] = [];
      for (const coord of coords) {
        if (CM.has(this.getMask(coord), d)) {
          positions.push(coord);
        }
      }
      map.set(d, positions);
    }
    return map;
  }

  // ================================================================
  // 不可变快照
  // ================================================================

  /** 返回当前候选数网格的不可变快照（供技巧模块使用） */
  snapshot(): CandidateSnapshot {
    return new CandidateSnapshot(this._grid);
  }

  // ================================================================
  // 回退：从快照恢复
  // ================================================================

  /** 从快照恢复候选数网格（回溯用） */
  restoreFrom(snapshot: CandidateSnapshot): void {
    const src = snapshot.toMutableGrid();
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        this._grid[row]![col] = src[row]![col]!;
      }
    }
  }

  // ================================================================
  // 内部工具
  // ================================================================

  /**
   * 计算一格应有的候选数全集：
   * {1..9} 减去同行、同列、同宫中已确定的值。
   */
  private _computeCandidates(row: RowIndex, col: ColIndex): CandidateMask {
    let mask = ALL_CANDIDATES_MASK;

    // 排除同行已填数字
    const rowCells = this._board.getRow(row);
    for (const cell of rowCells) {
      if (cell.value !== 0) mask = CM.remove(mask, cell.value);
    }

    // 排除同列已填数字
    const colCells = this._board.getCol(col);
    for (const cell of colCells) {
      if (cell.value !== 0) mask = CM.remove(mask, cell.value);
    }

    // 排除同宫已填数字
    const bx = boxIndex(row, col);
    const boxCellList = this._board.getBox(bx);
    for (const cell of boxCellList) {
      if (cell.value !== 0) mask = CM.remove(mask, cell.value);
    }

    return mask;
  }
}

// ============================================================
// 合并工具：将多个 CandidateDelta 合并为一个
// ============================================================

export function mergeDeltas(deltas: readonly CandidateDelta[]): CandidateDelta {
  const db = new DeltaBuilder();

  for (const d of deltas) {
    if (d.placement) db.placement = d.placement;
    for (const e of d.eliminations) db.eliminations.push(e);
    for (const c of d.contradictions) db.contradictions.push(c);
    for (const n of d.nakedSingles) db.nakedSingles.push(n);
  }

  // 去重 eliminations（同格同数字合并为一条）
  const dedup = new Map<string, { coord: CellCoord; digit: Digit }>();
  for (const e of db.eliminations) {
    dedup.set(`${r(e.coord)},${c(e.coord)}:${e.digit}`, e);
  }
  db.eliminations = [...dedup.values()];

  return db.build();
}

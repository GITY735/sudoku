"use strict";
var SudokuApp = (() => {
  // ../../ClaudeSafe/sudoku/types.ts
  var ALL_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  var ALL_CANDIDATES_MASK = 1 << 1 | 1 << 2 | 1 << 3 | 1 << 4 | 1 << 5 | 1 << 6 | 1 << 7 | 1 << 8 | 1 << 9;
  var CandidateMask = {
    /** 空集 */
    empty: 0,
    /** 全集 {1..9} */
    all: ALL_CANDIDATES_MASK,
    /** 从数字列表构建掩码 */
    fromDigits(digits) {
      let mask = 0;
      for (const d of digits) {
        mask |= 1 << d;
      }
      return mask;
    },
    /** 添加一个数字，返回新掩码（不变原值） */
    add(mask, digit) {
      return mask | 1 << digit;
    },
    /** 移除一个数字，返回新掩码（不变原值） */
    remove(mask, digit) {
      return mask & ~(1 << digit);
    },
    /** 是否包含某数字 */
    has(mask, digit) {
      return (mask & 1 << digit) !== 0;
    },
    /** 集合大小（popcount） */
    size(mask) {
      let n = mask;
      n = n - (n >>> 1 & 1431655765);
      n = (n & 858993459) + (n >>> 2 & 858993459);
      n = n + (n >>> 4) & 252645135;
      n = n + (n >>> 8);
      n = n + (n >>> 16);
      return n & 63;
    },
    /** 将掩码转为数字数组（已排序） */
    toDigits(mask) {
      const result = [];
      for (let d = 1; d <= 9; d++) {
        if (CandidateMask.has(mask, d)) {
          result.push(d);
        }
      }
      return result;
    },
    /** 合并两个掩码，返回新掩码 */
    union(a, b) {
      return a | b;
    },
    /** 交集，返回新掩码 */
    intersect(a, b) {
      return a & b;
    },
    /** 差集：a 中有但 b 中没有 */
    subtract(a, b) {
      return a & ~b;
    },
    /** 只有一位被置位（即恰好一个候选数） */
    isSingle(mask) {
      return mask !== 0 && (mask & mask - 1) === 0;
    },
    /** 获取 sole candidate 的数字（mask 必须只有一位被置位） */
    soleDigit(mask) {
      let i = 0;
      while (mask !== 0) {
        if (mask & 1) return i;
        mask >>>= 1;
        i++;
      }
      throw new Error("CandidateMask is zero \u2014 no sole digit");
    }
  };
  function boxIndex(row, col) {
    return Math.floor(row / 3) * 3 + Math.floor(col / 3);
  }
  function boxCells(box) {
    const startRow = Math.floor(box / 3) * 3;
    const startCol = box % 3 * 3;
    const cells = [];
    for (let r3 = startRow; r3 < startRow + 3; r3++) {
      for (let c3 = startCol; c3 < startCol + 3; c3++) {
        cells.push([r3, c3]);
      }
    }
    return cells;
  }
  function formatCoord(coord) {
    return `r${coord[0] + 1}c${coord[1] + 1}`;
  }

  // ../../ClaudeSafe/sudoku/cell.ts
  var Cell = class _Cell {
    coord;
    row;
    col;
    box;
    _value;
    // 0 = 空
    _state;
    _candidates;
    // 由 CandidateManager 写入
    constructor(coord, value = 0, state) {
      this.coord = coord;
      this.row = coord[0];
      this.col = coord[1];
      this.box = boxIndex(this.row, this.col);
      this._value = value;
      this._state = state ?? (value === 0 ? "empty" /* Empty */ : "given" /* Given */);
      this._candidates = 0;
    }
    // ---- 只读 ----
    get value() {
      return this._value;
    }
    get state() {
      return this._state;
    }
    get candidates() {
      return this._candidates;
    }
    get candidateCount() {
      let n = this._candidates;
      n = n - (n >>> 1 & 1431655765);
      n = (n & 858993459) + (n >>> 2 & 858993459);
      n = n + (n >>> 4) & 252645135;
      n = n + (n >>> 8);
      n = n + (n >>> 16);
      return n & 63;
    }
    isEmpty() {
      return this._state === "empty" /* Empty */;
    }
    isGiven() {
      return this._state === "given" /* Given */;
    }
    // ---- 写入（仅供 Board / CandidateManager 调用） ----
    setValue(value, state) {
      this._value = value;
      this._state = state;
      this._candidates = value === 0 ? 0 : 1 << value;
    }
    clearValue() {
      this._value = 0;
      this._state = "empty" /* Empty */;
    }
    setCandidates(mask) {
      this._candidates = mask;
    }
    // ---- 工具 ----
    clone() {
      const c3 = new _Cell(this.coord, this._value, this._state);
      c3._candidates = this._candidates;
      return c3;
    }
    /** 判断此格是否与另一格相同位置 */
    is(coord) {
      return this.row === coord[0] && this.col === coord[1];
    }
  };

  // ../../ClaudeSafe/sudoku/board.ts
  function buildPeerTable() {
    const table = Array.from({ length: 81 }, () => []);
    for (let r3 = 0; r3 < 9; r3++) {
      for (let c3 = 0; c3 < 9; c3++) {
        const set = /* @__PURE__ */ new Set();
        const key = (rr, cc) => `${rr},${cc}`;
        for (let cc = 0; cc < 9; cc++) {
          if (cc !== c3) set.add(key(r3, cc));
        }
        for (let rr = 0; rr < 9; rr++) {
          if (rr !== r3) set.add(key(rr, c3));
        }
        const sr = Math.floor(r3 / 3) * 3;
        const sc = Math.floor(c3 / 3) * 3;
        for (let rr = sr; rr < sr + 3; rr++) {
          for (let cc = sc; cc < sc + 3; cc++) {
            if (rr !== r3 || cc !== c3) set.add(key(rr, cc));
          }
        }
        const idx = r3 * 9 + c3;
        for (const k of set) {
          const parts = k.split(",").map(Number);
          table[idx].push([parts[0], parts[1]]);
        }
      }
    }
    return table;
  }
  var PEER_TABLE = buildPeerTable();
  function buildUnitTable(getCells) {
    return Array.from({ length: 9 }, (_, i) => getCells(i));
  }
  var ROW_CELLS = buildUnitTable(
    (row) => Array.from({ length: 9 }, (_, c3) => [row, c3])
  );
  var COL_CELLS = buildUnitTable(
    (col) => Array.from({ length: 9 }, (_, r3) => [r3, col])
  );
  var BOX_CELLS = buildUnitTable((box) => boxCells(box));
  function r(coord) {
    return coord[0];
  }
  function c(coord) {
    return coord[1];
  }
  var Board = class _Board {
    _cells;
    constructor(puzzle) {
      this._cells = Array.from(
        { length: 9 },
        (_, row) => Array.from({ length: 9 }, (_2, col) => new Cell([row, col]))
      );
      if (puzzle) this.loadPuzzle(puzzle);
    }
    // ---- 初始化 ----
    loadPuzzle(puzzle) {
      const chars = puzzle.replace(/\s/g, "").split("");
      for (let i = 0; i < Math.min(chars.length, 81); i++) {
        const ch = chars[i];
        const d = parseInt(ch, 10);
        if (d >= 1 && d <= 9) {
          const row = Math.floor(i / 9);
          const col = i % 9;
          this.place([row, col], d, "given" /* Given */);
        }
      }
    }
    getCell(rowOrCoord, col) {
      if (Array.isArray(rowOrCoord)) {
        const row = rowOrCoord[0];
        const cIdx = rowOrCoord[1];
        return this._cells[row][cIdx];
      }
      return this._cells[rowOrCoord][col];
    }
    get cells() {
      return this._cells;
    }
    // ---- 单元查询 ----
    getRow(row) {
      return ROW_CELLS[row].map(([rr, cc]) => this._cells[rr][cc]);
    }
    getCol(col) {
      return COL_CELLS[col].map(([rr, cc]) => this._cells[rr][cc]);
    }
    getBox(box) {
      return BOX_CELLS[box].map(([rr, cc]) => this._cells[rr][cc]);
    }
    getDigitPositions(digit, unit, index) {
      let cells = [];
      switch (unit) {
        case "row":
          cells = this.getRow(index);
          break;
        case "col":
          cells = this.getCol(index);
          break;
        case "box":
          cells = this.getBox(index);
          break;
      }
      return cells.filter((cel) => cel.value === digit).map((cel) => cel.coord);
    }
    // ---- 同辈格 ----
    getPeers(coord) {
      return PEER_TABLE[r(coord) * 9 + c(coord)];
    }
    getSeenByValue(coord) {
      const peers = this.getPeers(coord);
      const result = [];
      const val = this.getCell(coord).value;
      if (val === 0) return result;
      for (const p of peers) {
        if (this.getCell(p).value === val) {
          result.push(p);
        }
      }
      return result;
    }
    // ---- 状态查询 ----
    isSolved() {
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          if (this._cells[row][col].value === 0) return false;
        }
      }
      return this.isValid();
    }
    isValid() {
      for (let i = 0; i < 9; i++) {
        if (!this._unitValid(this.getRow(i))) return false;
        if (!this._unitValid(this.getCol(i))) return false;
        if (!this._unitValid(this.getBox(i))) return false;
      }
      return true;
    }
    _unitValid(cells) {
      const seen = /* @__PURE__ */ new Set();
      for (const cel of cells) {
        if (cel.value === 0) continue;
        if (seen.has(cel.value)) return false;
        seen.add(cel.value);
      }
      return true;
    }
    emptyCount() {
      let n = 0;
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          if (this._cells[row][col].value === 0) n++;
        }
      }
      return n;
    }
    // ---- 修改 ----
    place(coord, digit, state = "solved" /* Solved */) {
      const cell = this._cells[r(coord)][c(coord)];
      cell.setValue(digit, state);
    }
    placeBatch(placements) {
      for (const p of placements) {
        this.place(p.coord, p.digit, "solved" /* Solved */);
      }
    }
    clear(coord) {
      this._cells[r(coord)][c(coord)].clearValue();
    }
    // ---- 工具 ----
    toPuzzleString() {
      let s = "";
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          const v = this._cells[row][col].value;
          s += v === 0 ? "0" : String(v);
        }
      }
      return s;
    }
    clone() {
      const b = new _Board();
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          const src = this._cells[row][col];
          const dst = b._cells[row][col];
          dst.setValue(src.value, src.state);
          dst.setCandidates(src.candidates);
        }
      }
      return b;
    }
    // ---- 静态工具 ----
    static boxIndex(row, col) {
      return boxIndex(row, col);
    }
    static boxCells(box) {
      return [...BOX_CELLS[box]];
    }
    static rowCells(row) {
      return [...ROW_CELLS[row]];
    }
    static colCells(col) {
      return [...COL_CELLS[col]];
    }
    static allCoords() {
      const coords = [];
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          coords.push([row, col]);
        }
      }
      return coords;
    }
  };

  // ../../ClaudeSafe/sudoku/candidate.ts
  function r2(coord) {
    return coord[0];
  }
  function c2(coord) {
    return coord[1];
  }
  var DeltaBuilder = class {
    placement = null;
    eliminations = [];
    contradictions = [];
    nakedSingles = [];
    isEmpty() {
      return this.placement === null && this.eliminations.length === 0 && this.contradictions.length === 0 && this.nakedSingles.length === 0;
    }
    build() {
      return {
        placement: this.placement,
        eliminations: this.eliminations,
        contradictions: this.contradictions,
        nakedSingles: this.nakedSingles
      };
    }
    /** 将本构建器的内容移入另一个构建器 */
    drainInto(target) {
      if (this.placement) target.placement = this.placement;
      for (const e of this.eliminations) target.eliminations.push(e);
      for (const c3 of this.contradictions) target.contradictions.push(c3);
      for (const n of this.nakedSingles) target.nakedSingles.push(n);
    }
  };
  var CandidateSnapshot = class {
    _grid;
    constructor(grid) {
      const frozen = grid.map((row) => Object.freeze([...row]));
      this._grid = Object.freeze(frozen);
      Object.freeze(this);
    }
    get grid() {
      return this._grid;
    }
    getMask(coord) {
      return this._grid[r2(coord)][c2(coord)];
    }
    getDigits(coord) {
      return CandidateMask.toDigits(this.getMask(coord));
    }
    has(coord, digit) {
      return CandidateMask.has(this.getMask(coord), digit);
    }
    count(coord) {
      return CandidateMask.size(this.getMask(coord));
    }
    /** 某行/列/宫中包含某候选数的所有格坐标 */
    getDigitPositionsInUnit(digit, unitType, index) {
      let coords = [];
      switch (unitType) {
        case "row":
          coords = Board.rowCells(index);
          break;
        case "col":
          coords = Board.colCells(index);
          break;
        case "box":
          coords = Board.boxCells(index);
          break;
      }
      return coords.filter((coord) => CandidateMask.has(this.getMask(coord), digit));
    }
    /** 深拷贝一份可变的 CandidateMask[][] 供重建 */
    toMutableGrid() {
      return this._grid.map((row) => [...row]);
    }
  };
  var CandidateManager = class {
    _grid;
    _board;
    constructor(board2, initFromBoard = true) {
      this._board = board2;
      this._grid = Array.from(
        { length: 9 },
        () => Array.from({ length: 9 }, () => 0)
      );
      if (initFromBoard) {
        this.initFromBoard();
      }
    }
    // ================================================================
    // 初始化
    // ================================================================
    /** 根据盘面已知值重置全部候选数 */
    initFromBoard() {
      const db = new DeltaBuilder();
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          const cell = this._board.getCell(row, col);
          if (cell.value !== 0) {
            this._grid[row][col] = 0;
          } else {
            this._grid[row][col] = this._computeCandidates(row, col);
            const mask = this._grid[row][col];
            if (CandidateMask.isSingle(mask)) {
              db.nakedSingles.push({
                coord: [row, col],
                digit: CandidateMask.soleDigit(mask)
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
    setValue(coord, digit) {
      const db = new DeltaBuilder();
      this._grid[r2(coord)][c2(coord)] = 0;
      const peers = this._board.getPeers(coord);
      for (const peer of peers) {
        const before = this._grid[r2(peer)][c2(peer)];
        if (before === 0) continue;
        const after = CandidateMask.remove(before, digit);
        if (after === before) continue;
        this._grid[r2(peer)][c2(peer)] = after;
        db.eliminations.push({ coord: peer, digit });
        if (after === 0) {
          db.contradictions.push(peer);
        } else if (CandidateMask.isSingle(after)) {
          db.nakedSingles.push({ coord: peer, digit: CandidateMask.soleDigit(after) });
        }
      }
      return db.build();
    }
    /**
     * setValue 的无传播版本：仅将该格候选数归零，返回清理前的候选数。
     * 用于回溯恢复后重新建立候选状态。
     */
    lockValue(coord) {
      const db = new DeltaBuilder();
      this._grid[r2(coord)][c2(coord)] = 0;
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
    removeCandidate(coord, digit) {
      const db = new DeltaBuilder();
      const mask = this._grid[r2(coord)][c2(coord)];
      if (!CandidateMask.has(mask, digit)) {
        return db.build();
      }
      const after = CandidateMask.remove(mask, digit);
      this._grid[r2(coord)][c2(coord)] = after;
      db.eliminations.push({ coord, digit });
      if (after === 0) {
        db.contradictions.push(coord);
      } else if (CandidateMask.isSingle(after)) {
        db.nakedSingles.push({ coord, digit: CandidateMask.soleDigit(after) });
      }
      return db.build();
    }
    /**
     * 从指定格中批量移除多个候选数。
     *
     * 合并为单次 delta 返回（避免逐条 removeCandidate 产生多条记录）。
     */
    removeCandidates(coord, digits) {
      const db = new DeltaBuilder();
      let mask = this._grid[r2(coord)][c2(coord)];
      for (const d of digits) {
        if (CandidateMask.has(mask, d)) {
          mask = CandidateMask.remove(mask, d);
          db.eliminations.push({ coord, digit: d });
        }
      }
      if (db.eliminations.length === 0) return db.build();
      this._grid[r2(coord)][c2(coord)] = mask;
      if (mask === 0) {
        db.contradictions.push(coord);
      } else if (CandidateMask.isSingle(mask)) {
        db.nakedSingles.push({ coord, digit: CandidateMask.soleDigit(mask) });
      }
      return db.build();
    }
    /**
     * 将一格收缩为仅保留给定数字的候选集。
     *
     * 等价于移除该格中除保留数字外的所有其他候选数。
     */
    restrictTo(coord, digits) {
      const keep = CandidateMask.fromDigits(digits);
      const current = this._grid[r2(coord)][c2(coord)];
      const toRemove = CandidateMask.subtract(current, keep);
      if (toRemove === 0) return new DeltaBuilder().build();
      return this.removeCandidates(coord, CandidateMask.toDigits(toRemove));
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
    removeDigitFromPeersExcept(peers, digit, keepCoords) {
      const db = new DeltaBuilder();
      const keepSet = new Set(keepCoords.map((coord) => `${r2(coord)},${c2(coord)}`));
      for (const peer of peers) {
        if (keepSet.has(`${r2(peer)},${c2(peer)}`)) continue;
        const mask = this._grid[r2(peer)][c2(peer)];
        if (mask === 0 || !CandidateMask.has(mask, digit)) continue;
        this._grid[r2(peer)][c2(peer)] = CandidateMask.remove(mask, digit);
        db.eliminations.push({ coord: peer, digit });
        const after = this._grid[r2(peer)][c2(peer)];
        if (after === 0) {
          db.contradictions.push(peer);
        } else if (CandidateMask.isSingle(after)) {
          db.nakedSingles.push({ coord: peer, digit: CandidateMask.soleDigit(after) });
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
    applyDelta(delta) {
      if (delta.placement) {
        this._grid[r2(delta.placement.coord)][c2(delta.placement.coord)] = 0;
      }
      for (const e of delta.eliminations) {
        const mask = this._grid[r2(e.coord)][c2(e.coord)];
        if (mask !== 0) {
          this._grid[r2(e.coord)][c2(e.coord)] = CandidateMask.remove(mask, e.digit);
        }
      }
    }
    // ================================================================
    // 查询
    // ================================================================
    getMask(coord) {
      return this._grid[r2(coord)][c2(coord)];
    }
    getDigits(coord) {
      return CandidateMask.toDigits(this.getMask(coord));
    }
    has(coord, digit) {
      return CandidateMask.has(this.getMask(coord), digit);
    }
    count(coord) {
      return CandidateMask.size(this.getMask(coord));
    }
    /** 某行/列/宫中包含某候选数的所有位置 */
    getDigitPositionsInUnit(digit, unitType, index) {
      let coords = [];
      switch (unitType) {
        case "row":
          coords = Board.rowCells(index);
          break;
        case "col":
          coords = Board.colCells(index);
          break;
        case "box":
          coords = Board.boxCells(index);
          break;
      }
      return coords.filter((coord) => CandidateMask.has(this.getMask(coord), digit));
    }
    /** 获取某单元（行/列/宫）中所有格的全部候选数出现位置（按数字分组） */
    getDigitMapForUnit(unitType, index) {
      let coords = [];
      switch (unitType) {
        case "row":
          coords = Board.rowCells(index);
          break;
        case "col":
          coords = Board.colCells(index);
          break;
        case "box":
          coords = Board.boxCells(index);
          break;
      }
      const map = /* @__PURE__ */ new Map();
      for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const positions = [];
        for (const coord of coords) {
          if (CandidateMask.has(this.getMask(coord), d)) {
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
    snapshot() {
      return new CandidateSnapshot(this._grid);
    }
    // ================================================================
    // 回退：从快照恢复
    // ================================================================
    /** 从快照恢复候选数网格（回溯用） */
    restoreFrom(snapshot) {
      const src = snapshot.toMutableGrid();
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          this._grid[row][col] = src[row][col];
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
    _computeCandidates(row, col) {
      let mask = ALL_CANDIDATES_MASK;
      const rowCells = this._board.getRow(row);
      for (const cell of rowCells) {
        if (cell.value !== 0) mask = CandidateMask.remove(mask, cell.value);
      }
      const colCells = this._board.getCol(col);
      for (const cell of colCells) {
        if (cell.value !== 0) mask = CandidateMask.remove(mask, cell.value);
      }
      const bx = boxIndex(row, col);
      const boxCellList = this._board.getBox(bx);
      for (const cell of boxCellList) {
        if (cell.value !== 0) mask = CandidateMask.remove(mask, cell.value);
      }
      return mask;
    }
  };
  function mergeDeltas(deltas) {
    const db = new DeltaBuilder();
    for (const d of deltas) {
      if (d.placement) db.placement = d.placement;
      for (const e of d.eliminations) db.eliminations.push(e);
      for (const c3 of d.contradictions) db.contradictions.push(c3);
      for (const n of d.nakedSingles) db.nakedSingles.push(n);
    }
    const dedup = /* @__PURE__ */ new Map();
    for (const e of db.eliminations) {
      dedup.set(`${r2(e.coord)},${c2(e.coord)}:${e.digit}`, e);
    }
    db.eliminations = [...dedup.values()];
    return db.build();
  }

  // ../../ClaudeSafe/sudoku/technique/manager.ts
  var TechniqueManager = class {
    _techniques = [];
    _events = {};
    // ================================================================
    // TechniqueRegistry 实现
    // ================================================================
    register(technique) {
      if (this._techniques.some((t) => t.id === technique.id)) {
        throw new Error(`Technique "${technique.id}" already registered`);
      }
      this._techniques.push(technique);
      this._techniques.sort((a, b) => a.priority - b.priority);
    }
    getByPriority(priority) {
      return this._techniques.filter((t) => t.priority === priority);
    }
    getAll() {
      return this._techniques;
    }
    find(id) {
      return this._techniques.find((t) => t.id === id);
    }
    // ================================================================
    // 事件
    // ================================================================
    setEvents(events) {
      this._events = events;
    }
    // ================================================================
    // 执行 — 每次从 Basic 起逐技巧尝试，返回首个发现
    // ================================================================
    /**
     * 尝试在当前盘面上寻找一步推导。
     *
     * 执行顺序：
     *   1. 从最低优先级（Basic）开始
     *   2. 在该优先级内依次尝试每条技巧
     *   3. 若某技巧成功 → 立即返回结果，内部指针归零
     *   4. 若某优先级全部技巧均无发现 → 触发 onLevelExhausted，继续下一级
     *   5. 全部技巧（含 BruteForce）均无发现 → 返回 null
     *
     * 每次调用独立：上一次成功后的状态变更已反映在 board / candidates 中。
     */
    next(board2, candidates) {
      let currentPriority = null;
      let priorityExhausted = true;
      for (const technique of this._techniques) {
        if (currentPriority === null || technique.priority !== currentPriority) {
          if (currentPriority !== null && priorityExhausted) {
            this._events.onLevelExhausted?.(currentPriority);
          }
          currentPriority = technique.priority;
          priorityExhausted = true;
        }
        const result = technique.apply(board2, candidates);
        if (result !== null) {
          return result;
        }
      }
      if (currentPriority !== null && priorityExhausted) {
        this._events.onLevelExhausted?.(currentPriority);
      }
      return null;
    }
    /**
     * 仅在某一优先级层级内尝试。
     * 用于 Engine 需要在特定层级内查找但不触发跨级遍历的场景。
     */
    tryLevel(priority, board2, candidates) {
      const techs = this.getByPriority(priority);
      for (const t of techs) {
        const result = t.apply(board2, candidates);
        if (result !== null) return result;
      }
      return null;
    }
    // ================================================================
    // 查询
    // ================================================================
    get count() {
      return this._techniques.length;
    }
    /** 已注册技巧的优先级分布 */
    distribution() {
      const map = /* @__PURE__ */ new Map();
      for (const t of this._techniques) {
        map.set(t.priority, (map.get(t.priority) ?? 0) + 1);
      }
      return map;
    }
  };

  // ../../ClaudeSafe/sudoku/technique/naked-single.ts
  var NakedSingleTechnique = class {
    id = "naked-single";
    name = "\u552F\u4F59\u6CD5";
    nameEn = "Naked Single";
    priority = 0 /* Basic */;
    category = "placement" /* Placement */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(board2, candidates);
      if (findings.length === 0) return null;
      const target = findings[0];
      return this.buildResult(target, board2, candidates);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描盘面，返回所有裸单一格的坐标。
     * 裸单一：空格且候选数恰好为 1。
     */
    detect(board2, candidates) {
      const results = [];
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const cell = board2.getCell(r3, c3);
          if (cell.value !== 0) continue;
          if (candidates.count([r3, c3]) === 1) {
            results.push([r3, c3]);
          }
        }
      }
      return results;
    }
    /**
     * 在指定格中检测是否为裸单一。
     * 是 → 返回候选数字；否 → 返回 null。
     */
    detectAt(coord, board2, candidates) {
      if (board2.getCell(coord).value !== 0) return null;
      if (candidates.count(coord) !== 1) return null;
      return candidates.getDigits(coord)[0];
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
    explanation(coord, digit, peersAffected) {
      let desc = `\u683C ${formatCoord(coord)} \u53EA\u5269\u552F\u4E00\u5019\u9009\u6570 ${digit}`;
      if (peersAffected && peersAffected.length > 0) {
        const sample = peersAffected.slice(0, 5);
        const items = sample.map((p) => formatCoord(p)).join("\u3001");
        const suffix = peersAffected.length > 5 ? `\u7B49 ${peersAffected.length} \u683C` : "";
        desc += `\uFF0C\u586B\u5165\u540E\u5C06\u6D88\u53BB ${items}${suffix} \u4E2D\u7684\u5019\u9009\u6570 ${digit}`;
      }
      return desc;
    }
    // ================================================================
    // 内部
    // ================================================================
    buildResult(coord, board2, candidates) {
      const digit = candidates.getDigits(coord)[0];
      const peers = board2.getPeers(coord);
      const affectedPeers = [];
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
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: { coord, digit },
          eliminations: affectedPeers.map((p) => ({ coord: p, digit })),
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: [coord],
        description
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/hidden-single.ts
  var UNIT_LABEL = {
    row: "\u884C",
    col: "\u5217",
    box: "\u5BAB"
  };
  var HiddenSingleTechnique = class {
    id = "hidden-single";
    name = "\u6452\u9664\u6CD5";
    nameEn = "Hidden Single";
    priority = 0 /* Basic */;
    category = "placement" /* Placement */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(board2, candidates);
      if (findings.length === 0) return null;
      const target = findings[0];
      return this.buildResult(target, board2, candidates);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部 27 个单元（9 行 + 9 列 + 9 宫），
     * 返回所有 Hidden Single 发现。
     */
    detect(board2, candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanUnit("row", i, board2, candidates, results);
      }
      for (let i = 0; i < 9; i++) {
        this._scanUnit("col", i, board2, candidates, results);
      }
      for (let i = 0; i < 9; i++) {
        this._scanUnit("box", i, board2, candidates, results);
      }
      return results;
    }
    /**
     * 在指定单元（行/列/宫）中检测隐藏唯一。
     * 有 → 返回找到的格和数字；无 → 返回 null。
     */
    detectInUnit(unitType, unitIndex, board2, candidates) {
      const results = [];
      this._scanUnit(unitType, unitIndex, board2, candidates, results);
      return results[0] ?? null;
    }
    /**
     * 在指定格所在的所有单元中检测：该格是否有数字仅在此格出现。
     * 返回找到的第一个隐藏唯一，无则 null。
     */
    detectForCell(coord, board2, candidates) {
      if (board2.getCell(coord).value !== 0) return null;
      const cellDigits = candidates.getDigits(coord);
      const box = board2.getCell(coord).box;
      for (const digit of cellDigits) {
        const rowPos = candidates.getDigitPositionsInUnit(digit, "row", coord[0]);
        if (rowPos.length === 1) {
          return { coord, digit, unitType: "row", unitIndex: coord[0] };
        }
        const colPos = candidates.getDigitPositionsInUnit(digit, "col", coord[1]);
        if (colPos.length === 1) {
          return { coord, digit, unitType: "col", unitIndex: coord[1] };
        }
        const boxPos = candidates.getDigitPositionsInUnit(digit, "box", box);
        if (boxPos.length === 1) {
          return { coord, digit, unitType: "box", unitIndex: box };
        }
      }
      return null;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    /**
     * 生成自然语言教学说明。
     */
    explanation(finding) {
      const { coord, digit, unitType, unitIndex } = finding;
      const label = UNIT_LABEL[unitType] ?? unitType;
      const index = unitIndex + 1;
      return `\u5728\u7B2C ${index} ${label}\uFF0C\u6570\u5B57 ${digit} \u53EA\u80FD\u51FA\u73B0\u5728 ${formatCoord(coord)}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanUnit(unitType, unitIndex, _board, candidates, out) {
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const positions = candidates.getDigitPositionsInUnit(
          digit,
          unitType,
          unitIndex
        );
        if (positions.length === 1) {
          out.push({
            coord: positions[0],
            digit,
            unitType,
            unitIndex
          });
        }
      }
    }
    buildResult(finding, board2, candidates) {
      const { coord, digit } = finding;
      const peers = board2.getPeers(coord);
      const affectedPeers = [];
      for (const p of peers) {
        if (candidates.has(p, digit)) {
          affectedPeers.push(p);
        }
      }
      const description = this.explanation(finding);
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: { coord, digit },
          eliminations: affectedPeers.map((p) => ({ coord: p, digit })),
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: positionsInUnit(finding.unitType, finding.unitIndex).filter(
          (c3) => candidates.has(c3, finding.digit)
        ),
        description
      };
    }
  };
  function positionsInUnit(unitType, index) {
    const coords = [];
    if (unitType === "row") {
      for (let c3 = 0; c3 < 9; c3++) {
        coords.push([index, c3]);
      }
    } else if (unitType === "col") {
      for (let r3 = 0; r3 < 9; r3++) {
        coords.push([r3, index]);
      }
    } else {
      const sr = Math.floor(index / 3) * 3;
      const sc = index % 3 * 3;
      for (let r3 = sr; r3 < sr + 3; r3++) {
        for (let c3 = sc; c3 < sc + 3; c3++) {
          coords.push([r3, c3]);
        }
      }
    }
    return coords;
  }

  // ../../ClaudeSafe/sudoku/technique/naked-pair.ts
  var UNIT_LABEL2 = {
    row: "\u884C",
    col: "\u5217",
    box: "\u5BAB"
  };
  var NakedPairTechnique = class {
    id = "naked-pair";
    name = "\u663E\u6027\u6570\u5BF9";
    nameEn = "Naked Pair";
    priority = 1 /* Pair */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部 27 个单元，返回所有显性数对发现。
     */
    detect(candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanUnit("row", i, candidates, results);
        this._scanUnit("col", i, candidates, results);
        this._scanUnit("box", i, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digits, unitType, unitIndex, pairCells, eliminations } = finding;
      const label = UNIT_LABEL2[unitType] ?? unitType;
      const idx = unitIndex + 1;
      const [d1, d2] = digits;
      const cell0Label = formatCoord(pairCells[0]);
      const cell1Label = formatCoord(pairCells[1]);
      return `\u5728\u7B2C ${idx} ${label}\uFF0C${cell0Label} \u548C ${cell1Label} \u5171\u540C\u62E5\u6709\u5019\u9009\u6570 {${d1}, ${d2}}\uFF0C\u5F62\u6210\u663E\u6027\u6570\u5BF9\uFF0C\u56E0\u6B64\u8BE5${label}\u5176\u4ED6 ${eliminations.length} \u5904\u53EF\u6D88\u53BB ${d1} \u548C ${d2}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanUnit(unitType, unitIndex, candidates, out) {
      const byMask = /* @__PURE__ */ new Map();
      const coords = this._getUnitCoords(unitType, unitIndex);
      for (const coord of coords) {
        const count = candidates.count(coord);
        if (count !== 2) continue;
        const mask = candidates.getMask(coord);
        let group = byMask.get(mask);
        if (!group) {
          group = [];
          byMask.set(mask, group);
        }
        group.push(coord);
      }
      for (const [mask, group] of byMask) {
        if (group.length !== 2) continue;
        const digits = candidates.getDigits(group[0]);
        const pairCells = [group[0], group[1]];
        const eliminations = [];
        const pairSet = new Set(pairCells.map((c3) => `${c3[0]},${c3[1]}`));
        for (const coord of coords) {
          if (pairSet.has(`${coord[0]},${coord[1]}`)) continue;
          for (const d of digits) {
            if (candidates.has(coord, d)) {
              eliminations.push({ coord, digit: d });
            }
          }
        }
        if (eliminations.length > 0) {
          out.push({ digits, unitType, unitIndex, pairCells, eliminations });
        }
      }
    }
    _getUnitCoords(unitType, index) {
      const coords = [];
      if (unitType === "row") {
        for (let c3 = 0; c3 < 9; c3++) {
          coords.push([index, c3]);
        }
      } else if (unitType === "col") {
        for (let r3 = 0; r3 < 9; r3++) {
          coords.push([r3, index]);
        }
      } else {
        const sr = Math.floor(index / 3) * 3;
        const sc = index % 3 * 3;
        for (let r3 = sr; r3 < sr + 3; r3++) {
          for (let c3 = sc; c3 < sc + 3; c3++) {
            coords.push([r3, c3]);
          }
        }
      }
      return coords;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.pairCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/hidden-pair.ts
  var UNIT_LABEL3 = {
    row: "\u884C",
    col: "\u5217",
    box: "\u5BAB"
  };
  var HiddenPairTechnique = class {
    id = "hidden-pair";
    name = "\u9690\u6027\u6570\u5BF9";
    nameEn = "Hidden Pair";
    priority = 1 /* Pair */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部 27 个单元，返回所有隐性数对发现。
     */
    detect(candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanUnit("row", i, candidates, results);
        this._scanUnit("col", i, candidates, results);
        this._scanUnit("box", i, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digits, unitType, unitIndex, pairCells } = finding;
      const label = UNIT_LABEL3[unitType] ?? unitType;
      const idx = unitIndex + 1;
      const [d1, d2] = digits;
      const cell0Label = formatCoord(pairCells[0]);
      const cell1Label = formatCoord(pairCells[1]);
      return `\u5728\u7B2C ${idx} ${label}\uFF0C\u6570\u5B57 ${d1} \u548C ${d2} \u53EA\u80FD\u51FA\u73B0\u5728 ${cell0Label} \u548C ${cell1Label}\uFF0C\u5F62\u6210\u9690\u6027\u6570\u5BF9\uFF0C\u56E0\u6B64\u8FD9\u4E24\u683C\u7684\u5176\u4ED6\u5019\u9009\u6570\u53EF\u88AB\u6D88\u53BB`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanUnit(unitType, unitIndex, candidates, out) {
      const coords = this._getUnitCoords(unitType, unitIndex);
      const digitCellMap = /* @__PURE__ */ new Map();
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const cells = [];
        for (const coord of coords) {
          if (candidates.has(coord, digit)) {
            cells.push(coord);
          }
        }
        digitCellMap.set(digit, cells);
      }
      const entries = [...digitCellMap.entries()].filter(
        ([, cells]) => cells.length === 2
      );
      if (entries.length < 2) return;
      for (let a = 0; a < entries.length; a++) {
        for (let b = a + 1; b < entries.length; b++) {
          const [digitA, cellsA] = entries[a];
          const [digitB, cellsB] = entries[b];
          const setA = new Set(cellsA.map((c3) => `${c3[0]},${c3[1]}`));
          const sameCells = cellsB.length === 2 && cellsB.every((c3) => setA.has(`${c3[0]},${c3[1]}`));
          if (!sameCells) continue;
          const pairCells = [cellsA[0], cellsA[1]];
          const hiddenDigits = [digitA, digitB];
          const hiddenMask = CandidateMask.fromDigits([digitA, digitB]);
          const eliminations = [];
          for (const coord of pairCells) {
            const cellMask = candidates.getMask(coord);
            for (let d = 1; d <= 9; d++) {
              if (CandidateMask.has(cellMask, d) && !CandidateMask.has(hiddenMask, d)) {
                eliminations.push({ coord, digit: d });
              }
            }
          }
          if (eliminations.length > 0) {
            out.push({
              digits: hiddenDigits,
              unitType,
              unitIndex,
              pairCells,
              eliminations
            });
          }
        }
      }
    }
    _getUnitCoords(unitType, index) {
      const coords = [];
      if (unitType === "row") {
        for (let c3 = 0; c3 < 9; c3++) {
          coords.push([index, c3]);
        }
      } else if (unitType === "col") {
        for (let r3 = 0; r3 < 9; r3++) {
          coords.push([r3, index]);
        }
      } else {
        const sr = Math.floor(index / 3) * 3;
        const sc = index % 3 * 3;
        for (let r3 = sr; r3 < sr + 3; r3++) {
          for (let c3 = sc; c3 < sc + 3; c3++) {
            coords.push([r3, c3]);
          }
        }
      }
      return coords;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.pairCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/pointing-pair.ts
  var PointingPairTechnique = class {
    id = "pointing-pair";
    name = "\u533A\u5757\u6452\u9664";
    nameEn = "Pointing Pair";
    priority = 1 /* Pair */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部 9 个宫，返回所有区块摒除发现。
     */
    detect(candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanBox(i, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digit, boxIndex: boxIndex2, lineType, lineIndex } = finding;
      const boxLabel = boxIndex2 + 1;
      const lineLabel = lineType === "row" ? "\u884C" : "\u5217";
      const lineIdx = lineIndex + 1;
      return `\u5728\u7B2C ${boxLabel} \u5BAB\uFF0C\u6570\u5B57 ${digit} \u53EA\u80FD\u51FA\u73B0\u5728\u7B2C ${lineIdx} ${lineLabel}\uFF0C\u56E0\u6B64\u53EF\u4ECE\u7B2C ${lineIdx} ${lineLabel}\u5176\u4ED6\u683C\u4E2D\u6D88\u53BB ${digit}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanBox(boxIndex2, candidates, out) {
      const coords = this._getUnitCoords("box", boxIndex2);
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const boxCells2 = [];
        for (const coord of coords) {
          if (candidates.has(coord, digit)) {
            boxCells2.push(coord);
          }
        }
        if (boxCells2.length === 0) continue;
        const rows = new Set(boxCells2.map((c3) => c3[0]));
        if (rows.size === 1) {
          const row = boxCells2[0][0];
          const eliminations = this._collectLineEliminations(
            "row",
            row,
            boxIndex2,
            digit,
            candidates
          );
          if (eliminations.length > 0) {
            out.push({
              digit,
              boxIndex: boxIndex2,
              lineType: "row",
              lineIndex: row,
              boxCells: boxCells2,
              eliminations
            });
          }
        }
        const cols = new Set(boxCells2.map((c3) => c3[1]));
        if (cols.size === 1) {
          const col = boxCells2[0][1];
          const eliminations = this._collectLineEliminations(
            "col",
            col,
            boxIndex2,
            digit,
            candidates
          );
          if (eliminations.length > 0) {
            out.push({
              digit,
              boxIndex: boxIndex2,
              lineType: "col",
              lineIndex: col,
              boxCells: boxCells2,
              eliminations
            });
          }
        }
      }
    }
    /**
     * 收集同行/列但不在目标宫内的待消去格。
     */
    _collectLineEliminations(lineType, lineIndex, boxIndex2, digit, candidates) {
      const eliminations = [];
      const lineCoords = this._getUnitCoords(lineType, lineIndex);
      for (const coord of lineCoords) {
        const cb = Math.floor(coord[0] / 3) * 3 + Math.floor(coord[1] / 3);
        if (cb === boxIndex2) continue;
        if (candidates.has(coord, digit)) {
          eliminations.push({ coord, digit });
        }
      }
      return eliminations;
    }
    _getUnitCoords(unitType, index) {
      const coords = [];
      if (unitType === "row") {
        for (let c3 = 0; c3 < 9; c3++) {
          coords.push([index, c3]);
        }
      } else if (unitType === "col") {
        for (let r3 = 0; r3 < 9; r3++) {
          coords.push([r3, index]);
        }
      } else {
        const sr = Math.floor(index / 3) * 3;
        const sc = index % 3 * 3;
        for (let r3 = sr; r3 < sr + 3; r3++) {
          for (let c3 = sc; c3 < sc + 3; c3++) {
            coords.push([r3, c3]);
          }
        }
      }
      return coords;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.boxCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/naked-triple.ts
  var UNIT_LABEL4 = {
    row: "\u884C",
    col: "\u5217",
    box: "\u5BAB"
  };
  var NakedTripleTechnique = class {
    id = "naked-triple";
    name = "\u663E\u6027\u4E09\u6570\u7EC4";
    nameEn = "Naked Triple";
    priority = 2 /* Triple */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    detect(candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanUnit("row", i, candidates, results);
        this._scanUnit("col", i, candidates, results);
        this._scanUnit("box", i, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digits, unitType, unitIndex, tripleCells, eliminations } = finding;
      const label = UNIT_LABEL4[unitType] ?? unitType;
      const idx = unitIndex + 1;
      const cellDesc = tripleCells.map((c3) => formatCoord(c3)).join("\u3001");
      const [d1, d2, d3] = digits;
      return `\u5728\u7B2C ${idx} ${label}\uFF0C${cellDesc} \u4E09\u683C\u7684\u5019\u9009\u6570\u5E76\u96C6\u4E3A {${d1}, ${d2}, ${d3}}\uFF0C\u5F62\u6210\u663E\u6027\u4E09\u6570\u7EC4\uFF0C\u56E0\u6B64\u8BE5${label}\u5176\u4ED6 ${eliminations.length} \u5904\u53EF\u6D88\u53BB ${d1}\u3001${d2}\u3001${d3}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanUnit(unitType, unitIndex, candidates, out) {
      const coords = this._getUnitCoords(unitType, unitIndex);
      const eligible = [];
      for (const coord of coords) {
        const cnt = candidates.count(coord);
        if (cnt < 2 || cnt > 3) continue;
        eligible.push({ coord, mask: candidates.getMask(coord) });
      }
      if (eligible.length < 3) return;
      const n = eligible.length;
      for (let a = 0; a < n - 2; a++) {
        for (let b = a + 1; b < n - 1; b++) {
          for (let c3 = b + 1; c3 < n; c3++) {
            const maskA = eligible[a].mask;
            const maskB = eligible[b].mask;
            const maskC = eligible[c3].mask;
            const union = CandidateMask.union(CandidateMask.union(maskA, maskB), maskC);
            const unionSize = CandidateMask.size(union);
            if (unionSize !== 3) continue;
            const digits = CandidateMask.toDigits(union);
            const tripleCells = [
              eligible[a].coord,
              eligible[b].coord,
              eligible[c3].coord
            ];
            const eliminations = [];
            const tripleSet = new Set(
              tripleCells.map((t) => `${t[0]},${t[1]}`)
            );
            for (const coord of coords) {
              if (tripleSet.has(`${coord[0]},${coord[1]}`)) continue;
              for (const d of digits) {
                if (candidates.has(coord, d)) {
                  eliminations.push({ coord, digit: d });
                }
              }
            }
            if (eliminations.length > 0) {
              out.push({ digits, unitType, unitIndex, tripleCells, eliminations });
            }
          }
        }
      }
    }
    _getUnitCoords(unitType, index) {
      const coords = [];
      if (unitType === "row") {
        for (let c3 = 0; c3 < 9; c3++) {
          coords.push([index, c3]);
        }
      } else if (unitType === "col") {
        for (let r3 = 0; r3 < 9; r3++) {
          coords.push([r3, index]);
        }
      } else {
        const sr = Math.floor(index / 3) * 3;
        const sc = index % 3 * 3;
        for (let r3 = sr; r3 < sr + 3; r3++) {
          for (let c3 = sc; c3 < sc + 3; c3++) {
            coords.push([r3, c3]);
          }
        }
      }
      return coords;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.tripleCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/hidden-triple.ts
  var UNIT_LABEL5 = {
    row: "\u884C",
    col: "\u5217",
    box: "\u5BAB"
  };
  var HiddenTripleTechnique = class {
    id = "hidden-triple";
    name = "\u9690\u6027\u4E09\u6570\u7EC4";
    nameEn = "Hidden Triple";
    priority = 2 /* Triple */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    detect(candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanUnit("row", i, candidates, results);
        this._scanUnit("col", i, candidates, results);
        this._scanUnit("box", i, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digits, unitType, unitIndex, tripleCells, eliminations } = finding;
      const label = UNIT_LABEL5[unitType] ?? unitType;
      const idx = unitIndex + 1;
      const cellDesc = tripleCells.map((c3) => formatCoord(c3)).join("\u3001");
      const [d1, d2, d3] = digits;
      return `\u5728\u7B2C ${idx} ${label}\uFF0C\u6570\u5B57 ${d1}\u3001${d2}\u3001${d3} \u7684\u5019\u9009\u4F4D\u7F6E\u6070\u597D\u9650\u5236\u5728 ${cellDesc} \u4E09\u683C\u5185\uFF0C\u5F62\u6210\u9690\u6027\u4E09\u6570\u7EC4\uFF0C\u56E0\u6B64\u8FD9\u4E09\u683C\u4E2D\u53EF\u6D88\u53BB ${eliminations.length} \u4E2A\u975E {${d1}, ${d2}, ${d3}} \u7684\u5019\u9009\u6570`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanUnit(unitType, unitIndex, candidates, out) {
      const coords = this._getUnitCoords(unitType, unitIndex);
      for (let i1 = 0; i1 < 7; i1++) {
        const d1 = ALL_DIGITS[i1];
        for (let i2 = i1 + 1; i2 < 8; i2++) {
          const d2 = ALL_DIGITS[i2];
          for (let i3 = i2 + 1; i3 < 9; i3++) {
            const d3 = ALL_DIGITS[i3];
            const cellSet = /* @__PURE__ */ new Set();
            const tripleCells = [];
            for (const coord of coords) {
              const mask = candidates.getMask(coord);
              if (mask === 0) continue;
              if (CandidateMask.has(mask, d1) || CandidateMask.has(mask, d2) || CandidateMask.has(mask, d3)) {
                cellSet.add(`${coord[0]},${coord[1]}`);
                tripleCells.push(coord);
              }
            }
            if (tripleCells.length !== 3) continue;
            const digits = [d1, d2, d3];
            const digitMask = CandidateMask.union(CandidateMask.union(CandidateMask.fromDigits([d1]), CandidateMask.fromDigits([d2])), CandidateMask.fromDigits([d3]));
            const eliminations = [];
            for (const cell of tripleCells) {
              const mask = candidates.getMask(cell);
              const toRemove = CandidateMask.subtract(mask, digitMask);
              if (toRemove === 0) continue;
              for (const d of CandidateMask.toDigits(toRemove)) {
                eliminations.push({ coord: cell, digit: d });
              }
            }
            if (eliminations.length > 0) {
              out.push({
                digits,
                unitType,
                unitIndex,
                tripleCells,
                eliminations
              });
            }
          }
        }
      }
    }
    _getUnitCoords(unitType, index) {
      const coords = [];
      if (unitType === "row") {
        for (let c3 = 0; c3 < 9; c3++) {
          coords.push([index, c3]);
        }
      } else if (unitType === "col") {
        for (let r3 = 0; r3 < 9; r3++) {
          coords.push([r3, index]);
        }
      } else {
        const sr = Math.floor(index / 3) * 3;
        const sc = index % 3 * 3;
        for (let r3 = sr; r3 < sr + 3; r3++) {
          for (let c3 = sc; c3 < sc + 3; c3++) {
            coords.push([r3, c3]);
          }
        }
      }
      return coords;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.tripleCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/box-line.ts
  var BoxLineTechnique = class {
    id = "box-line";
    name = "\u884C\u5217\u533A\u5757\u5220\u51CF\u6CD5";
    nameEn = "Box-Line Reduction";
    priority = 2 /* Triple */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部 9 行和 9 列，返回所有行列区块发现。
     */
    detect(candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanLine("row", i, candidates, results);
        this._scanLine("col", i, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digit, lineType, lineIndex, boxIndex: boxIndex2 } = finding;
      const lineLabel = lineType === "row" ? "\u884C" : "\u5217";
      const lineIdx = lineIndex + 1;
      const boxLabel = boxIndex2 + 1;
      return `\u5728\u7B2C ${lineIdx} ${lineLabel}\uFF0C\u6570\u5B57 ${digit} \u53EA\u80FD\u51FA\u73B0\u5728\u7B2C ${boxLabel} \u5BAB\uFF0C\u56E0\u6B64\u53EF\u4ECE\u7B2C ${boxLabel} \u5BAB\u5176\u4ED6\u683C\u4E2D\u6D88\u53BB ${digit}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanLine(lineType, lineIndex, candidates, out) {
      const coords = this._getUnitCoords(lineType, lineIndex);
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const lineCells = [];
        for (const coord of coords) {
          if (candidates.has(coord, digit)) {
            lineCells.push(coord);
          }
        }
        if (lineCells.length === 0) continue;
        const boxSet = new Set(
          lineCells.map(
            (c3) => Math.floor(c3[0] / 3) * 3 + Math.floor(c3[1] / 3)
          )
        );
        if (boxSet.size !== 1) continue;
        const boxIndex2 = lineCells[0] ? Math.floor(lineCells[0][0] / 3) * 3 + Math.floor(lineCells[0][1] / 3) : 0;
        const eliminations = this._collectBoxEliminations(
          boxIndex2,
          lineType,
          lineIndex,
          digit,
          candidates
        );
        if (eliminations.length > 0) {
          out.push({
            digit,
            lineType,
            lineIndex,
            boxIndex: boxIndex2,
            lineCells,
            eliminations
          });
        }
      }
    }
    /**
     * 收集目标宫内不在指定行/列中的待消去格。
     */
    _collectBoxEliminations(boxIndex2, lineType, lineIndex, digit, candidates) {
      const eliminations = [];
      const boxCoords = this._getUnitCoords("box", boxIndex2);
      for (const coord of boxCoords) {
        if (lineType === "row" && coord[0] === lineIndex) continue;
        if (lineType === "col" && coord[1] === lineIndex) continue;
        if (candidates.has(coord, digit)) {
          eliminations.push({ coord, digit });
        }
      }
      return eliminations;
    }
    _getUnitCoords(unitType, index) {
      const coords = [];
      if (unitType === "row") {
        for (let c3 = 0; c3 < 9; c3++) {
          coords.push([index, c3]);
        }
      } else if (unitType === "col") {
        for (let r3 = 0; r3 < 9; r3++) {
          coords.push([r3, index]);
        }
      } else {
        const sr = Math.floor(index / 3) * 3;
        const sc = index % 3 * 3;
        for (let r3 = sr; r3 < sr + 3; r3++) {
          for (let c3 = sc; c3 < sc + 3; c3++) {
            coords.push([r3, c3]);
          }
        }
      }
      return coords;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.lineCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/naked-quad.ts
  var UNIT_LABEL6 = {
    row: "\u884C",
    col: "\u5217",
    box: "\u5BAB"
  };
  var NakedQuadTechnique = class {
    id = "naked-quad";
    name = "\u663E\u6027\u56DB\u6570\u7EC4";
    nameEn = "Naked Quad";
    priority = 3 /* Quad */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    detect(candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanUnit("row", i, candidates, results);
        this._scanUnit("col", i, candidates, results);
        this._scanUnit("box", i, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digits, unitType, unitIndex, quadCells, eliminations } = finding;
      const label = UNIT_LABEL6[unitType] ?? unitType;
      const idx = unitIndex + 1;
      const cellDesc = quadCells.map((c3) => formatCoord(c3)).join("\u3001");
      const [d1, d2, d3, d4] = digits;
      return `\u5728\u7B2C ${idx} ${label}\uFF0C${cellDesc} \u56DB\u683C\u7684\u5019\u9009\u6570\u5E76\u96C6\u4E3A {${d1}, ${d2}, ${d3}, ${d4}}\uFF0C\u5F62\u6210\u663E\u6027\u56DB\u6570\u7EC4\uFF0C\u56E0\u6B64\u8BE5${label}\u5176\u4ED6 ${eliminations.length} \u5904\u53EF\u6D88\u53BB ${d1}\u3001${d2}\u3001${d3}\u3001${d4}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanUnit(unitType, unitIndex, candidates, out) {
      const coords = this._getUnitCoords(unitType, unitIndex);
      const eligible = [];
      for (const coord of coords) {
        const cnt = candidates.count(coord);
        if (cnt < 2 || cnt > 4) continue;
        eligible.push({ coord, mask: candidates.getMask(coord) });
      }
      if (eligible.length < 4) return;
      if (eligible.length > 7) return;
      const n = eligible.length;
      for (let a = 0; a < n - 3; a++) {
        for (let b = a + 1; b < n - 2; b++) {
          for (let c3 = b + 1; c3 < n - 1; c3++) {
            for (let d = c3 + 1; d < n; d++) {
              const maskA = eligible[a].mask;
              const maskB = eligible[b].mask;
              const maskC = eligible[c3].mask;
              const maskD = eligible[d].mask;
              const union = CandidateMask.union(
                CandidateMask.union(CandidateMask.union(maskA, maskB), maskC),
                maskD
              );
              const unionSize = CandidateMask.size(union);
              if (unionSize !== 4) continue;
              const digits = CandidateMask.toDigits(union);
              const quadCells = [
                eligible[a].coord,
                eligible[b].coord,
                eligible[c3].coord,
                eligible[d].coord
              ];
              const eliminations = [];
              const quadSet = new Set(
                quadCells.map((t) => `${t[0]},${t[1]}`)
              );
              for (const coord of coords) {
                if (quadSet.has(`${coord[0]},${coord[1]}`)) continue;
                for (const dgt of digits) {
                  if (candidates.has(coord, dgt)) {
                    eliminations.push({ coord, digit: dgt });
                  }
                }
              }
              if (eliminations.length > 0) {
                out.push({ digits, unitType, unitIndex, quadCells, eliminations });
              }
            }
          }
        }
      }
    }
    _getUnitCoords(unitType, index) {
      const coords = [];
      if (unitType === "row") {
        for (let c3 = 0; c3 < 9; c3++) {
          coords.push([index, c3]);
        }
      } else if (unitType === "col") {
        for (let r3 = 0; r3 < 9; r3++) {
          coords.push([r3, index]);
        }
      } else {
        const sr = Math.floor(index / 3) * 3;
        const sc = index % 3 * 3;
        for (let r3 = sr; r3 < sr + 3; r3++) {
          for (let c3 = sc; c3 < sc + 3; c3++) {
            coords.push([r3, c3]);
          }
        }
      }
      return coords;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.quadCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/hidden-quad.ts
  var UNIT_LABEL7 = {
    row: "\u884C",
    col: "\u5217",
    box: "\u5BAB"
  };
  var HiddenQuadTechnique = class {
    id = "hidden-quad";
    name = "\u9690\u6027\u56DB\u6570\u7EC4";
    nameEn = "Hidden Quad";
    priority = 3 /* Quad */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    detect(candidates) {
      const results = [];
      for (let i = 0; i < 9; i++) {
        this._scanUnit("row", i, candidates, results);
        this._scanUnit("col", i, candidates, results);
        this._scanUnit("box", i, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digits, unitType, unitIndex, quadCells, eliminations } = finding;
      const label = UNIT_LABEL7[unitType] ?? unitType;
      const idx = unitIndex + 1;
      const cellDesc = quadCells.map((c3) => formatCoord(c3)).join("\u3001");
      const [d1, d2, d3, d4] = digits;
      return `\u5728\u7B2C ${idx} ${label}\uFF0C\u6570\u5B57 ${d1}\u3001${d2}\u3001${d3}\u3001${d4} \u7684\u5019\u9009\u4F4D\u7F6E\u6070\u597D\u9650\u5236\u5728 ${cellDesc} \u56DB\u683C\u5185\uFF0C\u5F62\u6210\u9690\u6027\u56DB\u6570\u7EC4\uFF0C\u56E0\u6B64\u8FD9\u56DB\u683C\u4E2D\u53EF\u6D88\u53BB ${eliminations.length} \u4E2A\u975E {${d1}, ${d2}, ${d3}, ${d4}} \u7684\u5019\u9009\u6570`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _scanUnit(unitType, unitIndex, candidates, out) {
      const coords = this._getUnitCoords(unitType, unitIndex);
      for (let i1 = 0; i1 < 6; i1++) {
        const d1 = ALL_DIGITS[i1];
        for (let i2 = i1 + 1; i2 < 7; i2++) {
          const d2 = ALL_DIGITS[i2];
          for (let i3 = i2 + 1; i3 < 8; i3++) {
            const d3 = ALL_DIGITS[i3];
            for (let i4 = i3 + 1; i4 < 9; i4++) {
              const d4 = ALL_DIGITS[i4];
              const quadCells = [];
              for (const coord of coords) {
                const mask = candidates.getMask(coord);
                if (mask === 0) continue;
                if (CandidateMask.has(mask, d1) || CandidateMask.has(mask, d2) || CandidateMask.has(mask, d3) || CandidateMask.has(mask, d4)) {
                  quadCells.push(coord);
                }
              }
              if (quadCells.length !== 4) continue;
              const digits = [d1, d2, d3, d4];
              const digitMask = CandidateMask.fromDigits([d1, d2, d3, d4]);
              const eliminations = [];
              for (const cell of quadCells) {
                const mask = candidates.getMask(cell);
                const toRemove = CandidateMask.subtract(mask, digitMask);
                if (toRemove === 0) continue;
                for (const d of CandidateMask.toDigits(toRemove)) {
                  eliminations.push({ coord: cell, digit: d });
                }
              }
              if (eliminations.length > 0) {
                out.push({
                  digits,
                  unitType,
                  unitIndex,
                  quadCells,
                  eliminations
                });
              }
            }
          }
        }
      }
    }
    _getUnitCoords(unitType, index) {
      const coords = [];
      if (unitType === "row") {
        for (let c3 = 0; c3 < 9; c3++) {
          coords.push([index, c3]);
        }
      } else if (unitType === "col") {
        for (let r3 = 0; r3 < 9; r3++) {
          coords.push([r3, index]);
        }
      } else {
        const sr = Math.floor(index / 3) * 3;
        const sc = index % 3 * 3;
        for (let r3 = sr; r3 < sr + 3; r3++) {
          for (let c3 = sc; c3 < sc + 3; c3++) {
            coords.push([r3, c3]);
          }
        }
      }
      return coords;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.quadCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/xwing.ts
  var XWingTechnique = class {
    id = "x-wing";
    name = "X-Wing";
    nameEn = "X-Wing";
    priority = 4 /* BasicFish */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      const target = findings[0];
      return this.buildResult(target);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部 9 个数字，检测行 X-Wing 和列 X-Wing。
     */
    detect(candidates) {
      const results = [];
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        this._detectInLines("row", digit, candidates, results);
        this._detectInLines("col", digit, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digit, baseUnitType, baseIndices, coverIndices, eliminations } = finding;
      const [b1, b2] = baseIndices.map((i) => i + 1);
      const [c1, c22] = coverIndices.map((i) => i + 1);
      const baseLabel = baseUnitType === "row" ? "\u884C" : "\u5217";
      const coverLabel = baseUnitType === "row" ? "\u5217" : "\u884C";
      return `\u6570\u5B57 ${digit} \u5728\u7B2C ${b1}${baseLabel}\u548C\u7B2C ${b2}${baseLabel}\u90FD\u53EA\u80FD\u51FA\u73B0\u5728\u7B2C ${c1}${coverLabel}\u548C\u7B2C ${c22}${coverLabel}\uFF0C\u5F62\u6210 X-Wing\uFF0C\u56E0\u6B64\u53EF\u4ECE\u7B2C ${c1}\u3001${c22}${coverLabel}\u7684\u5176\u4ED6 ${eliminations.length} \u683C\u4E2D\u6D88\u53BB ${digit}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    /**
     * 在行或列方向检测 X-Wing。
     */
    _detectInLines(baseType, digit, candidates, out) {
      const positionMap = /* @__PURE__ */ new Map();
      for (let i = 0; i < 9; i++) {
        const positions = candidates.getDigitPositionsInUnit(
          digit,
          baseType,
          i
        );
        if (positions.length === 2) {
          const coverIdx = baseType === "row" ? [positions[0][1], positions[1][1]] : [positions[0][0], positions[1][0]];
          positionMap.set(i, coverIdx);
        }
      }
      if (positionMap.size < 2) return;
      const entries = [...positionMap.entries()];
      for (let a = 0; a < entries.length; a++) {
        for (let b = a + 1; b < entries.length; b++) {
          const [baseA, coverA] = entries[a];
          const [baseB, coverB] = entries[b];
          const setA = new Set(coverA);
          const setB = new Set(coverB);
          if (setA.size !== 2 || setB.size !== 2) continue;
          const isMatch = setA.has(coverB[0]) && setA.has(coverB[1]);
          if (!isMatch) continue;
          const coverSorted = [
            Math.min(coverA[0], coverA[1]),
            Math.max(coverA[0], coverA[1])
          ];
          const baseCells = baseType === "row" ? [
            [baseA, coverSorted[0]],
            [baseA, coverSorted[1]],
            [baseB, coverSorted[0]],
            [baseB, coverSorted[1]]
          ] : [
            [coverSorted[0], baseA],
            [coverSorted[1], baseA],
            [coverSorted[0], baseB],
            [coverSorted[1], baseB]
          ];
          const eliminations = [];
          const coverType = baseType === "row" ? "col" : "row";
          for (const ci of coverSorted) {
            const allInCover = candidates.getDigitPositionsInUnit(
              digit,
              coverType,
              ci
            );
            for (const c3 of allInCover) {
              const isBaseCell = baseCells.some(
                (bc) => bc[0] === c3[0] && bc[1] === c3[1]
              );
              if (!isBaseCell) {
                eliminations.push({ coord: c3, digit });
              }
            }
          }
          if (eliminations.length > 0) {
            out.push({
              digit,
              baseUnitType: baseType,
              baseIndices: [baseA, baseB],
              coverIndices: coverSorted,
              baseCells,
              eliminations
            });
          }
        }
      }
    }
    buildResult(finding) {
      const involvedCells = [...finding.baseCells];
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/swordfish.ts
  var SwordfishTechnique = class {
    id = "swordfish";
    name = "Swordfish";
    nameEn = "Swordfish";
    priority = 4 /* BasicFish */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      const target = findings[0];
      return this.buildResult(target);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部 9 个数字，检测行 Swordfish 和列 Swordfish。
     */
    detect(candidates) {
      const results = [];
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        this._detectInLines("row", digit, candidates, results);
        this._detectInLines("col", digit, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digit, baseUnitType, baseIndices, coverIndices, eliminations } = finding;
      const [b1, b2, b3] = baseIndices.map((i) => i + 1);
      const [c1, c22, c3] = coverIndices.map((i) => i + 1);
      const baseLabel = baseUnitType === "row" ? "\u884C" : "\u5217";
      const coverLabel = baseUnitType === "row" ? "\u5217" : "\u884C";
      return `\u6570\u5B57 ${digit} \u5728\u7B2C ${b1}\u3001${b2}\u3001${b3} ${baseLabel}\u53EA\u80FD\u51FA\u73B0\u5728\u7B2C ${c1}\u3001${c22}\u3001${c3} ${coverLabel}\uFF0C\u5F62\u6210 Swordfish\uFF0C\u56E0\u6B64\u53EF\u4ECE\u7B2C ${c1}\u3001${c22}\u3001${c3} ${coverLabel}\u7684\u5176\u4ED6 ${eliminations.length} \u683C\u4E2D\u6D88\u53BB ${digit}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    /**
     * 在行或列方向检测 Swordfish。
     */
    _detectInLines(baseType, digit, candidates, out) {
      const positionMap = /* @__PURE__ */ new Map();
      for (let i = 0; i < 9; i++) {
        const positions = candidates.getDigitPositionsInUnit(
          digit,
          baseType,
          i
        );
        if (positions.length >= 2 && positions.length <= 3) {
          const coverIdx = baseType === "row" ? positions.map((p) => p[1]) : positions.map((p) => p[0]);
          positionMap.set(i, coverIdx);
        }
      }
      if (positionMap.size < 3) return;
      const entries = [...positionMap.entries()];
      for (let a = 0; a < entries.length; a++) {
        for (let b = a + 1; b < entries.length; b++) {
          for (let c3 = b + 1; c3 < entries.length; c3++) {
            const [baseA, coverA] = entries[a];
            const [baseB, coverB] = entries[b];
            const [baseC, coverC] = entries[c3];
            const allCover = /* @__PURE__ */ new Set([...coverA, ...coverB, ...coverC]);
            if (allCover.size !== 3) continue;
            const coverSorted = [...allCover].sort((x, y) => x - y);
            const baseIndices = [baseA, baseB, baseC];
            const baseCells = [];
            for (const bi of baseIndices) {
              for (const ci of coverSorted) {
                const coord = baseType === "row" ? [bi, ci] : [ci, bi];
                if (candidates.has(coord, digit)) {
                  baseCells.push(coord);
                }
              }
            }
            const eliminations = [];
            const coverType = baseType === "row" ? "col" : "row";
            const baseSet = new Set(baseIndices);
            for (const ci of coverSorted) {
              const allInCover = candidates.getDigitPositionsInUnit(
                digit,
                coverType,
                ci
              );
              for (const coord of allInCover) {
                const unitIdx = baseType === "row" ? coord[0] : coord[1];
                if (!baseSet.has(unitIdx)) {
                  eliminations.push({ coord, digit });
                }
              }
            }
            if (eliminations.length > 0) {
              out.push({
                digit,
                baseUnitType: baseType,
                baseIndices,
                coverIndices: coverSorted,
                baseCells,
                eliminations
              });
            }
          }
        }
      }
    }
    buildResult(finding) {
      const involvedCells = [...finding.baseCells];
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/jellyfish.ts
  var JellyfishTechnique = class {
    id = "jellyfish";
    name = "Jellyfish";
    nameEn = "Jellyfish";
    priority = 4 /* BasicFish */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      const target = findings[0];
      return this.buildResult(target);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部 9 个数字，检测行 Jellyfish 和列 Jellyfish。
     */
    detect(candidates) {
      const results = [];
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        this._detectInLines("row", digit, candidates, results);
        this._detectInLines("col", digit, candidates, results);
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digit, baseUnitType, baseIndices, coverIndices, eliminations } = finding;
      const [b1, b2, b3, b4] = baseIndices.map((i) => i + 1);
      const [c1, c22, c3, c4] = coverIndices.map((i) => i + 1);
      const baseLabel = baseUnitType === "row" ? "\u884C" : "\u5217";
      const coverLabel = baseUnitType === "row" ? "\u5217" : "\u884C";
      return `\u6570\u5B57 ${digit} \u5728\u7B2C ${b1}\u3001${b2}\u3001${b3}\u3001${b4} ${baseLabel}\u53EA\u80FD\u51FA\u73B0\u5728\u7B2C ${c1}\u3001${c22}\u3001${c3}\u3001${c4} ${coverLabel}\uFF0C\u5F62\u6210 Jellyfish\uFF0C\u56E0\u6B64\u53EF\u4ECE\u7B2C ${c1}\u3001${c22}\u3001${c3}\u3001${c4} ${coverLabel}\u7684\u5176\u4ED6 ${eliminations.length} \u683C\u4E2D\u6D88\u53BB ${digit}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    /**
     * 在行或列方向检测 Jellyfish。
     */
    _detectInLines(baseType, digit, candidates, out) {
      const positionMap = /* @__PURE__ */ new Map();
      for (let i = 0; i < 9; i++) {
        const positions = candidates.getDigitPositionsInUnit(
          digit,
          baseType,
          i
        );
        if (positions.length >= 2 && positions.length <= 4) {
          const coverIdx = baseType === "row" ? positions.map((p) => p[1]) : positions.map((p) => p[0]);
          positionMap.set(i, coverIdx);
        }
      }
      if (positionMap.size < 4) return;
      const entries = [...positionMap.entries()];
      for (let a = 0; a < entries.length; a++) {
        for (let b = a + 1; b < entries.length; b++) {
          for (let c3 = b + 1; c3 < entries.length; c3++) {
            for (let d = c3 + 1; d < entries.length; d++) {
              const [baseA, coverA] = entries[a];
              const [baseB, coverB] = entries[b];
              const [baseC, coverC] = entries[c3];
              const [baseD, coverD] = entries[d];
              const allCover = /* @__PURE__ */ new Set([
                ...coverA,
                ...coverB,
                ...coverC,
                ...coverD
              ]);
              if (allCover.size !== 4) continue;
              const coverSorted = [...allCover].sort((x, y) => x - y);
              const baseIndices = [
                baseA,
                baseB,
                baseC,
                baseD
              ];
              const baseCells = [];
              for (const bi of baseIndices) {
                for (const ci of coverSorted) {
                  const coord = baseType === "row" ? [bi, ci] : [ci, bi];
                  if (candidates.has(coord, digit)) {
                    baseCells.push(coord);
                  }
                }
              }
              const eliminations = [];
              const coverType = baseType === "row" ? "col" : "row";
              const baseSet = new Set(baseIndices);
              for (const ci of coverSorted) {
                const allInCover = candidates.getDigitPositionsInUnit(
                  digit,
                  coverType,
                  ci
                );
                for (const coord of allInCover) {
                  const unitIdx = baseType === "row" ? coord[0] : coord[1];
                  if (!baseSet.has(unitIdx)) {
                    eliminations.push({ coord, digit });
                  }
                }
              }
              if (eliminations.length > 0) {
                out.push({
                  digit,
                  baseUnitType: baseType,
                  baseIndices,
                  coverIndices: coverSorted,
                  baseCells,
                  eliminations
                });
              }
            }
          }
        }
      }
    }
    buildResult(finding) {
      const involvedCells = [...finding.baseCells];
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/ywing.ts
  var YWingTechnique = class {
    id = "y-wing";
    name = "Y-Wing";
    nameEn = "Y-Wing";
    priority = 5 /* IntermediateChain */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(board2, candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描所有两候选数格，检测 Y-Wing 结构。
     */
    detect(board2, candidates) {
      const results = [];
      const twoCandidateCells = this._findTwoCandidateCells(candidates);
      for (const pivot of twoCandidateCells) {
        const pivotDigits = candidates.getDigits(pivot);
        if (pivotDigits.length !== 2) continue;
        const [x, y] = pivotDigits;
        const pivotPeers = board2.getPeers(pivot);
        const groupXZ = [];
        const groupYZ = [];
        for (const peer of pivotPeers) {
          if (candidates.count(peer) !== 2) continue;
          const digits = candidates.getDigits(peer);
          if (digits.length !== 2) continue;
          const [d1, d2] = digits;
          if (d1 === x && d2 !== x && d2 !== y) {
            groupXZ.push({ coord: peer, z: d2 });
          } else if (d2 === x && d1 !== x && d1 !== y) {
            groupXZ.push({ coord: peer, z: d1 });
          } else if (d1 === y && d2 !== x && d2 !== y) {
            groupYZ.push({ coord: peer, z: d2 });
          } else if (d2 === y && d1 !== x && d1 !== y) {
            groupYZ.push({ coord: peer, z: d1 });
          }
        }
        if (groupXZ.length === 0 || groupYZ.length === 0) continue;
        for (const p1 of groupXZ) {
          const p1Peers = board2.getPeers(p1.coord);
          const p1PeerSet = new Set(p1Peers.map((p) => `${p[0]},${p[1]}`));
          for (const p2 of groupYZ) {
            if (p1.z !== p2.z) continue;
            const z = p1.z;
            if (p1PeerSet.has(`${p2.coord[0]},${p2.coord[1]}`)) continue;
            const eliminations = [];
            const p2Peers = board2.getPeers(p2.coord);
            for (const p2Peer of p2Peers) {
              if (p1PeerSet.has(`${p2Peer[0]},${p2Peer[1]}`)) {
                if (candidates.has(p2Peer, z)) {
                  eliminations.push({ coord: p2Peer, digit: z });
                }
              }
            }
            if (eliminations.length > 0) {
              const p1Digits = [x, z].sort();
              const p2Digits = [y, z].sort();
              results.push({
                pivot,
                pivotDigits: [x, y],
                pincer1: p1.coord,
                pincer1Digits: p1Digits,
                pincer2: p2.coord,
                pincer2Digits: p2Digits,
                eliminations
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
    explanation(finding) {
      const { pivot, pivotDigits, pincer1, pincer1Digits, pincer2, pincer2Digits, eliminations } = finding;
      const z = eliminations[0].digit;
      const pivotStr = `${formatCoord(pivot)} {${pivotDigits.join(", ")}}`;
      const p1Str = `${formatCoord(pincer1)} {${pincer1Digits.join(", ")}}`;
      const p2Str = `${formatCoord(pincer2)} {${pincer2Digits.join(", ")}}`;
      const elimStrs = eliminations.map((e) => formatCoord(e.coord)).join("\u3001");
      return `${pivotStr} \u4E3A\u67A2\u8F74\uFF0C${p1Str} \u548C ${p2Str} \u4E3A\u53CC\u7FFC\uFF0C\u56E0\u6B64 ${elimStrs} \u53EF\u6D88\u53BB ${z}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _findTwoCandidateCells(candidates) {
      const cells = [];
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          if (candidates.count(coord) === 2) {
            cells.push(coord);
          }
        }
      }
      return cells;
    }
    buildResult(finding) {
      const involvedCells = [finding.pivot, finding.pincer1, finding.pincer2];
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/xyz-wing.ts
  var XYZWingTechnique = class {
    id = "xyz-wing";
    name = "XYZ-Wing";
    nameEn = "XYZ-Wing";
    priority = 5 /* IntermediateChain */;
    category = "elimination" /* Elimination */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(board2, candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描所有三候选数格，检测 XYZ-Wing 结构。
     */
    detect(board2, candidates) {
      const results = [];
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const pivot = [r3, c3];
          if (candidates.count(pivot) !== 3) continue;
          const pivotDigits = candidates.getDigits(pivot);
          if (pivotDigits.length !== 3) continue;
          const [x, y, z] = pivotDigits;
          const pivotPeers = board2.getPeers(pivot);
          const pivotPeerSet = new Set(pivotPeers.map((p) => `${p[0]},${p[1]}`));
          const xzCells = [];
          const yzCells = [];
          for (const peer of pivotPeers) {
            if (candidates.count(peer) !== 2) continue;
            const digits = candidates.getDigits(peer);
            if (digits.length !== 2) continue;
            const [d1, d2] = digits;
            if (d1 === x && d2 === z) {
              xzCells.push(peer);
            } else if (d1 === y && d2 === z) {
              yzCells.push(peer);
            }
          }
          if (xzCells.length === 0 || yzCells.length === 0) continue;
          for (const p1 of xzCells) {
            const p1Peers = board2.getPeers(p1);
            const p1PeerSet = new Set(p1Peers.map((p) => `${p[0]},${p[1]}`));
            for (const p2 of yzCells) {
              if (p1[0] === p2[0] && p1[1] === p2[1]) continue;
              const eliminations = [];
              const p2Peers = board2.getPeers(p2);
              for (const p2Peer of p2Peers) {
                const key = `${p2Peer[0]},${p2Peer[1]}`;
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
                  eliminations
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
    explanation(finding) {
      const { pivot, pivotDigits, pincer1, pincer1Digits, pincer2, pincer2Digits, eliminations } = finding;
      const z = finding.z;
      const pivotStr = `${formatCoord(pivot)} {${pivotDigits.join(", ")}}`;
      const p1Str = `${formatCoord(pincer1)} {${pincer1Digits.join(", ")}}`;
      const p2Str = `${formatCoord(pincer2)} {${pincer2Digits.join(", ")}}`;
      const elimStrs = eliminations.map((e) => formatCoord(e.coord)).join("\u3001");
      return `${pivotStr} \u4E3A\u67A2\u8F74\uFF0C${p1Str} \u548C ${p2Str} \u4E3A\u53CC\u7FFC\uFF0C\u56E0\u6B64 ${elimStrs} \u53EF\u6D88\u53BB ${z}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    buildResult(finding) {
      const involvedCells = [finding.pivot, finding.pincer1, finding.pincer2];
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/simple-coloring.ts
  function arePeers(a, b) {
    if (a[0] === b[0]) return true;
    if (a[1] === b[1]) return true;
    const ba = boxIndex(a[0], a[1]);
    const bb = boxIndex(b[0], b[1]);
    return ba === bb;
  }
  function inUnit(coord, unitType, index) {
    switch (unitType) {
      case "row":
        return coord[0] === index;
      case "col":
        return coord[1] === index;
      case "box":
        return boxIndex(coord[0], coord[1]) === index;
    }
  }
  var SimpleColoringTechnique = class {
    id = "simple-coloring";
    name = "\u5355\u8272\u94FE";
    nameEn = "Simple Coloring";
    priority = 5 /* IntermediateChain */;
    category = "coloring" /* Coloring */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 对每个数字依次执行单色链算法，返回所有发现。
     */
    detect(candidates) {
      const results = [];
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const adj = this._buildConjugateGraph(digit, candidates);
        if (adj.size === 0) continue;
        const visited = /* @__PURE__ */ new Set();
        for (const [node] of adj) {
          if (visited.has(node)) continue;
          const componentColors = this._bfsColor(adj, node, visited);
          if (componentColors.size < 2) continue;
          const color0 = [];
          const color1 = [];
          for (const [key, col] of componentColors) {
            const [r3, c3] = key.split(",").map(Number);
            const coord = [r3, c3];
            if (col === 0) color0.push(coord);
            else color1.push(coord);
          }
          const conflictColor = this._findConflict(color0, color1);
          if (conflictColor !== null) {
            const badCells = conflictColor === 0 ? color0 : color1;
            const eliminations2 = badCells.map((c3) => ({ coord: c3, digit }));
            results.push({
              digit,
              type: "contradiction",
              color0Cells: color0,
              color1Cells: color1,
              eliminations: eliminations2
            });
            break;
          }
          const eliminations = this._findSeesBothColors(
            digit,
            color0,
            color1,
            candidates,
            componentColors
          );
          if (eliminations.length > 0) {
            results.push({
              digit,
              type: "elimination",
              color0Cells: color0,
              color1Cells: color1,
              eliminations
            });
            break;
          }
        }
      }
      return results;
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digit, type, color0Cells, color1Cells, eliminations } = finding;
      if (type === "contradiction") {
        const badColorCells = eliminations.map((e) => e.coord);
        const [witnessA, witnessB, unitDesc] = this._findConflictWitness(badColorCells);
        if (witnessA && witnessB) {
          return `\u6570\u5B57 ${digit} \u7684\u5355\u8272\u94FE\u53D1\u73B0\u77DB\u76FE\uFF1A${formatCoord(witnessA)} \u548C ${formatCoord(witnessB)}\u540C\u4E3A\u8272 A \u4E14\u5904\u4E8E\u540C\u4E00${unitDesc}\uFF0C\u56E0\u6B64\u6240\u6709\u8272 A \u7684 ${eliminations.length} \u683C\u53EF\u6D88\u53BB ${digit}`;
        }
        return `\u6570\u5B57 ${digit} \u7684\u5355\u8272\u94FE\u53D1\u73B0\u77DB\u76FE\uFF1A\u8272 A \u4E2D\u5B58\u5728\u540C\u5355\u5143\u51B2\u7A81\uFF0C\u56E0\u6B64 ${eliminations.length} \u683C\u53EF\u6D88\u53BB ${digit}`;
      }
      const [colorWitness, elimWitness] = this._findEliminationWitness(
        color0Cells,
        color1Cells,
        eliminations
      );
      if (colorWitness && elimWitness) {
        return `\u6570\u5B57 ${digit} \u7684\u5355\u8272\u94FE\u4E2D\uFF0C${formatCoord(colorWitness[0])}\uFF08\u8272 A\uFF09\u4E0E ${formatCoord(colorWitness[1])}\uFF08\u8272 B\uFF09\u4E3A\u5171\u8F6D\u5BF9\uFF0C\u540C\u65F6\u5F71\u54CD ${formatCoord(elimWitness)}\uFF0C\u53EF\u6D88\u53BB ${eliminations.length} \u683C\u4E2D\u7684 ${digit}`;
      }
      return `\u6570\u5B57 ${digit} \u7684\u5355\u8272\u94FE\u4E2D\uFF0C${eliminations.length} \u683C\u540C\u65F6\u53D7\u8272 A \u548C\u8272 B \u5F71\u54CD\uFF0C\u53EF\u6D88\u53BB ${digit}`;
    }
    // ================================================================
    // 内部：共轭对图构建
    // ================================================================
    /**
     * 对指定数字，遍历 27 个单元，找出所有共轭对（该数字恰好出现两次），
     * 构建无向图邻接表。
     */
    _buildConjugateGraph(digit, candidates) {
      const adj = /* @__PURE__ */ new Map();
      const addEdge = (a, b) => {
        if (!adj.has(a)) adj.set(a, /* @__PURE__ */ new Set());
        if (!adj.has(b)) adj.set(b, /* @__PURE__ */ new Set());
        adj.get(a).add(b);
        adj.get(b).add(a);
      };
      for (let i = 0; i < 9; i++) {
        this._addConjugateIfExists(
          digit,
          "row",
          i,
          candidates,
          addEdge
        );
        this._addConjugateIfExists(
          digit,
          "col",
          i,
          candidates,
          addEdge
        );
        this._addConjugateIfExists(
          digit,
          "box",
          i,
          candidates,
          addEdge
        );
      }
      return adj;
    }
    _addConjugateIfExists(digit, unitType, index, candidates, addEdge) {
      const positions = candidates.getDigitPositionsInUnit(
        digit,
        unitType,
        index
      );
      if (positions.length === 2) {
        const a = positions[0];
        const b = positions[1];
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
    _bfsColor(adj, start, visited) {
      const colors = /* @__PURE__ */ new Map();
      const queue = [start];
      colors.set(start, 0);
      visited.add(start);
      while (queue.length > 0) {
        const current = queue.shift();
        const currentColor = colors.get(current);
        const neighbors = adj.get(current);
        if (!neighbors) continue;
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            colors.set(neighbor, currentColor === 0 ? 1 : 0);
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
    _findConflict(color0, color1) {
      const unitTypes = ["row", "col", "box"];
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
    _findSeesBothColors(digit, color0, color1, candidates, colored) {
      const unitHasColor0 = this._buildUnitColorPresence(color0);
      const unitHasColor1 = this._buildUnitColorPresence(color1);
      const eliminations = [];
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const key = `${r3},${c3}`;
          if (colored.has(key)) continue;
          if (!candidates.has(coord, digit)) continue;
          const box = boxIndex(r3, c3);
          const sees0 = unitHasColor0.row[r3] || unitHasColor0.col[c3] || unitHasColor0.box[box];
          const sees1 = unitHasColor1.row[r3] || unitHasColor1.col[c3] || unitHasColor1.box[box];
          if (sees0 && sees1) {
            eliminations.push({ coord, digit });
          }
        }
      }
      return eliminations;
    }
    _buildUnitColorPresence(cells) {
      const row = Array(9).fill(false);
      const col = Array(9).fill(false);
      const box = Array(9).fill(false);
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
    _findConflictWitness(badCells) {
      for (let i = 0; i < badCells.length; i++) {
        for (let j = i + 1; j < badCells.length; j++) {
          const a = badCells[i];
          const b = badCells[j];
          if (a[0] === b[0]) return [a, b, `\u884C\uFF08\u7B2C ${a[0] + 1} \u884C\uFF09`];
          if (a[1] === b[1]) return [a, b, `\u5217\uFF08\u7B2C ${a[1] + 1} \u5217\uFF09`];
          if (boxIndex(a[0], a[1]) === boxIndex(b[0], b[1]))
            return [a, b, `\u5BAB\uFF08\u7B2C ${boxIndex(a[0], a[1]) + 1} \u5BAB\uFF09`];
        }
      }
      return [null, null, ""];
    }
    /**
     * 从消去格中找出一对异色格作为教学示例。
     */
    _findEliminationWitness(color0, color1, eliminations) {
      if (eliminations.length === 0) return [null, null];
      for (const elim of eliminations) {
        const eCoord = elim.coord;
        const peer0 = color0.find((c3) => arePeers(c3, eCoord));
        const peer1 = color1.find((c3) => arePeers(c3, eCoord));
        if (peer0 && peer1) {
          return [[peer0, peer1], eCoord];
        }
      }
      return [null, null];
    }
    // ================================================================
    // 内部：构建结果
    // ================================================================
    buildResult(finding) {
      const allColored = [
        ...finding.color0Cells,
        ...finding.color1Cells
      ];
      const elimCoords = new Set(
        finding.eliminations.map((e) => `${e.coord[0]},${e.coord[1]}`)
      );
      for (const coord of allColored) {
        elimCoords.add(`${coord[0]},${coord[1]}`);
      }
      const involvedCells = Array.from(elimCoords).map(
        (s) => {
          const [r3, c3] = s.split(",").map(Number);
          return [r3, c3];
        }
      );
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/xy-chain.ts
  var XYChainTechnique = class {
    id = "xy-chain";
    name = "XY\u94FE";
    nameEn = "XY-Chain";
    priority = 6 /* AdvancedChain */;
    category = "chain" /* Chain */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(board2, candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 扫描全部双值格，搜索 XY-Chain。
     * 对每个双值格作为起点进行 DFS，链长度上限 12。
     */
    detect(board2, candidates) {
      const results = [];
      const bivalueCells = [];
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const cnt = candidates.count(coord);
          if (cnt !== 2) continue;
          bivalueCells.push({
            coord,
            digits: candidates.getDigits(coord)
          });
        }
      }
      if (bivalueCells.length < 2) return results;
      const peerSet = this._buildPeerSet(board2);
      const adj = /* @__PURE__ */ new Map();
      for (const cell of bivalueCells) {
        adj.set(coordKey(cell.coord), []);
      }
      for (let i = 0; i < bivalueCells.length; i++) {
        const a = bivalueCells[i];
        for (let j = i + 1; j < bivalueCells.length; j++) {
          const b = bivalueCells[j];
          if (!this._arePeers(a.coord, b.coord, peerSet)) continue;
          const shared = this._sharedDigit(a.digits, b.digits);
          if (shared === null) continue;
          adj.get(coordKey(a.coord)).push({ cell: b.coord, sharedDigit: shared });
          adj.get(coordKey(b.coord)).push({ cell: a.coord, sharedDigit: shared });
        }
      }
      for (const start of bivalueCells) {
        const [d0, d1] = start.digits;
        this._dfsChain(
          start.coord,
          d0,
          d1,
          [start.coord],
          /* @__PURE__ */ new Set([coordKey(start.coord)]),
          adj,
          candidates,
          peerSet,
          results,
          12
        );
        this._dfsChain(
          start.coord,
          d1,
          d0,
          [start.coord],
          /* @__PURE__ */ new Set([coordKey(start.coord)]),
          adj,
          candidates,
          peerSet,
          results,
          12
        );
      }
      return this._deduplicateFindings(results);
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { sharedDigit, chain, eliminations } = finding;
      const chainDesc = chain.map((c3) => formatCoord(c3)).join(" \u2192 ");
      const startKey = formatCoord(chain[0]);
      const endKey = formatCoord(chain[chain.length - 1]);
      return `XY\u94FE\uFF1A${chainDesc}\uFF0C\u8D77\u70B9 ${startKey} \u548C\u7EC8\u70B9 ${endKey} \u5171\u4EAB\u6570\u5B57 ${sharedDigit}\uFF0C\u56E0\u6B64\u540C\u65F6\u770B\u5230\u8FD9\u4E24\u7AEF\u7684 ${eliminations.length} \u5904\u53EF\u6D88\u53BB ${sharedDigit}`;
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
    _dfsChain(current, targetDigit, linkDigit, chain, visited, adj, candidates, peerSet, out, maxLen) {
      if (chain.length >= maxLen) return;
      const currentKey = coordKey(current);
      const neighbors = adj.get(currentKey) ?? [];
      for (const { cell: next, sharedDigit: shared } of neighbors) {
        const nextKey = coordKey(next);
        if (visited.has(nextKey)) continue;
        if (shared !== linkDigit) continue;
        const nextDigits = candidates.getDigits(next);
        const otherDigit = nextDigits[0] === linkDigit ? nextDigits[1] : nextDigits[0];
        if (otherDigit === targetDigit && chain.length >= 2) {
          const startCoord = chain[0];
          const eliminations = this._findEliminations(
            startCoord,
            next,
            targetDigit,
            candidates,
            peerSet,
            chain
          );
          if (eliminations.length > 0) {
            out.push({
              sharedDigit: targetDigit,
              chain: [...chain, next],
              eliminations
            });
          }
          continue;
        }
        visited.add(nextKey);
        chain.push(next);
        this._dfsChain(
          next,
          targetDigit,
          otherDigit,
          chain,
          visited,
          adj,
          candidates,
          peerSet,
          out,
          maxLen
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
    _findEliminations(start, end, digit, candidates, peerSet, chain) {
      const eliminations = [];
      const chainSet = new Set(chain.map((c3) => coordKey(c3)));
      const startPeers = peerSet.get(coordKey(start)) ?? /* @__PURE__ */ new Set();
      const endPeers = peerSet.get(coordKey(end)) ?? /* @__PURE__ */ new Set();
      for (const peerKey of startPeers) {
        if (!endPeers.has(peerKey)) continue;
        if (chainSet.has(peerKey)) continue;
        const [r3, c3] = peerKey.split(",").map(Number);
        const coord = [r3, c3];
        if (candidates.has(coord, digit)) {
          eliminations.push({ coord, digit });
        }
      }
      return eliminations;
    }
    // ================================================================
    // 内部 — 工具
    // ================================================================
    _sharedDigit(a, b) {
      if (a[0] === b[0] || a[0] === b[1]) return a[0];
      if (a[1] === b[0] || a[1] === b[1]) return a[1];
      return null;
    }
    _arePeers(a, b, peerSet) {
      const peers = peerSet.get(coordKey(a));
      return peers ? peers.has(coordKey(b)) : false;
    }
    /**
     * 为全部 81 格预计算同辈格键集合。
     */
    _buildPeerSet(board2) {
      const map = /* @__PURE__ */ new Map();
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const key = coordKey(coord);
          const peers = board2.getPeers(coord);
          const peerKeys = new Set(peers.map((p) => coordKey(p)));
          map.set(key, peerKeys);
        }
      }
      return map;
    }
    /** 按链签名去重 */
    _deduplicateFindings(findings) {
      const seen = /* @__PURE__ */ new Set();
      const result = [];
      for (const f of findings) {
        const chainKeys = f.chain.map((c3) => coordKey(c3)).sort();
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
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.chain,
        description: this.explanation(finding)
      };
    }
  };
  function coordKey(coord) {
    return `${coord[0]},${coord[1]}`;
  }

  // ../../ClaudeSafe/sudoku/technique/medusa.ts
  var MedusaTechnique = class {
    id = "3d-medusa";
    name = "\u4E09\u7EF4\u7F8E\u675C\u838E";
    nameEn = "3D Medusa";
    priority = 6 /* AdvancedChain */;
    category = "coloring" /* Coloring */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(board2, candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    detect(board2, candidates) {
      const results = [];
      const nodeList = [];
      const nodeIndex = /* @__PURE__ */ new Map();
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const digits = candidates.getDigits(coord);
          for (const d of digits) {
            const key = nodeKey(coord, d);
            nodeIndex.set(key, nodeList.length);
            nodeList.push({ coord, digit: d });
          }
        }
      }
      if (nodeList.length === 0) return results;
      const adj = Array.from({ length: nodeList.length }, () => []);
      const addEdge = (a, b) => {
        if (a !== b && !adj[a].includes(b)) {
          adj[a].push(b);
          adj[b].push(a);
        }
      };
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        for (const unitType of ["row", "col", "box"]) {
          for (let idx = 0; idx < 9; idx++) {
            const positions = candidates.getDigitPositionsInUnit(
              digit,
              unitType,
              idx
            );
            if (positions.length !== 2) continue;
            const k1 = nodeKey(positions[0], digit);
            const k2 = nodeKey(positions[1], digit);
            const i1 = nodeIndex.get(k1);
            const i2 = nodeIndex.get(k2);
            if (i1 !== void 0 && i2 !== void 0) {
              addEdge(i1, i2);
            }
          }
        }
      }
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const cnt = candidates.count(coord);
          if (cnt !== 2) continue;
          const digits = candidates.getDigits(coord);
          const k1 = nodeKey(coord, digits[0]);
          const k2 = nodeKey(coord, digits[1]);
          const i1 = nodeIndex.get(k1);
          const i2 = nodeIndex.get(k2);
          if (i1 !== void 0 && i2 !== void 0) {
            addEdge(i1, i2);
          }
        }
      }
      const colors = /* @__PURE__ */ new Map();
      const visited = /* @__PURE__ */ new Set();
      for (let i = 0; i < nodeList.length; i++) {
        if (visited.has(i)) continue;
        const component = [];
        const queue = [i];
        colors.set(i, 0);
        visited.add(i);
        while (queue.length > 0) {
          const u = queue.shift();
          component.push(u);
          const uColor = colors.get(u);
          for (const v of adj[u]) {
            if (!visited.has(v)) {
              visited.add(v);
              colors.set(v, 1 - uColor);
              queue.push(v);
            }
          }
        }
        if (component.length < 2) continue;
        const finding = this._analyzeComponent(
          component,
          nodeList,
          colors,
          candidates,
          board2
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
    explanation(finding) {
      const { ruleType, eliminations, detailCell, detailDigit, detailUnitLabel, detailUnitIndex } = finding;
      if (ruleType === "two_same_color_in_cell") {
        return `\u4E09\u7EF4\u7F8E\u675C\u838E\u7740\u8272\uFF1A${formatCoord(detailCell)} \u6709\u4E24\u4E2A\u540C\u8272\u5019\u9009\u6570\uFF0C\u8BE5\u8272\u5168\u4F53 ${eliminations.length} \u4E2A\u5019\u9009\u6570\u53EF\u6D88\u53BB`;
      }
      if (ruleType === "two_same_color_in_unit") {
        const label = detailUnitLabel;
        const idx = detailUnitIndex + 1;
        return `\u4E09\u7EF4\u7F8E\u675C\u838E\u7740\u8272\uFF1A\u6570\u5B57 ${detailDigit} \u5728\u7B2C ${idx} ${label} \u6709\u4E24\u4E2A\u540C\u8272\u4F4D\u7F6E\uFF0C\u8BE5\u8272\u5168\u4F53 ${eliminations.length} \u4E2A\u5019\u9009\u6570\u53EF\u6D88\u53BB`;
      }
      return `\u4E09\u7EF4\u7F8E\u675C\u838E\u7740\u8272\uFF1A${formatCoord(detailCell)} \u540C\u65F6\u770B\u5230\u6570\u5B57 ${detailDigit} \u7684\u4E24\u79CD\u989C\u8272\uFF0C\u56E0\u6B64\u53EF\u6D88\u53BB\u8BE5\u6570\u5B57\uFF08\u5171 ${eliminations.length} \u5904\uFF09`;
    }
    // ================================================================
    // 内部 — 分量分析
    // ================================================================
    _analyzeComponent(component, nodeList, colors, candidates, board2) {
      const cellColorMap = /* @__PURE__ */ new Map();
      const unitDigitColorMap = /* @__PURE__ */ new Map();
      for (const idx of component) {
        const { coord, digit } = nodeList[idx];
        const color = colors.get(idx);
        const ck = coordKey2(coord);
        if (!cellColorMap.has(ck)) {
          cellColorMap.set(ck, /* @__PURE__ */ new Map([[0, []], [1, []]]));
        }
        cellColorMap.get(ck).get(color).push(idx);
        const bx = boxIndex(coord[0], coord[1]);
        const units = [
          { type: "row", idx: coord[0] },
          { type: "col", idx: coord[1] },
          { type: "box", idx: bx }
        ];
        for (const ut of units) {
          const key = `${ut.type}|${ut.idx}|${digit}`;
          if (!unitDigitColorMap.has(key)) {
            unitDigitColorMap.set(key, /* @__PURE__ */ new Map([[0, []], [1, []]]));
          }
          unitDigitColorMap.get(key).get(color).push(idx);
        }
      }
      for (const [cellKey, colorGroups] of cellColorMap) {
        for (const color of [0, 1]) {
          const nodes = colorGroups.get(color);
          if (nodes.length < 2) continue;
          const detailCoord = parseCoord(cellKey);
          return this._buildColorElimination(
            component,
            nodeList,
            colors,
            color,
            "two_same_color_in_cell",
            detailCoord,
            nodeList[nodes[0]].digit,
            "",
            0
          );
        }
      }
      for (const [key, colorGroups] of unitDigitColorMap) {
        for (const color of [0, 1]) {
          const nodes = colorGroups.get(color);
          if (nodes.length < 2) continue;
          const [ut, uidxStr, dStr] = key.split("|");
          const unitLabel = ut === "row" ? "\u884C" : ut === "col" ? "\u5217" : "\u5BAB";
          return this._buildColorElimination(
            component,
            nodeList,
            colors,
            color,
            "two_same_color_in_unit",
            nodeList[nodes[0]].coord,
            Number(dStr),
            unitLabel,
            Number(uidxStr)
          );
        }
      }
      const coloredByDigit = /* @__PURE__ */ new Map();
      for (const idx of component) {
        const { coord, digit } = nodeList[idx];
        const color = colors.get(idx);
        if (!coloredByDigit.has(digit)) {
          coloredByDigit.set(digit, /* @__PURE__ */ new Map([[0, /* @__PURE__ */ new Set()], [1, /* @__PURE__ */ new Set()]]));
        }
        coloredByDigit.get(digit).get(color).add(coordKey2(coord));
      }
      const componentCellKeys = /* @__PURE__ */ new Set();
      for (const idx of component) {
        componentCellKeys.add(coordKey2(nodeList[idx].coord));
      }
      const peerCache = this._buildPeerCache(board2);
      for (const [digit, colorMap] of coloredByDigit) {
        const set0 = colorMap.get(0);
        const set1 = colorMap.get(1);
        if (set0.size === 0 || set1.size === 0) continue;
        for (let r3 = 0; r3 < 9; r3++) {
          for (let c3 = 0; c3 < 9; c3++) {
            const coord = [r3, c3];
            const ck = coordKey2(coord);
            if (componentCellKeys.has(ck)) continue;
            if (!candidates.has(coord, digit)) continue;
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
              const eliminations = [];
              for (let rr = 0; rr < 9; rr++) {
                for (let cc = 0; cc < 9; cc++) {
                  const cc2 = [rr, cc];
                  const ck2 = coordKey2(cc2);
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
                const involved = [];
                for (const idx of component) {
                  involved.push(nodeList[idx].coord);
                }
                return {
                  eliminations,
                  involvedCells: this._uniqueCoords(involved),
                  ruleType: "seen_by_both_colors",
                  detailCell: coord,
                  detailDigit: digit,
                  detailUnitLabel: "",
                  detailUnitIndex: 0
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
    _buildColorElimination(component, nodeList, colors, badColor, ruleType, detailCell, detailDigit, detailUnitLabel, detailUnitIndex) {
      const eliminations = [];
      const involved = [];
      for (const idx of component) {
        const { coord, digit } = nodeList[idx];
        involved.push(coord);
        if (colors.get(idx) === badColor) {
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
        detailUnitIndex
      };
    }
    // ================================================================
    // 内部 — 工具
    // ================================================================
    /** 为全部 81 格预计算同辈格键集合，缓存复用。 */
    _buildPeerCache(board2) {
      const map = /* @__PURE__ */ new Map();
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const key = coordKey2(coord);
          const peers = board2.getPeers(coord);
          const peerKeys = new Set(peers.map((p) => coordKey2(p)));
          map.set(key, peerKeys);
        }
      }
      return map;
    }
    /** 从坐标列表中按字符串键去重。 */
    _uniqueCoords(coords) {
      const seen = /* @__PURE__ */ new Set();
      const result = [];
      for (const c3 of coords) {
        const k = coordKey2(c3);
        if (!seen.has(k)) {
          seen.add(k);
          result.push(c3);
        }
      }
      return result;
    }
    // ================================================================
    // 内部 — 结果构建
    // ================================================================
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.involvedCells,
        description: this.explanation(finding)
      };
    }
  };
  function coordKey2(coord) {
    return `${coord[0]},${coord[1]}`;
  }
  function nodeKey(coord, digit) {
    return `${coord[0]},${coord[1]}:${digit}`;
  }
  function parseCoord(key) {
    const [r3, c3] = key.split(",").map(Number);
    return [r3, c3];
  }

  // ../../ClaudeSafe/sudoku/technique/aic.ts
  var AICTechnique = class {
    id = "aic";
    name = "\u4EA4\u66FF\u63A8\u7406\u94FE";
    nameEn = "Alternating Inference Chain";
    priority = 6 /* AdvancedChain */;
    category = "chain" /* Chain */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(board2, candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    /**
     * 对每个数字独立执行单数字着色分析。
     * 强链 = 共轭对（某数字在某单元中恰好出现在 2 格）。
     * 弱链 = 同单元内两格均有该数字。
     */
    detect(board2, candidates) {
      const results = [];
      const peerCache = this._buildPeerCache(board2);
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
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
    explanation(finding) {
      const { digit, ruleType, eliminations, detailColor } = finding;
      if (ruleType === "same_color_peers") {
        const colorName = detailColor === 0 ? "A" : "B";
        return `\u4EA4\u66FF\u63A8\u7406\u94FE\uFF1A\u6570\u5B57 ${digit} \u7684\u7740\u8272\u94FE\u4E2D\uFF0C\u540C\u8272 (${colorName}) \u4E24\u683C\u5728\u540C\u4E00\u5355\u5143\uFF0C\u56E0\u6B64\u8BE5\u8272\u5168\u90E8 ${eliminations.length} \u5904\u53EF\u6D88\u53BB ${digit}`;
      }
      return `\u4EA4\u66FF\u63A8\u7406\u94FE\uFF1A\u6570\u5B57 ${digit} \u7684\u7740\u8272\u94FE\u4E2D\uFF0C\u6709 ${eliminations.length} \u683C\u540C\u65F6\u770B\u5230\u4E24\u79CD\u989C\u8272\uFF0C\u53EF\u6D88\u53BB ${digit}`;
    }
    // ================================================================
    // 内部 — 单数字分析
    // ================================================================
    _analyzeDigit(digit, candidates, peerCache) {
      const results = [];
      const cellList = [];
      const cellIndex = /* @__PURE__ */ new Map();
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          if (candidates.has(coord, digit)) {
            const key = coordKey3(coord);
            cellIndex.set(key, cellList.length);
            cellList.push(coord);
          }
        }
      }
      if (cellList.length < 2) return results;
      const adj = Array.from({ length: cellList.length }, () => []);
      const addEdge = (a, b) => {
        if (!adj[a].includes(b)) {
          adj[a].push(b);
          adj[b].push(a);
        }
      };
      for (let i = 0; i < 9; i++) {
        this._addConjugatePair(digit, "row", i, candidates, cellIndex, addEdge);
        this._addConjugatePair(digit, "col", i, candidates, cellIndex, addEdge);
        this._addConjugatePair(digit, "box", i, candidates, cellIndex, addEdge);
      }
      const colors = /* @__PURE__ */ new Map();
      const visited = /* @__PURE__ */ new Set();
      for (let i = 0; i < cellList.length; i++) {
        if (visited.has(i)) continue;
        const component = [];
        const queue = [i];
        colors.set(i, 0);
        visited.add(i);
        while (queue.length > 0) {
          const u = queue.shift();
          component.push(u);
          const uColor = colors.get(u);
          for (const v of adj[u]) {
            if (!visited.has(v)) {
              visited.add(v);
              colors.set(v, 1 - uColor);
              queue.push(v);
            }
          }
        }
        if (component.length < 2) continue;
        const sameColorResult = this._checkSameColorPeers(
          component,
          cellList,
          colors,
          digit,
          peerCache
        );
        if (sameColorResult) {
          results.push(sameColorResult);
          continue;
        }
        const seenBothResult = this._checkSeenByBothColors(
          component,
          cellList,
          colors,
          digit,
          candidates,
          peerCache
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
    _addConjugatePair(digit, unitType, index, candidates, cellIndex, addEdge) {
      const positions = candidates.getDigitPositionsInUnit(digit, unitType, index);
      if (positions.length !== 2) return;
      const k1 = coordKey3(positions[0]);
      const k2 = coordKey3(positions[1]);
      const i1 = cellIndex.get(k1);
      const i2 = cellIndex.get(k2);
      if (i1 !== void 0 && i2 !== void 0 && i1 !== i2) {
        addEdge(i1, i2);
      }
    }
    // ================================================================
    // 内部 — 规则 1：同色同单元
    // ================================================================
    _checkSameColorPeers(component, cellList, colors, digit, peerCache) {
      const byColor = [/* @__PURE__ */ new Set(), /* @__PURE__ */ new Set()];
      for (const idx of component) {
        const key = coordKey3(cellList[idx]);
        byColor[colors.get(idx)].add(key);
      }
      for (const color of [0, 1]) {
        const colorSet = byColor[color];
        const keys = [...colorSet];
        for (let a = 0; a < keys.length; a++) {
          const peers = peerCache.get(keys[a]);
          for (let b = a + 1; b < keys.length; b++) {
            if (peers.has(keys[b])) {
              const eliminations = [];
              for (const idx of component) {
                if (colors.get(idx) === color) {
                  eliminations.push({ coord: cellList[idx], digit });
                }
              }
              return {
                digit,
                componentCells: component.map((i) => cellList[i]),
                eliminations,
                ruleType: "same_color_peers",
                detailColor: color
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
    _checkSeenByBothColors(component, cellList, colors, digit, candidates, peerCache) {
      const byColor = [/* @__PURE__ */ new Set(), /* @__PURE__ */ new Set()];
      for (const idx of component) {
        const key = coordKey3(cellList[idx]);
        byColor[colors.get(idx)].add(key);
      }
      if (byColor[0].size === 0 || byColor[1].size === 0) return null;
      const componentKeys = /* @__PURE__ */ new Set();
      for (const idx of component) {
        componentKeys.add(coordKey3(cellList[idx]));
      }
      const eliminations = [];
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const ck = coordKey3(coord);
          if (componentKeys.has(ck)) continue;
          if (!candidates.has(coord, digit)) continue;
          const peers = peerCache.get(ck);
          if (!peers) continue;
          let sees0 = false;
          let sees1 = false;
          for (const pk of peers) {
            if (byColor[0].has(pk)) sees0 = true;
            if (byColor[1].has(pk)) sees1 = true;
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
        componentCells: component.map((i) => cellList[i]),
        eliminations,
        ruleType: "seen_by_both_colors",
        detailColor: 0
        // not meaningful for this rule
      };
    }
    // ================================================================
    // 内部 — 工具
    // ================================================================
    /** 为全部 81 格预计算同辈格键集合。 */
    _buildPeerCache(board2) {
      const map = /* @__PURE__ */ new Map();
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const peers = board2.getPeers(coord);
          const peerKeys = new Set(peers.map((p) => coordKey3(p)));
          map.set(coordKey3(coord), peerKeys);
        }
      }
      return map;
    }
    // ================================================================
    // 内部 — 结果构建
    // ================================================================
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.componentCells,
        description: this.explanation(finding)
      };
    }
  };
  function coordKey3(coord) {
    return `${coord[0]},${coord[1]}`;
  }

  // ../../ClaudeSafe/sudoku/technique/empty-rectangle.ts
  var EmptyRectangleTechnique = class {
    id = "empty-rectangle";
    name = "\u7A7A\u77E9\u5F62";
    nameEn = "Empty Rectangle";
    priority = 5 /* IntermediateChain */;
    category = "elimination" /* Elimination */;
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    detect(candidates) {
      const results = [];
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        for (let box = 0; box < 9; box++) {
          const boxPositions = candidates.getDigitPositionsInUnit(digit, "box", box);
          if (boxPositions.length < 2 || boxPositions.length > 5) continue;
          const boxRows = [...new Set(boxPositions.map((c3) => c3[0]))];
          const boxCols = [...new Set(boxPositions.map((c3) => c3[1]))];
          if (boxRows.length < 2 || boxCols.length < 2) continue;
          if (boxRows.length > 3 || boxCols.length > 3) continue;
          const allRowColCombos = boxRows.length * boxCols.length;
          if (boxPositions.length === allRowColCombos) continue;
          for (const row of boxRows) {
            const rowPositions = candidates.getDigitPositionsInUnit(digit, "row", row);
            if (rowPositions.length !== 2) continue;
            const inner = rowPositions.find((c3) => this._inBox(c3, box));
            const outer = rowPositions.find((c3) => !this._inBox(c3, box));
            if (!inner || !outer) continue;
            const outerCol = outer[1];
            for (const bc of boxCols) {
              if (bc === outerCol) continue;
              const target = [outer[0], bc];
              if (this._inBox(target, box)) continue;
              if (candidates.has(target, digit)) {
                const existing = results.find(
                  (r3) => r3.digit === digit && r3.box === box && r3.eliminations.some((e) => e.coord[0] === target[0] && e.coord[1] === target[1])
                );
                if (!existing) {
                  results.push({
                    digit,
                    box,
                    boxRows,
                    boxCols,
                    strongLink: { unitType: "row", unitIndex: row, inner, outer },
                    eliminations: [{ coord: target, digit }]
                  });
                }
              }
            }
            for (const col of boxCols) {
              const colPositions = candidates.getDigitPositionsInUnit(digit, "col", col);
              if (colPositions.length !== 2) continue;
              const innerC = colPositions.find((c3) => this._inBox(c3, box));
              const outerC = colPositions.find((c3) => !this._inBox(c3, box));
              if (!innerC || !outerC) continue;
              const outerRow = outerC[0];
              for (const br of boxRows) {
                if (br === outerRow) continue;
                const targetC = [br, outerC[1]];
                if (this._inBox(targetC, box)) continue;
                if (candidates.has(targetC, digit)) {
                  const existing = results.find(
                    (r3) => r3.digit === digit && r3.box === box && r3.eliminations.some((e) => e.coord[0] === targetC[0] && e.coord[1] === targetC[1])
                  );
                  if (!existing) {
                    results.push({
                      digit,
                      box,
                      boxRows,
                      boxCols,
                      strongLink: { unitType: "col", unitIndex: col, inner: innerC, outer: outerC },
                      eliminations: [{ coord: targetC, digit }]
                    });
                  }
                }
              }
            }
          }
        }
      }
      return this._mergeSamePattern(results);
    }
    // ================================================================
    // 教学说明
    // ================================================================
    explanation(finding) {
      const { digit, box, strongLink, eliminations } = finding;
      const unitLabel = strongLink.unitType === "row" ? "\u884C" : "\u5217";
      const unitIdx = strongLink.unitIndex + 1;
      const targets = eliminations.map((e) => formatCoord(e.coord)).join("\u3001");
      return `\u6570\u5B57 ${digit} \u5728\u7B2C ${box + 1} \u5BAB\u5F62\u6210\u7A7A\u77E9\u5F62\uFF0C\u914D\u5408\u7B2C ${unitIdx}${unitLabel}\u7684\u5F3A\u94FE ${formatCoord(strongLink.inner)}\u2194${formatCoord(strongLink.outer)}\uFF0C\u56E0\u6B64\u53EF\u4ECE ${targets} \u6D88\u53BB ${digit}`;
    }
    // ================================================================
    // 内部
    // ================================================================
    _inBox(coord, box) {
      const sr = Math.floor(box / 3) * 3;
      const sc = box % 3 * 3;
      const [r3, c3] = coord;
      return r3 >= sr && r3 < sr + 3 && c3 >= sc && c3 < sc + 3;
    }
    /** 合并同一宫 + 同数字 + 同强链的多条消去到一条记录 */
    _mergeSamePattern(findings) {
      const groups = /* @__PURE__ */ new Map();
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
    buildResult(finding) {
      const involved = [
        ...finding.boxRows.flatMap(
          (r3) => finding.boxCols.map((c3) => [r3, c3])
        ),
        finding.strongLink.inner,
        finding.strongLink.outer
      ];
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: involved,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/unique-rectangle.ts
  var UniqueRectangleTechnique = class {
    id = "unique-rectangle";
    name = "\u552F\u4E00\u77E9\u5F62";
    nameEn = "Unique Rectangle";
    priority = 6 /* AdvancedChain */;
    category = "elimination" /* Elimination */;
    apply(_board, candidates) {
      const findings = this.detect(candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => b.eliminations.length - a.eliminations.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    detect(candidates) {
      const results = [];
      for (let r1 = 0; r1 < 8; r1++) {
        for (let r22 = r1 + 1; r22 < 9; r22++) {
          for (let c1 = 0; c1 < 8; c1++) {
            for (let c22 = c1 + 1; c22 < 9; c22++) {
              const c11 = [r1, c1];
              const c12 = [r1, c22];
              const c21 = [r22, c1];
              const c222 = [r22, c22];
              const boxes = /* @__PURE__ */ new Set([
                this._boxOf(c11),
                this._boxOf(c12),
                this._boxOf(c21),
                this._boxOf(c222)
              ]);
              if (boxes.size !== 2) continue;
              const cands = [
                candidates.getDigits(c11),
                candidates.getDigits(c12),
                candidates.getDigits(c21),
                candidates.getDigits(c222)
              ];
              if (cands.some((c3) => c3.length === 0)) continue;
              const pair = this._findCommonPair(cands);
              if (!pair) continue;
              const [x, y] = pair;
              const biValueCount = cands.filter(
                (c3) => c3.length === 2 && c3.includes(x) && c3.includes(y)
              ).length;
              if (biValueCount === 3) {
                const corners = [c11, c12, c21, c222];
                for (let i = 0; i < 4; i++) {
                  const c3 = cands[i];
                  if (!(c3.length === 2 && c3.includes(x) && c3.includes(y))) {
                    const elims = [];
                    if (c3.includes(x)) elims.push({ coord: corners[i], digit: x });
                    if (c3.includes(y)) elims.push({ coord: corners[i], digit: y });
                    if (elims.length > 0) {
                      results.push({
                        digits: pair,
                        corners,
                        urType: 1,
                        eliminations: elims
                      });
                    }
                  }
                }
              }
              if (biValueCount === 2) {
                const corners = [c11, c12, c21, c222];
                const biIndices = [0, 1, 2, 3].filter(
                  (i) => cands[i].length === 2 && cands[i].includes(x) && cands[i].includes(y)
                );
                if (biIndices.length === 2) {
                  const bi0 = corners[biIndices[0]];
                  const bi1 = corners[biIndices[1]];
                  if (bi0[0] !== bi1[0] && bi0[1] !== bi1[1]) {
                    const extraIndices = [0, 1, 2, 3].filter((i) => !biIndices.includes(i));
                    const extras1 = cands[extraIndices[0]].filter((d) => d !== x && d !== y);
                    const extras2 = cands[extraIndices[1]].filter((d) => d !== x && d !== y);
                    for (const z of extras1) {
                      if (extras2.includes(z)) {
                        const elims = [];
                        for (let rr = 0; rr < 9; rr++) {
                          for (let cc = 0; cc < 9; cc++) {
                            const tc = [rr, cc];
                            if (corners.some((cn) => cn[0] === tc[0] && cn[1] === tc[1])) continue;
                            if (!candidates.has(tc, z)) continue;
                            const sees1 = this._arePeers(tc, corners[extraIndices[0]]);
                            const sees2 = this._arePeers(tc, corners[extraIndices[1]]);
                            if (sees1 && sees2) {
                              elims.push({ coord: tc, digit: z });
                            }
                          }
                        }
                        if (elims.length > 0) {
                          results.push({
                            digits: pair,
                            corners,
                            urType: 2,
                            eliminations: elims
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
    explanation(finding) {
      const { digits, corners, urType } = finding;
      const [x, y] = digits;
      const cells = corners.map((c3) => formatCoord(c3)).join("\u3001");
      if (urType === 1) {
        const target = finding.eliminations[0];
        return `\u56DB\u683C ${cells} \u5F62\u6210\u552F\u4E00\u77E9\u5F62 {${x},${y}}\uFF0C\u5176\u4E2D\u4E09\u89D2\u4E3A\u7EAF\u53CC\u503C\u683C\uFF0C\u7B2C\u56DB\u683C ${formatCoord(target.coord)} \u542B\u989D\u5916\u5019\u9009\uFF0C\u4E3A\u907F\u514D\u591A\u89E3\uFF0C\u53EF\u4ECE\u8BE5\u683C\u6D88\u53BB ${x} \u548C ${y}`;
      } else {
        const z = finding.eliminations[0].digit;
        return `\u56DB\u683C ${cells} \u5BF9\u9876\u89D2\u5171\u4EAB\u989D\u5916\u6570\u5B57 ${z}\uFF0C\u5F62\u6210\u552F\u4E00\u77E9\u5F62 Type 2\uFF0C\u53EF\u6D88\u53BB ${finding.eliminations.length} \u5904 ${z}`;
      }
    }
    // ================================================================
    // 内部
    // ================================================================
    _boxOf(c3) {
      return Math.floor(c3[0] / 3) * 3 + Math.floor(c3[1] / 3);
    }
    _arePeers(a, b) {
      if (a[0] === b[0] || a[1] === b[1]) return true;
      return this._boxOf(a) === this._boxOf(b);
    }
    /**
     * 从 4 组候选数中找共同包含的两个数字。
     * 返回 [x,y] 若每组都包含 x 和 y，否则 null。
     */
    _findCommonPair(cands) {
      let common = new Set(cands[0]);
      for (let i = 1; i < 4; i++) {
        common = new Set(cands[i].filter((d) => common.has(d)));
      }
      const arr = [...common];
      if (arr.length >= 2) {
        return [arr[0], arr[1]];
      }
      return null;
    }
    buildResult(finding) {
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement: null,
          eliminations: finding.eliminations,
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: finding.corners,
        description: this.explanation(finding)
      };
    }
  };

  // ../../ClaudeSafe/sudoku/technique/forcing-chain.ts
  var ForcingChainTechnique = class {
    id = "forcing-chain";
    name = "\u5F3A\u5236\u94FE";
    nameEn = "Forcing Chain";
    priority = 6 /* AdvancedChain */;
    category = "chain" /* Chain */;
    // ================================================================
    // Technique 接口
    // ================================================================
    apply(board2, candidates) {
      const findings = this.detect(board2, candidates);
      if (findings.length === 0) return null;
      findings.sort((a, b) => a.chainSteps.length - b.chainSteps.length);
      return this.buildResult(findings[0]);
    }
    // ================================================================
    // 检测
    // ================================================================
    detect(board2, candidates) {
      const results = [];
      const bivalCells = [];
      const multiCells = [];
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          const coord = [r3, c3];
          const cnt = candidates.count(coord);
          if (cnt === 2) {
            bivalCells.push({ coord, digits: candidates.getDigits(coord) });
          } else if (cnt >= 3 && cnt <= 4) {
            multiCells.push({ coord, digits: candidates.getDigits(coord) });
          }
        }
      }
      for (const cell of bivalCells) {
        for (const assumeDigit of cell.digits) {
          const result = this._testAssumption(board2, candidates, cell.coord, assumeDigit);
          if (result) {
            results.push(result);
            break;
          }
        }
        if (results.length > 0) break;
      }
      if (results.length > 0) return results;
      multiCells.sort((a, b) => a.digits.length - b.digits.length);
      for (const cell of multiCells) {
        for (const assumeDigit of cell.digits) {
          const result = this._testAssumption(board2, candidates, cell.coord, assumeDigit);
          if (result) {
            results.push(result);
            break;
          }
        }
        if (results.length > 0) break;
      }
      if (results.length > 0) return results;
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        for (let i = 0; i < 9; i++) {
          for (const unitType of ["row", "col", "box"]) {
            const pos = candidates.getDigitPositionsInUnit(digit, unitType, i);
            if (pos.length !== 2) continue;
            for (const coord of pos) {
              const result = this._testAssumption(board2, candidates, coord, digit);
              if (result) {
                results.push(result);
                return results;
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
    explanation(finding) {
      const { startCell, startCandidates, assumedDigit, contradictionCell, chainSteps } = finding;
      const startLabel = formatCoord(startCell);
      const contraLabel = formatCoord(contradictionCell);
      const remaining = startCandidates.filter((d) => d !== assumedDigit);
      const conclusion = remaining.length === 1 ? `\u5FC5\u4E3A ${remaining[0]}` : `\u53EF\u6392\u9664 ${assumedDigit}`;
      return `\u5047\u8BBE ${startLabel} = ${assumedDigit}\uFF0C\u63A8\u5BFC\u94FE\uFF1A` + chainSteps.join(" \u2192 ") + ` \u2192 ${contraLabel} \u77DB\u76FE\uFF0C\u56E0\u6B64 ${startLabel} \u2260 ${assumedDigit}\uFF0C${conclusion}`;
    }
    // ================================================================
    // 内部：假设推理
    // ================================================================
    _testAssumption(board2, candidates, startCell, assumeDigit) {
      const testBoard = board2.clone();
      const testGrid = candidates.toMutableGrid();
      testBoard.place(startCell, assumeDigit);
      this._placeAndPropagate(testGrid, startCell, assumeDigit);
      const chainSteps = [];
      chainSteps.push(`\u7F6E ${formatCoord(startCell)}=${assumeDigit}`);
      for (let iter = 0; iter < 50; iter++) {
        const contra = this._findContradiction(testBoard, testGrid);
        if (contra) {
          return {
            startCell,
            startCandidates: candidates.getDigits(startCell),
            assumedDigit: assumeDigit,
            contradictionCell: contra.coord,
            contradictionDesc: `${formatCoord(contra.coord)} ${contra.reason}`,
            chainSteps
          };
        }
        const naked = this._findNakedSingle(testBoard, testGrid);
        if (naked) {
          testBoard.place(naked.coord, naked.digit);
          this._placeAndPropagate(testGrid, naked.coord, naked.digit);
          chainSteps.push(
            `\u552F\u4F59 ${formatCoord(naked.coord)}=${naked.digit}`
          );
          continue;
        }
        const hidden = this._findHiddenSingle(testBoard, testGrid);
        if (hidden) {
          testBoard.place(hidden.coord, hidden.digit);
          this._placeAndPropagate(testGrid, hidden.coord, hidden.digit);
          chainSteps.push(
            `\u6452\u9664 ${formatCoord(hidden.coord)}=${hidden.digit}`
          );
          continue;
        }
        break;
      }
      return null;
    }
    // ================================================================
    // 候选数操作（轻量，不依赖 CandidateManager）
    // ================================================================
    /** 填入数字并从同辈格消去 */
    _placeAndPropagate(grid, coord, digit) {
      grid[coord[0]][coord[1]] = 0;
      for (let i = 0; i < 9; i++) {
        if (i !== coord[1]) {
          grid[coord[0]][i] = CandidateMask.remove(grid[coord[0]][i], digit);
        }
        if (i !== coord[0]) {
          grid[i][coord[1]] = CandidateMask.remove(grid[i][coord[1]], digit);
        }
        const br = Math.floor(coord[0] / 3) * 3 + Math.floor(i / 3);
        const bc = Math.floor(coord[1] / 3) * 3 + i % 3;
        if (br === coord[0] && bc === coord[1]) continue;
        grid[br][bc] = CandidateMask.remove(grid[br][bc], digit);
      }
    }
    /** 找第一个裸单一（候选数=1的空格） */
    _findNakedSingle(board2, grid) {
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          if (board2.getCell(r3, c3).value !== 0) continue;
          const mask = grid[r3][c3];
          if (CandidateMask.isSingle(mask)) {
            return {
              coord: [r3, c3],
              digit: CandidateMask.soleDigit(mask)
            };
          }
        }
      }
      return null;
    }
    /** 找第一个隐单一（某行/列/宫中某数字仅出现1次） */
    _findHiddenSingle(board2, grid) {
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        for (let r3 = 0; r3 < 9; r3++) {
          const pos = [];
          for (let c3 = 0; c3 < 9; c3++) {
            if (board2.getCell(r3, c3).value !== 0) continue;
            if (CandidateMask.has(grid[r3][c3], digit)) {
              pos.push([r3, c3]);
            }
          }
          if (pos.length === 1) return { coord: pos[0], digit };
        }
        for (let c3 = 0; c3 < 9; c3++) {
          const pos = [];
          for (let r3 = 0; r3 < 9; r3++) {
            if (board2.getCell(r3, c3).value !== 0) continue;
            if (CandidateMask.has(grid[r3][c3], digit)) {
              pos.push([r3, c3]);
            }
          }
          if (pos.length === 1) return { coord: pos[0], digit };
        }
        for (let b = 0; b < 9; b++) {
          const pos = [];
          const sr = Math.floor(b / 3) * 3;
          const sc = b % 3 * 3;
          for (let dr = 0; dr < 3; dr++) {
            for (let dc = 0; dc < 3; dc++) {
              const r3 = sr + dr, c3 = sc + dc;
              if (board2.getCell(r3, c3).value !== 0) continue;
              if (CandidateMask.has(grid[r3][c3], digit)) {
                pos.push([r3, c3]);
              }
            }
          }
          if (pos.length === 1) return { coord: pos[0], digit };
        }
      }
      return null;
    }
    /** 检查是否存在矛盾（空格无候选数） */
    _findContradiction(board2, grid) {
      for (let r3 = 0; r3 < 9; r3++) {
        for (let c3 = 0; c3 < 9; c3++) {
          if (board2.getCell(r3, c3).value !== 0) continue;
          if (grid[r3][c3] === 0) {
            return {
              coord: [r3, c3],
              reason: "\u5019\u9009\u6570\u4E3A\u96F6\uFF08\u77DB\u76FE\uFF09"
            };
          }
        }
      }
      for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        for (let r3 = 0; r3 < 9; r3++) {
          let has = false;
          for (let c3 = 0; c3 < 9; c3++) {
            if (board2.getCell(r3, c3).value === digit) {
              has = true;
              break;
            }
            if (board2.getCell(r3, c3).value === 0 && CandidateMask.has(grid[r3][c3], digit)) {
              has = true;
              break;
            }
          }
          if (!has) return { coord: [r3, 0], reason: `\u7B2C${r3 + 1}\u884C\u65E0\u5904\u653E${digit}` };
        }
      }
      return null;
    }
    // ================================================================
    // 构建结果
    // ================================================================
    buildResult(finding) {
      const { startCell, startCandidates, assumedDigit } = finding;
      const remaining = startCandidates.filter((d) => d !== assumedDigit);
      const description = this.explanation(finding);
      const placement = remaining.length === 1 ? { coord: startCell, digit: remaining[0] } : null;
      return {
        techniqueId: this.id,
        techniqueName: this.name,
        priority: this.priority,
        category: this.category,
        outcome: "progressed" /* Progressed */,
        delta: {
          placement,
          eliminations: [{ coord: startCell, digit: assumedDigit }],
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: [startCell, finding.contradictionCell],
        description
      };
    }
  };

  // ../../ClaudeSafe/sudoku/trace.ts
  var PRIORITY_LABEL = {
    [0 /* Basic */]: "\u57FA\u672C",
    [1 /* Pair */]: "\u6570\u5BF9",
    [2 /* Triple */]: "\u4E09\u6570\u7EC4",
    [3 /* Quad */]: "\u56DB\u6570\u7EC4",
    [4 /* BasicFish */]: "\u57FA\u7840\u9C7C",
    [5 /* IntermediateChain */]: "\u4E2D\u7EA7\u94FE",
    [6 /* AdvancedChain */]: "\u9AD8\u7EA7\u94FE",
    [7 /* BruteForce */]: "\u56DE\u6EAF"
  };
  var CATEGORY_LABEL = {
    ["placement" /* Placement */]: "\u586B\u503C",
    ["elimination" /* Elimination */]: "\u6D88\u6570",
    ["coloring" /* Coloring */]: "\u67D3\u8272",
    ["chain" /* Chain */]: "\u94FE",
    ["brute_force" /* BruteForce */]: "\u56DE\u6EAF"
  };
  var StepRecorder = class {
    _steps = [];
    _board;
    _candidates;
    constructor(board2, candidates) {
      this._board = board2;
      this._candidates = candidates;
    }
    // ================================================================
    // 记录
    // ================================================================
    /**
     * 从 TechniqueResult 创建一条 SolveStep。
     *
     * 调用时机：Engine 已执行 Board.place / CandidateManager.applyDelta 之后。
     * 此方法捕捉操作后的盘面和候选数快照。
     */
    commit(result, boardBefore, candidatesBefore) {
      const step = {
        stepNumber: this._steps.length + 1,
        techniqueId: result.techniqueId,
        techniqueName: result.techniqueName,
        priority: result.priority,
        category: result.category,
        boardBefore,
        boardAfter: this._board.clone(),
        candidatesBefore,
        candidatesAfter: this._candidates.snapshot(),
        delta: result.delta,
        involvedCells: result.involvedCells,
        description: result.description,
        isBacktrack: false,
        backtrackDepth: 0
      };
      this._steps.push(step);
      return step;
    }
    /**
     * 记录回溯猜测步骤。
     */
    commitBacktrack(depth, guess, boardBefore, candidatesBefore, description) {
      const step = {
        stepNumber: this._steps.length + 1,
        techniqueId: "backtrack-guess",
        techniqueName: "\u56DE\u6EAF\u731C\u6D4B",
        priority: 7 /* BruteForce */,
        category: "brute_force" /* BruteForce */,
        boardBefore,
        boardAfter: this._board.clone(),
        candidatesBefore,
        candidatesAfter: this._candidates.snapshot(),
        delta: {
          placement: { coord: guess.coord, digit: guess.digit },
          eliminations: [],
          contradictions: [],
          nakedSingles: []
        },
        involvedCells: [guess.coord],
        description,
        isBacktrack: true,
        backtrackDepth: depth
      };
      this._steps.push(step);
      return step;
    }
    // ================================================================
    // 查询
    // ================================================================
    get steps() {
      return this._steps;
    }
    get stepCount() {
      return this._steps.length;
    }
    lastStep() {
      return this._steps[this._steps.length - 1];
    }
    // ================================================================
    // 纯文本输出（无需外部 Formatter 时的兜底）
    // ================================================================
    /**
     * 生成可阅读的解题轨迹文本。
     */
    toText() {
      if (this._steps.length === 0) return "(\u65E0\u6B65\u9AA4)";
      const lines = [];
      lines.push(`\u89E3\u9898\u8F68\u8FF9 \u2014 \u5171 ${this._steps.length} \u6B65`);
      lines.push("");
      for (const s of this._steps) {
        const prio = PRIORITY_LABEL[s.priority] ?? `L${s.priority}`;
        const cat = CATEGORY_LABEL[s.category] ?? s.category;
        const prefix = s.isBacktrack ? "  [\u56DE\u6EAF] " : "  ";
        lines.push(`\u7B2C ${s.stepNumber} \u6B65${prefix}[${s.techniqueName} \xB7 ${prio} \xB7 ${cat}]`);
        if (s.delta.placement) {
          const p = s.delta.placement;
          lines.push(`    \u586B\u503C: ${formatCoord(p.coord)} \u2190 ${p.digit}`);
        }
        if (s.delta.eliminations.length > 0) {
          const items = s.delta.eliminations.map(
            (e) => `${formatCoord(e.coord)}\xB7${e.digit}`
          );
          for (let i = 0; i < items.length; i += 10) {
            const chunk = items.slice(i, i + 10).join(", ");
            const label = i === 0 ? "    \u6D88\u53BB: " : "          ";
            lines.push(label + chunk);
          }
        }
        if (s.delta.nakedSingles.length > 0) {
          const items = s.delta.nakedSingles.map(
            (n) => `${formatCoord(n.coord)}\u2192${n.digit}`
          );
          lines.push(`    \u51FA\u73B0\u88F8\u5355\u4E00: ${items.join(", ")}`);
        }
        if (s.delta.contradictions.length > 0) {
          const items = s.delta.contradictions.map(
            (c3) => formatCoord(c3)
          );
          lines.push(`    \u26A0 \u77DB\u76FE: ${items.join(", ")}`);
        }
        lines.push(`    \u4F9D\u636E: ${s.description}`);
        lines.push("");
      }
      return lines.join("\n");
    }
  };

  // ../../ClaudeSafe/sudoku/trace-formatter.ts
  var PRIORITY_CN = {
    [0 /* Basic */]: "\u57FA\u672C\u6392\u9664",
    [1 /* Pair */]: "\u5019\u9009\u6570\u5BF9",
    [2 /* Triple */]: "\u4E09\u6570\u7EC4",
    [3 /* Quad */]: "\u56DB\u6570\u7EC4",
    [4 /* BasicFish */]: "\u57FA\u7840\u9C7C",
    [5 /* IntermediateChain */]: "\u4E2D\u7EA7\u94FE",
    [6 /* AdvancedChain */]: "\u9AD8\u7EA7\u94FE",
    [7 /* BruteForce */]: "\u66B4\u529B\u56DE\u6EAF"
  };
  var CATEGORY_CN = {
    ["placement" /* Placement */]: "\u586B\u503C",
    ["elimination" /* Elimination */]: "\u6D88\u6570",
    ["coloring" /* Coloring */]: "\u67D3\u8272",
    ["chain" /* Chain */]: "\u94FE\u63A8\u5BFC",
    ["brute_force" /* BruteForce */]: "\u56DE\u6EAF"
  };
  var CATEGORY_ICON = {
    ["placement" /* Placement */]: "\u2B1B",
    ["elimination" /* Elimination */]: "\u{1FAE5}",
    ["coloring" /* Coloring */]: "\u{1F3A8}",
    ["chain" /* Chain */]: "\u{1F517}",
    ["brute_force" /* BruteForce */]: "\u{1F3B2}"
  };
  function formatStepOneLine(step) {
    const icon = CATEGORY_ICON[step.category] ?? "\xB7";
    let line = `${icon} \u7B2C${step.stepNumber}\u6B65 [${step.techniqueName}]`;
    if (step.isBacktrack) {
      line += ` \u6DF1\u5EA6${step.backtrackDepth}`;
    }
    if (step.delta.placement) {
      const p = step.delta.placement;
      line += ` \u2192 ${formatCoord(p.coord)}=${p.digit}`;
    } else if (step.delta.eliminations.length > 0) {
      line += ` \u2192 \u6D88\u53BB${step.delta.eliminations.length}\u4E2A\u5019\u9009\u6570`;
    }
    return line;
  }
  function formatStepDetail(step) {
    const lines = [];
    const prefix = step.isBacktrack ? "[\u56DE\u6EAF\u731C\u6D4B] " : "";
    lines.push(
      `\u2501\u2501\u2501 \u7B2C ${step.stepNumber} \u6B65 ${prefix}\u2501\u2501\u2501`
    );
    lines.push(`  \u6280\u5DE7: ${step.techniqueName}`);
    lines.push(`  \u5C42\u7EA7: ${PRIORITY_CN[step.priority] ?? step.priority}  \xB7  ${CATEGORY_CN[step.category] ?? step.category}`);
    if (step.delta.placement) {
      const p = step.delta.placement;
      lines.push(`  \u586B\u503C: ${formatCoord(p.coord)} \u2190 ${p.digit}`);
    }
    if (step.delta.eliminations.length > 0) {
      const chunks = [];
      for (let i = 0; i < step.delta.eliminations.length; i += 12) {
        const chunk = step.delta.eliminations.slice(i, i + 12).map((e) => `${formatCoord(e.coord)}\xB7${e.digit}`).join("  ");
        chunks.push(chunk);
      }
      lines.push(`  \u6D88\u53BB (${step.delta.eliminations.length}): ${chunks[0]}`);
      for (let i = 1; i < chunks.length; i++) {
        lines.push(`         ${chunks[i]}`);
      }
    }
    if (step.delta.nakedSingles.length > 0) {
      const items = step.delta.nakedSingles.map((n) => `${formatCoord(n.coord)}\u2192${n.digit}`).join("  ");
      lines.push(`  \u88F8\u5355\u4E00: ${items}`);
    }
    if (step.delta.contradictions.length > 0) {
      const items = step.delta.contradictions.map((c3) => formatCoord(c3)).join(", ");
      lines.push(`  \u26A0 \u77DB\u76FE: ${items}`);
    }
    if (step.involvedCells.length > 0) {
      const items = step.involvedCells.map((c3) => formatCoord(c3)).join(" ");
      lines.push(`  \u6D89\u53CA\u683C: ${items}`);
    }
    lines.push(`  \u4F9D\u636E: ${step.description}`);
    lines.push("");
    return lines.join("\n");
  }
  var TraceFormatter = class {
    _steps;
    constructor(steps2) {
      this._steps = steps2;
    }
    /** 所有步骤的单行摘要 */
    oneLine() {
      if (this._steps.length === 0) return "(\u65E0\u6B65\u9AA4)";
      const header = `\u89E3\u9898\u5171 ${this._steps.length} \u6B65\uFF1A`;
      const body = this._steps.map(formatStepOneLine).join("\n");
      return header + "\n" + body;
    }
    /** 逐步骤详细输出 */
    detailed() {
      if (this._steps.length === 0) return "(\u65E0\u6B65\u9AA4)";
      const header = `\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551  \u6570\u72EC\u6C42\u89E3 \xB7 \u6559\u5B66\u8F68\u8FF9     \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
\u5171 ${this._steps.length} \u6B65
`;
      const body = this._steps.map(formatStepDetail).join("");
      return header + "\n" + body;
    }
    /** 仅关键步骤（填值步骤） */
    placements() {
      const ps = this._steps.filter((s) => s.delta.placement !== null);
      if (ps.length === 0) return "(\u65E0\u586B\u503C\u6B65\u9AA4)";
      const header = `\u586B\u503C\u6B65\u9AA4\u5171 ${ps.length} \u6B65\uFF1A`;
      const body = ps.map(formatStepOneLine).join("\n");
      return header + "\n" + body;
    }
    /** 按优先级统计 */
    summary() {
      if (this._steps.length === 0) return "(\u65E0\u6B65\u9AA4)";
      const byPriority = /* @__PURE__ */ new Map();
      const byCategory = /* @__PURE__ */ new Map();
      for (const s of this._steps) {
        byPriority.set(s.priority, (byPriority.get(s.priority) ?? 0) + 1);
        byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
      }
      const lines = [
        `\u6B65\u9AA4\u7EDF\u8BA1 \u2014 \u5171 ${this._steps.length} \u6B65`,
        "",
        "\u6309\u96BE\u5EA6\u5C42\u7EA7\uFF1A"
      ];
      const sortedPriorities = [...byPriority.entries()].sort((a, b) => a[0] - b[0]);
      for (const [p, count] of sortedPriorities) {
        const label = PRIORITY_CN[p] ?? `L${p}`;
        lines.push(`  ${label}: ${count} \u6B65`);
      }
      lines.push("");
      lines.push("\u6309\u64CD\u4F5C\u7C7B\u578B\uFF1A");
      for (const [cat, count] of byCategory) {
        const label = CATEGORY_CN[cat] ?? cat;
        lines.push(`  ${label}: ${count} \u6B65`);
      }
      const backtrackSteps = this._steps.filter((s) => s.isBacktrack);
      if (backtrackSteps.length > 0) {
        const maxDepth = Math.max(...backtrackSteps.map((s) => s.backtrackDepth));
        lines.push("");
        lines.push(`\u542B\u56DE\u6EAF\u6B65\u9AA4 ${backtrackSteps.length} \u6B65\uFF0C\u6700\u5927\u6DF1\u5EA6 ${maxDepth}`);
      }
      return lines.join("\n");
    }
  };

  // ../../ClaudeSafe/sudoku/console-logger.ts
  var PRIORITY_CN2 = {
    [0 /* Basic */]: "\u57FA\u672C\u6392\u9664",
    [1 /* Pair */]: "\u5019\u9009\u6570\u5BF9",
    [2 /* Triple */]: "\u4E09\u6570\u7EC4",
    [3 /* Quad */]: "\u56DB\u6570\u7EC4",
    [4 /* BasicFish */]: "\u57FA\u7840\u9C7C",
    [5 /* IntermediateChain */]: "\u4E2D\u7EA7\u94FE",
    [6 /* AdvancedChain */]: "\u9AD8\u7EA7\u94FE",
    [7 /* BruteForce */]: "\u66B4\u529B\u56DE\u6EAF"
  };
  var CATEGORY_SYMBOL = {
    ["placement" /* Placement */]: "\u25A3",
    ["elimination" /* Elimination */]: "\u25CB",
    ["coloring" /* Coloring */]: "\u25C7",
    ["chain" /* Chain */]: "\u2192",
    ["brute_force" /* BruteForce */]: "\u26A1"
  };

  // ../../ClaudeSafe/sudoku/solve-engine.ts
  var SudokuEngine = class {
    _mgr;
    _logger = null;
    _aborted = false;
    constructor(mgr) {
      this._mgr = mgr;
    }
    setLogger(logger) {
      this._logger = logger;
    }
    solve(puzzle, _maxDepth = -1) {
      this._aborted = false;
      const board2 = new Board(puzzle);
      const cm2 = new CandidateManager(board2);
      const rec = new StepRecorder(board2, cm2);
      this._logger?.onSolveStart(puzzle);
      this._mgr.setEvents({
        onLevelExhausted: (priority) => {
          this._logger?.onLevelExhausted(priority);
        }
      });
      while (!board2.isSolved() && !this._aborted) {
        const candidatesBefore = cm2.snapshot();
        const boardBefore = board2.clone();
        const result = this._mgr.next(board2, candidatesBefore);
        if (!result) {
          break;
        }
        const appliedDelta = this._apply(board2, cm2, result);
        const mergedResult = {
          ...result,
          delta: appliedDelta
        };
        rec.commit(mergedResult, boardBefore, candidatesBefore);
        this._logger?.onStep(rec.lastStep());
      }
      const steps2 = rec.steps;
      this._logger?.onSolveEnd(steps2, board2.isSolved());
      return steps2;
    }
    abort() {
      this._aborted = true;
    }
    // ================================================================
    // 内部：应用结果
    // ================================================================
    _apply(board2, cm2, result) {
      const deltas = [result.delta];
      if (result.delta.placement) {
        const { coord, digit } = result.delta.placement;
        board2.place(coord, digit);
        const propagationDelta = cm2.setValue(coord, digit);
        deltas.push(propagationDelta);
      } else if (result.delta.eliminations.length > 0) {
        cm2.applyDelta(result.delta);
      }
      return mergeDeltas(deltas);
    }
  };
  function createEngine() {
    const mgr = new TechniqueManager();
    mgr.register(new NakedSingleTechnique());
    mgr.register(new HiddenSingleTechnique());
    mgr.register(new NakedPairTechnique());
    mgr.register(new HiddenPairTechnique());
    mgr.register(new PointingPairTechnique());
    mgr.register(new NakedTripleTechnique());
    mgr.register(new HiddenTripleTechnique());
    mgr.register(new BoxLineTechnique());
    mgr.register(new NakedQuadTechnique());
    mgr.register(new HiddenQuadTechnique());
    mgr.register(new XWingTechnique());
    mgr.register(new SwordfishTechnique());
    mgr.register(new JellyfishTechnique());
    mgr.register(new YWingTechnique());
    mgr.register(new XYZWingTechnique());
    mgr.register(new SimpleColoringTechnique());
    mgr.register(new XYChainTechnique());
    mgr.register(new MedusaTechnique());
    mgr.register(new AICTechnique());
    mgr.register(new EmptyRectangleTechnique());
    mgr.register(new UniqueRectangleTechnique());
    mgr.register(new ForcingChainTechnique());
    return new SudokuEngine(mgr);
  }

  // ../../ClaudeSafe/app.ts
  var SAMPLES = {
    \u793A\u4F8B1: "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
    \u793A\u4F8B2: "000000000000003085001020000000507000004000100090000000500000073002010000000040009",
    \u793A\u4F8B3: "900508007080302905054000080070680032100004008500219060000906001726001040001470056"
  };
  var engine = createEngine();
  var board;
  var cm;
  var steps = [];
  var currentStepIdx = -1;
  var ocrWorker = null;
  var ocrReady = false;
  var opencvReady = false;
  function $(id) {
    return document.getElementById(id);
  }
  function init() {
    buildGrid();
    bindButtons();
    initOpenCV();
    initOCR();
    loadPuzzle(SAMPLES["\u793A\u4F8B1"]);
  }
  async function initOpenCV() {
    window._opencvLoaded = () => {
      if (cv && cv.Mat) {
        opencvReady = true;
        updateEngineStatus();
      }
    };
    if (window.cv && window.cv.Mat) {
      opencvReady = true;
      updateEngineStatus();
    }
    let attempts = 0;
    const poll = setInterval(() => {
      if (opencvReady) {
        clearInterval(poll);
        return;
      }
      if (cv && cv.Mat) {
        opencvReady = true;
        updateEngineStatus();
        clearInterval(poll);
      }
      if (++attempts > 150) clearInterval(poll);
    }, 200);
  }
  async function initOCR() {
    try {
      ocrWorker = await Tesseract.createWorker("eng", 1, {
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js"
      });
      await ocrWorker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: "10"
        // PSM_SINGLE_CHAR
      });
      ocrReady = true;
      updateEngineStatus();
    } catch {
      ocrReady = false;
      updateEngineStatus();
    }
  }
  function updateEngineStatus() {
    const btn = $("btn-ocr");
    if (opencvReady && ocrReady) {
      btn.disabled = false;
      btn.textContent = "\u62CD\u7167\u8BC6\u522B";
      updateStatus("\u5C31\u7EEA \u2014 \u53EF\u624B\u52A8\u8F93\u5165\u3001\u8F7D\u5165\u793A\u4F8B\u6216\u62CD\u7167\u8BC6\u522B");
    } else if (opencvReady && !ocrReady) {
      btn.disabled = false;
      btn.textContent = "\u62CD\u7167\u8BC6\u522B (\u79BB\u7EBF\u6A21\u5F0F)";
      updateStatus("OCR \u79BB\u7EBF \u2014 \u62CD\u7167\u8BC6\u522B\u4E0D\u53EF\u7528\uFF0C\u53EF\u624B\u52A8\u8F93\u5165");
    } else {
      btn.disabled = true;
      btn.textContent = "\u62CD\u7167\u8BC6\u522B (\u5F15\u64CE\u52A0\u8F7D\u4E2D...)";
      updateStatus("OpenCV \u5F15\u64CE\u52A0\u8F7D\u4E2D\uFF0C\u8BC6\u522B\u529F\u80FD\u6682\u4E0D\u53EF\u7528...");
    }
  }
  function buildGrid() {
    const grid = $("grid");
    grid.innerHTML = "";
    for (let r3 = 0; r3 < 9; r3++) {
      for (let c3 = 0; c3 < 9; c3++) {
        const cell = document.createElement("input");
        cell.type = "text";
        cell.maxLength = 1;
        cell.className = "cell";
        cell.dataset.row = String(r3);
        cell.dataset.col = String(c3);
        if (c3 % 3 === 2 && c3 !== 8) cell.classList.add("br");
        if (r3 % 3 === 2 && r3 !== 8) cell.classList.add("bb");
        cell.addEventListener("input", onCellInput);
        cell.addEventListener("keydown", onCellKey);
        grid.appendChild(cell);
      }
    }
  }
  function getCell(r3, c3) {
    return document.querySelector(`.cell[data-row="${r3}"][data-col="${c3}"]`);
  }
  function onCellInput(e) {
    const inp = e.target;
    inp.value = inp.value.replace(/[^1-9]/g, "");
    if (inp.value) {
      const r3 = +inp.dataset.row, c3 = +inp.dataset.col;
      const next = r3 * 9 + c3 + 1;
      if (next < 81) document.querySelector(`.cell:nth-child(${next + 1})`)?.focus();
    }
  }
  function onCellKey(e) {
    const inp = e.target;
    const r3 = +inp.dataset.row, c3 = +inp.dataset.col;
    if (e.key === "ArrowUp" && r3 > 0) getCell(r3 - 1, c3).focus();
    if (e.key === "ArrowDown" && r3 < 8) getCell(r3 + 1, c3).focus();
    if (e.key === "ArrowLeft" && c3 > 0) getCell(r3, c3 - 1).focus();
    if (e.key === "ArrowRight" && c3 < 8) getCell(r3, c3 + 1).focus();
    if (e.key === "Backspace" && !inp.value && c3 > 0) getCell(r3, c3 - 1).focus();
  }
  function readBoard() {
    let s = "";
    for (let r3 = 0; r3 < 9; r3++)
      for (let c3 = 0; c3 < 9; c3++)
        s += getCell(r3, c3).value || "0";
    return s;
  }
  function writeBoard(b) {
    for (let r3 = 0; r3 < 9; r3++) {
      for (let c3 = 0; c3 < 9; c3++) {
        const cell = getCell(r3, c3);
        const v = b.getCell(r3, c3).value;
        cell.value = v === 0 ? "" : String(v);
        cell.classList.remove("given", "solved", "highlight");
        if (v !== 0) cell.classList.add(b.getCell(r3, c3).state === "given" ? "given" : "solved");
      }
    }
  }
  function fillCells(digits) {
    for (let i = 0; i < 81; i++) {
      const r3 = Math.floor(i / 9), c3 = i % 9;
      getCell(r3, c3).value = digits[i] === "0" ? "" : digits[i];
    }
    loadPuzzle(digits);
  }
  function bindButtons() {
    $("btn-solve").addEventListener("click", onSolve);
    $("btn-step").addEventListener("click", onStep);
    $("btn-reset").addEventListener("click", onReset);
    $("btn-clear").addEventListener("click", onClear);
    $("btn-clear-chain").addEventListener("click", clearChain);
    $("btn-load-string").addEventListener("click", onLoadString);
    $("btn-ocr").addEventListener("click", () => $("ocr-file").click());
    $("ocr-file").addEventListener("change", onOCRFile);
    $("ocr-close").addEventListener("click", () => $("ocr-overlay").classList.remove("show"));
    const sel = $("samples");
    for (const [name, puzzle] of Object.entries(SAMPLES)) {
      const opt = document.createElement("option");
      opt.value = puzzle;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => loadPuzzle(sel.value));
  }
  function onLoadString() {
    const raw = $("puzzle-string").value.replace(/\s/g, "");
    if (raw.length !== 81 || !/^[0-9]{81}$/.test(raw)) {
      alert("\u8BF7\u8F93\u5165 81 \u4F4D\u6570\u5B57\uFF08\u7A7A\u683C\u7528 0 \u8868\u793A\uFF09");
      return;
    }
    loadPuzzle(raw);
  }
  function loadPuzzle(puzzle) {
    board = new Board(puzzle);
    cm = new CandidateManager(board);
    steps = [];
    currentStepIdx = -1;
    clearChain();
    writeBoard(board);
    updateStatus("\u9898\u76EE\u5DF2\u52A0\u8F7D \u2014 \u7A7A\u683C: " + board.emptyCount());
    $("trace").innerHTML = "";
    $("puzzle-string").value = puzzle;
  }
  function onSolve() {
    const puzzle = readBoard();
    board = new Board(puzzle);
    cm = new CandidateManager(board);
    engine = createEngine();
    steps = engine.solve(puzzle);
    currentStepIdx = -1;
    if (steps.length > 0) writeBoard(steps[steps.length - 1].boardAfter);
    else writeBoard(board);
    updateStatus(steps.length > 0 ? `\u6C42\u89E3\u5B8C\u6210 \u2014 ${steps.length} \u6B65` : "\u65E0\u6CD5\u6C42\u89E3");
    renderTrace();
  }
  function onStep() {
    if (steps.length === 0) {
      onSolve();
      return;
    }
    currentStepIdx = Math.min(currentStepIdx + 1, steps.length - 1);
    const step = steps[currentStepIdx];
    writeBoard(step.boardAfter);
    drawChain(step);
    updateStatus(`\u7B2C ${step.stepNumber} / ${steps.length} \u6B65 \u2014 ${step.techniqueName} \u2014 ${step.description}`);
    renderCurrentStep(step);
  }
  function onReset() {
    if (steps.length > 0 && currentStepIdx >= 0) {
      currentStepIdx--;
      const b = currentStepIdx < 0 ? board : steps[currentStepIdx].boardAfter;
      writeBoard(b);
      updateStatus(currentStepIdx < 0 ? "\u5DF2\u56DE\u9000\u5230\u8D77\u59CB" : `\u56DE\u9000\u5230\u7B2C ${currentStepIdx + 1} \u6B65`);
    }
  }
  function onClear() {
    for (let r3 = 0; r3 < 9; r3++)
      for (let c3 = 0; c3 < 9; c3++) {
        getCell(r3, c3).value = "";
        getCell(r3, c3).classList.remove("given", "solved", "highlight");
      }
    steps = [];
    currentStepIdx = -1;
    clearChain();
    updateStatus("\u5DF2\u6E05\u7A7A");
    $("trace").innerHTML = "";
  }
  async function onOCRFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const overlay = $("ocr-overlay");
    const stepsEl = $("ocr-steps");
    const preview = $("ocr-preview");
    overlay.classList.add("show");
    preview.style.display = "none";
    const setStep = (step, text, done) => {
      const prefix = done ? "\u2713 " : "\u25CC ";
      const cls = done ? "step-done" : "step-active";
      const lines = stepsEl.innerHTML.split("<br>").filter((l) => l);
      lines[step - 1] = `<span class="${cls}">${prefix}${text}</span>`;
      stepsEl.innerHTML = lines.join("<br>");
    };
    stepsEl.innerHTML = [
      "1. \u52A0\u8F7D\u56FE\u7247",
      "2. \u7070\u5EA6\u5316 & \u4E8C\u503C\u5316",
      "3. \u5B9A\u4F4D\u4E5D\u5BAB\u683C\u5916\u6846",
      "4. \u900F\u89C6\u77EB\u6B63 & \u88C1\u526A",
      "5. \u5206\u5272 81 \u683C",
      "6. OCR \u9010\u683C\u8BC6\u522B"
    ].map((t) => `<span>${t}</span>`).join("<br>");
    try {
      const img = await loadImage(file);
      setStep(1, "\u52A0\u8F7D\u56FE\u7247", true);
      const gray = opencvGray(img);
      const binary = opencvAdaptiveThreshold(gray);
      setStep(2, "\u7070\u5EA6\u5316 & \u4E8C\u503C\u5316", true);
      const corners = findGridCorners(binary);
      if (!corners) throw new Error("\u672A\u68C0\u6D4B\u5230\u4E5D\u5BAB\u683C\u8F6E\u5ED3");
      setStep(3, "\u5B9A\u4F4D\u4E5D\u5BAB\u683C\u5916\u6846", true);
      const warped = opencvWarp(gray, corners, 450);
      preview.src = matToDataURL(warped);
      preview.style.display = "block";
      setStep(4, "\u900F\u89C6\u77EB\u6B63 & \u88C1\u526A", true);
      const cells = extractCells81(warped);
      warped.delete();
      setStep(5, "\u5206\u5272 81 \u683C", true);
      let puzzle = "";
      for (let i = 0; i < 81; i++) {
        const digit = await ocrCell(cells[i], i);
        puzzle += digit;
        if (i % 9 === 8) setStep(6, `OCR \u9010\u683C\u8BC6\u522B ${i + 1} / 81`, i < 80);
      }
      setStep(6, `OCR \u8BC6\u522B\u5B8C\u6210 \u2014 \u68C0\u6D4B\u5230 ${puzzle.split("").filter((c3) => c3 !== "0").length} \u4E2A\u6570\u5B57`, true);
      gray.delete();
      binary.delete();
      for (const c3 of cells) c3.delete();
      fillCells(puzzle);
      updateStatus(`\u8BC6\u522B\u5B8C\u6210\uFF01${puzzle.split("").filter((c3) => c3 !== "0").length} \u683C\u6709\u6570\u5B57\uFF0C\u53EF\u624B\u52A8\u4FEE\u6B63`);
      setTimeout(() => overlay.classList.remove("show"), 1500);
    } catch (err) {
      setStep(6, `\u5931\u8D25: ${err.message || "\u672A\u77E5\u9519\u8BEF"}`, true);
      updateStatus("\u8BC6\u522B\u5931\u8D25\uFF0C\u8BF7\u786E\u4FDD\u56FE\u7247\u5305\u542B\u5B8C\u6574\u6E05\u6670\u7684\u6570\u72EC\u7F51\u683C");
    }
  }
  function opencvGray(img) {
    const src = cv.imread(img);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    src.delete();
    return gray;
  }
  function opencvAdaptiveThreshold(gray) {
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    const binary = new cv.Mat();
    cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 3);
    blurred.delete();
    const kernel = cv.Mat.ones(2, 2, cv.CV_8U);
    const closed = new cv.Mat();
    cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);
    kernel.delete();
    binary.delete();
    return closed;
  }
  function findGridCorners(binary) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    hierarchy.delete();
    let bestArea = 0;
    let bestCorners = null;
    const imgArea = binary.rows * binary.cols;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < imgArea * 0.1) continue;
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      if (approx.rows === 4 && area > bestArea) {
        bestArea = area;
        const pts = [];
        for (let j = 0; j < 4; j++) {
          pts.push([approx.data32S[j * 2], approx.data32S[j * 2 + 1]]);
        }
        pts.sort((a, b) => a[0] - b[0]);
        const left = pts.slice(0, 2).sort((a, b) => a[1] - b[1]);
        const right = pts.slice(2, 4).sort((a, b) => a[1] - b[1]);
        bestCorners = { tl: left[0], tr: right[0], br: right[1], bl: left[1] };
      }
      approx.delete();
    }
    contours.delete();
    return bestCorners;
  }
  function opencvWarp(gray, corners, size) {
    const { tl, tr, br, bl } = corners;
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl[0],
      tl[1],
      tr[0],
      tr[1],
      br[0],
      br[1],
      bl[0],
      bl[1]
    ]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,
      size - 1,
      0,
      size - 1,
      size - 1,
      0,
      size - 1
    ]);
    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const warped = new cv.Mat();
    cv.warpPerspective(gray, warped, M, new cv.Size(size, size));
    const inverted = new cv.Mat();
    cv.bitwise_not(warped, inverted);
    srcPts.delete();
    dstPts.delete();
    M.delete();
    warped.delete();
    return inverted;
  }
  function extractCells81(warped) {
    const cells = [];
    const cellSz = 50;
    const inset = 5;
    for (let r3 = 0; r3 < 9; r3++) {
      for (let c3 = 0; c3 < 9; c3++) {
        const x = c3 * cellSz + inset;
        const y = r3 * cellSz + inset;
        const w = cellSz - inset * 2;
        const rect = new cv.Rect(x, y, w, w);
        const roi = warped.roi(rect);
        const resized = new cv.Mat();
        cv.resize(roi, resized, new cv.Size(40, 40));
        roi.delete();
        cells.push(resized);
      }
    }
    return cells;
  }
  function matToDataURL(mat) {
    const canvas = document.createElement("canvas");
    canvas.width = mat.cols;
    canvas.height = mat.rows;
    cv.imshow(canvas, mat);
    return canvas.toDataURL("image/png");
  }
  async function ocrCell(cellMat, _idx) {
    const data = new Uint8Array(cellMat.data);
    let darkCount = 0;
    for (let i = 0; i < data.length; i += cellMat.channels()) {
      if (data[i] < 128) darkCount++;
    }
    const totalPixels = cellMat.rows * cellMat.cols;
    if (darkCount / totalPixels < 0.04) return "0";
    if (!ocrReady || !ocrWorker) return "0";
    const canvas = document.createElement("canvas");
    canvas.width = cellMat.cols;
    canvas.height = cellMat.rows;
    cv.imshow(canvas, cellMat);
    try {
      const { data: result } = await ocrWorker.recognize(canvas);
      const text = (result.text || "").replace(/\s/g, "");
      const match = text.match(/[0-9]/);
      return match ? match[0] : "0";
    } catch {
      return "0";
    }
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  function clearChain() {
    const canvas = $("chain-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r3 = 0; r3 < 9; r3++)
      for (let c3 = 0; c3 < 9; c3++)
        getCell(r3, c3).classList.remove("chain-start", "chain-path", "chain-target");
  }
  function drawChain(step) {
    clearChain();
    const cells = step.involvedCells;
    if (!cells || cells.length < 2) return;
    const canvas = $("chain-canvas");
    const ctx = canvas.getContext("2d");
    const cx = (c3) => c3[1] * 41 + 22;
    const cy = (c3) => c3[0] * 41 + 22;
    const isChainTech = ["y-wing", "xyz-wing", "simple-coloring", "xy-chain", "medusa", "aic", "forcing-chain"].includes(step.techniqueId);
    const start = cells[0];
    const targetIdx = step.delta.eliminations.length > 0 ? cells.findIndex((c3) => step.delta.eliminations.some((e) => e.coord[0] === c3[0] && e.coord[1] === c3[1])) : -1;
    const isTarget = (c3) => step.delta.eliminations.some((e) => e.coord[0] === c3[0] && e.coord[1] === c3[1]);
    for (let i = 0; i < cells.length; i++) {
      const el = getCell(cells[i][0], cells[i][1]);
      if (isTarget(cells[i])) el.classList.add("chain-target");
      else if (i === 0 && isChainTech) el.classList.add("chain-start");
      else if (isChainTech) el.classList.add("chain-path");
    }
    if (!isChainTech) return;
    ctx.lineWidth = 2.5;
    for (let i = 1; i < cells.length; i++) {
      const from = cells[i - 1];
      const to = cells[i];
      const isPeer = from[0] === to[0] || from[1] === to[1] || Math.floor(from[0] / 3) === Math.floor(to[0] / 3) && Math.floor(from[1] / 3) === Math.floor(to[1] / 3);
      const isElim = isTarget(to);
      ctx.beginPath();
      ctx.moveTo(cx(from), cy(from));
      ctx.lineTo(cx(to), cy(to));
      ctx.strokeStyle = isElim ? "#c62828" : isPeer ? "#2e7d32" : "#1565c0";
      if (isElim) ctx.setLineDash([5, 3]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawArrow(ctx, cx(from), cy(from), cx(to), cy(to), isElim ? "#c62828" : isPeer ? "#2e7d32" : "#1565c0");
    }
  }
  function drawArrow(ctx, x1, y1, x2, y2, color) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const len = 14;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const sz = 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(midX - sz * Math.cos(angle - 0.6), midY - sz * Math.sin(angle - 0.6));
    ctx.lineTo(midX - sz * Math.cos(angle + 0.6), midY - sz * Math.sin(angle + 0.6));
    ctx.closePath();
    ctx.fill();
  }
  function updateStatus(msg) {
    $("status").textContent = msg;
  }
  function renderTrace() {
    const fmt = new TraceFormatter(steps);
    $("trace").innerHTML = escapeHtml(fmt.detailed() + "\n" + fmt.summary()).replace(/\n/g, "<br>").replace(/  /g, "&nbsp;&nbsp;");
  }
  function renderCurrentStep(step) {
    const fmt = new TraceFormatter([step]);
    $("trace").innerHTML = escapeHtml(fmt.detailed()).replace(/\n/g, "<br>").replace(/  /g, "&nbsp;&nbsp;");
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  document.addEventListener("DOMContentLoaded", init);
})();

import { Cell } from "./cell";
import type { CellCoord, RowIndex, ColIndex, BoxIndex, Digit } from "./types";
import { CellState, boxIndex, boxCells as boxCellList } from "./types";

// ---- 预计算：每个格的 20 个同辈格坐标 ----
function buildPeerTable(): readonly (readonly CellCoord[])[] {
  const table: CellCoord[][] = Array.from({ length: 81 }, () => []);

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const set = new Set<string>();
      const key = (rr: number, cc: number) => `${rr},${cc}`;

      // 同行
      for (let cc = 0; cc < 9; cc++) {
        if (cc !== c) set.add(key(r, cc));
      }
      // 同列
      for (let rr = 0; rr < 9; rr++) {
        if (rr !== r) set.add(key(rr, c));
      }
      // 同宫
      const sr = Math.floor(r / 3) * 3;
      const sc = Math.floor(c / 3) * 3;
      for (let rr = sr; rr < sr + 3; rr++) {
        for (let cc = sc; cc < sc + 3; cc++) {
          if (rr !== r || cc !== c) set.add(key(rr, cc));
        }
      }

      const idx = r * 9 + c;
      for (const k of set) {
        const parts = k.split(",").map(Number) as [number, number];
        table[idx]!.push([parts[0] as RowIndex, parts[1] as ColIndex]);
      }
    }
  }

  return table;
}

const PEER_TABLE = buildPeerTable();

// ---- 预计算：每行/列/宫包含的所有坐标 ----
function buildUnitTable(
  getCells: (idx: number) => CellCoord[],
): readonly (readonly CellCoord[])[] {
  return Array.from({ length: 9 }, (_, i) => getCells(i));
}

const ROW_CELLS = buildUnitTable((row) =>
  Array.from({ length: 9 }, (_, c) => [row as RowIndex, c as ColIndex]),
);

const COL_CELLS = buildUnitTable((col) =>
  Array.from({ length: 9 }, (_, r) => [r as RowIndex, col as ColIndex]),
);

const BOX_CELLS = buildUnitTable((box) => boxCellList(box as BoxIndex));

// ---- 索引解包辅助 ----
function r(coord: CellCoord): number {
  return coord[0];
}
function c(coord: CellCoord): number {
  return coord[1];
}

// ============================================================
// BoardReadonly — 只读盘面视图（供技巧模块使用）
// ============================================================

export interface BoardReadonly {
  readonly cells: readonly (readonly Cell[])[];
  getCell(coord: CellCoord): Cell;
  getCell(row: RowIndex, col: ColIndex): Cell;
  getRow(row: RowIndex): readonly Cell[];
  getCol(col: ColIndex): readonly Cell[];
  getBox(box: BoxIndex): readonly Cell[];
  getDigitPositions(
    digit: Digit,
    unit: "row" | "col" | "box",
    index: number,
  ): readonly CellCoord[];
  getPeers(coord: CellCoord): readonly CellCoord[];
  getSeenByValue(coord: CellCoord): readonly CellCoord[];
  isSolved(): boolean;
  isValid(): boolean;
  emptyCount(): number;
  toPuzzleString(): string;
}

// ============================================================
// Board
// ============================================================

export class Board implements BoardReadonly {
  private _cells: Cell[][];

  constructor(puzzle?: string) {
    this._cells = Array.from({ length: 9 }, (_, row) =>
      Array.from({ length: 9 }, (_, col) => new Cell([row as RowIndex, col as ColIndex])),
    );
    if (puzzle) this.loadPuzzle(puzzle);
  }

  // ---- 初始化 ----

  private loadPuzzle(puzzle: string): void {
    const chars = puzzle.replace(/\s/g, "").split("");
    for (let i = 0; i < Math.min(chars.length, 81); i++) {
      const ch = chars[i]!;
      const d = parseInt(ch, 10);
      if (d >= 1 && d <= 9) {
        const row = Math.floor(i / 9) as RowIndex;
        const col = (i % 9) as ColIndex;
        this.place([row, col], d as Digit, CellState.Given);
      }
    }
  }

  // ---- 单元格访问 ----

  getCell(coord: CellCoord): Cell;
  getCell(row: RowIndex, col: ColIndex): Cell;
  getCell(rowOrCoord: RowIndex | CellCoord, col?: ColIndex): Cell {
    if (Array.isArray(rowOrCoord)) {
      const row = rowOrCoord[0] as number;
      const cIdx = rowOrCoord[1] as number;
      return this._cells[row]![cIdx]!;
    }
    return this._cells[rowOrCoord as number]![col as number]!;
  }

  get cells(): readonly (readonly Cell[])[] {
    return this._cells;
  }

  // ---- 单元查询 ----

  getRow(row: RowIndex): readonly Cell[] {
    return ROW_CELLS[row]!.map(([rr, cc]) => this._cells[rr as number]![cc as number]!);
  }

  getCol(col: ColIndex): readonly Cell[] {
    return COL_CELLS[col]!.map(([rr, cc]) => this._cells[rr as number]![cc as number]!);
  }

  getBox(box: BoxIndex): readonly Cell[] {
    return BOX_CELLS[box]!.map(([rr, cc]) => this._cells[rr as number]![cc as number]!);
  }

  getDigitPositions(
    digit: Digit,
    unit: "row" | "col" | "box",
    index: number,
  ): readonly CellCoord[] {
    let cells: readonly Cell[] = [];
    switch (unit) {
      case "row":
        cells = this.getRow(index as RowIndex);
        break;
      case "col":
        cells = this.getCol(index as ColIndex);
        break;
      case "box":
        cells = this.getBox(index as BoxIndex);
        break;
    }
    return cells.filter((cel) => cel.value === digit).map((cel) => cel.coord);
  }

  // ---- 同辈格 ----

  getPeers(coord: CellCoord): readonly CellCoord[] {
    return PEER_TABLE[r(coord) * 9 + c(coord)]!;
  }

  getSeenByValue(coord: CellCoord): readonly CellCoord[] {
    const peers = this.getPeers(coord);
    const result: CellCoord[] = [];
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

  isSolved(): boolean {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if ((this._cells[row]![col]! as Cell).value === 0) return false;
      }
    }
    return this.isValid();
  }

  isValid(): boolean {
    for (let i = 0; i < 9; i++) {
      if (!this._unitValid(this.getRow(i as RowIndex))) return false;
      if (!this._unitValid(this.getCol(i as ColIndex))) return false;
      if (!this._unitValid(this.getBox(i as BoxIndex))) return false;
    }
    return true;
  }

  private _unitValid(cells: readonly Cell[]): boolean {
    const seen = new Set<number>();
    for (const cel of cells) {
      if (cel.value === 0) continue;
      if (seen.has(cel.value)) return false;
      seen.add(cel.value);
    }
    return true;
  }

  emptyCount(): number {
    let n = 0;
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if ((this._cells[row]![col]! as Cell).value === 0) n++;
      }
    }
    return n;
  }

  // ---- 修改 ----

  place(coord: CellCoord, digit: Digit, state: CellState = CellState.Solved): void {
    const cell = this._cells[r(coord)]![c(coord)]!;
    cell.setValue(digit, state);
  }

  placeBatch(placements: readonly { coord: CellCoord; digit: Digit }[]): void {
    for (const p of placements) {
      this.place(p.coord, p.digit, CellState.Solved);
    }
  }

  clear(coord: CellCoord): void {
    this._cells[r(coord)]![c(coord)]!.clearValue();
  }

  // ---- 工具 ----

  toPuzzleString(): string {
    let s = "";
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const v = (this._cells[row]![col]! as Cell).value;
        s += v === 0 ? "0" : String(v);
      }
    }
    return s;
  }

  clone(): Board {
    const b = new Board();
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const src = this._cells[row]![col]!;
        const dst = b._cells[row]![col]!;
        dst.setValue(src.value, src.state);
        dst.setCandidates(src.candidates);
      }
    }
    return b;
  }

  // ---- 静态工具 ----

  static boxIndex(row: number, col: number): BoxIndex {
    return boxIndex(row, col);
  }

  static boxCells(box: BoxIndex): CellCoord[] {
    return [...BOX_CELLS[box]!] as CellCoord[];
  }

  static rowCells(row: RowIndex): CellCoord[] {
    return [...ROW_CELLS[row]!] as CellCoord[];
  }

  static colCells(col: ColIndex): CellCoord[] {
    return [...COL_CELLS[col]!] as CellCoord[];
  }

  static allCoords(): CellCoord[] {
    const coords: CellCoord[] = [];
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        coords.push([row as RowIndex, col as ColIndex]);
      }
    }
    return coords;
  }
}

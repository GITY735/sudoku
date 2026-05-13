import type { CellCoord, RowIndex, ColIndex, BoxIndex, CandidateMask, Digit } from "./types";
import { CellState, boxIndex } from "./types";

/**
 * 单格不可变数据。
 *
 * 候选数掩码由此格的外部 CandidateManager 维护，
 * Cell 本身只存储值/状态，不参与传播逻辑。
 */
export class Cell {
  readonly coord: CellCoord;
  readonly row: RowIndex;
  readonly col: ColIndex;
  readonly box: BoxIndex;

  private _value: number; // 0 = 空
  private _state: CellState;
  private _candidates: CandidateMask; // 由 CandidateManager 写入

  constructor(coord: CellCoord, value: number = 0, state?: CellState) {
    this.coord = coord;
    this.row = coord[0] as RowIndex;
    this.col = coord[1] as ColIndex;
    this.box = boxIndex(this.row, this.col);
    this._value = value;
    this._state = state ?? (value === 0 ? CellState.Empty : CellState.Given);
    this._candidates = 0;
  }

  // ---- 只读 ----

  get value(): number {
    return this._value;
  }

  get state(): CellState {
    return this._state;
  }

  get candidates(): CandidateMask {
    return this._candidates;
  }

  get candidateCount(): number {
    let n = this._candidates;
    n = n - ((n >>> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    n = (n + (n >>> 4)) & 0x0F0F0F0F;
    n = n + (n >>> 8);
    n = n + (n >>> 16);
    return n & 0x3F;
  }

  isEmpty(): boolean {
    return this._state === CellState.Empty;
  }

  isGiven(): boolean {
    return this._state === CellState.Given;
  }

  // ---- 写入（仅供 Board / CandidateManager 调用） ----

  setValue(value: number, state: CellState): void {
    this._value = value;
    this._state = state;
    // 当值被确定时，候选数收缩为仅该数字
    this._candidates = value === 0 ? 0 : 1 << value;
  }

  clearValue(): void {
    this._value = 0;
    this._state = CellState.Empty;
  }

  setCandidates(mask: CandidateMask): void {
    this._candidates = mask;
  }

  // ---- 工具 ----

  clone(): Cell {
    const c = new Cell(this.coord, this._value, this._state);
    c._candidates = this._candidates;
    return c;
  }

  /** 判断此格是否与另一格相同位置 */
  is(coord: CellCoord): boolean {
    return this.row === coord[0] && this.col === coord[1];
  }
}

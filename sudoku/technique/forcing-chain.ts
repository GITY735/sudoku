import type { CellCoord, Digit, RowIndex, ColIndex, CandidateMask } from "../types";
import { TechniquePriority, TechniqueCategory, SolveStepOutcome, CandidateMask as CM, formatCoord } from "../types";
import type { BoardReadonly } from "../board";
import { Board } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { Technique, TechniqueResult } from "./types";

// ============================================================
// ForcingChainFinding
// ============================================================

interface ForcingChainFinding {
  /** 起始格 */
  startCell: CellCoord;
  /** 起始格的完整候选数列表 */
  startCandidates: readonly Digit[];
  /** 导致矛盾的假设数字 */
  assumedDigit: Digit;
  /** 矛盾发生的格子 */
  contradictionCell: CellCoord;
  /** 矛盾描述 */
  contradictionDesc: string;
  /** 推理链步骤（教学用） */
  chainSteps: string[];
}

// ============================================================
// ForcingChainTechnique
// ============================================================

/**
 * 强制链 (Forcing Chain)。
 *
 * 规则：对双值格 {a,b}，假设其为 a，推导至矛盾，
 * 则可从该格排除 a，该格必为 b。
 *
 * 这是泛用性最强的候选数推理技巧，
 * 仅在前面所有技巧都无法推进时才触发。
 *
 * 优先级：AdvancedChain (6)，归类：Chain。
 */
export class ForcingChainTechnique implements Technique {
  readonly id = "forcing-chain";
  readonly name = "强制链";
  readonly nameEn = "Forcing Chain";
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
    // 优先返回推导步数最少的（教学更清晰）
    findings.sort((a, b) => a.chainSteps.length - b.chainSteps.length);
    return this.buildResult(findings[0]!);
  }

  // ================================================================
  // 检测
  // ================================================================

  detect(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): ForcingChainFinding[] {
    const results: ForcingChainFinding[] = [];

    // 优先策略：对双值格逐位试错（最易产生矛盾）
    const bivalCells: { coord: CellCoord; digits: readonly [Digit, Digit] }[] = [];
    const multiCells: { coord: CellCoord; digits: readonly Digit[] }[] = [];

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const coord: CellCoord = [r as RowIndex, c as ColIndex];
        const cnt = candidates.count(coord);
        if (cnt === 2) {
          bivalCells.push({ coord, digits: candidates.getDigits(coord) as [Digit, Digit] });
        } else if (cnt >= 3 && cnt <= 4) {
          multiCells.push({ coord, digits: candidates.getDigits(coord) });
        }
      }
    }

    // 第一阶段：双值格 → 逐位试错
    for (const cell of bivalCells) {
      for (const assumeDigit of cell.digits) {
        const result = this._testAssumption(board, candidates, cell.coord, assumeDigit as Digit);
        if (result) { results.push(result); break; }
      }
      if (results.length > 0) break;
    }
    if (results.length > 0) return results;

    // 第二阶段：多值格 → 逐位试错
    multiCells.sort((a, b) => a.digits.length - b.digits.length);
    for (const cell of multiCells) {
      for (const assumeDigit of cell.digits) {
        const result = this._testAssumption(board, candidates, cell.coord, assumeDigit as Digit);
        if (result) { results.push(result); break; }
      }
      if (results.length > 0) break;
    }
    if (results.length > 0) return results;

    // 第三阶段：对共轭对（某单元内数字仅出现 2 次）试错
    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      for (let i = 0; i < 9; i++) {
        for (const unitType of ["row", "col", "box"] as const) {
          const pos = candidates.getDigitPositionsInUnit(digit, unitType, i);
          if (pos.length !== 2) continue;
          for (const coord of pos) {
            const result = this._testAssumption(board, candidates, coord, digit);
            if (result) { results.push(result); return results; }
          }
        }
      }
    }

    return results;
  }

  // ================================================================
  // 教学说明
  // ================================================================

  explanation(finding: ForcingChainFinding): string {
    const { startCell, startCandidates, assumedDigit, contradictionCell, chainSteps } =
      finding;
    const startLabel = formatCoord(startCell);
    const contraLabel = formatCoord(contradictionCell);

    const remaining = startCandidates.filter((d) => d !== assumedDigit);
    const conclusion =
      remaining.length === 1
        ? `必为 ${remaining[0]}`
        : `可排除 ${assumedDigit}`;

    return (
      `假设 ${startLabel} = ${assumedDigit}，推导链：` +
      chainSteps.join(" → ") +
      ` → ${contraLabel} 矛盾，` +
      `因此 ${startLabel} ≠ ${assumedDigit}，${conclusion}`
    );
  }

  // ================================================================
  // 内部：假设推理
  // ================================================================

  private _testAssumption(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
    startCell: CellCoord,
    assumeDigit: Digit,
  ): ForcingChainFinding | null {
    // 克隆盘面与候选数
    const testBoard = (board as Board).clone();
    const testGrid = candidates.toMutableGrid();

    // 填入假设值
    testBoard.place(startCell, assumeDigit);
    this._placeAndPropagate(testGrid, startCell, assumeDigit);

    const chainSteps: string[] = [];
    chainSteps.push(`置 ${formatCoord(startCell)}=${assumeDigit}`);

    // 循环推导（裸单一 + 隐单一），上限 50 步
    for (let iter = 0; iter < 50; iter++) {
      // 检查矛盾
      const contra = this._findContradiction(testBoard, testGrid);
      if (contra) {
        return {
          startCell,
          startCandidates: candidates.getDigits(startCell),
          assumedDigit: assumeDigit,
          contradictionCell: contra.coord,
          contradictionDesc: `${formatCoord(contra.coord)} ${contra.reason}`,
          chainSteps,
        };
      }

      // 尝试裸单一
      const naked = this._findNakedSingle(testBoard, testGrid);
      if (naked) {
        testBoard.place(naked.coord, naked.digit);
        this._placeAndPropagate(testGrid, naked.coord, naked.digit);
        chainSteps.push(
          `唯余 ${formatCoord(naked.coord)}=${naked.digit}`,
        );
        continue;
      }

      // 尝试隐单一
      const hidden = this._findHiddenSingle(testBoard, testGrid);
      if (hidden) {
        testBoard.place(hidden.coord, hidden.digit);
        this._placeAndPropagate(testGrid, hidden.coord, hidden.digit);
        chainSteps.push(
          `摒除 ${formatCoord(hidden.coord)}=${hidden.digit}`,
        );
        continue;
      }

      // 无法继续推导
      break;
    }

    return null; // 没有矛盾
  }

  // ================================================================
  // 候选数操作（轻量，不依赖 CandidateManager）
  // ================================================================

  /** 填入数字并从同辈格消去 */
  private _placeAndPropagate(
    grid: CandidateMask[][],
    coord: CellCoord,
    digit: Digit,
  ): void {
    grid[coord[0]]![coord[1]] = 0;

    // 从同行/列/宫消去
    for (let i = 0; i < 9; i++) {
      // 同行
      if (i !== coord[1]) {
        grid[coord[0]]![i] = CM.remove(grid[coord[0]]![i]!, digit);
      }
      // 同列
      if (i !== coord[0]) {
        grid[i]![coord[1]] = CM.remove(grid[i]![coord[1]]!, digit);
      }
      // 同宫
      const br = Math.floor(coord[0] / 3) * 3 + Math.floor(i / 3);
      const bc = Math.floor(coord[1] / 3) * 3 + (i % 3);
      if (br === coord[0] && bc === coord[1]) continue;
      grid[br]![bc] = CM.remove(grid[br]![bc]!, digit);
    }
  }

  /** 找第一个裸单一（候选数=1的空格） */
  private _findNakedSingle(
    board: BoardReadonly,
    grid: CandidateMask[][],
  ): { coord: CellCoord; digit: Digit } | null {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board.getCell(r as RowIndex, c as ColIndex).value !== 0) continue;
        const mask = grid[r]![c]!;
        if (CM.isSingle(mask)) {
          return {
            coord: [r as RowIndex, c as ColIndex],
            digit: CM.soleDigit(mask),
          };
        }
      }
    }
    return null;
  }

  /** 找第一个隐单一（某行/列/宫中某数字仅出现1次） */
  private _findHiddenSingle(
    board: BoardReadonly,
    grid: CandidateMask[][],
  ): { coord: CellCoord; digit: Digit } | null {
    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      // 检查每行
      for (let r = 0; r < 9; r++) {
        const pos: CellCoord[] = [];
        for (let c = 0; c < 9; c++) {
          if (board.getCell(r as RowIndex, c as ColIndex).value !== 0) continue;
          if (CM.has(grid[r]![c]!, digit)) {
            pos.push([r as RowIndex, c as ColIndex]);
          }
        }
        if (pos.length === 1) return { coord: pos[0]!, digit };
      }

      // 检查每列
      for (let c = 0; c < 9; c++) {
        const pos: CellCoord[] = [];
        for (let r = 0; r < 9; r++) {
          if (board.getCell(r as RowIndex, c as ColIndex).value !== 0) continue;
          if (CM.has(grid[r]![c]!, digit)) {
            pos.push([r as RowIndex, c as ColIndex]);
          }
        }
        if (pos.length === 1) return { coord: pos[0]!, digit };
      }

      // 检查每宫
      for (let b = 0; b < 9; b++) {
        const pos: CellCoord[] = [];
        const sr = Math.floor(b / 3) * 3;
        const sc = (b % 3) * 3;
        for (let dr = 0; dr < 3; dr++) {
          for (let dc = 0; dc < 3; dc++) {
            const r = sr + dr, c = sc + dc;
            if (board.getCell(r as RowIndex, c as ColIndex).value !== 0) continue;
            if (CM.has(grid[r]![c]!, digit)) {
              pos.push([r as RowIndex, c as ColIndex]);
            }
          }
        }
        if (pos.length === 1) return { coord: pos[0]!, digit };
      }
    }
    return null;
  }

  /** 检查是否存在矛盾（空格无候选数） */
  private _findContradiction(
    board: BoardReadonly,
    grid: CandidateMask[][],
  ): { coord: CellCoord; reason: string } | null {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board.getCell(r as RowIndex, c as ColIndex).value !== 0) continue;
        if (grid[r]![c] === 0) {
          return {
            coord: [r as RowIndex, c as ColIndex],
            reason: "候选数为零（矛盾）",
          };
        }
      }
    }

    // 额外：检查某单元内某数字无处可放
    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]) {
      for (let r = 0; r < 9; r++) {
        let has = false;
        for (let c = 0; c < 9; c++) {
          if (board.getCell(r as RowIndex, c as ColIndex).value === digit) { has = true; break; }
          if (board.getCell(r as RowIndex, c as ColIndex).value === 0 && CM.has(grid[r]![c]!, digit)) { has = true; break; }
        }
        if (!has) return { coord: [r as RowIndex, 0 as ColIndex], reason: `第${r + 1}行无处放${digit}` };
      }
    }

    return null;
  }

  // ================================================================
  // 构建结果
  // ================================================================

  private buildResult(finding: ForcingChainFinding): TechniqueResult {
    const { startCell, startCandidates, assumedDigit } = finding;
    const remaining = startCandidates.filter((d) => d !== assumedDigit);
    const description = this.explanation(finding);

    // 排除假设数后只剩一个候选数 → 可填值
    const placement =
      remaining.length === 1
        ? { coord: startCell, digit: remaining[0]! as Digit }
        : null;

    return {
      techniqueId: this.id,
      techniqueName: this.name,
      priority: this.priority,
      category: this.category,
      outcome: SolveStepOutcome.Progressed,
      delta: {
        placement,
        eliminations: [{ coord: startCell, digit: assumedDigit }],
        contradictions: [],
        nakedSingles: [],
      },
      involvedCells: [startCell, finding.contradictionCell],
      description,
    };
  }
}

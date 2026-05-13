import { Board } from "./board";
import { TraceFormatter } from "./trace-formatter";
import type { SolveStep } from "./trace";
import type { RowIndex, ColIndex } from "./types";

// ============================================================
// parseBoard — 多种输入格式 → Board
// ============================================================

/**
 * 从文本解析盘面。支持三种格式：
 *
 * 1. 紧凑单行 81 字符："530070000600195000..."
 * 2. 9 行网格（每行 9 字符，可用空格/竖线分隔）：
 *       5 3 0 | 0 7 0 | 0 0 0
 *       6 0 0 | 1 9 5 | 0 0 0
 *       ...
 * 3. 带点号/问号的格式（自动替换为 0）：
 *       53..7....
 *       6..195...
 */
export function parseBoard(text: string): Board {
  // 清洗：移除空格、竖线、横线、加号、换行
  let cleaned = text
    .replace(/[\s|+\-]+/g, "")
    .replace(/[.?xX]/g, "0");

  // 若清洗后仍非 81 字符，尝试按行解析
  if (cleaned.length !== 81) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("-") && !l.startsWith("+"));

    // 取前 9 行作为盘面行
    const gridLines = lines.slice(0, 9);
    cleaned = gridLines
      .map((l) => l.replace(/[\s|]/g, "").replace(/[.?xX]/g, "0"))
      .join("")
      .padEnd(81, "0")
      .slice(0, 81);
  }

  // 确保恰好 81 字符
  if (cleaned.length !== 81) {
    cleaned = cleaned.padEnd(81, "0").slice(0, 81);
  }

  // 校验：只能包含 0-9
  if (!/^[0-9]{81}$/.test(cleaned)) {
    throw new Error(
      `parseBoard: 无法解析输入，清洗后仍含非数字字符 (${cleaned.length} 字符)`,
    );
  }

  return new Board(cleaned);
}

// ============================================================
// stringifyBoard — Board → 81 字符字符串
// ============================================================

export function stringifyBoard(board: Board): string {
  return board.toPuzzleString();
}

// ============================================================
// printBoard — 美化打印盘面到控制台
// ============================================================

export function printBoard(board: Board): void {
  const lines: string[] = [];
  lines.push("┌───────┬───────┬───────┐");

  for (let r = 0; r < 9; r++) {
    const rowCells: string[] = [];
    for (let c = 0; c < 9; c++) {
      if (c % 3 === 0) rowCells.push("│ ");
      const v = board.getCell(r as RowIndex, c as ColIndex).value;
      rowCells.push(v === 0 ? "·" : String(v));
      rowCells.push(" ");
    }
    rowCells.push("│");
    lines.push(rowCells.join(""));

    if (r === 2 || r === 5) {
      lines.push("├───────┼───────┼───────┤");
    }
  }

  lines.push("└───────┴───────┴───────┘");
  console.log(lines.join("\n"));
}

// ============================================================
// printSolutionSteps — 打印解题轨迹
// ============================================================

export function printSolutionSteps(steps: readonly SolveStep[]): void {
  const fmt = new TraceFormatter(steps);
  console.log(fmt.detailed());
  console.log(fmt.summary());
}

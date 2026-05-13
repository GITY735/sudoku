import type { SolveStep } from "./trace";
import type { Logger } from "./logger";
import type { BoardReadonly } from "./board";
import type { TechniquePriority, RowIndex, ColIndex } from "./types";
import { TechniquePriority as TP, TechniqueCategory as TC, formatCoord } from "./types";

// ============================================================
// LogLevel
// ============================================================

export enum LogLevel {
  /** 仅输出关键节点 */
  Info = 0,
  /** 输出每步详情 */
  Debug = 1,
  /** 仅错误 */
  Error = 2,
}

// ============================================================
// 标签映射
// ============================================================

const PRIORITY_CN: Record<number, string> = {
  [TP.Basic]: "基本排除",
  [TP.Pair]: "候选数对",
  [TP.Triple]: "三数组",
  [TP.Quad]: "四数组",
  [TP.BasicFish]: "基础鱼",
  [TP.IntermediateChain]: "中级链",
  [TP.AdvancedChain]: "高级链",
  [TP.BruteForce]: "暴力回溯",
};

const CATEGORY_SYMBOL: Record<string, string> = {
  [TC.Placement]: "▣",
  [TC.Elimination]: "○",
  [TC.Coloring]: "◇",
  [TC.Chain]: "→",
  [TC.BruteForce]: "⚡",
};

// ============================================================
// ConsoleLogger
// ============================================================

export class ConsoleLogger implements Logger {
  private _level: LogLevel;
  private _stepCount = 0;

  constructor(level: LogLevel = LogLevel.Info) {
    this._level = level;
  }

  setLevel(level: LogLevel): void {
    this._level = level;
  }

  // ================================================================
  // Logger 实现
  // ================================================================

  onSolveStart(puzzle: string): void {
    this._stepCount = 0;
    if (this._level === LogLevel.Error) return;

    console.log("╔══════════════════════════════╗");
    console.log("║       数独求解 · 开始        ║");
    console.log("╚══════════════════════════════╝");
    if (this._level === LogLevel.Debug) {
      console.log("[题目] " + puzzle);
    }
  }

  onStep(step: SolveStep): void {
    this._stepCount++;

    if (this._level === LogLevel.Error) return;

    const symbol = CATEGORY_SYMBOL[step.category] ?? "·";
    const prio = PRIORITY_CN[step.priority] ?? `L${step.priority}`;
    const bt = step.isBacktrack ? " [回溯]" : "";

    if (this._level === LogLevel.Info) {
      this._printInfoStep(step, symbol, prio, bt);
    } else {
      this._printDebugStep(step, symbol, prio, bt);
    }
  }

  onLevelExhausted(priority: TechniquePriority): void {
    if (this._level === LogLevel.Error) return;
    if (this._level === LogLevel.Debug) {
      const label = PRIORITY_CN[priority] ?? `L${priority}`;
      console.log(`  ── 「${label}」层级已无可用技巧 ──`);
    }
  }

  onSolveEnd(steps: readonly SolveStep[], solved: boolean): void {
    if (this._level === LogLevel.Error) return;

    console.log("");
    if (solved) {
      console.log("╔══════════════════════════════╗");
      console.log("║       求解完成 ✓             ║");
      console.log("╚══════════════════════════════╝");
    } else {
      console.log("╔══════════════════════════════╗");
      console.log("║     求解中断 — 无法继续      ║");
      console.log("╚══════════════════════════════╝");
    }

    console.log(`  共 ${steps.length} 步`);
    this._printSummary(steps);
  }

  onBacktrackStart(depth: number): void {
    if (this._level === LogLevel.Error) return;
    console.log(`  ⚡ 进入回溯 — 深度 ${depth}`);
  }

  onBacktrackGuess(step: SolveStep): void {
    if (this._level === LogLevel.Error) return;
    if (step.delta.placement) {
      const p = step.delta.placement;
      console.log(
        `  ⚡ 回溯猜测 ${formatCoord(p.coord)} = ${p.digit}  (深度 ${step.backtrackDepth})`,
      );
    }
  }

  onBacktrackEnd(solved: boolean): void {
    if (this._level === LogLevel.Error) return;
    console.log(`  ⚡ 回溯结束 — ${solved ? "成功" : "失败"}`);
  }

  // ================================================================
  // 额外：打印盘面
  // ================================================================

  printBoard(board: BoardReadonly, title?: string): void {
    if (title) console.log(`\n  ── ${title} ──`);
    const lines: string[] = [];
    lines.push("  ┌───────┬───────┬───────┐");

    for (let r = 0; r < 9; r++) {
      const row: string[] = ["  "];
      for (let c = 0; c < 9; c++) {
        if (c % 3 === 0) row.push("│ ");
        const v = board.getCell(r as RowIndex, c as ColIndex).value;
        row.push(v === 0 ? "·" : String(v), " ");
      }
      row.push("│");
      lines.push(row.join(""));

      if (r === 2 || r === 5) {
        lines.push("  ├───────┼───────┼───────┤");
      }
    }

    lines.push("  └───────┴───────┴───────┘");
    console.log(lines.join("\n"));
  }

  // ================================================================
  // 错误
  // ================================================================

  error(msg: string): void {
    console.error(`  ✘ 错误: ${msg}`);
  }

  // ================================================================
  // 内部
  // ================================================================

  private _printInfoStep(
    step: SolveStep,
    symbol: string,
    prio: string,
    bt: string,
  ): void {
    let line = `  ${symbol} 第${String(step.stepNumber).padStart(2, " ")}步${bt}`;
    line += ` [${step.techniqueName}]`;

    if (step.delta.placement) {
      const p = step.delta.placement;
      line += ` → ${formatCoord(p.coord)} = ${p.digit}`;
    } else if (step.delta.eliminations.length > 0) {
      line += ` → 消去 ${step.delta.eliminations.length} 个候选数`;
    }

    line += `  (${prio})`;
    console.log(line);
  }

  private _printDebugStep(
    step: SolveStep,
    symbol: string,
    prio: string,
    bt: string,
  ): void {
    console.log(`  ┌─ 第 ${step.stepNumber} 步${bt} ─────────────────────`);
    console.log(
      `  │ ${symbol} ${step.techniqueName}  [${prio}]`,
    );

    if (step.delta.placement) {
      const p = step.delta.placement;
      console.log(`  │ 填值: ${formatCoord(p.coord)} ← ${p.digit}`);
    }

    if (step.delta.eliminations.length > 0) {
      const items = step.delta.eliminations
        .map((e) => `${formatCoord(e.coord)}·${e.digit}`)
        .join(" ");
      console.log(`  │ 消去: ${items}`);
    }

    if (step.delta.nakedSingles.length > 0) {
      const items = step.delta.nakedSingles
        .map((n) => `${formatCoord(n.coord)}→${n.digit}`)
        .join(" ");
      console.log(`  │ 裸单一: ${items}`);
    }

    if (step.delta.contradictions.length > 0) {
      const items = step.delta.contradictions
        .map((c) => formatCoord(c))
        .join(" ");
      console.log(`  │ ⚠ 矛盾: ${items}`);
    }

    if (step.involvedCells.length > 0) {
      const items = step.involvedCells
        .map((c) => formatCoord(c))
        .join(" ");
      console.log(`  │ 涉及: ${items}`);
    }

    console.log(`  │ 依据: ${step.description}`);
    console.log(`  └──────────────────────────────────`);
  }

  private _printSummary(steps: readonly SolveStep[]): void {
    const byPriority = new Map<number, number>();
    const byCategory = new Map<string, number>();
    const backtrackSteps: SolveStep[] = [];

    for (const s of steps) {
      byPriority.set(s.priority, (byPriority.get(s.priority) ?? 0) + 1);
      byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
      if (s.isBacktrack) backtrackSteps.push(s);
    }

    console.log("");
    console.log("  ── 统计 ──");

    const sorted = [...byPriority.entries()].sort((a, b) => a[0] - b[0]);
    for (const [p, count] of sorted) {
      const label = PRIORITY_CN[p] ?? `L${p}`;
      const bar = "█".repeat(Math.min(count, 40));
      console.log(`  ${label.padEnd(6, "　")} ${String(count).padStart(2)} ${bar}`);
    }

    if (backtrackSteps.length > 0) {
      const maxDepth = Math.max(...backtrackSteps.map((s) => s.backtrackDepth));
      console.log(`  回溯步骤: ${backtrackSteps.length}  最大深度: ${maxDepth}`);
    }
  }
}

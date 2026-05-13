import type { SolveStep } from "./trace";
import { TechniquePriority, TechniqueCategory, formatCoord } from "./types";

// ============================================================
// TraceFormatter — 可阅读的解题轨迹格式化
// ============================================================

const PRIORITY_CN: Record<number, string> = {
  [TechniquePriority.Basic]: "基本排除",
  [TechniquePriority.Pair]: "候选数对",
  [TechniquePriority.Triple]: "三数组",
  [TechniquePriority.Quad]: "四数组",
  [TechniquePriority.BasicFish]: "基础鱼",
  [TechniquePriority.IntermediateChain]: "中级链",
  [TechniquePriority.AdvancedChain]: "高级链",
  [TechniquePriority.BruteForce]: "暴力回溯",
};

const CATEGORY_CN: Record<string, string> = {
  [TechniqueCategory.Placement]: "填值",
  [TechniqueCategory.Elimination]: "消数",
  [TechniqueCategory.Coloring]: "染色",
  [TechniqueCategory.Chain]: "链推导",
  [TechniqueCategory.BruteForce]: "回溯",
};

const CATEGORY_ICON: Record<string, string> = {
  [TechniqueCategory.Placement]: "⬛",
  [TechniqueCategory.Elimination]: "🫥",
  [TechniqueCategory.Coloring]: "🎨",
  [TechniqueCategory.Chain]: "🔗",
  [TechniqueCategory.BruteForce]: "🎲",
};

/**
 * 将单条 SolveStep 格式化为教学文本（单行摘要）。
 */
function formatStepOneLine(step: SolveStep): string {
  const icon = CATEGORY_ICON[step.category] ?? "·";
  let line = `${icon} 第${step.stepNumber}步 [${step.techniqueName}]`;

  if (step.isBacktrack) {
    line += ` 深度${step.backtrackDepth}`;
  }

  if (step.delta.placement) {
    const p = step.delta.placement;
    line += ` → ${formatCoord(p.coord)}=${p.digit}`;
  } else if (step.delta.eliminations.length > 0) {
    line += ` → 消去${step.delta.eliminations.length}个候选数`;
  }

  return line;
}

/**
 * 将单条 SolveStep 格式化为详细教学文本。
 */
function formatStepDetail(step: SolveStep): string {
  const lines: string[] = [];
  const prefix = step.isBacktrack ? "[回溯猜测] " : "";

  lines.push(
    `━━━ 第 ${step.stepNumber} 步 ${prefix}━━━`,
  );
  lines.push(`  技巧: ${step.techniqueName}`);
  lines.push(`  层级: ${PRIORITY_CN[step.priority] ?? step.priority}  ·  ${CATEGORY_CN[step.category] ?? step.category}`);

  if (step.delta.placement) {
    const p = step.delta.placement;
    lines.push(`  填值: ${formatCoord(p.coord)} ← ${p.digit}`);
  }

  if (step.delta.eliminations.length > 0) {
    const chunks: string[] = [];
    for (let i = 0; i < step.delta.eliminations.length; i += 12) {
      const chunk = step.delta.eliminations
        .slice(i, i + 12)
        .map((e) => `${formatCoord(e.coord)}·${e.digit}`)
        .join("  ");
      chunks.push(chunk);
    }
    lines.push(`  消去 (${step.delta.eliminations.length}): ${chunks[0]}`);
    for (let i = 1; i < chunks.length; i++) {
      lines.push(`         ${chunks[i]}`);
    }
  }

  if (step.delta.nakedSingles.length > 0) {
    const items = step.delta.nakedSingles
      .map((n) => `${formatCoord(n.coord)}→${n.digit}`)
      .join("  ");
    lines.push(`  裸单一: ${items}`);
  }

  if (step.delta.contradictions.length > 0) {
    const items = step.delta.contradictions
      .map((c) => formatCoord(c))
      .join(", ");
    lines.push(`  ⚠ 矛盾: ${items}`);
  }

  if (step.involvedCells.length > 0) {
    const items = step.involvedCells
      .map((c) => formatCoord(c))
      .join(" ");
    lines.push(`  涉及格: ${items}`);
  }

  lines.push(`  依据: ${step.description}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * TraceFormatter — 可自定义输出格式。
 *
 * 用法：
 *   const fmt = new TraceFormatter(recorder.steps);
 *   console.log(fmt.oneLine());      // 紧凑
 *   console.log(fmt.detailed());     // 教学详细
 */
export class TraceFormatter {
  private _steps: readonly SolveStep[];

  constructor(steps: readonly SolveStep[]) {
    this._steps = steps;
  }

  /** 所有步骤的单行摘要 */
  oneLine(): string {
    if (this._steps.length === 0) return "(无步骤)";
    const header = `解题共 ${this._steps.length} 步：`;
    const body = this._steps.map(formatStepOneLine).join("\n");
    return header + "\n" + body;
  }

  /** 逐步骤详细输出 */
  detailed(): string {
    if (this._steps.length === 0) return "(无步骤)";
    const header = `╔══════════════════════════╗
║  数独求解 · 教学轨迹     ║
╚══════════════════════════╝
共 ${this._steps.length} 步
`;
    const body = this._steps.map(formatStepDetail).join("");
    return header + "\n" + body;
  }

  /** 仅关键步骤（填值步骤） */
  placements(): string {
    const ps = this._steps.filter((s) => s.delta.placement !== null);
    if (ps.length === 0) return "(无填值步骤)";
    const header = `填值步骤共 ${ps.length} 步：`;
    const body = ps.map(formatStepOneLine).join("\n");
    return header + "\n" + body;
  }

  /** 按优先级统计 */
  summary(): string {
    if (this._steps.length === 0) return "(无步骤)";

    const byPriority = new Map<number, number>();
    const byCategory = new Map<string, number>();

    for (const s of this._steps) {
      byPriority.set(s.priority, (byPriority.get(s.priority) ?? 0) + 1);
      byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
    }

    const lines: string[] = [
      `步骤统计 — 共 ${this._steps.length} 步`,
      "",
      "按难度层级：",
    ];

    const sortedPriorities = [...byPriority.entries()].sort((a, b) => a[0] - b[0]);
    for (const [p, count] of sortedPriorities) {
      const label = PRIORITY_CN[p] ?? `L${p}`;
      lines.push(`  ${label}: ${count} 步`);
    }

    lines.push("");
    lines.push("按操作类型：");
    for (const [cat, count] of byCategory) {
      const label = CATEGORY_CN[cat] ?? cat;
      lines.push(`  ${label}: ${count} 步`);
    }

    const backtrackSteps = this._steps.filter((s) => s.isBacktrack);
    if (backtrackSteps.length > 0) {
      const maxDepth = Math.max(...backtrackSteps.map((s) => s.backtrackDepth));
      lines.push("");
      lines.push(`含回溯步骤 ${backtrackSteps.length} 步，最大深度 ${maxDepth}`);
    }

    return lines.join("\n");
  }
}

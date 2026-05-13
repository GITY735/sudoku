import type { BoardReadonly } from "../board";
import type { CandidateSnapshot } from "../candidate";
import type { TechniquePriority } from "../types";
import type { Technique, TechniqueResult } from "./types";
import type { TechniqueRegistry } from "../registry";

// ============================================================
// TechniqueManager — 技巧注册 + 按优先级逐步执行
// ============================================================

export interface TechniqueManagerEvents {
  /**
   * 某优先级层级的全部技巧均无发现时回调。
   * 返回 false 可中断执行循环（由 Engine 决定是否继续暴力层）。
   */
  onLevelExhausted?(priority: TechniquePriority): void;
}

export class TechniqueManager implements TechniqueRegistry {
  private _techniques: Technique[] = [];
  private _events: TechniqueManagerEvents = {};

  // ================================================================
  // TechniqueRegistry 实现
  // ================================================================

  register(technique: Technique): void {
    // 不允许重复 id
    if (this._techniques.some((t) => t.id === technique.id)) {
      throw new Error(`Technique "${technique.id}" already registered`);
    }
    this._techniques.push(technique);
    // 保持按优先级排序
    this._techniques.sort((a, b) => a.priority - b.priority);
  }

  getByPriority(priority: TechniquePriority): readonly Technique[] {
    return this._techniques.filter((t) => t.priority === priority);
  }

  getAll(): readonly Technique[] {
    return this._techniques;
  }

  find(id: string): Technique | undefined {
    return this._techniques.find((t) => t.id === id);
  }

  // ================================================================
  // 事件
  // ================================================================

  setEvents(events: TechniqueManagerEvents): void {
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
  next(
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null {
    let currentPriority: TechniquePriority | null = null;
    let priorityExhausted = true;

    for (const technique of this._techniques) {
      // 进入新的优先级层级
      if (currentPriority === null || technique.priority !== currentPriority) {
        // 上一层级全部技巧均无发现 → 通知
        if (currentPriority !== null && priorityExhausted) {
          this._events.onLevelExhausted?.(currentPriority);
        }
        currentPriority = technique.priority;
        priorityExhausted = true;
      }

      const result = technique.apply(board, candidates);
      if (result !== null) {
        return result;
      }
      // 此技巧无发现，继续
    }

    // 最后一级也耗尽了
    if (currentPriority !== null && priorityExhausted) {
      this._events.onLevelExhausted?.(currentPriority);
    }

    return null;
  }

  /**
   * 仅在某一优先级层级内尝试。
   * 用于 Engine 需要在特定层级内查找但不触发跨级遍历的场景。
   */
  tryLevel(
    priority: TechniquePriority,
    board: BoardReadonly,
    candidates: CandidateSnapshot,
  ): TechniqueResult | null {
    const techs = this.getByPriority(priority);
    for (const t of techs) {
      const result = t.apply(board, candidates);
      if (result !== null) return result;
    }
    return null;
  }

  // ================================================================
  // 查询
  // ================================================================

  get count(): number {
    return this._techniques.length;
  }

  /** 已注册技巧的优先级分布 */
  distribution(): Map<TechniquePriority, number> {
    const map = new Map<TechniquePriority, number>();
    for (const t of this._techniques) {
      map.set(t.priority, (map.get(t.priority) ?? 0) + 1);
    }
    return map;
  }
}

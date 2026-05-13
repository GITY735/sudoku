import type { Technique } from "./technique/types";
import type { TechniquePriority } from "./types";

// ============================================================
// TechniqueRegistry — 技巧注册表
// ============================================================

/**
 * 技巧注册表：按优先级层级组织技巧。
 *
 * 新增一条技巧只需：
 *   1. 实现 Technique 接口
 *   2. 调用 registry.register(technique)
 *
 * Engine 遍历注册表时按优先级从低到高逐层尝试。
 */
export interface TechniqueRegistry {
  /** 注册一条技巧（按 technique.priority 归入对应层级） */
  register(technique: Technique): void;

  /** 获取某优先级层级的全部技巧 */
  getByPriority(priority: TechniquePriority): readonly Technique[];

  /** 获取所有已注册技巧（按优先级排序） */
  getAll(): readonly Technique[];

  /** 按 id 查找 */
  find(id: string): Technique | undefined;
}

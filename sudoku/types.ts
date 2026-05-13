// ============================================================
// 基础类型 — Candidate propagation system 的公共词汇表
// ============================================================

export type RowIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type ColIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type BoxIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type BoardIndex = RowIndex;
export type CellCoord = readonly [RowIndex, ColIndex];
export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * 候选数位掩码。
 * bit 0 闲置。
 * bit 1 → 1 存在, ..., bit 9 → 9 存在。
 * 空集 = 0。全集 = (1<<1)|...|(1<<9) = 0x3FE (1022)。
 */
export type CandidateMask = number;

// ============================================================
// 枚举
// ============================================================

export enum CellState {
  Given = "given",
  Solved = "solved",
  Empty = "empty",
}

export enum TechniquePriority {
  /** 唯余法、摒除法 */
  Basic = 0,
  /** 显性/隐性数对、区块摒除 */
  Pair = 1,
  /** 显性/隐性三数组、行列区块 */
  Triple = 2,
  /** 显性/隐性四数组 */
  Quad = 3,
  /** X-Wing、Swordfish、Jellyfish */
  BasicFish = 4,
  /** Y-Wing、XYZ-Wing、Simple Coloring */
  IntermediateChain = 5,
  /** XY-Chain、3D Medusa、AIC */
  AdvancedChain = 6,
  /** 回溯 — 不可教学 */
  BruteForce = 7,
}

export enum TechniqueCategory {
  Placement = "placement",
  Elimination = "elimination",
  Coloring = "coloring",
  Chain = "chain",
  BruteForce = "brute_force",
}

export enum SolveStepOutcome {
  /** 推导成功：值被填入或候选数被消去 */
  Progressed = "progressed",
  /** 该技巧在当前盘面无任何发现 */
  NoFinding = "no_finding",
  /** 技巧认为盘面出现矛盾（不可恢复） */
  Contradiction = "contradiction",
}

export const ALL_DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const ALL_CANDIDATES_MASK: CandidateMask =
  (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9);

// ============================================================
// CandidateMask 位操作
// ============================================================

export const CandidateMask = {
  /** 空集 */
  empty: 0 as CandidateMask,

  /** 全集 {1..9} */
  all: ALL_CANDIDATES_MASK as CandidateMask,

  /** 从数字列表构建掩码 */
  fromDigits(digits: readonly number[]): CandidateMask {
    let mask = 0;
    for (const d of digits) {
      mask |= 1 << d;
    }
    return mask;
  },

  /** 添加一个数字，返回新掩码（不变原值） */
  add(mask: CandidateMask, digit: number): CandidateMask {
    return mask | (1 << digit);
  },

  /** 移除一个数字，返回新掩码（不变原值） */
  remove(mask: CandidateMask, digit: number): CandidateMask {
    return mask & ~(1 << digit);
  },

  /** 是否包含某数字 */
  has(mask: CandidateMask, digit: number): boolean {
    return (mask & (1 << digit)) !== 0;
  },

  /** 集合大小（popcount） */
  size(mask: CandidateMask): number {
    let n = mask;
    n = n - ((n >>> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    n = (n + (n >>> 4)) & 0x0F0F0F0F;
    n = n + (n >>> 8);
    n = n + (n >>> 16);
    return n & 0x3F;
  },

  /** 将掩码转为数字数组（已排序） */
  toDigits(mask: CandidateMask): Digit[] {
    const result: number[] = [];
    for (let d = 1; d <= 9; d++) {
      if (CandidateMask.has(mask, d)) {
        result.push(d);
      }
    }
    return result as Digit[];
  },

  /** 合并两个掩码，返回新掩码 */
  union(a: CandidateMask, b: CandidateMask): CandidateMask {
    return a | b;
  },

  /** 交集，返回新掩码 */
  intersect(a: CandidateMask, b: CandidateMask): CandidateMask {
    return a & b;
  },

  /** 差集：a 中有但 b 中没有 */
  subtract(a: CandidateMask, b: CandidateMask): CandidateMask {
    return a & ~b;
  },

  /** 只有一位被置位（即恰好一个候选数） */
  isSingle(mask: CandidateMask): boolean {
    return mask !== 0 && (mask & (mask - 1)) === 0;
  },

  /** 获取 sole candidate 的数字（mask 必须只有一位被置位） */
  soleDigit(mask: CandidateMask): Digit {
    // bitScan: 找最低置位对应的数字
    let i = 0;
    while (mask !== 0) {
      if (mask & 1) return i as Digit;
      mask >>>= 1;
      i++;
    }
    throw new Error("CandidateMask is zero — no sole digit");
  },
} as const;

// ============================================================
// 坐标常量：9×9 预计算
// ============================================================

/** 通过行列计算宫索引 */
export function boxIndex(row: number, col: number): BoxIndex {
  return (Math.floor(row / 3) * 3 + Math.floor(col / 3)) as BoxIndex;
}

/** 获取某宫内所有格坐标 */
export function boxCells(box: BoxIndex): CellCoord[] {
  const startRow = Math.floor(box / 3) * 3;
  const startCol = (box % 3) * 3;
  const cells: CellCoord[] = [];
  for (let r = startRow; r < startRow + 3; r++) {
    for (let c = startCol; c < startCol + 3; c++) {
      cells.push([r as RowIndex, c as ColIndex]);
    }
  }
  return cells;
}

/** 格式化坐标，便于日志（内部使用，0-based） */
export function coordKey(coord: CellCoord): string {
  return `r${coord[0]}c${coord[1]}`;
}

/** 格式化坐标为 1-based 显示文本：r1c1 ~ r9c9 */
export function formatCoord(coord: CellCoord): string {
  return `r${coord[0] + 1}c${coord[1] + 1}`;
}

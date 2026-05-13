// ---- 基础类型 ----
export { Cell } from "./cell";
export { Board } from "./board";
export type { BoardReadonly } from "./board";
export { CandidateManager, CandidateSnapshot, mergeDeltas } from "./candidate";
export type { CandidateDelta } from "./candidate";

// ---- 技巧层 ----
export type { Technique, TechniqueResult } from "./technique/types";
export { TechniqueManager } from "./technique/manager";
export type { TechniqueManagerEvents } from "./technique/manager";
export {
  NakedSingleTechnique,
  HiddenSingleTechnique,
  NakedPairTechnique,
  HiddenPairTechnique,
  PointingPairTechnique,
  NakedTripleTechnique,
  HiddenTripleTechnique,
  BoxLineTechnique,
  NakedQuadTechnique,
  HiddenQuadTechnique,
  XWingTechnique,
  SwordfishTechnique,
  JellyfishTechnique,
  YWingTechnique,
  XYZWingTechnique,
  SimpleColoringTechnique,
  XYChainTechnique,
  MedusaTechnique,
  AICTechnique,
  EmptyRectangleTechnique,
  UniqueRectangleTechnique,
  ForcingChainTechnique,
} from "./technique";

// ---- Engine / Trace / Logger / Registry 接口 ----
export type { SolveStep } from "./trace";
export { StepRecorder } from "./trace";
export { TraceFormatter } from "./trace-formatter";
export type { Logger } from "./logger";
export { ConsoleLogger, LogLevel } from "./console-logger";
export type { TechniqueRegistry } from "./registry";
export type { SolveEngine } from "./engine";
export { SudokuEngine, createEngine, solve } from "./solve-engine";
export { parseBoard, stringifyBoard, printBoard, printSolutionSteps } from "./io";

// ---- 枚举与基础类型 ----
export * from "./types";

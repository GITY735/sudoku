export type { Technique, TechniqueResult } from "./types";
export { TechniqueManager } from "./manager";
export type { TechniqueManagerEvents } from "./manager";

// Basic (0)
export { NakedSingleTechnique } from "./naked-single";
export { HiddenSingleTechnique } from "./hidden-single";

// Pair (1)
export { NakedPairTechnique } from "./naked-pair";
export { HiddenPairTechnique } from "./hidden-pair";
export { PointingPairTechnique } from "./pointing-pair";

// Triple (2)
export { NakedTripleTechnique } from "./naked-triple";
export { HiddenTripleTechnique } from "./hidden-triple";
export { BoxLineTechnique } from "./box-line";

// Quad (3)
export { NakedQuadTechnique } from "./naked-quad";
export { HiddenQuadTechnique } from "./hidden-quad";

// BasicFish (4)
export { XWingTechnique } from "./xwing";
export { SwordfishTechnique } from "./swordfish";
export { JellyfishTechnique } from "./jellyfish";

// IntermediateChain (5)
export { YWingTechnique } from "./ywing";
export { XYZWingTechnique } from "./xyz-wing";
export { SimpleColoringTechnique } from "./simple-coloring";

// AdvancedChain (6)
export { XYChainTechnique } from "./xy-chain";
export { MedusaTechnique } from "./medusa";
export { AICTechnique } from "./aic";
export { EmptyRectangleTechnique } from "./empty-rectangle";
export { UniqueRectangleTechnique } from "./unique-rectangle";
export { ForcingChainTechnique } from "./forcing-chain";

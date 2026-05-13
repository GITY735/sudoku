// ---- external globals (loaded via CDN script tags) ----
declare var cv: any;
declare var Tesseract: any;

import { Board, CandidateManager, createEngine, TraceFormatter } from "./sudoku/index.ts";
import type { SolveStep } from "./sudoku/trace.ts";
import type { CellCoord } from "./sudoku/types.ts";

// ---- puzzle samples ----
const SAMPLES: Record<string, string> = {
  示例1: "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
  示例2: "000000000000003085001020000000507000004000100090000000500000073002010000000040009",
  示例3: "900508007080302905054000080070680032100004008500219060000906001726001040001470056",
};

// ---- state ----
let engine = createEngine();
let board: Board;
let cm: CandidateManager;
let steps: readonly SolveStep[] = [];
let currentStepIdx = -1;
let ocrWorker: any = null;
let ocrReady = false;
let opencvReady = false;

// ---- DOM refs ----
function $(id: string): HTMLElement { return document.getElementById(id)!; }

// ================================================================
// INIT
// ================================================================
function init() {
  buildGrid();
  bindButtons();
  initOpenCV();
  initOCR();
  loadPuzzle(SAMPLES["示例1"]!);
}

async function initOpenCV() {
  // OpenCV.js is loaded asynchronously via script tag. The onload callback
  // sets window._opencvLoaded. We register it, then cv initializes.
  (window as any)._opencvLoaded = () => {
    if (cv && cv.Mat) {
      opencvReady = true;
      updateEngineStatus();
    }
  };
  // If already loaded (cached), check immediately
  if ((window as any).cv && (window as any).cv.Mat) {
    opencvReady = true;
    updateEngineStatus();
  }
  // Fallback polling
  let attempts = 0;
  const poll = setInterval(() => {
    if (opencvReady) { clearInterval(poll); return; }
    if (cv && cv.Mat) {
      opencvReady = true;
      updateEngineStatus();
      clearInterval(poll);
    }
    if (++attempts > 150) clearInterval(poll); // 30s timeout
  }, 200);
}

async function initOCR() {
  try {
    ocrWorker = await Tesseract.createWorker("eng", 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
    });
    await ocrWorker.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: "10", // PSM_SINGLE_CHAR
    });
    ocrReady = true;
    updateEngineStatus();
  } catch {
    ocrReady = false;
    updateEngineStatus();
  }
}

function updateEngineStatus() {
  const btn = $("btn-ocr") as HTMLButtonElement;
  if (opencvReady && ocrReady) {
    btn.disabled = false;
    btn.textContent = "拍照识别";
    updateStatus("就绪 — 可手动输入、载入示例或拍照识别");
  } else if (opencvReady && !ocrReady) {
    btn.disabled = false;
    btn.textContent = "拍照识别 (离线模式)";
    updateStatus("OCR 离线 — 拍照识别不可用，可手动输入");
  } else {
    btn.disabled = true;
    btn.textContent = "拍照识别 (引擎加载中...)";
    updateStatus("OpenCV 引擎加载中，识别功能暂不可用...");
  }
}

// ================================================================
// 9x9 GRID
// ================================================================
function buildGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement("input");
      cell.type = "text"; cell.maxLength = 1;
      cell.className = "cell";
      cell.dataset.row = String(r); cell.dataset.col = String(c);
      if (c % 3 === 2 && c !== 8) cell.classList.add("br");
      if (r % 3 === 2 && r !== 8) cell.classList.add("bb");
      cell.addEventListener("input", onCellInput);
      cell.addEventListener("keydown", onCellKey);
      grid.appendChild(cell);
    }
  }
}

function getCell(r: number, c: number): HTMLInputElement {
  return document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`)!;
}

function onCellInput(e: Event) {
  const inp = e.target as HTMLInputElement;
  inp.value = inp.value.replace(/[^1-9]/g, "");
  if (inp.value) {
    const r = +inp.dataset.row!, c = +inp.dataset.col!;
    const next = r * 9 + c + 1;
    if (next < 81) (document.querySelector(`.cell:nth-child(${next + 1})`) as HTMLInputElement)?.focus();
  }
}

function onCellKey(e: KeyboardEvent) {
  const inp = e.target as HTMLInputElement;
  const r = +inp.dataset.row!, c = +inp.dataset.col!;
  if (e.key === "ArrowUp" && r > 0) getCell(r - 1, c).focus();
  if (e.key === "ArrowDown" && r < 8) getCell(r + 1, c).focus();
  if (e.key === "ArrowLeft" && c > 0) getCell(r, c - 1).focus();
  if (e.key === "ArrowRight" && c < 8) getCell(r, c + 1).focus();
  if (e.key === "Backspace" && !inp.value && c > 0) getCell(r, c - 1).focus();
}

function readBoard(): string {
  let s = "";
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      s += getCell(r, c).value || "0";
  return s;
}

function writeBoard(b: Board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = getCell(r, c);
      const v = b.getCell(r as 0, c as 0).value;
      cell.value = v === 0 ? "" : String(v);
      cell.classList.remove("given", "solved", "highlight");
      if (v !== 0) cell.classList.add(b.getCell(r as 0, c as 0).state === "given" ? "given" : "solved");
    }
  }
}

function fillCells(digits: string) {
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9), c = i % 9;
    getCell(r, c).value = digits[i] === "0" ? "" : digits[i]!;
  }
  loadPuzzle(digits);
}

// ================================================================
// BUTTONS
// ================================================================
function bindButtons() {
  $("btn-solve").addEventListener("click", onSolve);
  $("btn-step").addEventListener("click", onStep);
  $("btn-reset").addEventListener("click", onReset);
  $("btn-clear").addEventListener("click", onClear);
  $("btn-clear-chain").addEventListener("click", clearChain);
  $("btn-load-string").addEventListener("click", onLoadString);
  $("btn-ocr").addEventListener("click", () => ($("ocr-file") as HTMLInputElement).click());
  ($("ocr-file") as HTMLInputElement).addEventListener("change", onOCRFile);
  $("ocr-close").addEventListener("click", () => ($("ocr-overlay") as HTMLElement).classList.remove("show"));

  const sel = $("samples") as HTMLSelectElement;
  for (const [name, puzzle] of Object.entries(SAMPLES)) {
    const opt = document.createElement("option");
    opt.value = puzzle; opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => loadPuzzle(sel.value));
}

function onLoadString() {
  const raw = ($("puzzle-string") as HTMLInputElement).value.replace(/\s/g, "");
  if (raw.length !== 81 || !/^[0-9]{81}$/.test(raw)) {
    alert("请输入 81 位数字（空格用 0 表示）");
    return;
  }
  loadPuzzle(raw);
}

function loadPuzzle(puzzle: string) {
  board = new Board(puzzle);
  cm = new CandidateManager(board);
  steps = []; currentStepIdx = -1; clearChain();
  writeBoard(board);
  updateStatus("题目已加载 — 空格: " + board.emptyCount());
  $("trace").innerHTML = "";
  ($("puzzle-string") as HTMLInputElement).value = puzzle;
}

function onSolve() {
  const puzzle = readBoard();
  board = new Board(puzzle); cm = new CandidateManager(board);
  engine = createEngine();
  steps = engine.solve(puzzle); currentStepIdx = -1;
  if (steps.length > 0) writeBoard(steps[steps.length - 1]!.boardAfter);
  else writeBoard(board);
  updateStatus(steps.length > 0 ? `求解完成 — ${steps.length} 步` : "无法求解");
  renderTrace();
}

function onStep() {
  if (steps.length === 0) { onSolve(); return; }
  currentStepIdx = Math.min(currentStepIdx + 1, steps.length - 1);
  const step = steps[currentStepIdx]!;
  writeBoard(step.boardAfter);
  drawChain(step);
  updateStatus(`第 ${step.stepNumber} / ${steps.length} 步 — ${step.techniqueName} — ${step.description}`);
  renderCurrentStep(step);
}

function onReset() {
  if (steps.length > 0 && currentStepIdx >= 0) {
    currentStepIdx--;
    const b = currentStepIdx < 0 ? board : steps[currentStepIdx]!.boardAfter;
    writeBoard(b);
    updateStatus(currentStepIdx < 0 ? "已回退到起始" : `回退到第 ${currentStepIdx + 1} 步`);
  }
}

function onClear() {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      getCell(r, c).value = "";
      getCell(r, c).classList.remove("given", "solved", "highlight");
    }
  steps = []; currentStepIdx = -1; clearChain();
  updateStatus("已清空"); $("trace").innerHTML = "";
}

// ================================================================
// OCR PIPELINE
// ================================================================
async function onOCRFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const overlay = $("ocr-overlay") as HTMLElement;
  const stepsEl = $("ocr-steps");
  const preview = $("ocr-preview") as HTMLImageElement;
  overlay.classList.add("show");
  preview.style.display = "none";

  const setStep = (step: number, text: string, done: boolean) => {
    const prefix = done ? "✓ " : "◌ ";
    const cls = done ? "step-done" : "step-active";
    const lines = stepsEl.innerHTML.split("<br>").filter(l => l);
    lines[step - 1] = `<span class="${cls}">${prefix}${text}</span>`;
    stepsEl.innerHTML = lines.join("<br>");
  };

  stepsEl.innerHTML = [
    "1. 加载图片",
    "2. 灰度化 & 二值化",
    "3. 定位九宫格外框",
    "4. 透视矫正 & 裁剪",
    "5. 分割 81 格",
    "6. OCR 逐格识别",
  ].map(t => `<span>${t}</span>`).join("<br>");

  try {
    // Step 1: load image
    const img = await loadImage(file);
    setStep(1, "加载图片", true);

    // Step 2: grayscale + binary
    const gray = opencvGray(img);
    const binary = opencvAdaptiveThreshold(gray);
    setStep(2, "灰度化 & 二值化", true);

    // Step 3: find grid contour
    const corners = findGridCorners(binary);
    if (!corners) throw new Error("未检测到九宫格轮廓");
    setStep(3, "定位九宫格外框", true);

    // Step 4: perspective warp to 450×450
    const warped = opencvWarp(gray, corners, 450);
    preview.src = matToDataURL(warped);
    preview.style.display = "block";
    setStep(4, "透视矫正 & 裁剪", true);

    // Step 5: split into 81 cells
    const cells = extractCells81(warped);
    warped.delete();
    setStep(5, "分割 81 格", true);

    // Step 6: OCR each cell
    let puzzle = "";
    for (let i = 0; i < 81; i++) {
      const digit = await ocrCell(cells[i]!, i);
      puzzle += digit;
      if (i % 9 === 8) setStep(6, `OCR 逐格识别 ${i + 1} / 81`, i < 80);
    }
    setStep(6, `OCR 识别完成 — 检测到 ${puzzle.split("").filter(c => c !== "0").length} 个数字`, true);

    // Cleanup
    gray.delete(); binary.delete();
    for (const c of cells) c.delete();

    // Fill board
    fillCells(puzzle);
    updateStatus(`识别完成！${puzzle.split("").filter(c => c !== "0").length} 格有数字，可手动修正`);
    setTimeout(() => overlay.classList.remove("show"), 1500);

  } catch (err: any) {
    setStep(6, `失败: ${err.message || "未知错误"}`, true);
    updateStatus("识别失败，请确保图片包含完整清晰的数独网格");
  }
}

// ---- OpenCV helpers ----

function opencvGray(img: HTMLImageElement): any {
  const src = cv.imread(img);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();
  return gray;
}

function opencvAdaptiveThreshold(gray: any): any {
  const blurred = new cv.Mat();
  // Gaussian blur to reduce noise
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const binary = new cv.Mat();
  // Adaptive threshold: 11x11 neighborhood, C=2
  cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 3);
  blurred.delete();

  // Morphological close to connect grid lines
  const kernel = cv.Mat.ones(2, 2, cv.CV_8U);
  const closed = new cv.Mat();
  cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);
  kernel.delete(); binary.delete();

  return closed;
}

function findGridCorners(binary: any): { tl: [number,number]; tr: [number,number]; br: [number,number]; bl: [number,number] } | null {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  hierarchy.delete();

  let bestArea = 0;
  let bestCorners: any = null;
  const imgArea = binary.rows * binary.cols;

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    // grid must be > 10% of image area
    if (area < imgArea * 0.10) continue;

    const peri = cv.arcLength(cnt, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

    if (approx.rows === 4 && area > bestArea) {
      bestArea = area;

      // Extract 4 corners
      const pts: [number, number][] = [];
      for (let j = 0; j < 4; j++) {
        pts.push([approx.data32S[j * 2]!, approx.data32S[j * 2 + 1]!]);
      }

      // Order: top-left, top-right, bottom-right, bottom-left
      pts.sort((a, b) => a[0] - b[0]); // sort by x
      const left = pts.slice(0, 2).sort((a, b) => a[1] - b[1]);
      const right = pts.slice(2, 4).sort((a, b) => a[1] - b[1]);
      bestCorners = { tl: left[0]!, tr: right[0]!, br: right[1]!, bl: left[1]! };
    }
    approx.delete();
  }
  contours.delete();

  return bestCorners;
}

function opencvWarp(gray: any, corners: any, size: number): any {
  const { tl, tr, br, bl } = corners;

  // Source points (in original image)
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1],
  ]);

  // Destination points (450×450 square)
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, size - 1, 0, size - 1, size - 1, 0, size - 1,
  ]);

  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  cv.warpPerspective(gray, warped, M, new cv.Size(size, size));

  // Invert: make digits dark on light background
  const inverted = new cv.Mat();
  cv.bitwise_not(warped, inverted);

  srcPts.delete(); dstPts.delete(); M.delete(); warped.delete();
  return inverted;
}

function extractCells81(warped: any): any[] {
  const cells: any[] = [];
  const cellSz = 50; // 450 / 9
  const inset = 5;   // crop inner to exclude grid lines

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const x = c * cellSz + inset;
      const y = r * cellSz + inset;
      const w = cellSz - inset * 2;
      const rect = new cv.Rect(x, y, w, w);
      const roi = warped.roi(rect);
      const resized = new cv.Mat();
      cv.resize(roi, resized, new cv.Size(40, 40));
      roi.delete();
      cells.push(resized);
    }
  }
  return cells;
}

function matToDataURL(mat: any): string {
  const canvas = document.createElement("canvas");
  canvas.width = mat.cols; canvas.height = mat.rows;
  cv.imshow(canvas, mat);
  return canvas.toDataURL("image/png");
}

// ---- Tesseract OCR ----

async function ocrCell(cellMat: any, _idx: number): Promise<string> {
  // Check if cell is empty: count non-white pixels
  const data = new Uint8Array(cellMat.data);
  let darkCount = 0;
  for (let i = 0; i < data.length; i += cellMat.channels()) {
    if (data[i]! < 128) darkCount++;
  }
  const totalPixels = cellMat.rows * cellMat.cols;
  if (darkCount / totalPixels < 0.04) return "0";

  if (!ocrReady || !ocrWorker) return "0";

  // Convert cv.Mat to canvas for Tesseract
  const canvas = document.createElement("canvas");
  canvas.width = cellMat.cols; canvas.height = cellMat.rows;
  cv.imshow(canvas, cellMat);

  try {
    const { data: result } = await ocrWorker.recognize(canvas);
    const text = (result.text || "").replace(/\s/g, "");
    const match = text.match(/[0-9]/);
    return match ? match[0]! : "0";
  } catch {
    return "0";
  }
}

// ---- image loader ----
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ================================================================
// TRACE
// ================================================================
function clearChain() {
  const canvas = $("chain-canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      getCell(r, c).classList.remove("chain-start", "chain-path", "chain-target");
}

function drawChain(step: SolveStep) {
  clearChain();
  const cells = step.involvedCells;
  if (!cells || cells.length < 2) return;

  const canvas = $("chain-canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const cx = (c: CellCoord) => c[1] * 41 + 22;
  const cy = (c: CellCoord) => c[0] * 41 + 22;
  const isChainTech = ["y-wing", "xyz-wing", "simple-coloring", "xy-chain", "medusa", "aic", "forcing-chain"].includes(step.techniqueId);

  // Mark cells
  const start = cells[0]!;
  const targetIdx = step.delta.eliminations.length > 0
    ? cells.findIndex((c) => step.delta.eliminations.some((e) => e.coord[0] === c[0] && e.coord[1] === c[1]))
    : -1;

  const isTarget = (c: CellCoord) => step.delta.eliminations.some((e) => e.coord[0] === c[0] && e.coord[1] === c[1]);

  for (let i = 0; i < cells.length; i++) {
    const el = getCell(cells[i]![0], cells[i]![1]);
    if (isTarget(cells[i]!)) el.classList.add("chain-target");
    else if (i === 0 && isChainTech) el.classList.add("chain-start");
    else if (isChainTech) el.classList.add("chain-path");
  }

  if (!isChainTech) return;

  // Draw lines between consecutive cells
  ctx.lineWidth = 2.5;
  for (let i = 1; i < cells.length; i++) {
    const from = cells[i - 1]!;
    const to = cells[i]!;
    const isPeer = from[0] === to[0] || from[1] === to[1] ||
      (Math.floor(from[0] / 3) === Math.floor(to[0] / 3) && Math.floor(from[1] / 3) === Math.floor(to[1] / 3));
    const isElim = isTarget(to);

    ctx.beginPath();
    ctx.moveTo(cx(from), cy(from));
    ctx.lineTo(cx(to), cy(to));
    ctx.strokeStyle = isElim ? "#c62828" : (isPeer ? "#2e7d32" : "#1565c0");
    if (isElim) ctx.setLineDash([5, 3]); else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    drawArrow(ctx, cx(from), cy(from), cx(to), cy(to), isElim ? "#c62828" : (isPeer ? "#2e7d32" : "#1565c0"));
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = 14;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const sz = 6;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(midX, midY);
  ctx.lineTo(midX - sz * Math.cos(angle - 0.6), midY - sz * Math.sin(angle - 0.6));
  ctx.lineTo(midX - sz * Math.cos(angle + 0.6), midY - sz * Math.sin(angle + 0.6));
  ctx.closePath();
  ctx.fill();
}

function updateStatus(msg: string) { $("status").textContent = msg; }

function renderTrace() {
  const fmt = new TraceFormatter(steps);
  $("trace").innerHTML = escapeHtml(fmt.detailed() + "\n" + fmt.summary())
    .replace(/\n/g, "<br>").replace(/  /g, "&nbsp;&nbsp;");
}

function renderCurrentStep(step: SolveStep) {
  const fmt = new TraceFormatter([step]);
  $("trace").innerHTML = escapeHtml(fmt.detailed())
    .replace(/\n/g, "<br>").replace(/  /g, "&nbsp;&nbsp;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- bootstrap ----
document.addEventListener("DOMContentLoaded", init);

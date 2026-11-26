import { applyH, type Pt } from "./homography";
import { hitTest, KEYS, type KeySpec } from "./keyboard-layout";
import { previewPathPrefix } from "./preview-path-prefix";
import { findSheet } from "./sheet-find";

export type PressStyle = "tap" | "rest";
export type PressDirection = "above" | "facing";

export type TrackerBridge = {
  getToBoard: () => number[] | null;
  getToVideo: () => number[] | null;
  getSensitivity: () => number;
  getDirection: () => PressDirection;
  getStyle: () => PressStyle;
  getLit: () => Set<string>;
  getFlags: () => { numlock: boolean; fn: boolean };
  getCalib: () => Pt[];
  onLive: (text: string) => void;
  onEvent: (id: string, phase: "down" | "up") => void;
  onSheet: (points: Pt[] | null) => void;
  sheetLocked: () => boolean;
};

type LM = { x: number; y: number; z?: number };

const FINGERS = [
  { name: "thumb", tip: 4, pip: 3 },
  { name: "index", tip: 8, pip: 6 },
  { name: "middle", tip: 12, pip: 10 },
  { name: "ring", tip: 16, pip: 14 },
  { name: "pinky", tip: 20, pip: 18 },
] as const;

const CHAINS = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

function assetRoot(): string {
  if (typeof window === "undefined") return "";
  return previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
}

export async function startHandLoop(opts: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  facing: "user" | "environment";
  bridge: { current: TrackerBridge };
}): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser has no camera.");
  }

  let running = true;
  let raf = 0;
  let stream: MediaStream | null = null;
  let landmarker: { close: () => void; detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks?: LM[][] } } | null =
    null;

  const teardown = () => {
    running = false;
    cancelAnimationFrame(raf);
    landmarker?.close();
    landmarker = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (opts.video.srcObject) opts.video.srcObject = null;
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: opts.facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    if (!running) {
      teardown();
      return teardown;
    }
    opts.video.srcObject = stream;
    await opts.video.play();
    if (!running) {
      teardown();
      return teardown;
    }

    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    const root = assetRoot();
    const wasm = await FilesetResolver.forVisionTasks(`${root}/mediapipe`);
    const model = `${root}/mediapipe/hand_landmarker.task`;
    const common = {
      numHands: 2,
      runningMode: "VIDEO" as const,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    };
    try {
      landmarker = await HandLandmarker.createFromOptions(wasm, {
        ...common,
        baseOptions: { modelAssetPath: model, delegate: "GPU" },
      });
    } catch {
      landmarker = await HandLandmarker.createFromOptions(wasm, {
        ...common,
        baseOptions: { modelAssetPath: model, delegate: "CPU" },
      });
    }
    if (!running) {
      teardown();
      return teardown;
    }

    const mem = new Map<
      string,
      { streak: number; downId: string | null; dwellId: string | null; dwellMs: number; fired: boolean; x: number; y: number }
    >();
    const holders = new Map<string, number>();
    let lastTs = -1;
    let lastFrame = performance.now();
    let lastLive = "";
    let probeTick = 0;
    const probe = document.createElement("canvas");
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });

    const emit = (id: string, phase: "down" | "up") => opts.bridge.current.onEvent(id, phase);

    const setDown = (fingerKey: string, keyId: string | null) => {
      const row = mem.get(fingerKey);
      if (!row || row.downId === keyId) return;
      if (row.downId) {
        const left = (holders.get(row.downId) ?? 1) - 1;
        if (left <= 0) {
          holders.delete(row.downId);
          emit(row.downId, "up");
        } else holders.set(row.downId, left);
      }
      row.downId = keyId;
      if (keyId) {
        const count = (holders.get(keyId) ?? 0) + 1;
        holders.set(keyId, count);
        if (count === 1) emit(keyId, "down");
      }
    };

    const live = (text: string) => {
      if (text === lastLive) return;
      lastLive = text;
      opts.bridge.current.onLive(text);
    };

    const frame = () => {
      if (!running || !landmarker) return;
      const video = opts.video;
      const canvas = opts.canvas;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const now = performance.now();
        const ts = now <= lastTs ? lastTs + 1 : now;
        lastTs = ts;
        const dt = Math.min(50, now - lastFrame);
        lastFrame = now;
        try {
          const bridge = opts.bridge.current;
          if (!bridge.sheetLocked() && probeCtx && probeTick++ % 3 === 0) {
            const long = Math.max(video.videoWidth, video.videoHeight);
            const scale = 240 / long;
            const pw = Math.max(32, Math.round(video.videoWidth * scale));
            const ph = Math.max(32, Math.round(video.videoHeight * scale));
            if (probe.width !== pw || probe.height !== ph) {
              probe.width = pw;
              probe.height = ph;
            }
            probeCtx.drawImage(video, 0, 0, pw, ph);
            const shot = probeCtx.getImageData(0, 0, pw, ph);
            const found = findSheet(shot.data, pw, ph);
            bridge.onSheet(found?.points ?? null);
          }
          const result = landmarker.detectForVideo(video, ts);
          paint(canvas, result.landmarks ?? [], dt, { mem, holders, setDown, live, bridge: opts.bridge });
        } catch {
          /* keep the camera up if a single frame fails */
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return teardown;
  } catch (error) {
    teardown();
    throw error;
  }
}

function paint(
  canvas: HTMLCanvasElement,
  hands: LM[][],
  dt: number,
  ctx: {
    mem: Map<
      string,
      { streak: number; downId: string | null; dwellId: string | null; dwellMs: number; fired: boolean; x: number; y: number }
    >;
    holders: Map<string, number>;
    setDown: (finger: string, keyId: string | null) => void;
    live: (text: string) => void;
    bridge: { current: TrackerBridge };
  },
) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  g.clearRect(0, 0, w, h);
  const b = ctx.bridge.current;
  const toBoard = b.getToBoard();
  const toVideo = b.getToVideo();
  const flags = b.getFlags();
  const lit = b.getLit();
  const hot = new Set<string>();
  const seen = new Set<string>();

  if (toBoard && toVideo) {
    for (let hi = 0; hi < hands.length; hi++) {
      const hand = hands[hi]!;
      for (const finger of FINGERS) {
        const id = `${hi}:${finger.name}`;
        seen.add(id);
        const tip = hand[finger.tip];
        const pip = hand[finger.pip];
        if (!tip || !pip) continue;
        let row = ctx.mem.get(id);
        if (!row) {
          row = { streak: 0, downId: null, dwellId: null, dwellMs: 0, fired: false, x: tip.x, y: tip.y };
          ctx.mem.set(id, row);
        }
        const jump = Math.hypot(tip.x - row.x, tip.y - row.y);
        row.x = tip.x;
        row.y = tip.y;
        const board = applyH(toBoard, { x: tip.x, y: tip.y });
        const key = jump > 0.22 ? null : hitTest(board.x, board.y);
        if (key) hot.add(key.id);
        trackFinger(b, row, id, finger.name, tip, pip, key, dt, ctx.setDown);
      }
    }
  }

  for (const [id, row] of ctx.mem) {
    if (seen.has(id)) continue;
    ctx.setDown(id, null);
    ctx.mem.delete(id);
  }

  if (toVideo) {
    const pressed = new Set(ctx.holders.keys());
    for (const key of KEYS) drawKey(g, key, toVideo, w, h, flags, lit.has(key.id), hot.has(key.id), pressed.has(key.id));
  }

  for (const hand of hands) drawHand(g, hand, w, h);

  const calib = b.getCalib();
  calib.forEach((pt, index) => {
    const x = pt.x * w;
    const y = pt.y * h;
    g.beginPath();
    g.arc(x, y, Math.max(10, w / 90), 0, Math.PI * 2);
    g.strokeStyle = "#e09a3e";
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = "#141311";
    g.font = `600 ${Math.max(14, w / 70)}px "Public Sans", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(index + 1), x, y);
  });

  if (!toBoard) return;
  if (hands.length === 0) {
    ctx.live("Sheet aligned. Bring a hand into the frame.");
    return;
  }
  const names = [...hot].map((id) => KEYS.find((key) => key.id === id)?.label).filter(Boolean);
  ctx.live(names.length ? `Over ${names.join(", ")}` : "Fingertips are off the keys.");
}

function trackFinger(
  b: TrackerBridge,
  row: { streak: number; downId: string | null; dwellId: string | null; dwellMs: number; fired: boolean },
  id: string,
  name: string,
  tip: LM,
  pip: LM,
  key: KeySpec | null,
  dt: number,
  setDown: (finger: string, keyId: string | null) => void,
) {
  if (b.getStyle() === "rest") {
    if (row.downId) setDown(id, null);
    if (!key) {
      row.dwellId = null;
      row.dwellMs = 0;
      row.fired = false;
      return;
    }
    if (row.dwellId !== key.id) {
      row.dwellId = key.id;
      row.dwellMs = 0;
      row.fired = false;
      return;
    }
    row.dwellMs += dt;
    if (!row.fired && row.dwellMs >= 280) {
      b.onEvent(key.id, "down");
      b.onEvent(key.id, "up");
      row.fired = true;
    }
    return;
  }

  const depth = (tip.z ?? 0) - (pip.z ?? 0);
  const thresh = b.getSensitivity() + (name === "thumb" ? 0.02 : 0);
  const margin = 0.012;
  const facing = b.getDirection() === "facing";
  const down = facing ? depth < -thresh : depth > thresh;
  const still = facing ? depth < -(thresh - margin) : depth > thresh - margin;

  if (row.downId && key && key.id === row.downId && still) {
    row.streak = 2;
    return;
  }
  if (down && key) {
    row.streak += 1;
    if (row.streak >= 2) setDown(id, key.id);
    return;
  }
  row.streak = 0;
  setDown(id, null);
}

function drawKey(
  g: CanvasRenderingContext2D,
  key: KeySpec,
  toVideo: number[],
  w: number,
  h: number,
  flags: { numlock: boolean; fn: boolean },
  lit: boolean,
  hot: boolean,
  pressed: boolean,
) {
  const inset = Math.min(key.w, key.h) * 0.08;
  const quad = [
    { x: key.x + inset, y: key.y + inset },
    { x: key.x + key.w - inset, y: key.y + inset },
    { x: key.x + key.w - inset, y: key.y + key.h - inset },
    { x: key.x + inset, y: key.y + key.h - inset },
  ].map((p) => {
    const n = applyH(toVideo, p);
    return { x: n.x * w, y: n.y * h };
  });
  g.beginPath();
  g.moveTo(quad[0]!.x, quad[0]!.y);
  for (let i = 1; i < 4; i++) g.lineTo(quad[i]!.x, quad[i]!.y);
  g.closePath();
  if (pressed || lit) {
    g.fillStyle = pressed ? "rgba(224,154,62,0.78)" : "rgba(224,154,62,0.4)";
    g.fill();
  } else if (hot) {
    g.fillStyle = "rgba(243,239,228,0.16)";
    g.fill();
  }
  g.strokeStyle = pressed || lit || hot ? "#e09a3e" : "rgba(243,239,228,0.8)";
  g.lineWidth = pressed || hot ? Math.max(2, w / 420) : Math.max(1.25, w / 700);
  g.stroke();

  const cx = (quad[0]!.x + quad[1]!.x + quad[2]!.x + quad[3]!.x) / 4;
  const cy = (quad[0]!.y + quad[1]!.y + quad[2]!.y + quad[3]!.y) / 4;
  const kh = (Math.hypot(quad[3]!.x - quad[0]!.x, quad[3]!.y - quad[0]!.y) + Math.hypot(quad[2]!.x - quad[1]!.x, quad[2]!.y - quad[1]!.y)) / 2;
  if (kh < 12) return;
  const label = capLabel(key, flags);
  if (!label) return;
  g.fillStyle = pressed || lit ? "#2a1c08" : "#f3efe4";
  g.font = `600 ${Math.max(9, kh * 0.38)}px "Public Sans", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, cx, cy);
}

function capLabel(key: KeySpec, flags: { numlock: boolean; fn: boolean }): string {
  if (key.kind.t === "num" && !flags.numlock) return key.sub || key.legend;
  if (key.kind.t === "fn" && flags.fn) return key.sub || key.legend;
  return key.legend;
}

function drawHand(g: CanvasRenderingContext2D, hand: LM[], w: number, h: number) {
  g.strokeStyle = "rgba(243,239,228,0.7)";
  g.lineWidth = Math.max(2, w / 520);
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const chain of CHAINS) {
    g.beginPath();
    chain.forEach((index, n) => {
      const p = hand[index];
      if (!p) return;
      const x = p.x * w;
      const y = p.y * h;
      if (n === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
  for (const finger of FINGERS) {
    const tip = hand[finger.tip];
    if (!tip) continue;
    g.beginPath();
    g.arc(tip.x * w, tip.y * h, Math.max(5, w / 180), 0, Math.PI * 2);
    g.fillStyle = "#e09a3e";
    g.fill();
  }
}

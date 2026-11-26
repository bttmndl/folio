import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Copy, SwitchCamera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeySheet } from "@/components/key-sheet";
import {
  createEditor,
  insertPlain,
  modOn,
  pushUndo,
  redo,
  reduceKey,
  repeats,
  undo,
  type EditorState,
  type Fx,
  type Phase,
} from "@/lib/editor";
import { startHandLoop, type PressDirection, type PressStyle, type TrackerBridge } from "@/lib/hand-loop";
import { solveHomography, type Pt } from "@/lib/homography";
import { KEY_BOUNDS, KEYS, keyById, type KeySpec } from "@/lib/keyboard-layout";
import { cn } from "@/lib/cn";

const STORE = "folio-v1";

type Save = {
  value?: string;
  anchor?: number;
  focus?: number;
  caps?: boolean;
  numlock?: boolean;
  muted?: boolean;
};

export function Studio() {
  const [mode, setMode] = useState<"home" | "camera">("home");
  const [engine, setEngine] = useState<EditorState>(createEditor);
  const [calib, setCalib] = useState<Pt[]>([]);
  const [mirror, setMirror] = useState(true);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [sense] = useState(0.02);
  const [direction] = useState<PressDirection>("above");
  const [style] = useState<PressStyle>("tap");
  const [muted, setMuted] = useState(false);
  const [live, setLive] = useState("Looking for the keyboard.");
  const [camError, setCamError] = useState<string | null>(null);
  const [camLoading, setCamLoading] = useState(false);
  const [camAttempt, setCamAttempt] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const editorRef = useRef(engine);
  const modeRef = useRef(mode);
  const repeatsRef = useRef(new Map<string, number>());
  const audioRef = useRef({
    volume: 0.7,
    muted: false,
    ctx: null as AudioContext | null,
    gain: null as GainNode | null,
  });
  const calibRef = useRef(calib);
  const watchRef = useRef<{ streak: number; pts: Pt[] | null }>({ streak: 0, pts: null });
  editorRef.current = engine;
  modeRef.current = mode;
  audioRef.current.muted = muted;
  calibRef.current = calib;

  const alignment = useMemo(() => {
    if (calib.length !== 4) return null;
    try {
      return {
        toBoard: solveHomography(calib, KEY_BOUNDS),
        toVideo: solveHomography(KEY_BOUNDS, calib),
      };
    } catch {
      return null;
    }
  }, [calib]);

  const bridgeRef = useRef<TrackerBridge>({
    getToBoard: () => null,
    getToVideo: () => null,
    getSensitivity: () => 0.02,
    getDirection: () => "above",
    getStyle: () => "tap",
    getLit: () => new Set(),
    getFlags: () => ({ numlock: true, fn: false }),
    getCalib: () => [],
    onLive: () => {},
    onEvent: () => {},
    onSheet: () => {},
    sheetLocked: () => false,
  });

  bridgeRef.current = {
    getToBoard: () => alignment?.toBoard ?? null,
    getToVideo: () => alignment?.toVideo ?? null,
    getSensitivity: () => sense,
    getDirection: () => direction,
    getStyle: () => style,
    getLit: () => new Set(KEYS.filter((key) => keyIsOn(editorRef.current, key)).map((key) => key.id)),
    getFlags: () => ({ numlock: editorRef.current.numlock, fn: modOn(editorRef.current, "fn") }),
    getCalib: () => calib,
    onLive: (text) => setLive(text),
    onEvent: (id, phase) => emit(id, phase),
    onSheet: (points) => {
      if (calibRef.current.length === 4) return;
      const watch = watchRef.current;
      if (!points) {
        watch.streak = 0;
        watch.pts = null;
        return;
      }
      const prev = watch.pts;
      const near =
        prev !== null &&
        points.every((point, index) => {
          const before = prev[index];
          return before ? Math.hypot(point.x - before.x, point.y - before.y) < 0.045 : false;
        });
      watch.pts = points;
      watch.streak = near ? watch.streak + 1 : 1;
      if (watch.streak >= 4) {
        try {
          solveHomography(points, KEY_BOUNDS);
          setCalib(points);
        } catch {
          watch.streak = 0;
        }
      }
    },
    sheetLocked: () => calibRef.current.length === 4,
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as Save;
        setEngine((current) => ({
          ...current,
          value: typeof saved.value === "string" ? saved.value : current.value,
          anchor: typeof saved.anchor === "number" ? saved.anchor : 0,
          focus: typeof saved.focus === "number" ? saved.focus : 0,
          caps: Boolean(saved.caps),
          numlock: saved.numlock !== false,
        }));
        if (typeof saved.muted === "boolean") setMuted(saved.muted);
      }
    } catch {
      /* ignore a broken save */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const handle = window.setTimeout(() => {
      const payload: Save = {
        value: engine.value,
        anchor: engine.anchor,
        focus: engine.focus,
        caps: engine.caps,
        numlock: engine.numlock,
        muted,
      };
      localStorage.setItem(STORE, JSON.stringify(payload));
    }, 280);
    return () => window.clearTimeout(handle);
  }, [hydrated, engine.value, engine.anchor, engine.focus, engine.caps, engine.numlock, muted]);

  useEffect(() => {
    const el = docRef.current;
    if (!el) return;
    const start = Math.min(engine.anchor, engine.focus);
    const end = Math.max(engine.anchor, engine.focus);
    if (el.selectionStart === start && el.selectionEnd === end) return;
    el.setSelectionRange(start, end, engine.focus >= engine.anchor ? "forward" : "backward");
  }, [engine.anchor, engine.focus, engine.value]);

  useEffect(() => {
    if (mode !== "camera") return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let stopped = false;
    let stop = () => {};
    setCamError(null);
    setCamLoading(true);
    startHandLoop({ video, canvas, facing, bridge: bridgeRef })
      .then((cleanup) => {
        if (stopped) cleanup();
        else {
          stop = cleanup;
          setCamLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (stopped) return;
        setCamLoading(false);
        setCamError(cameraMessage(error));
      });
    return () => {
      stopped = true;
      stop();
      setCamLoading(false);
    };
  }, [mode, facing, camAttempt]);

  useEffect(() => {
    const timers = repeatsRef.current;
    return () => {
      for (const id of timers.values()) window.clearTimeout(id);
      timers.clear();
    };
  }, []);

  function primeAudio() {
    const audio = audioRef.current;
    if (!audio.ctx) {
      audio.ctx = new AudioContext();
      audio.gain = audio.ctx.createGain();
      audio.gain.connect(audio.ctx.destination);
    }
    if (!audio.gain) return;
    audio.gain.gain.value = audio.muted ? 0 : audio.volume;
    if (audio.ctx.state === "suspended") void audio.ctx.resume();
  }

  function play(tone: "key" | "mod") {
    const audio = audioRef.current;
    if (audio.muted || !audio.ctx || !audio.gain) return;
    const osc = audio.ctx.createOscillator();
    const filter = audio.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = tone === "key" ? 210 : 146;
    osc.connect(filter);
    filter.connect(audio.gain);
    const t = audio.ctx.currentTime;
    filter.gain.setValueAtTime(0.0001, t);
    filter.gain.exponentialRampToValueAtTime(tone === "key" ? 0.09 : 0.05, t + 0.004);
    filter.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);
    osc.start(t);
    osc.stop(t + 0.036);
  }

  function runFx(effect: Fx) {
    if (effect.t === "click") play(effect.tone);
    if (effect.t === "vol") {
      const audio = audioRef.current;
      audio.volume = clamp(audio.volume + effect.delta, 0.08, 1);
      if (audio.gain && !audio.muted) audio.gain.gain.value = audio.volume;
      setEngine((state) => ({ ...state, chord: `Volume ${Math.round(audio.volume * 100)}` }));
    }
    if (effect.t === "mute") {
      setMuted((value) => {
        const next = !value;
        const audio = audioRef.current;
        if (audio.gain) audio.gain.gain.value = next ? 0 : audio.volume;
        return next;
      });
    }
    if (effect.t === "copy") {
      if (!effect.text) return;
      void navigator.clipboard.writeText(effect.text).catch(() => {
        setEngine((state) => ({ ...state, chord: "Copy blocked" }));
      });
    }
    if (effect.t === "paste") {
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text) setEngine((state) => insertPlain(state, text));
        })
        .catch(() => setEngine((state) => ({ ...state, chord: "Paste blocked" })));
    }
    if (effect.t === "focus") docRef.current?.focus({ preventScroll: true });
    if (effect.t === "fullscreen") {
      const node = stageRef.current;
      if (!node) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void node.requestFullscreen().catch(() => {});
    }
  }

  function apply(key: KeySpec, phase: Phase) {
    const now = performance.now();
    const result = reduceKey(editorRef.current, key, phase, now);
    editorRef.current = result.state;
    setEngine(result.state);
    for (const effect of result.fx) runFx(effect);
  }

  function clearRepeat(id: string) {
    const wait = repeatsRef.current.get(id);
    const tick = repeatsRef.current.get(`${id}:tick`);
    if (wait) window.clearTimeout(wait);
    if (tick) window.clearInterval(tick);
    repeatsRef.current.delete(id);
    repeatsRef.current.delete(`${id}:tick`);
  }

  function emit(id: string, phase: "down" | "up") {
    const key = keyById(id);
    if (!key) return;
    primeAudio();
    if (phase === "down") {
      if (modeRef.current !== "camera") docRef.current?.focus({ preventScroll: true });
      apply(key, "down");
      if (!repeats(key)) return;
      const wait = window.setTimeout(() => {
        const tick = window.setInterval(() => apply(key, "repeat"), 48);
        repeatsRef.current.set(`${id}:tick`, tick);
      }, 420);
      repeatsRef.current.set(id, wait);
      return;
    }
    clearRepeat(id);
    apply(key, "up");
  }

  function openCamera() {
    primeAudio();
    watchRef.current = { streak: 0, pts: null };
    setCalib([]);
    setCamError(null);
    setLive("Looking for the keyboard.");
    setMode("camera");
  }

  function flipCamera() {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    setMirror(next === "user");
    watchRef.current = { streak: 0, pts: null };
    setCalib([]);
    setCamError(null);
    setLive("Looking for the keyboard.");
  }

  function closeCamera() {
    setMode("home");
    setCalib([]);
    watchRef.current = { streak: 0, pts: null };
  }

  const found = calib.length === 4 && Boolean(alignment);
  const status = camError
    ? camError
    : camLoading
      ? facing === "user"
        ? "Opening the front camera…"
        : "Opening the back camera…"
      : found
        ? live
        : "Looking for the keyboard.";

  return (
    <main className="bg-ink text-paper" onPointerDown={primeAudio}>
      {mode === "home" ? (
        <section className="home-stage">
          <h1 className="sr-only">Folio</h1>
          <button type="button" className="tap-camera" onClick={openCamera}>
            <Camera className="tap-camera-icon" aria-hidden />
            <span>Tap camera</span>
          </button>
        </section>
      ) : (
        <section ref={stageRef} className="cam-stage">
          <div className={cn("absolute inset-0", mirror && "mirror-x")}>
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              playsInline
              muted
              autoPlay
            />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          </div>
          <button type="button" className="cam-close" onClick={closeCamera} aria-label="Close camera">
            <X className="size-5" aria-hidden />
          </button>
          <button type="button" className="cam-flip" onClick={flipCamera} aria-label="Switch camera">
            <SwitchCamera className="size-5" aria-hidden />
            {facing === "user" ? "Front" : "Back"}
          </button>
          {camError ? (
            <div className="cam-status">
              <p className="max-w-xs text-sm leading-relaxed">{camError}</p>
              <Button variant="solid" onClick={() => setCamAttempt((n) => n + 1)}>
                Try again
              </Button>
            </div>
          ) : found ? (
            <p className="cam-live" aria-live="polite">
              {status}
            </p>
          ) : (
            <div className="cam-status">
              <p className="font-display text-4xl leading-none">Looking for the keyboard</p>
              <p className="max-w-xs text-sm leading-relaxed text-mist">Hold the printed sheet in front of the camera.</p>
            </div>
          )}
          {found ? (
            <div className="cam-doc">
              <textarea
                ref={docRef}
                className="doc min-h-28 w-full"
                value={engine.value}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="Typed keys land here."
                aria-label="Document"
                onChange={(event) => {
                  const el = event.target;
                  const caret = caretFrom(el);
                  setEngine((state) => ({ ...state, value: el.value, anchor: caret.anchor, focus: caret.focus }));
                }}
                onSelect={(event) => {
                  const el = event.currentTarget;
                  if (el.value !== engine.value) return;
                  const caret = caretFrom(el);
                  setEngine((state) =>
                    state.anchor === caret.anchor && state.focus === caret.focus ? state : { ...state, ...caret },
                  );
                }}
                onKeyDown={(event) => {
                  const key = event.key;
                  if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "Z")) {
                    event.preventDefault();
                    setEngine((state) => (event.shiftKey ? redo(state) : undo(state)));
                    return;
                  }
                  if ((event.ctrlKey || event.metaKey) && (key === "y" || key === "Y")) {
                    event.preventDefault();
                    setEngine((state) => redo(state));
                    return;
                  }
                  if (key === "Tab") {
                    event.preventDefault();
                    setEngine((state) => insertPlain(state, "\t"));
                    return;
                  }
                  const types =
                    key === "Backspace" ||
                    key === "Delete" ||
                    key === "Enter" ||
                    (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey);
                  if (types) setEngine((state) => pushUndo(state));
                }}
              />
              <div className="mt-2 flex items-center">
                <Button size="sm" variant="line" onClick={() => copyAll(engine.value, setEngine)}>
                  <Copy className="size-4" aria-hidden />
                  Copy
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      )}
      <div id="folio-sheet" className="print-sheet">
        <KeySheet tone="print" interactive={false} numlock fnOn={false} />
      </div>
    </main>
  );
}

function keyIsOn(state: EditorState, key: KeySpec): boolean {
  if (key.kind.t === "mod") return state.sticky[key.kind.mod] || state.held.includes(key.id);
  if (key.kind.t === "lock" && key.kind.lock === "caps") return state.caps;
  if (key.kind.t === "lock" && key.kind.lock === "numlock") return state.numlock;
  if (key.kind.t === "lock" && key.kind.lock === "insert") return state.overtype;
  return state.held.includes(key.id);
}

function caretFrom(el: HTMLTextAreaElement) {
  const dir = el.selectionDirection;
  if (dir === "backward") return { anchor: el.selectionEnd ?? 0, focus: el.selectionStart ?? 0 };
  return { anchor: el.selectionStart ?? 0, focus: el.selectionEnd ?? 0 };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function cameraMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission is blocked. Allow the camera for this page, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No front camera is available.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "The camera didn't start.";
}

function copyAll(value: string, setEngine: (update: (state: EditorState) => EditorState) => void) {
  if (!value) {
    setEngine((state) => ({ ...state, chord: "Nothing to copy" }));
    return;
  }
  void navigator.clipboard.writeText(value).then(
    () => setEngine((state) => ({ ...state, chord: "Copied" })),
    () => setEngine((state) => ({ ...state, chord: "Copy blocked" })),
  );
}

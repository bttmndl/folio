import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Copy, Keyboard, Printer, Redo2, Trash2, Undo2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeySheet } from "@/components/key-sheet";
import {
  createEditor,
  insertPlain,
  modHeld,
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
import { solveHomography } from "@/lib/homography";
import { CORNERS, KEYS, keyById, type KeySpec, type ModName } from "@/lib/keyboard-layout";
import { clientToVideoNorm } from "@/lib/video-map";
import { cn } from "@/lib/cn";

const STORE = "folio-v1";
const STEPS = [
  "Tap printed cross 1 — top left of the sheet.",
  "Tap cross 2 — top right.",
  "Tap cross 3 — bottom right.",
  "Tap cross 4 — bottom left.",
];

type Save = {
  value?: string;
  anchor?: number;
  focus?: number;
  caps?: boolean;
  numlock?: boolean;
  calib?: { x: number; y: number }[];
  mirror?: boolean;
  facing?: "user" | "environment";
  sense?: number;
  direction?: PressDirection;
  style?: PressStyle;
  muted?: boolean;
};

export function Studio() {
  const [mode, setMode] = useState<"sheet" | "camera">("sheet");
  const [engine, setEngine] = useState<EditorState>(createEditor);
  const [calib, setCalib] = useState<{ x: number; y: number }[]>([]);
  const [mirror, setMirror] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [sense, setSense] = useState(0.02);
  const [direction, setDirection] = useState<PressDirection>("above");
  const [style, setStyle] = useState<PressStyle>("tap");
  const [muted, setMuted] = useState(false);
  const [live, setLive] = useState("Align the sheet to start typing.");
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
  editorRef.current = engine;
  modeRef.current = mode;
  audioRef.current.muted = muted;

  const alignment = useMemo(() => {
    if (calib.length !== 4) return null;
    try {
      return {
        toBoard: solveHomography(calib, CORNERS),
        toVideo: solveHomography(CORNERS, calib),
      };
    } catch {
      return null;
    }
  }, [calib]);
  const alignFailed = calib.length === 4 && !alignment;

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
        if (Array.isArray(saved.calib) && saved.calib.length === 4 && saved.calib.every(isPoint)) {
          setCalib(saved.calib);
        }
        if (typeof saved.mirror === "boolean") setMirror(saved.mirror);
        if (saved.facing === "user" || saved.facing === "environment") setFacing(saved.facing);
        if (typeof saved.sense === "number") setSense(clamp(saved.sense, 0.004, 0.08));
        if (saved.direction === "above" || saved.direction === "facing") setDirection(saved.direction);
        if (saved.style === "tap" || saved.style === "rest") setStyle(saved.style);
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
        calib,
        mirror,
        facing,
        sense,
        direction,
        style,
        muted,
      };
      localStorage.setItem(STORE, JSON.stringify(payload));
    }, 280);
    return () => window.clearTimeout(handle);
  }, [
    hydrated,
    engine.value,
    engine.anchor,
    engine.focus,
    engine.caps,
    engine.numlock,
    calib,
    mirror,
    facing,
    sense,
    direction,
    style,
    muted,
  ]);

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

  function addCorner(event: React.PointerEvent<HTMLButtonElement>) {
    const video = videoRef.current;
    if (!video) return;
    const point = clientToVideoNorm(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
      video.videoWidth,
      video.videoHeight,
      mirror,
    );
    if (!point) return;
    setCalib((points) => (points.length >= 4 ? points : [...points, point]));
  }

  const banner =
    camError ??
    (alignFailed
      ? "Those four taps don't sit on a flat sheet. Reset and tap crosses 1–4 again."
      : camLoading
        ? "Opening the camera and loading hand tracking…"
        : calib.length < 4
          ? (STEPS[calib.length] ?? STEPS[0])
          : live);

  const words = engine.value.trim() ? engine.value.trim().split(/\s+/).length : 0;
  const chips = (["shift", "ctrl", "alt", "meta", "fn"] as ModName[]).filter(
    (mod) => engine.sticky[mod] || modHeld(engine, mod),
  );

  return (
    <main className="app-shell bg-ink text-paper" onPointerDown={primeAudio}>
      <header className="no-print flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="mr-auto min-w-0">
          <h1 className="font-display text-3xl leading-none">Folio</h1>
          <p className="mt-1 text-xs tracking-wide text-mist uppercase">Full-size laptop sheet</p>
        </div>
        <div className="flex rounded-full border border-line bg-graphite p-1" role="tablist" aria-label="Input">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sheet"}
            className={cn(
              "inline-flex h-11 items-center rounded-full px-4 text-sm",
              mode === "sheet" ? "bg-brass text-brass-ink" : "text-paper",
            )}
            onClick={() => setMode("sheet")}
          >
            <Keyboard className="mr-2 size-4" aria-hidden />
            Sheet
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "camera"}
            className={cn(
              "inline-flex h-11 items-center rounded-full px-4 text-sm",
              mode === "camera" ? "bg-brass text-brass-ink" : "text-paper",
            )}
            onClick={() => setMode("camera")}
          >
            <Camera className="mr-2 size-4" aria-hidden />
            Camera
          </button>
        </div>
        <Button variant="line" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print
        </Button>
      </header>

      <div className="no-print studio">
        <section ref={stageRef} className="pane flex min-h-96 flex-col border-b border-line lg:border-r lg:border-b-0">
          {mode === "sheet" ? (
            <div className="sheet-scroll-wrap">
              <div className="sheet-scroll">
                <p className="mb-4 max-w-3xl text-sm leading-relaxed text-mist">
                  This is a full laptop deck: function row, navigation cluster, number pad, and Fn — not a phone keypad.
                  Tap the caps here, or print the sheet, lay it flat, and switch to Camera.
                </p>
                <KeySheet
                  tone="desk"
                  interactive
                  numlock={engine.numlock}
                  fnOn={modOn(engine, "fn")}
                  isOn={(key) => keyIsOn(engine, key)}
                  onPhase={(key, phase) => emit(key.id, phase)}
                />
                <p className="mt-3 text-sm text-mist">
                  On a phone, slide sideways to reach the number pad. Crosses 1–4 are what the camera asks you to tap.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-96 flex-1 flex-col">
              <div className="relative min-h-72 flex-1 bg-ink">
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
                {!camError && !camLoading && calib.length < 4 ? (
                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-crosshair"
                    aria-label="Mark the next printed cross"
                    onPointerDown={addCorner}
                  />
                ) : null}
                {camError ? (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink/80 px-6 text-center">
                    <p className="max-w-sm text-sm leading-relaxed">{camError}</p>
                    <Button variant="solid" onClick={() => setCamAttempt((n) => n + 1)}>
                      Try camera again
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
                <p className="text-sm leading-relaxed text-paper">{banner}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant={mirror ? "solid" : "line"} onClick={() => setMirror((value) => !value)}>
                    {mirror ? "Mirrored" : "Mirror off"}
                  </Button>
                  <Button
                    size="sm"
                    variant="line"
                    onClick={() => setFacing((value) => (value === "environment" ? "user" : "environment"))}
                  >
                    {facing === "environment" ? "Rear camera" : "Front camera"}
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setCalib((points) => points.slice(0, -1))}
                    disabled={!calib.length}
                  >
                    Undo cross
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setCalib([])} disabled={!calib.length}>
                    Reset
                  </Button>
                </div>
                <details className="text-sm text-mist">
                  <summary className="cursor-pointer text-paper">How a press is detected</summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={direction === "above" ? "solid" : "line"}
                        onClick={() => setDirection("above")}
                      >
                        Camera above the sheet
                      </Button>
                      <Button
                        size="sm"
                        variant={direction === "facing" ? "solid" : "line"}
                        onClick={() => setDirection("facing")}
                      >
                        Camera facing the sheet
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={style === "tap" ? "solid" : "line"} onClick={() => setStyle("tap")}>
                        Depth tap
                      </Button>
                      <Button size="sm" variant={style === "rest" ? "solid" : "line"} onClick={() => setStyle("rest")}>
                        Rest to type
                      </Button>
                    </div>
                    <label className="flex items-center gap-3 text-paper">
                      Press depth
                      <input
                        className="depth"
                        type="range"
                        min={0.004}
                        max={0.08}
                        step={0.002}
                        value={sense}
                        onChange={(event) => setSense(Number(event.target.value))}
                      />
                      <span className="text-mist tabular-nums">{sense.toFixed(3)}</span>
                    </label>
                    <p>
                      Prop the whole printed sheet in frame. Depth tap fires when a fingertip pushes into the paper. If
                      taps miss, lower press depth. Rest mode types when a fingertip stays on a key.
                    </p>
                  </div>
                </details>
              </div>
            </div>
          )}
        </section>

        <aside className="pane flex flex-col gap-3 px-4 py-4 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl leading-none">Document</h2>
            <p className="text-xs tracking-wide text-mist uppercase tabular-nums" aria-live="polite">
              {engine.chord}
            </p>
          </div>
          <p className="text-sm text-mist">
            Try: <span className="text-paper">The quick brown fox jumps over the lazy dog.</span>
          </p>
          {chips.length || engine.caps ? (
            <div className="flex flex-wrap gap-2">
              {engine.caps ? (
                <button
                  type="button"
                  className="h-9 rounded-full bg-brass px-3 text-sm text-brass-ink"
                  onClick={() => setEngine((s) => ({ ...s, caps: false, chord: "Caps off" }))}
                >
                  Caps
                </button>
              ) : null}
              {chips.map((mod) => (
                <button
                  key={mod}
                  type="button"
                  className="h-9 rounded-full bg-brass px-3 text-sm text-brass-ink"
                  onClick={() =>
                    setEngine((s) => ({
                      ...s,
                      sticky: { ...s.sticky, [mod]: false },
                      chord: `${chipLabel(mod)} off`,
                    }))
                  }
                >
                  {chipLabel(mod)}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={docRef}
            className="doc min-h-64 w-full flex-1"
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
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="line" onClick={() => copyAll(engine.value, setEngine)}>
              <Copy className="size-4" aria-hidden />
              Copy
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() =>
                setEngine((state) =>
                  state.value
                    ? {
                        ...state,
                        undo: [
                          { value: state.value, anchor: state.anchor, focus: state.focus },
                          ...state.undo,
                        ].slice(0, 100),
                        redo: [],
                        value: "",
                        anchor: 0,
                        focus: 0,
                        chord: "Cleared",
                      }
                    : state,
                )
              }
            >
              <Trash2 className="size-4" aria-hidden />
              Clear
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setEngine((state) => undo(state))} disabled={!engine.undo.length}>
              <Undo2 className="size-4" aria-hidden />
              Undo
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setEngine((state) => redo(state))} disabled={!engine.redo.length}>
              <Redo2 className="size-4" aria-hidden />
              Redo
            </Button>
            <Button
              size="sm"
              variant={muted ? "solid" : "quiet"}
              aria-pressed={muted}
              onClick={() => {
                primeAudio();
                setMuted((value) => {
                  const next = !value;
                  const audio = audioRef.current;
                  if (audio.gain) audio.gain.gain.value = next ? 0 : audio.volume;
                  return next;
                });
              }}
            >
              {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
              {muted ? "Sound off" : "Sound"}
            </Button>
            <p className="ml-auto text-xs text-mist tabular-nums">
              {words} {words === 1 ? "word" : "words"}
            </p>
          </div>
          <p className="text-sm leading-relaxed text-mist">
            Tap Shift once for the next character, or hold it. Esc clears stuck modifiers. Fn plus F12 copies the
            document.
          </p>
        </aside>
      </div>

      <div id="folio-sheet" className="print-sheet">
        <p className="font-display text-3xl text-ink">Folio laptop sheet</p>
        <p className="mt-1 mb-3 text-sm text-ink">
          Full-size layout. Print landscape. In the camera, tap crosses 1, 2, 3, then 4.
        </p>
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

function chipLabel(mod: ModName): string {
  if (mod === "meta") return "Win";
  if (mod === "fn") return "Fn";
  if (mod === "ctrl") return "Ctrl";
  if (mod === "alt") return "Alt";
  return "Shift";
}

function caretFrom(el: HTMLTextAreaElement) {
  const dir = el.selectionDirection;
  if (dir === "backward") return { anchor: el.selectionEnd ?? 0, focus: el.selectionStart ?? 0 };
  return { anchor: el.selectionStart ?? 0, focus: el.selectionEnd ?? 0 };
}

function isPoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === "number" && typeof point.y === "number";
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
    return "No camera is available. You can still type on the sheet.";
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

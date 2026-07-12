// src/state/codec — the versioned URL / preset codec (DESIGN.md §6 save/share).
//
// A ShareConfig is the full shareable configuration: the pattern, every slider,
// the hand geometry, the view toggles, the audio settings, and the camera. It is
// encoded into a compact, versioned query string (`v=1&...`) and decoded back with
// graceful degradation — an unknown or malformed parameter is ignored, never a
// crash (DESIGN.md §6: "never crash on a bad URL"). The same payload is what the
// localStorage presets and the JSON export/import round-trip.
//
// This module is PURE (no store, no window, no core-timeline import) so the
// round-trip is a fast-check property test (encode → decode = identity to codec
// precision, PLAN.md Phase 9). URL assembly (origin + pathname) and store
// application live in the state store, which structurally implements
// {@link ConfigSource}; the codec never imports the store (no cycle).

/** A camera placement (structurally identical to render3d's CameraView). */
export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

/** A hand catch/throw point in the horizontal plane (y is fixed at HAND_Y). */
export interface PlanarPoint {
  readonly x: number;
  readonly z: number;
}

/** The carry-path kinds the codec knows (mirrors state's CarryPathKind). */
export type CarryPathKindCode = 'quintic' | 'cubic';
/** The hand-geometry presets (mirrors state's HandPreset). */
export type HandPresetCode = 'line' | 'circle';
/** The chart axis modes (mirrors state's ChartAxisMode). */
export type ChartAxisModeCode = 'magnitude' | 'x' | 'y' | 'z';
/** The bottom-dock tri-state (mirrors state's DockMode). */
export type DockModeCode = 'none' | 'charts' | 'explorer';

/** The workspace shape kinds (mirrors workspace's WorkspaceShapeKind). */
export type WorkspaceShapeKindCode = 'sphere' | 'cube' | 'tetra' | 'stl';

/** Per-axis workspace half-extents in the display frame (mirrors WorkspaceScale). */
export interface WorkspaceScaleCode {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The codec-visible workspace spec (orchestrator ruling 4): the shared bounding
 * volume's shape kind, per-axis display-frame scale, and enabled flag. Primitives
 * round-trip losslessly; an 'stl' kind is NOT persisted — it encodes with enabled
 * forced off, so on share/reload it degrades to a disabled STL workspace (the store
 * surfaces a "re-upload the mesh" note). Geometry never enters the URL.
 */
export interface WorkspaceConfigCode {
  readonly kind: WorkspaceShapeKindCode;
  readonly scale: WorkspaceScaleCode;
  readonly enabled: boolean;
}

/**
 * The full shareable configuration (DESIGN.md §6: pattern, all sliders,
 * positions, toggles, camera — plus audio). Field names match the store so
 * mapping is mechanical.
 */
export interface ShareConfig {
  readonly pattern: string;
  readonly beatPeriod: number;
  readonly dwellTime: number;
  readonly playbackSpeed: number;
  readonly gravity: number;
  readonly holdDepth: number;
  readonly carryPathKind: CarryPathKindCode;
  readonly handCount: number;
  readonly handPreset: HandPresetCode;
  readonly handThrowPoints: readonly PlanarPoint[];
  readonly handCatchPoints: readonly PlanarPoint[];
  readonly ballRadius: number;
  readonly ballColor: string;
  readonly orbitColoring: boolean;
  readonly showHands: boolean;
  readonly showHandPaths: boolean;
  readonly timelineWindow: number;
  readonly trailLength: number;
  readonly ghostsEnabled: boolean;
  readonly chartsVisible: boolean;
  /**
   * The bottom dock's tri-state (codec key `dm`; orchestrator ruling 2026-07-11).
   * Optional so old `v=1` links without it still decode — a `cv`-only link maps to
   * 'charts'/'none' at apply time (backward compatible). When present it wins.
   */
  readonly dockMode?: DockModeCode;
  readonly chartAxisMode: ChartAxisModeCode;
  readonly graphMaxHeight: number;
  readonly graphVisible: boolean;
  readonly graphThrowLabels: boolean;
  readonly audioEnabled: boolean;
  readonly catchTickEnabled: boolean;
  readonly audioVolume: number;
  readonly camera: CameraPose;
  /**
   * Optional playhead time bookmark in seconds (owner-approved 2026-07-11, codec
   * key `t`, ~3 decimals). When present, loading the config seeks the clock here;
   * when absent the scene loads at t = 0. Optional so old `v=1` links without it
   * still decode (backward compatible) and the round-trip stays lossless.
   */
  readonly time?: number;
  /**
   * Optional hand-workspace spec (owner feature 2026-07-11, codec keys `ws*`).
   * Optional so old `v=1` links without it still decode and the shared round-trip
   * stays lossless when it is absent. Primitives round-trip exactly; an 'stl' kind
   * degrades to a disabled STL on reload (its geometry never travels in the URL).
   */
  readonly workspace?: WorkspaceConfigCode;
  /**
   * Optional work & power table collapsed flag (owner request 2026-07-12, codec
   * key `wt`). Default is false (table visible); the key is emitted ONLY when
   * true, so a link with the default layout is byte-for-byte unchanged by this
   * field's introduction. Absent decodes to undefined — the store applies its own
   * false default (DESIGN.md §6: graceful, backward-compatible decoding).
   */
  readonly workTableCollapsed?: boolean;
}

/** The current codec version. Bump only with a decode migration (never silently). */
export const CODEC_VERSION = '1';

/**
 * Trail-length ceiling the decode clamps to (owner override 2026-07-11: the app max
 * dropped 8 s → 2 s). An OLD shared link still carries its larger `tl`; decode caps
 * it here so a pre-2026-07-11 link loads as a 2 s trail. Mirrors state's
 * `TRAIL_LENGTH_MAX` — the codec stays store-free (a stated invariant of this
 * module), so the value is duplicated deliberately and pinned equal by a drift-guard
 * test in codec.test.ts. The store re-clamps on apply too (belt-and-suspenders, as
 * with the `t` bookmark's ≥ 0 clamp below); this keeps the decoded partial in range.
 */
const TRAIL_LENGTH_MAX_DECODE = 2;

/** Fixed-precision float encoding (4 dp): stable, compact, round-trips cleanly. */
const FLOAT_DECIMALS = 4;

function fixed(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return String(Number(value.toFixed(FLOAT_DECIMALS)));
}

/** Playhead-time precision (3 dp): a time bookmark needs ~ms, not sub-µs. */
const TIME_DECIMALS = 3;

function fixedTime(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return String(Number(value.toFixed(TIME_DECIMALS)));
}

/** Parse a finite number, or null when absent/malformed (graceful ignore). */
function parseNum(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseBool(raw: string | null): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** Encode a planar-point list as a flat `x0,z0,x1,z1,...` string. */
function encodePoints(points: readonly PlanarPoint[]): string {
  const parts: string[] = [];
  for (const point of points) {
    parts.push(fixed(point.x), fixed(point.z));
  }
  return parts.join(',');
}

/** Decode a flat `x0,z0,...` string into planar points; null on any bad token. */
function decodePoints(raw: string | null): PlanarPoint[] | null {
  if (raw === null || raw === '') {
    return null;
  }
  const tokens = raw.split(',');
  if (tokens.length === 0 || tokens.length % 2 !== 0) {
    return null;
  }
  const points: PlanarPoint[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const x = parseNum(tokens[i] ?? null);
    const z = parseNum(tokens[i + 1] ?? null);
    if (x === null || z === null) {
      return null;
    }
    points.push({ x, z });
  }
  return points;
}

const CARRY_TO_CODE: Record<CarryPathKindCode, string> = { quintic: 'q', cubic: 'c' };
const CODE_TO_CARRY: Record<string, CarryPathKindCode> = { q: 'quintic', c: 'cubic' };
const PRESET_TO_CODE: Record<HandPresetCode, string> = { line: 'l', circle: 'c' };
const CODE_TO_PRESET: Record<string, HandPresetCode> = { l: 'line', c: 'circle' };
const AXIS_CODES: readonly ChartAxisModeCode[] = ['magnitude', 'x', 'y', 'z'];
const AXIS_TO_CODE: Record<ChartAxisModeCode, string> = { magnitude: 'm', x: 'x', y: 'y', z: 'z' };
const CODE_TO_AXIS: Record<string, ChartAxisModeCode> = { m: 'magnitude', x: 'x', y: 'y', z: 'z' };
const DOCK_TO_CODE: Record<DockModeCode, string> = { none: 'n', charts: 'c', explorer: 'x' };
const CODE_TO_DOCK: Record<string, DockModeCode> = { n: 'none', c: 'charts', x: 'explorer' };
// Workspace shape kind codes (stl = 'x' so it never collides with a primitive).
const WORKSPACE_TO_CODE: Record<WorkspaceShapeKindCode, string> = {
  sphere: 's',
  cube: 'b',
  tetra: 't',
  stl: 'x',
};
const CODE_TO_WORKSPACE: Record<string, WorkspaceShapeKindCode> = {
  s: 'sphere',
  b: 'cube',
  t: 'tetra',
  x: 'stl',
};

/** Normalize a CSS color to `#rrggbb`, or null when it is not a 6-digit hex. */
function normalizeHex(raw: string): string | null {
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex.toLowerCase()}`;
  }
  return null;
}

/**
 * Encode a full ShareConfig into a versioned query string (no leading `?`).
 * Keys are short and stable; floats are fixed-precision. Built through
 * URLSearchParams so every value is correctly percent-encoded.
 */
export function encodeConfig(config: ShareConfig): string {
  const params = new URLSearchParams();
  params.set('v', CODEC_VERSION);
  params.set('p', config.pattern);
  params.set('bp', fixed(config.beatPeriod));
  params.set('dw', fixed(config.dwellTime));
  params.set('ps', fixed(config.playbackSpeed));
  params.set('g', fixed(config.gravity));
  params.set('hd', fixed(config.holdDepth));
  params.set('cy', CARRY_TO_CODE[config.carryPathKind]);
  params.set('nh', String(config.handCount));
  params.set('pr', PRESET_TO_CODE[config.handPreset]);
  params.set('tp', encodePoints(config.handThrowPoints));
  params.set('ct', encodePoints(config.handCatchPoints));
  params.set('br', fixed(config.ballRadius));
  params.set('bc', config.ballColor.replace('#', ''));
  params.set('oc', config.orbitColoring ? '1' : '0');
  params.set('sh', config.showHands ? '1' : '0');
  params.set('hp', config.showHandPaths ? '1' : '0');
  params.set('tw', fixed(config.timelineWindow));
  params.set('tl', fixed(config.trailLength));
  params.set('gh', config.ghostsEnabled ? '1' : '0');
  // `cv` (legacy boolean) stays for backward compatibility; `dm` carries the full
  // tri-state and wins on decode when present (orchestrator ruling 2026-07-11).
  // `dm` is ALWAYS emitted, deriving from chartsVisible when dockMode is absent —
  // the same derivation decode applies to legacy cv-only links — so encode→decode
  // →encode is stable (idempotence property).
  params.set('cv', config.chartsVisible ? '1' : '0');
  const dockMode =
    config.dockMode !== undefined && config.dockMode in DOCK_TO_CODE
      ? config.dockMode
      : config.chartsVisible
        ? 'charts'
        : 'none';
  params.set('dm', DOCK_TO_CODE[dockMode]);
  params.set('ca', AXIS_TO_CODE[config.chartAxisMode]);
  params.set('gn', String(config.graphMaxHeight));
  params.set('gv', config.graphVisible ? '1' : '0');
  // The state-graph minimap is now always shown (owner 2026-07-12): the old `gm`
  // key is no longer emitted, and a legacy `gm=0/1` is silently ignored on decode.
  // `gt` (throw-number labels) is ALWAYS emitted; an old link without it decodes to
  // the store default (ON) via the boot merge, so absence reads as ON.
  params.set('gt', config.graphThrowLabels ? '1' : '0');
  params.set('au', config.audioEnabled ? '1' : '0');
  params.set('ac', config.catchTickEnabled ? '1' : '0');
  params.set('av', fixed(config.audioVolume));
  const cam = [...config.camera.position, ...config.camera.target].map(fixed).join(',');
  params.set('cam', cam);
  // Optional playhead-time bookmark. Key `t` is free (no collision with tp/tw/tl).
  if (config.time !== undefined && Number.isFinite(config.time)) {
    params.set('t', fixedTime(config.time));
  }
  // Optional hand-workspace spec (ruling 4). An 'stl' kind forces enabled off — its
  // geometry cannot travel in a URL, so it degrades to a disabled STL on reload.
  if (config.workspace !== undefined) {
    const ws = config.workspace;
    params.set('wsk', WORKSPACE_TO_CODE[ws.kind]);
    params.set('wsx', fixed(ws.scale.x));
    params.set('wsy', fixed(ws.scale.y));
    params.set('wsz', fixed(ws.scale.z));
    params.set('wse', ws.kind === 'stl' ? '0' : ws.enabled ? '1' : '0');
  }
  // Optional work & power table collapsed flag. Emitted ONLY when true — the
  // default (false, table visible) omits the key entirely so a plain/default
  // link is unaffected by this field's introduction.
  if (config.workTableCollapsed === true) {
    params.set('wt', '1');
  }
  return params.toString();
}

/**
 * Decode a query string (URLSearchParams or a raw string) into a PARTIAL config:
 * only the parameters present and well-formed appear. A URL without a `v` field
 * yields `{}` (no config to apply → the caller keeps defaults). Every malformed
 * value is skipped silently — the decode never throws (DESIGN.md §6).
 */
export function decodeConfig(input: URLSearchParams | string): Partial<ShareConfig> {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  // Versioned URLs only: an unversioned query is treated as "no shared config".
  if (!params.has('v')) {
    return {};
  }
  const out: Record<string, unknown> = {};

  const pattern = params.get('p');
  if (pattern !== null && pattern.length > 0) {
    out.pattern = pattern;
  }

  const numFields: readonly [string, keyof ShareConfig][] = [
    ['bp', 'beatPeriod'],
    ['dw', 'dwellTime'],
    ['ps', 'playbackSpeed'],
    ['g', 'gravity'],
    ['hd', 'holdDepth'],
    ['br', 'ballRadius'],
    ['tw', 'timelineWindow'],
    ['av', 'audioVolume'],
  ];
  for (const [key, field] of numFields) {
    const value = parseNum(params.get(key));
    if (value !== null) {
      out[field] = value;
    }
  }

  // Trail length `tl` clamps to [0, TRAIL_LENGTH_MAX_DECODE] here (not a plain
  // passthrough like the numFields above): an old link that encoded a larger `tl`
  // (the pre-2026-07-11 max was 8 s) loads as a 2 s trail. The store re-clamps too.
  const trail = parseNum(params.get('tl'));
  if (trail !== null) {
    out.trailLength = Math.min(TRAIL_LENGTH_MAX_DECODE, Math.max(0, trail));
  }

  const intFields: readonly [string, keyof ShareConfig][] = [
    ['nh', 'handCount'],
    ['gn', 'graphMaxHeight'],
  ];
  for (const [key, field] of intFields) {
    const value = parseNum(params.get(key));
    if (value !== null) {
      out[field] = Math.round(value);
    }
  }

  const boolFields: readonly [string, keyof ShareConfig][] = [
    ['oc', 'orbitColoring'],
    ['sh', 'showHands'],
    ['hp', 'showHandPaths'],
    ['gh', 'ghostsEnabled'],
    ['cv', 'chartsVisible'],
    ['gv', 'graphVisible'],
    // No `gm` (state-graph minimap) any more — it is always shown (owner 2026-07-12);
    // a legacy `gm` key in an old link is simply not read, so it degrades silently.
    ['gt', 'graphThrowLabels'],
    ['au', 'audioEnabled'],
    ['ac', 'catchTickEnabled'],
    // `wt` is normally emitted only when true (see encodeConfig), but decode
    // accepts either token if a hand-authored URL supplies one explicitly.
    ['wt', 'workTableCollapsed'],
  ];
  for (const [key, field] of boolFields) {
    const value = parseBool(params.get(key));
    if (value !== null) {
      out[field] = value;
    }
  }

  const carry = params.get('cy');
  if (carry !== null && carry in CODE_TO_CARRY) {
    out.carryPathKind = CODE_TO_CARRY[carry];
  }
  const preset = params.get('pr');
  if (preset !== null && preset in CODE_TO_PRESET) {
    out.handPreset = CODE_TO_PRESET[preset];
  }
  const axis = params.get('ca');
  if (axis !== null && axis in CODE_TO_AXIS) {
    out.chartAxisMode = CODE_TO_AXIS[axis];
  }
  // Bottom-dock tri-state. When `dm` is present it wins. A `cv`-only (legacy)
  // link derives dockMode HERE, not downstream: the boot path merges the decoded
  // partial over currentConfig(), which always carries a concrete dockMode, so an
  // absent key would never reach a derivation in applyConfig.
  const dock = params.get('dm');
  if (dock !== null && dock in CODE_TO_DOCK) {
    out.dockMode = CODE_TO_DOCK[dock];
  } else if (out.chartsVisible !== undefined) {
    out.dockMode = out.chartsVisible ? 'charts' : 'none';
  }

  const throwPoints = decodePoints(params.get('tp'));
  if (throwPoints !== null) {
    out.handThrowPoints = throwPoints;
  }
  const catchPoints = decodePoints(params.get('ct'));
  if (catchPoints !== null) {
    out.handCatchPoints = catchPoints;
  }

  const color = params.get('bc');
  if (color !== null) {
    const hex = normalizeHex(color);
    if (hex !== null) {
      out.ballColor = hex;
    }
  }

  const cam = params.get('cam');
  if (cam !== null) {
    const parts = cam.split(',').map((token) => parseNum(token));
    if (parts.length === 6 && parts.every((value) => value !== null)) {
      const [px, py, pz, tx, ty, tz] = parts as number[];
      out.camera = {
        position: [px, py, pz] as [number, number, number],
        target: [tx, ty, tz] as [number, number, number],
      };
    }
  }

  // Optional playhead-time bookmark (key `t`); clamp to t ≥ 0, ignore if malformed.
  const time = parseNum(params.get('t'));
  if (time !== null) {
    out.time = Math.max(0, time);
  }

  // Optional hand-workspace spec (keys `ws*`). Present only when the kind decodes;
  // missing/garbage axes fall back to a neutral 0.4 half-extent (the store re-clamps).
  const wsKindCode = params.get('wsk');
  if (wsKindCode !== null && wsKindCode in CODE_TO_WORKSPACE) {
    const kind = CODE_TO_WORKSPACE[wsKindCode]!;
    out.workspace = {
      kind,
      scale: {
        x: parseNum(params.get('wsx')) ?? 0.4,
        y: parseNum(params.get('wsy')) ?? 0.4,
        z: parseNum(params.get('wsz')) ?? 0.4,
      },
      // An 'stl' kind never travels enabled — it degrades to disabled on reload.
      enabled: kind === 'stl' ? false : parseBool(params.get('wse')) === true,
    };
  }

  return out as Partial<ShareConfig>;
}

/** True when `value` is one of the codec's chart-axis codes (used by validators). */
export function isChartAxisMode(value: unknown): value is ChartAxisModeCode {
  return typeof value === 'string' && (AXIS_CODES as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlanarPointArray(value: unknown): value is PlanarPoint[] {
  return (
    Array.isArray(value) &&
    value.every(
      (point) =>
        point !== null &&
        typeof point === 'object' &&
        isFiniteNumber((point as { x?: unknown }).x) &&
        isFiniteNumber((point as { z?: unknown }).z),
    )
  );
}

function isCameraPose(value: unknown): value is CameraPose {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const pose = value as { position?: unknown; target?: unknown };
  const triple = (v: unknown): boolean =>
    Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
  return triple(pose.position) && triple(pose.target);
}

/** Structural guard for a {@link WorkspaceConfigCode} (used by isShareConfigLike). */
function isWorkspaceConfigLike(value: unknown): value is WorkspaceConfigCode {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const ws = value as { kind?: unknown; scale?: unknown; enabled?: unknown };
  if (ws.kind !== 'sphere' && ws.kind !== 'cube' && ws.kind !== 'tetra' && ws.kind !== 'stl') {
    return false;
  }
  if (typeof ws.enabled !== 'boolean') {
    return false;
  }
  const scale = ws.scale as { x?: unknown; y?: unknown; z?: unknown } | null;
  return (
    scale !== null &&
    typeof scale === 'object' &&
    isFiniteNumber(scale.x) &&
    isFiniteNumber(scale.y) &&
    isFiniteNumber(scale.z)
  );
}

/**
 * Structural type guard for a full {@link ShareConfig} — used to validate an
 * imported JSON file before applying it (DESIGN.md §6: "validation with a clear
 * error on bad JSON"). Range clamping is applyConfig's job; this only guarantees
 * every field is present with the right type, so no undefined/NaN reaches the sim.
 */
export function isShareConfigLike(raw: unknown): raw is ShareConfig {
  if (raw === null || typeof raw !== 'object') {
    return false;
  }
  const config = raw as Record<string, unknown>;
  if (typeof config.pattern !== 'string' || typeof config.ballColor !== 'string') {
    return false;
  }
  const numericFields = [
    'beatPeriod',
    'dwellTime',
    'playbackSpeed',
    'gravity',
    'holdDepth',
    'handCount',
    'ballRadius',
    'timelineWindow',
    'trailLength',
    'graphMaxHeight',
    'audioVolume',
  ];
  for (const field of numericFields) {
    if (!isFiniteNumber(config[field])) {
      return false;
    }
  }
  const boolFields = [
    'orbitColoring',
    'showHands',
    'showHandPaths',
    'ghostsEnabled',
    'chartsVisible',
    'graphVisible',
    'graphThrowLabels',
    'audioEnabled',
    'catchTickEnabled',
  ];
  for (const field of boolFields) {
    if (typeof config[field] !== 'boolean') {
      return false;
    }
  }
  if (config.carryPathKind !== 'quintic' && config.carryPathKind !== 'cubic') {
    return false;
  }
  if (config.handPreset !== 'line' && config.handPreset !== 'circle') {
    return false;
  }
  if (!isChartAxisMode(config.chartAxisMode)) {
    return false;
  }
  // `time` is optional; if present it must be a finite number (absent = load at 0).
  if (config.time !== undefined && !isFiniteNumber(config.time)) {
    return false;
  }
  // `dockMode` is optional (absent ⇒ derived from chartsVisible); validate if present.
  if (
    config.dockMode !== undefined &&
    config.dockMode !== 'none' &&
    config.dockMode !== 'charts' &&
    config.dockMode !== 'explorer'
  ) {
    return false;
  }
  // `workspace` is optional; if present it must be a well-formed spec.
  if (config.workspace !== undefined && !isWorkspaceConfigLike(config.workspace)) {
    return false;
  }
  // `workTableCollapsed` is optional (absent ⇒ store default false); validate type.
  if (config.workTableCollapsed !== undefined && typeof config.workTableCollapsed !== 'boolean') {
    return false;
  }
  return (
    isPlanarPointArray(config.handThrowPoints) &&
    isPlanarPointArray(config.handCatchPoints) &&
    isCameraPose(config.camera)
  );
}

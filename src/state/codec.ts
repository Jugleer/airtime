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
  readonly chartAxisMode: ChartAxisModeCode;
  readonly graphMaxHeight: number;
  readonly graphVisible: boolean;
  readonly graphMinimap: boolean;
  readonly audioEnabled: boolean;
  readonly catchTickEnabled: boolean;
  readonly audioVolume: number;
  readonly camera: CameraPose;
}

/** The current codec version. Bump only with a decode migration (never silently). */
export const CODEC_VERSION = '1';

/** Fixed-precision float encoding (4 dp): stable, compact, round-trips cleanly. */
const FLOAT_DECIMALS = 4;

function fixed(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return String(Number(value.toFixed(FLOAT_DECIMALS)));
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
  params.set('cv', config.chartsVisible ? '1' : '0');
  params.set('ca', AXIS_TO_CODE[config.chartAxisMode]);
  params.set('gn', String(config.graphMaxHeight));
  params.set('gv', config.graphVisible ? '1' : '0');
  params.set('gm', config.graphMinimap ? '1' : '0');
  params.set('au', config.audioEnabled ? '1' : '0');
  params.set('ac', config.catchTickEnabled ? '1' : '0');
  params.set('av', fixed(config.audioVolume));
  const cam = [...config.camera.position, ...config.camera.target].map(fixed).join(',');
  params.set('cam', cam);
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
    ['tl', 'trailLength'],
    ['av', 'audioVolume'],
  ];
  for (const [key, field] of numFields) {
    const value = parseNum(params.get(key));
    if (value !== null) {
      out[field] = value;
    }
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
    ['gm', 'graphMinimap'],
    ['au', 'audioEnabled'],
    ['ac', 'catchTickEnabled'],
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
    'graphMinimap',
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
  return (
    isPlanarPointArray(config.handThrowPoints) &&
    isPlanarPointArray(config.handCatchPoints) &&
    isCameraPose(config.camera)
  );
}

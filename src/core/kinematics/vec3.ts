// src/core/kinematics/vec3 — a minimal plain-object 3-vector for core kinematics.
//
// Core stays pure (CLAUDE.md hard rule 1): no three.js import here. The render
// layer converts these `{x, y, z}` records to three.Vector3. Scene units are
// meters, y-up (NOTATION.md conventions).

/** A 3-vector in scene coordinates (meters, y-up). */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Construct a vector. */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** The zero vector. */
export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** a + b. */
export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** a − b. */
export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** k·a. */
export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

/** Midpoint (a + b)/2. */
export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: 0.5 * (a.x + b.x), y: 0.5 * (a.y + b.y), z: 0.5 * (a.z + b.z) };
}

/** Dot product a·b. */
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Euclidean length |a|. */
export function magnitude(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/** Squared length |a|². */
export function magnitudeSquared(a: Vec3): number {
  return dot(a, a);
}

// src/render3d/threeConsole — silence one upstream deprecation line at startup.
//
// @react-three/fiber eagerly constructs a `new THREE.Clock()` in its root store
// (see events-*.esm.js: `clock: new THREE.Clock()`), and three.js r183 deprecated
// Clock — its constructor calls `warn('Clock: This module has been deprecated …')`.
// So a bare page load prints that warning the moment the <Canvas> mounts, even
// though WE never read r3f's clock (the app's own wall clock in ui/useClock owns
// simTime, and every useFrame subscriber reads simTime from the store, ignoring the
// r3f-provided delta). We can't stop r3f constructing the clock, and the warning
// fires in the constructor before we could swap it out.
//
// three.js exposes a supported hook for exactly this: `setConsoleFunction` routes
// ALL of three's own log/warn/error through a handler. We install a filter that
// drops only that single deprecated-Clock line and forwards every other message to
// the native console faithfully (including three's stack-trace branch), so no real
// three diagnostic is ever hidden. Idempotent; call once before the first Canvas.

import { getConsoleFunction, setConsoleFunction } from 'three';

const CLOCK_DEPRECATION = 'Clock: This module has been deprecated';

type ThreeConsoleType = 'log' | 'warn' | 'error';

/** Forward a three console call to the native console, mirroring three's own branch. */
function forward(type: ThreeConsoleType, message: unknown, params: unknown[]): void {
  const method = type === 'error' ? console.error : type === 'warn' ? console.warn : console.log;
  const first = params[0] as { isStackTrace?: boolean; getError?: (m: unknown) => unknown } | undefined;
  if (
    (type === 'warn' || type === 'error') &&
    first &&
    first.isStackTrace === true &&
    typeof first.getError === 'function'
  ) {
    method(first.getError(message));
  } else {
    method(message, ...params);
  }
}

/**
 * Install the one-line filter for three's deprecated-Clock warning. Safe to call
 * more than once (no-op if a console function is already set). Must run before the
 * first `<Canvas>` mounts so it catches r3f's store-init Clock construction.
 */
export function installThreeConsoleFilter(): void {
  if (getConsoleFunction() !== null) {
    return; // a host (or a previous call) already owns three's console — don't stack.
  }
  setConsoleFunction((type: ThreeConsoleType, message: unknown, ...params: unknown[]): void => {
    if (type === 'warn' && typeof message === 'string' && message.includes(CLOCK_DEPRECATION)) {
      return; // swallow exactly the deprecated-Clock line
    }
    forward(type, message, params);
  });
}

// src/ui/useModalFocus — shared focus management for the popup panels (Help,
// ExportPanel, WorkspacePanel). Accessibility pass 2026-07-11.
//
// When `open` becomes true it moves focus INTO the panel (the element the returned
// ref is attached to) so keyboard and screen-reader users land inside the dialog
// instead of being stranded on the page behind it; when it closes/unmounts it
// RESTORES focus to whatever was focused when it opened (normally the launcher
// button). Cheap and dependency-free.
//
// NOT a full focus trap — Tab can still move out of the panel into the page behind
// it. A proper trap needs a focusable-sentinel pair or a small dependency and is
// deferred (raised in the a11y pass). Attach the ref to a `tabIndex={-1}` container
// (typically the role="dialog" element); the shared focus-ring selector in ui/theme
// excludes tabindex="-1" so focusing it never draws a ring around the whole card.

import { useEffect, useRef, type RefObject } from 'react';

export function useModalFocus<T extends HTMLElement>(open: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const previouslyFocused =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    // The container exists by the time this effect runs (post-commit); focus it so
    // the dialog's accessible name is announced and Tab starts from inside.
    ref.current?.focus?.();
    return () => {
      // Restore focus to the launcher on close/unmount (guard: it may be gone).
      previouslyFocused?.focus?.();
    };
  }, [open]);
  return ref;
}

export function isPlayerInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  return Boolean(
    target.closest("[data-player-controls]") ||
      target.closest("input") ||
      target.closest("button") ||
      target.closest("a"),
  );
}

export function stopPointerPropagation(
  event: React.PointerEvent | React.TouchEvent,
) {
  event.stopPropagation();
}

export function safeReleasePointerCapture(
  element: Element | null,
  pointerId: number,
) {
  if (!element?.releasePointerCapture) return;

  try {
    if (element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Pointer may already be released by the browser or DevTools.
  }
}

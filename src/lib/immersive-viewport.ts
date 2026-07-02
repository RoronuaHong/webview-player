export function syncImmersiveViewportMetrics(
  viewport: HTMLElement | null | undefined,
) {
  if (!viewport) return;

  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  viewport.style.setProperty("--immersive-vw", `${w}px`);
  viewport.style.setProperty("--immersive-vh", `${h}px`);
}

export function runAfterDoubleFrame(callback: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(callback);
  });
}

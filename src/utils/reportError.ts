/** Shows a failed action to the user (App renders it as a toast) and keeps the console trace. */
export function reportError(action: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`${action}:`, err);
  window.dispatchEvent(new CustomEvent('lazylab:error', { detail: `${action}: ${message}` }));
}

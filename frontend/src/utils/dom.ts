// DOM utility functions

/**
 * Get element by ID with type safety
 */
export function getElementById<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Get element by ID, throwing if not found
 */
export function getRequiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) {
    throw new Error(`Required element not found: #${id}`);
  }
  return el;
}

/**
 * Add event listener with cleanup function
 */
export function addListener<K extends keyof HTMLElementEventMap>(
  element: HTMLElement,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions
): () => void {
  element.addEventListener(event, handler, options);
  return () => element.removeEventListener(event, handler, options);
}

/**
 * Show element
 */
export function show(el: HTMLElement): void {
  el.style.display = '';
}

/**
 * Hide element
 */
export function hide(el: HTMLElement): void {
  el.style.display = 'none';
}

/**
 * Toggle element visibility
 */
export function toggle(el: HTMLElement, visible: boolean): void {
  el.style.display = visible ? '' : 'none';
}

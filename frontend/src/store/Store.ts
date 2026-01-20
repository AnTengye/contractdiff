// Lightweight Store implementation with pub-sub pattern - FIXED VERSION
import type { Listener, Selector, Updater } from '@/types';

export class Store<T extends object> {
  private state: T;
  private listeners: Set<Listener<T>> = new Set();
  private selectorListeners: Map<Selector<T, unknown>, Set<Listener<unknown>>> = new Map();

  constructor(initialState: T) {
    this.state = { ...initialState };
  }

  getState(): Readonly<T> {
    return this.state;
  }

  setState(updater: Partial<T> | Updater<T>): void {
    const prevState = { ...this.state };
    const partial = typeof updater === 'function' ? updater(this.state) : updater;

    this.state = { ...this.state, ...partial };

    // Notify global listeners
    this.listeners.forEach(listener => {
      try {
        listener(this.state, prevState);
      } catch (error) {
        console.error('[Store] Listener error:', error);
      }
    });

    // Notify selector listeners only if selected value changed
    this.selectorListeners.forEach((listeners, selector) => {
      const prevValue = selector(prevState);
      const newValue = selector(this.state);
      if (!Object.is(prevValue, newValue)) {
        listeners.forEach(listener => {
          try {
            listener(newValue, prevValue);
          } catch (error) {
            console.error('[Store] Selector listener error:', error);
          }
        });
      }
    });
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    console.log('[Store] Listener added, total:', this.listeners.size);
    return () => {
      this.listeners.delete(listener);
      console.log('[Store] Listener removed, remaining:', this.listeners.size);
    };
  }

  subscribeToSelector<R>(
    selector: Selector<T, R>,
    listener: Listener<R>
  ): () => void {
    if (!this.selectorListeners.has(selector)) {
      this.selectorListeners.set(selector, new Set());
    }
    const listeners = this.selectorListeners.get(selector)!;
    listeners.add(listener as Listener<unknown>);

    return () => {
      listeners.delete(listener as Listener<unknown>);
      if (listeners.size === 0) {
        this.selectorListeners.delete(selector);
      }
    };
  }

  reset(initialState: T): void {
    this.setState(initialState);
  }
}

// Helper function to create stores
export function createStore<T extends object>(initialState: T): Store<T> {
  return new Store(initialState);
}

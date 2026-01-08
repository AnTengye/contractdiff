// Lightweight Store implementation with pub-sub pattern
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
    const prevState = this.state;
    const partial = typeof updater === 'function' ? updater(this.state) : updater;

    this.state = { ...this.state, ...partial };

    // Notify global listeners
    this.listeners.forEach(listener => listener(this.state, prevState));

    // Notify selector listeners only if selected value changed
    this.selectorListeners.forEach((listeners, selector) => {
      const prevValue = selector(prevState);
      const newValue = selector(this.state);
      if (!Object.is(prevValue, newValue)) {
        listeners.forEach(listener => listener(newValue, prevValue));
      }
    });
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

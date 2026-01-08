// Store types
export type Listener<T> = (state: T, prevState: T) => void;
export type Selector<T, R> = (state: T) => R;
export type Updater<T> = (state: T) => Partial<T>;

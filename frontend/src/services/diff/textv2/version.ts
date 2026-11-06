declare const __BUILD_REVISION__: string;
export const DIFF_ENGINE_VERSION = 'structured-v3';
export const BUILD_REVISION =
  typeof __BUILD_REVISION__ === 'string' ? __BUILD_REVISION__ : 'unknown';

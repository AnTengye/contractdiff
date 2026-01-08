// Application constants

export const SIMILARITY_THRESHOLD = 0.85;
export const BLOCK_MATCH_THRESHOLD = 0.6;

export const POLLING = {
  MAX_ATTEMPTS: 120,
  INTERVAL_MS: 5000,
  TIMEOUT_MINUTES: 10,
} as const;

export const ZOOM = {
  MIN: 0.5,
  MAX: 3.0,
  STEP: 0.25,
  DEFAULT: 1.0,
} as const;

export const SYNC_SCROLL = {
  DEBOUNCE_MS: 50,
} as const;

export const FILE_EXTENSIONS = {
  PDF: '.pdf',
  DOCX: '.docx',
} as const;

export const API_ENDPOINTS = {
  AUTH_LOGIN: '/api/auth/login',
  AUTH_ME: '/api/auth/me',
  CONTRACTS_UPLOAD: '/api/contracts/upload',
  CONTRACTS_LIST: '/api/contracts',
  CONTRACTS_DETAIL: (id: string) => `/api/contracts/${id}`,
  CONTRACTS_STATUS: (id: string) => `/api/contracts/${id}/status`,
  PARSERS: '/api/parsers',
} as const;

export const COLORS = {
  ADDED: {
    FILL: 'rgba(74, 222, 128, 0.2)',
    STROKE: '#4ade80',
    BG: 'rgba(74, 222, 128, 0.25)',
  },
  REMOVED: {
    FILL: 'rgba(248, 113, 113, 0.2)',
    STROKE: '#f87171',
    BG: 'rgba(239, 68, 68, 0.25)',
  },
} as const;

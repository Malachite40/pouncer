export const API_BASE_URL = 'http://localhost:3020';

export const STORAGE_KEYS = {
    AUTH_TOKEN: 'pounce_auth_token',
    USER_INFO: 'pounce_user_info',
    API_URL: 'pounce_api_url',
} as const;

export const SESSION_COOKIE_NAME = 'better-auth.session_token';

export const BRAND = {
    // Surfaces (warm charcoal)
    background: '#130e0d',
    card: '#1d1715',
    input: '#1a1513',
    // Primary (golden amber)
    primary: '#f4661d',
    primaryForeground: '#120b0a',
    primaryHover: '#de5300',
    primaryLight: 'rgba(244, 102, 29, 0.15)',
    primaryBorder: 'rgba(244, 102, 29, 0.7)',
    // Text
    foreground: '#f0eae3',
    mutedForeground: '#aaa39d',
    // Borders
    border: '#362e2c',
    // Semantic
    destructive: '#f5312c',
    green: '#2ecc71',
    ring: '#ed7a3d',
    white: '#ffffff',
} as const;

export const FONTS = {
    sans: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "'Oswald', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

export const RADIUS = '9px';

import { SESSION_COOKIE_NAME } from '~lib/constants';
import {
    clearStorage,
    getApiUrl,
    getAuthToken,
    getUserInfo,
    setAuthToken,
    setUserInfo,
} from '~lib/storage';

export async function extractSessionToken(): Promise<string | null> {
    const apiUrl = await getApiUrl();
    try {
        const cookie = await chrome.cookies.get({
            url: apiUrl,
            name: SESSION_COOKIE_NAME,
        });
        return cookie?.value ?? null;
    } catch {
        return null;
    }
}

export async function checkAndRefreshAuth(): Promise<
    | {
          authenticated: true;
          user: { id: string; name: string; email: string; image: string | null };
      }
    | { authenticated: false }
> {
    const apiUrl = await getApiUrl();

    // Try stored token first
    let token = await getAuthToken();
    if (token) {
        const result = await validateSession(apiUrl, token);
        if (result) return { authenticated: true, user: result };
    }

    // Try extracting from cookie
    token = await extractSessionToken();
    if (token) {
        const result = await validateSession(apiUrl, token);
        if (result) {
            await setAuthToken(token);
            await setUserInfo(result);
            return { authenticated: true, user: result };
        }
    }

    await clearStorage();
    return { authenticated: false };
}

async function validateSession(
    apiUrl: string,
    token: string,
): Promise<{ id: string; name: string; email: string; image: string | null } | null> {
    try {
        const res = await fetch(`${apiUrl}/api/auth/get-session`, {
            headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.user) return null;
        return {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            image: data.user.image ?? null,
        };
    } catch {
        return null;
    }
}

export async function clearAuth(): Promise<void> {
    await clearStorage();
}

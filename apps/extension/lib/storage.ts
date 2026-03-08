import { API_BASE_URL, STORAGE_KEYS } from './constants';

export async function getAuthToken(): Promise<string | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH_TOKEN);
    return result[STORAGE_KEYS.AUTH_TOKEN] ?? null;
}

export async function setAuthToken(token: string): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_TOKEN]: token });
}

export async function getUserInfo(): Promise<{
    id: string;
    name: string;
    email: string;
    image: string | null;
} | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.USER_INFO);
    return result[STORAGE_KEYS.USER_INFO] ?? null;
}

export async function setUserInfo(user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
}): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_INFO]: user });
}

export async function getApiUrl(): Promise<string> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.API_URL);
    return result[STORAGE_KEYS.API_URL] ?? API_BASE_URL;
}

export async function clearStorage(): Promise<void> {
    await chrome.storage.local.remove([
        STORAGE_KEYS.AUTH_TOKEN,
        STORAGE_KEYS.USER_INFO,
    ]);
}

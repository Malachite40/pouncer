import { SESSION_COOKIE_NAME } from '~lib/constants';
import { clearStorage, getApiUrl, getAuthToken } from '~lib/storage';

interface CreateWatchInput {
    url: string;
    name: string;
    checkType: 'price' | 'stock' | 'both';
    cssSelector: string;
    imageUrl: string | null;
    skipMerge: boolean;
}

interface CreateWatchResult {
    success: true;
    watch: { id: string; name: string; merged: boolean };
}

interface CreateWatchError {
    success: false;
    error: string;
    authRequired?: boolean;
}

export async function findWatchByUrl(
    url: string,
): Promise<{ id: string; name: string; checkType: string } | null> {
    const apiUrl = await getApiUrl();
    const token = await getAuthToken();

    if (!token) return null;

    try {
        const input = encodeURIComponent(JSON.stringify({ json: { url } }));
        const res = await fetch(`${apiUrl}/api/trpc/watch.findByUrl?input=${input}`, {
            method: 'GET',
            headers: {
                Cookie: `${SESSION_COOKIE_NAME}=${token}`,
            },
        });

        if (!res.ok) return null;

        const data = await res.json();
        const watch = data.result?.data?.json;
        if (!watch?.id) return null;

        return { id: watch.id, name: watch.name, checkType: watch.checkType };
    } catch {
        return null;
    }
}

export async function createWatch(
    input: CreateWatchInput,
): Promise<CreateWatchResult | CreateWatchError> {
    const apiUrl = await getApiUrl();
    const token = await getAuthToken();

    if (!token) {
        return { success: false, error: 'Not signed in', authRequired: true };
    }

    try {
        const res = await fetch(`${apiUrl}/api/trpc/watch.create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: `${SESSION_COOKIE_NAME}=${token}`,
            },
            body: JSON.stringify({
                json: {
                    url: input.url,
                    name: input.name,
                    checkType: input.checkType,
                    cssSelector: input.cssSelector,
                    imageUrl: input.imageUrl,
                    skipMerge: input.skipMerge,
                },
            }),
        });

        if (res.status === 401) {
            await clearStorage();
            return { success: false, error: 'Not signed in. Please log in to Pounce first.', authRequired: true };
        }

        if (!res.ok) {
            const text = await res.text();
            return { success: false, error: `Server error: ${res.status} ${text}` };
        }

        const data = await res.json();
        const watch = data.result?.data?.json;
        if (!watch?.id) {
            return { success: false, error: 'Unexpected response format' };
        }

        return { success: true, watch: { id: watch.id, name: watch.name, merged: watch.merged ?? false } };
    } catch (err) {
        return { success: false, error: `Network error: ${(err as Error).message}` };
    }
}

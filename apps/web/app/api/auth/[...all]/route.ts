import { getAuth } from '@/auth';
import { toNextJsHandler } from 'better-auth/next-js';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
    const { GET: authGet } = toNextJsHandler(getAuth());
    const response = await authGet(req);
    const origin = req.headers.get('origin') ?? '';
    if (origin.startsWith('chrome-extension://')) {
        const res = new NextResponse(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
        res.headers.set('Access-Control-Allow-Origin', origin);
        res.headers.set('Access-Control-Allow-Credentials', 'true');
        return res;
    }
    return response;
}

export async function POST(req: NextRequest) {
    const { POST: authPost } = toNextJsHandler(getAuth());
    const response = await authPost(req);
    const origin = req.headers.get('origin') ?? '';
    if (origin.startsWith('chrome-extension://')) {
        const res = new NextResponse(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
        res.headers.set('Access-Control-Allow-Origin', origin);
        res.headers.set('Access-Control-Allow-Credentials', 'true');
        return res;
    }
    return response;
}

export function OPTIONS(req: NextRequest) {
    const origin = req.headers.get('origin') ?? '';
    const headers: Record<string, string> = {};
    if (origin.startsWith('chrome-extension://')) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Cookie';
        headers['Access-Control-Allow-Credentials'] = 'true';
    }
    return new NextResponse(null, { status: 204, headers });
}

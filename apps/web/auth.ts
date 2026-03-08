import { getDb } from '@pounce/db';
import * as schema from '@pounce/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

let _auth: ReturnType<typeof betterAuth> | undefined;

function getAuth() {
    if (!_auth) {
        const db = getDb();
        _auth = betterAuth({
            secret: process.env.BETTER_AUTH_SECRET,
            baseURL: process.env.BETTER_AUTH_URL,
            database: drizzleAdapter(db, {
                provider: 'pg',
                schema,
            }),
            socialProviders: {
                google: {
                    clientId: process.env.GOOGLE_CLIENT_ID!,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
                },
            },
            trustedOrigins: ['chrome-extension://*'],
            plugins: [nextCookies()],
        }) as unknown as ReturnType<typeof betterAuth>;
    }
    return _auth;
}

export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
    get(_target, prop, receiver) {
        return Reflect.get(getAuth(), prop, receiver);
    },
});

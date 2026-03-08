import { db } from '@pounce/db';
import * as schema from '@pounce/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

function createAuth() {
    return betterAuth({
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
    });
}

type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | undefined;

export function getAuth(): Auth {
    if (authInstance) {
        return authInstance;
    }

    authInstance = createAuth();

    return authInstance;
}

export const auth: Auth = new Proxy({} as Auth, {
    get(_target, prop, receiver) {
        return Reflect.get(getAuth() as object, prop, receiver);
    },
});

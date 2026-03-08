import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

type Database = ReturnType<typeof drizzle<typeof schema>>;

let client: Sql | undefined;
let dbInstance: Database | undefined;

function requireConnectionString(): string {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set');
    }
    return connectionString;
}

function initDb(): Database {
    if (dbInstance) {
        return dbInstance;
    }

    client = postgres(requireConnectionString());
    dbInstance = drizzle(client, { schema });
    return dbInstance;
}

export const db: Database = new Proxy({} as Database, {
    get(_target, prop, receiver) {
        return Reflect.get(initDb() as object, prop, receiver);
    },
});

export function createDb(): Database {
    return initDb();
}

export function getDb(): Database {
    return initDb();
}

export function getDbClient(): Sql {
    initDb();
    return client!;
}

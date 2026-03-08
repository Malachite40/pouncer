import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

type Database = ReturnType<typeof drizzle<typeof schema>>;

let client: Sql | undefined;
let dbInstance: Database | undefined;

export function createDb(connectionString = process.env.DATABASE_URL): Database {
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set');
    }

    client = postgres(connectionString);
    return drizzle(client, { schema });
}

export function getDb(): Database {
    if (!dbInstance) {
        dbInstance = createDb();
    }

    return dbInstance;
}

export function getDbClient(): Sql {
    if (!client) {
        getDb();
    }

    return client!;
}

export const db: Database = new Proxy({} as Database, {
    get(_target, property, receiver) {
        const value = Reflect.get(getDb() as object, property, receiver);
        return typeof value === 'function' ? value.bind(getDb()) : value;
    },
});

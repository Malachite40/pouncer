import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

type Database = ReturnType<typeof drizzle<typeof schema>>;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
}

const client = postgres(connectionString);
export const db: Database = drizzle(client, { schema });

export function createDb(): Database {
    return db;
}

export function getDb(): Database {
    return db;
}

export function getDbClient(): Sql {
    return client;
}

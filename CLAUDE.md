## Drizzle Kit (Database Migrations)

Schema lives in `packages/db/src/schema.ts`. Migrations output to `packages/db/drizzle/`. Config is in `packages/db/drizzle.config.ts` (reads `DATABASE_URL` from root `.env`).

### Workflow for schema changes

1. **Edit the schema** — modify `packages/db/src/schema.ts`
2. **Generate a migration** — run `npm run db:generate` (runs `drizzle-kit generate`)
3. **Review the generated SQL** — check the new file in `packages/db/drizzle/` before applying
4. **Apply the migration** — run `npm run db:migrate` (runs `drizzle-kit migrate`)
5. **Verify** — run `npm run db:generate` again to confirm no new migration is produced (ensures DB and journal are in sync)

### Rules

- **Never manually edit migration SQL files** in `packages/db/drizzle/` — always regenerate if something is wrong
- **Never edit or delete `drizzle/meta/` files** — these track migration state and are managed by drizzle-kit
- **Use `db:generate` + `db:migrate` for all schema changes** — this creates versioned migration files that get committed
- **Never use `db:push`** — it applies schema changes directly to the DB without creating migration files, which desynchronizes the migration journal from the actual DB state. A subsequent `db:generate` + `db:migrate` will then fail because the tables/columns already exist
- **Always run `db:generate` from the repo root** (via turborepo) or from `packages/db/` — the config expects `DATABASE_URL` from `../../.env`
- **Do not delete or rename existing migration files** — this will break the migration journal

### Queries

- **Prefer Drizzle's typed API over raw `sql` template tags** — use helpers like `eq()`, `lte()`, `and()`, `inArray()`, etc. from `drizzle-orm` instead of writing raw SQL fragments. Raw `sql` should only be used when there is no Drizzle API equivalent (e.g., window functions like `row_number() over (...)`)

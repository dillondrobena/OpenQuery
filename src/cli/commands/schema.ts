import { mapDbError } from '../errors.js';
import { executorForAlias } from '../resolve.js';

/*
 * schema <alias> — progressive disclosure so big databases fit agent context:
 *   default        summary: tables + row estimates + FK pairs
 *   --table users  full column detail for one table
 *   --filter 'tx*' glob-scoped summary
 */

const SUMMARY_TABLES_SQL = `
  SELECT n.nspname AS schema, c.relname AS table,
         CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS estimated_rows
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY n.nspname, c.relname`;

const FOREIGN_KEYS_SQL = `
  SELECT conname AS constraint, conrelid::regclass::text AS from_table, confrelid::regclass::text AS to_table
  FROM pg_constraint WHERE contype = 'f' ORDER BY conname`;

const COLUMNS_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = $1 AND table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY ordinal_position`;

const PK_SQL = `
  SELECT a.attname AS column
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = $1::regclass AND i.indisprimary`;

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export interface SchemaCommandOptions {
  table?: string;
  filter?: string;
}

export async function schemaCommand(alias: string, opts: SchemaCommandOptions): Promise<void> {
  const { executor } = await executorForAlias(alias);
  try {
    if (opts.table) {
      const columns = await executor.query(COLUMNS_SQL, { params: [opts.table] });
      const pk = await executor
        .query(PK_SQL, { params: [opts.table] })
        .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
      process.stdout.write(
        JSON.stringify(
          {
            table: opts.table,
            primaryKey: pk.rows.map((r) => r.column),
            columns: columns.rows,
          },
          null,
          2
        ) + '\n'
      );
      return;
    }

    const tables = await executor.query(SUMMARY_TABLES_SQL, { maxRows: 5000 });
    const fks = await executor.query(FOREIGN_KEYS_SQL, { maxRows: 5000 });
    let tableRows = tables.rows;
    if (opts.filter) {
      const regex = globToRegex(opts.filter);
      tableRows = tableRows.filter((r) => regex.test(String(r.table)));
    }
    process.stdout.write(
      JSON.stringify(
        {
          summary: true,
          note: 'Summary view. Use --table <name> for column detail, --filter <glob> to scope.',
          tables: tableRows,
          foreignKeys: fks.rows,
        },
        null,
        2
      ) + '\n'
    );
  } catch (err) {
    throw mapDbError(err);
  } finally {
    await executor.close();
  }
}

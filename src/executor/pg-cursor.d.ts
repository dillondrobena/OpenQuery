declare module 'pg-cursor' {
  import type { Submittable } from 'pg';

  class Cursor implements Submittable {
    constructor(sql: string, params?: unknown[]);
    read(maxRows: number): Promise<unknown[]>;
    close(): Promise<void>;
    submit(connection: unknown): void;
  }
  export default Cursor;
}

import { Pool } from 'pg';
import { config } from '../config';

// PostgreSQL connection pool
export const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
    max: 20,
    idleTimeoutMillis: 30000,
});

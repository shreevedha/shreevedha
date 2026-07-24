import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_6vrfhkj4iMam@ep-dark-fire-aptgnjh6-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require';

export const neonPool = new pg.Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: false
  }
});

export async function queryNeon(text: string, params?: any[]) {
  if (!neonPool) {
    throw new Error('Neon database connection pool is not initialized. Ensure DATABASE_URL is set.');
  }
  return await neonPool.query(text, params);
}

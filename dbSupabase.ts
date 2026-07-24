import pg from 'pg';
import dotenv from 'dotenv';
import { queryNeon } from './dbNeon.js';
dotenv.config();

const connectionString = 'postgresql://postgres:Shreevedha%400678@db.kiuiizukxrlgnryweqvp.supabase.co:5432/postgres';

export const supabasePool = new pg.Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: false
  }
});

export async function querySupabase(text: string, params?: any[]) {
  try {
    return await supabasePool.query(text, params);
  } catch (err: any) {
    console.warn('Supabase DB primary connection issue, executing via fallback DB:', err?.message || err);
    try {
      return await queryNeon(text, params);
    } catch (fallbackErr: any) {
      throw err;
    }
  }
}

import pg from 'pg';
import dotenv from 'dotenv';
import { queryNeon } from './dbNeon.ts';
dotenv.config();

const connectionString = 'postgresql://postgres:Shreevedha%400678@db.kiuiizukxrlgnryweqvp.supabase.co:5432/postgres';

let _supabasePool: pg.Pool | null = null;
export function getSupabasePool() {
  if (!_supabasePool) {
    _supabasePool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: {
        rejectUnauthorized: false
      }
    });
    _supabasePool.on('error', (err) => {
      console.error('Supabase pool background error:', err?.message || err);
    });
  }
  return _supabasePool;
}

export async function querySupabase(text: string, params?: any[]) {
  try {
    return await getSupabasePool().query(text, params);
  } catch (err: any) {
    console.warn('Supabase DB primary connection issue, executing via fallback DB:', err?.message || err);
    try {
      return await queryNeon(text, params);
    } catch (fallbackErr: any) {
      throw err;
    }
  }
}

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

export async function uploadToSupabase(fileBuffer: Buffer, folder: string, filename: string, mimeType: string): Promise<string | null> {
  if (!supabase) {
    console.warn('Supabase credentials not configured. Skipping upload.');
    return null;
  }
  
  const cleanFilename = `${folder}/${Date.now()}_${filename.replace(/\s+/g, '_')}`;
  
  try {
    const { data, error } = await supabase.storage
      .from('publicimages')
      .upload(cleanFilename, fileBuffer, {
        contentType: mimeType,
        upsert: true
      });

    if (error) {
      console.warn('Supabase upload skipped (error/unreachable), falling back:', error.message || error);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from('publicimages')
      .getPublicUrl(cleanFilename);

    return publicUrlData?.publicUrl || null;
  } catch (err: any) {
    console.warn('Supabase Storage connection offline or ENOTFOUND, using fallback:', err?.message || err);
    return null;
  }
}

import { createClient } from '@supabase/supabase-js';

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
  
  // Create a clean filename with folder and timestamp prefix
  const cleanFilename = `${folder}/${Date.now()}_${filename.replace(/\s+/g, '_')}`;
  
  try {
    const { data, error } = await supabase.storage
      .from('publicimages')
      .upload(cleanFilename, fileBuffer, {
        contentType: mimeType,
        upsert: true
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return null;
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('publicimages')
      .getPublicUrl(cleanFilename);

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('Failed uploading to Supabase Storage:', err);
    return null;
  }
}

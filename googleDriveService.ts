import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Dynamically constructs and returns an authenticated Google Drive client
 * using either Google Service Account credentials or a Google OAuth Refresh Token.
 */
export async function getDriveService() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  // Strategy A: Service Account JWT Authentication
  if (serviceAccountEmail && privateKey) {
    try {
      const cleanPrivateKey = privateKey.replace(/\\n/g, '\n');
      const auth = new google.auth.JWT({
        email: serviceAccountEmail,
        key: cleanPrivateKey,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
      });
      console.log('Authenticated Google Drive using Service Account JWT.');
      return google.drive({ version: 'v3', auth });
    } catch (err) {
      console.error('Service Account JWT Authentication failed:', err);
    }
  }

  // Strategy B: Institutional Admin OAuth Refresh Token
  if (clientId && clientSecret && refreshToken) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
      );
      oauth2Client.setCredentials({
        refresh_token: refreshToken
      });
      console.log('Authenticated Google Drive using Institutional OAuth Refresh Token.');
      return google.drive({ version: 'v3', auth: oauth2Client });
    } catch (err) {
      console.error('Institutional OAuth Authentication failed:', err);
    }
  }

  // Default: Return null when no service credentials are provided yet
  console.warn('Google Drive credentials not fully configured in environment variables.');
  return null;
}

/**
 * Method to list files from a specific private folder
 * to be displayed in the LMS student dashboard.
 */
export async function listPrivateFolderFiles() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    console.warn('No GOOGLE_DRIVE_FOLDER_ID specified in environment variables.');
    return null;
  }

  const drive = await getDriveService();
  if (!drive) {
    return null;
  }

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 12,
      fields: 'files(id, name, mimeType, webViewLink, size, createdTime, iconLink)',
      orderBy: 'createdTime desc'
    });
    return response.data.files || [];
  } catch (error) {
    console.error(`Error listing files for folder ID ${folderId} from Google Drive:`, error);
    throw error;
  }
}

import { google } from 'googleapis';
import { shell } from 'electron';
import * as http from 'http';
import * as url from 'url';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const REDIRECT_PORT = 51837;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

export class GmailOAuth {
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async authorize(): Promise<string> {
    const oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      REDIRECT_URI
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const parsedUrl = url.parse(req.url || '', true);
          if (parsedUrl.pathname !== '/callback') return;

          const code = parsedUrl.query.code as string;
          if (!code) {
            res.end('認証に失敗しました。アプリに戻ってください。');
            reject(new Error('認証コードが取得できませんでした'));
            server.close();
            return;
          }

          const { tokens } = await oauth2Client.getToken(code);
          res.end('認証に成功しました！このタブを閉じてアプリに戻ってください。');
          server.close();
          resolve(tokens.refresh_token || '');
        } catch (err) {
          res.end('認証エラーが発生しました。');
          server.close();
          reject(err);
        }
      });

      server.listen(REDIRECT_PORT, () => {
        shell.openExternal(authUrl);
      });

      setTimeout(() => {
        server.close();
        reject(new Error('認証がタイムアウトしました（2分）'));
      }, 120000);
    });
  }

  createClient(refreshToken: string) {
    const oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }
}

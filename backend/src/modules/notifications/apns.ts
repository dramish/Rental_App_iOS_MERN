import http2 from 'http2';
import jwt from 'jsonwebtoken';

export interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  production: boolean;
}

export interface ApnsResult {
  status: number;
  reason?: string;
}

/**
 * Minimal APNs HTTP/2 client with token (.p8) auth.
 * NOT exercised against Apple in CI: verify on a device with a real key (sandbox first).
 */
export class ApnsClient {
  private session?: http2.ClientHttp2Session;
  private cachedJwt?: { token: string; issuedAt: number };

  constructor(private cfg: ApnsConfig) {}

  private authToken(): string {
    const now = Math.floor(Date.now() / 1000);
    // Apple requires refreshing the provider token between 20 and 60 minutes.
    if (!this.cachedJwt || now - this.cachedJwt.issuedAt > 45 * 60) {
      const token = jwt.sign({ iss: this.cfg.teamId, iat: now }, this.cfg.keyP8.replace(/\\n/g, '\n'), {
        algorithm: 'ES256',
        header: { alg: 'ES256', kid: this.cfg.keyId },
      });
      this.cachedJwt = { token, issuedAt: now };
    }
    return this.cachedJwt.token;
  }

  private connection(): http2.ClientHttp2Session {
    if (!this.session || this.session.closed || this.session.destroyed) {
      const host = this.cfg.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
      this.session = http2.connect(host);
      this.session.on('error', () => (this.session = undefined));
      this.session.on('close', () => (this.session = undefined));
    }
    return this.session;
  }

  send(opts: { deviceToken: string; pushType: 'alert' | 'liveactivity'; payload: unknown; priority?: 5 | 10; bundleId?: string }): Promise<ApnsResult> {
    return new Promise((resolve, reject) => {
      const bundle = opts.bundleId ?? this.cfg.bundleId;
      const topic = opts.pushType === 'liveactivity' ? `${bundle}.push-type.liveactivity` : bundle;
      const req = this.connection().request({
        ':method': 'POST',
        ':path': `/3/device/${opts.deviceToken}`,
        authorization: `bearer ${this.authToken()}`,
        'apns-topic': topic,
        'apns-push-type': opts.pushType,
        'apns-priority': String(opts.priority ?? (opts.pushType === 'alert' ? 10 : 5)),
      });
      let status = 0;
      let body = '';
      req.on('response', (h) => (status = Number(h[':status'])));
      req.setEncoding('utf8');
      req.on('data', (c) => (body += c));
      req.on('end', () => resolve({ status, reason: body ? (JSON.parse(body) as { reason?: string }).reason : undefined }));
      req.on('error', reject);
      req.end(JSON.stringify(opts.payload));
    });
  }

  close(): void {
    this.session?.close();
  }
}

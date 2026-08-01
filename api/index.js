import app from '../dist/server.js';

export default function handler(req, res) {
  if (typeof app === 'function') {
    return app(req, res);
  }
  if (app && typeof app.default === 'function') {
    return app.default(req, res);
  }
  return app(req, res);
}

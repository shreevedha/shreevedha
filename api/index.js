import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const app = require('../dist/server.cjs');

export default function handler(req, res) {
  const handlerFn = app.default || app;
  return handlerFn(req, res);
}

const path = require('path');
const fs = require('fs');

let serverPath = path.resolve(__dirname, '../dist/server.cjs');
if (!fs.existsSync(serverPath)) {
  serverPath = path.resolve(__dirname, './dist/server.cjs');
}
if (!fs.existsSync(serverPath)) {
  serverPath = path.resolve(process.cwd(), 'dist/server.cjs');
}

let app;
let loadError = null;

try {
  app = require(serverPath);
} catch (err) {
  loadError = err;
}

module.exports = (req, res) => {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    return res.end('<h1>500 Internal Server Error (Module Load Error)</h1><pre>' + (loadError.stack || loadError.message || String(loadError)) + '</pre>');
  }
  try {
    const handler = app.default || app;
    return handler(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html');
    return res.end('<h1>500 Internal Server Error (Runtime Error)</h1><pre>' + (err.stack || err.message || String(err)) + '</pre>');
  }
};

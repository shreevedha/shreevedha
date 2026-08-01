const path = require('path');
const fs = require('fs');

const candidatePaths = [
  path.join(__dirname, 'dist', 'server.cjs'),
  path.join(__dirname, '..', 'dist', 'server.cjs'),
  path.join(__dirname, 'server.cjs'),
  path.join(process.cwd(), 'dist', 'server.cjs')
];

let serverPath = null;
for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    serverPath = p;
    break;
  }
}

let app;
let loadError = null;

if (!serverPath) {
  loadError = new Error('Could not find server.cjs. Candidate paths: ' + JSON.stringify(candidatePaths) + ' | cwd: ' + process.cwd() + ' | __dirname: ' + __dirname);
} else {
  try {
    app = require(serverPath);
  } catch (err) {
    loadError = err;
  }
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

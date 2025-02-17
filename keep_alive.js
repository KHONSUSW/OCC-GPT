const http = require('http');

http.createServer(function (req, res) {
  if (req.url === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const data = JSON.parse(body);
      if (data.type === 'url_verification') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge: data.challenge }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end("I'm alive");
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("I'm alive");
  }
}).listen(8080);

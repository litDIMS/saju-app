const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // /api/saju → Anthropic 프록시
  if (req.method === 'POST' && req.url === '/api/saju') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const bodyBuffer = Buffer.concat(chunks);
      const bodyStr    = bodyBuffer.toString('utf-8');

      console.log('[요청] body 길이:', bodyBuffer.length, 'bytes');

      let parsed;
      try {
        parsed = JSON.parse(bodyStr);
      } catch (e) {
        console.error('[오류] JSON 파싱 실패:', e.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      parsed.model = 'claude-sonnet-4-6';
      const finalBody = JSON.stringify(parsed);

      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(finalBody),
          'x-api-key':         API_KEY,
          'anthropic-version': '2023-06-01',
        }
      };

      const proxy = https.request(options, (apiRes) => {
        console.log('[응답] Anthropic 상태코드:', apiRes.statusCode);

        res.writeHead(apiRes.statusCode, {
          'Content-Type':                'text/event-stream',
          'Cache-Control':               'no-cache',
          'Access-Control-Allow-Origin': '*',
        });

        if (apiRes.statusCode !== 200) {
          let errBody = '';
          apiRes.on('data', d => errBody += d);
          apiRes.on('end', () => {
            console.error('[Anthropic 오류 응답]', errBody);
            res.end(errBody);
          });
          return;
        }

        apiRes.pipe(res);
      });

      proxy.on('error', (e) => {
        console.error('[네트워크 오류]', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      });

      proxy.write(finalBody);
      proxy.end();
    });
    return;
  }

  // 정적 파일 서빙
  let filePath = req.url === '/' ? '/saju_app_local.html' : req.url;
  filePath = path.join(__dirname, filePath);

  const ext  = path.extname(filePath);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║        사주명리 서버 시작            ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  ✅ 서버 주소: http://localhost:${PORT}`);
  console.log('');
  if (API_KEY === 'YOUR_API_KEY_HERE') {
    console.log("  ⚠️  API 키 미설정! 'YOUR_API_KEY_HERE' 를 실제 키로 교체하세요.");
  } else {
    console.log('  ✅ API 키 확인됨:', API_KEY.slice(0, 18) + '...');
  }
  console.log('');
  console.log('  종료: Ctrl+C');
  console.log('');
});

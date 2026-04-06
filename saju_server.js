const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';

// ── 사전 생성 해석 DB 로드
let SAJU_DB = {};
const DB_FILE = path.join(__dirname, 'saju_data.json');
if (fs.existsSync(DB_FILE)) {
  try {
    SAJU_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    console.log(`✅ 해석 DB 로드: ${Object.keys(SAJU_DB).length}개 일주`);
  } catch(e) {
    console.log('⚠️  해석 DB 로드 실패, 실시간 AI 모드로 운영');
  }
} else {
  console.log('ℹ️  해석 DB 없음, 실시간 AI 모드로 운영');
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── 정적 이미지 파일 서빙 (Luna.png / luna.png)
  if (req.method === 'GET' && (req.url === '/Luna.png' || req.url === '/luna.png')) {
    // Luna.png 우선, 없으면 luna.png 시도
    let imgPath = path.join(__dirname, 'Luna.png');
    if (!fs.existsSync(imgPath)) imgPath = path.join(__dirname, 'luna.png');
    if (fs.existsSync(imgPath)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(imgPath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // ── /api/interpret → 사전 생성 해석 조회
  if (req.method === 'POST' && req.url === '/api/interpret') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { dayPillar, category } = JSON.parse(body);
        const entry = SAJU_DB[dayPillar];
        if (entry && entry[category]) {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(JSON.stringify({ text: entry[category], source: 'db' }));
        } else {
          // DB에 없으면 404 → 클라이언트가 실시간 AI로 폴백
          res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'not found', source: 'miss' }));
        }
      } catch(e) {
        res.writeHead(400); res.end('Bad Request');
      }
    });
    return;
  }

  // ── /api/saju → Anthropic 프록시
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

      parsed.model = 'claude-haiku-4-5-20251001';
      const finalBody = JSON.stringify(parsed);

      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(finalBody),
          'x-api-key':         API_KEY.trim(),
          'anthropic-version': '2023-06-01',
        }
      };

      const proxy = https.request(options, (apiRes) => {
        console.log('[응답] Anthropic 상태코드:', apiRes.statusCode);
        if (apiRes.statusCode !== 200) {
          console.log('[디버그] API_KEY 앞 20자:', API_KEY ? API_KEY.trim().slice(0,20) : 'EMPTY');
          console.log('[디버그] 요청 모델:', parsed.model);
        }

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
  const urlPath = req.url.split('?')[0].split('#')[0]; // 파라미터·해시 제거
  // ads.txt 직접 처리
  if (urlPath === '/ads.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('google.com, pub-7771155449664842, DIRECT, f08c47fec0942fa0\n');
    return;
  }
  let filePath = (urlPath === '/' || urlPath === '') ? '/saju_app_local.html' : urlPath;
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

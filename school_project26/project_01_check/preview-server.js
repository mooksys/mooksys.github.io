'use strict';

// Local-only visual QA server. Password: demo
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PREVIEW_PORT || 4174);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};
const demoData = {
  status: '성공',
  sheetNames: ['3학년 12반', '3학년 11반', '실습 A반'],
  currentSheetName: '3학년 12반',
  headers: ['학번', '이름', 'UI/UX 기획서', 'React 미니 프로젝트', '정보처리 필기'],
  students: [
    { '학번': '31201', '이름': '김민준', 'UI/UX 기획서': '완료', 'React 미니 프로젝트': '완료', '정보처리 필기': '' },
    { '학번': '31202', '이름': '박서연', 'UI/UX 기획서': '완료', 'React 미니 프로젝트': '', '정보처리 필기': '완료' },
    { '학번': '31203', '이름': '이도윤', 'UI/UX 기획서': '', 'React 미니 프로젝트': '완료', '정보처리 필기': '' },
    { '학번': '31204', '이름': '최지우', 'UI/UX 기획서': '해당없음', 'React 미니 프로젝트': '완료', '정보처리 필기': '완료' },
    { '학번': '31205', '이름': '정하준', 'UI/UX 기획서': '완료', 'React 미니 프로젝트': '', '정보처리 필기': '' },
    { '학번': '31206', '이름': '한유진', 'UI/UX 기획서': '', 'React 미니 프로젝트': '해당없음', '정보처리 필기': '완료' },
    { '학번': '31207', '이름': '오지훈', 'UI/UX 기획서': '완료', 'React 미니 프로젝트': '완료', '정보처리 필기': '완료' },
    { '학번': '31208', '이름': '강예은', 'UI/UX 기획서': '', 'React 미니 프로젝트': '', '정보처리 필기': '해당없음' },
    { '학번': '31209', '이름': '윤시우', 'UI/UX 기획서': '완료', 'React 미니 프로젝트': '완료', '정보처리 필기': '' },
    { '학번': '31210', '이름': '신수빈', 'UI/UX 기획서': '완료', 'React 미니 프로젝트': '', '정보처리 필기': '완료' }
  ]
};

function sendJson(response, payload) {
  response.writeHead(200, { 'Content-Type': mimeTypes['.json'], 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(request.url.split('?')[0]);
  if (pathname === '/school_project_01_check_gas_url.json') return sendJson(response, { webAppUrl: '/api' });
  if (pathname === '/api' && request.method === 'POST') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      let params = {};
      try { params = JSON.parse(body); } catch (error) { return sendJson(response, { status: '실패', message: '잘못된 요청입니다.' }); }
      if (params.action === 'verify_password') {
        if (params.password !== 'demo') return sendJson(response, { status: '실패', message: '미리보기 비밀번호는 demo입니다.' });
        return sendJson(response, { status: '성공', sessionToken: 'a'.repeat(64), expireAt: Date.now() + 3600000 });
      }
      if (params.action === 'get_data') return sendJson(response, { ...demoData, currentSheetName: params.sheetName || demoData.currentSheetName });
      if (params.action === 'logout') return sendJson(response, { status: '성공' });
      return sendJson(response, { status: '성공' });
    });
    return;
  }

  const targetPath = pathname === '/' ? '/school_project_01_check.v0.7.html' : pathname;
  const filePath = path.resolve(root, '.' + targetPath);
  if (!filePath.startsWith(root)) { response.writeHead(403); response.end(); return; }
  fs.readFile(filePath, (error, bytes) => {
    if (error) { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(bytes);
  });
});

server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port} (password: demo)`));

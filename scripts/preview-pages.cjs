const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../docs');
const port = Number(process.env.PREVIEW_PORT || 3014);
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon'};
http.createServer((req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/FormReport\/?/,'').replace(/^\/+/,'') || 'index.html';
    const target = path.resolve(root,relative);
    if (!target.startsWith(root+path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(target,(error,data)=>{if(error){res.writeHead(404);return res.end('Arquivo não encontrado');}res.setHeader('Content-Type',mime[path.extname(target)] || 'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.end(data);});
  } catch {res.writeHead(400);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`Prévia: http://127.0.0.1:${port}/FormReport/`));

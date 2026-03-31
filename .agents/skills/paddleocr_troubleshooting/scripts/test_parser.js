const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = 28080;
const HOST = 'localhost';

async function testPaddleOCR() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage: node test_parser.js <path_to_pdf>");
        process.exit(1);
    }
    
    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    try {
        console.log(`[1/3] Authenticating as admin/admin123...`);
        const loginData = JSON.stringify({ username: 'admin', password: 'admin123' });
        const token = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: HOST, port: PORT, path: '/api/auth/login', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) }
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const parsed = JSON.parse(data);
                    if (!parsed.token) reject(new Error('Login failed: ' + data));
                    resolve(parsed.token);
                });
            });
            req.on('error', reject);
            req.write(loginData);
            req.end();
        });

        console.log(`[2/3] Uploading file for paddleocr parsing...`);
        const boundary = '----WebKitFormBoundary' + Math.random().toString(16).slice(2);
        const fileBytes = fs.readFileSync(filePath);
        
        const bodyHead = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\nContent-Type: application/pdf\r\n\r\n`
        );
        const bodyTail = Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="parser_type"\r\n\r\npaddleocr\r\n--${boundary}--\r\n`
        );
        const body = Buffer.concat([bodyHead, fileBytes, bodyTail]);

        const taskId = await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: HOST, port: PORT, path: '/api/contracts/upload', method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'multipart/form-data; boundary=' + boundary,
                    'Content-Length': body.length
                }
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(JSON.parse(data).id));
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });

        console.log(`[3/3] Polling task ${taskId}...`);
        while (true) {
            await new Promise(r => setTimeout(r, 2000));
            const resData = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: HOST, port: PORT, path: `/api/contracts/${taskId}`, method: 'GET',
                    headers: { 'Authorization': 'Bearer ' + token }
                }, res => {
                    let d = '';
                    res.on('data', chunk => d += chunk);
                    res.on('end', () => resolve(JSON.parse(d)));
                });
                req.on('error', reject);
                req.end();
            });
            
            if (resData.status === 'completed') {
                console.log('\n--- Analysis Results ---');
                const paras = resData.json_data.paragraphs || [];
                const pages = [...new Set(paras.map(p => p.page))];
                
                console.log(`Total Pages Processed: ${pages.length}`);
                console.log(`Total Paragraphs Extracted: ${paras.length}`);

                let hasIssues = false;
                for (const page of pages) {
                    const pageParas = paras.filter(p => p.page === page);
                    if (pageParas.length === 1) {
                        const p = pageParas[0];
                        const bbox = p.bbox;
                        if (bbox && bbox.length === 4 && bbox[0] === 0 && bbox[1] === 0) {
                            console.log(`[WARN] Page ${page} failed layout granularity test. It only has ONE paragraph covering the entire page (bbox: ${bbox}). Diff engine will fail.`);
                            hasIssues = true;
                        } else {
                            console.log(`[INFO] Page ${page} has ${pageParas.length} paragraphs.`);
                        }
                    } else if (pageParas.length === 0) {
                        console.log(`[WARN] Page ${page} has 0 paragraphs.`);
                    } else {
                        console.log(`[OK] Page ${page} successfully extracted ${pageParas.length} paragraphs.`);
                    }
                }

                if (hasIssues) {
                    console.log(`\n[DIAGNOSIS] Layout detection is likely DISABLED for PaddleOCR. This causes missing line-level coordinates and breaks the diffing engine.`);
                } else {
                    console.log(`\n[DIAGNOSIS] Layout detection appears well-formed. The engine should diff accurately.`);
                }
                break;
            } else if (resData.status === 'failed') {
                console.error('[ERROR] Task failed:', resData.error);
                break;
            } else {
                process.stdout.write('.');
            }
        }
    } catch (e) {
        console.error('\n[ERROR] Script failed:', e.message);
    }
}

testPaddleOCR();

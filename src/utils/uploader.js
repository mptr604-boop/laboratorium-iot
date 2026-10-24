// src/utils/uploader.js
// Native multipart/form-data stream parser for laboratory file attachments

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const IS_DOCKER = process.env.IS_DOCKER === 'true';
const UPLOADS_DIR = IS_DOCKER ? '/app/storage/uploads' : path.join(process.cwd(), 'src', 'storage', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function parseMultipartFormData(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/i);
    if (!boundaryMatch) return reject(new Error('Invalid multipart format.'));

    const boundary = `--${boundaryMatch[1]}`;
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const delimiterBuf = Buffer.from(boundary);
      const parts = splitBuffer(buffer, delimiterBuf);
      
      const result = { fields: {}, file: null };

      parts.forEach(part => {
        const headerEndIndex = part.indexOf("\r\n\r\n");
        if (headerEndIndex === -1) return;

        const headers = part.subarray(0, headerEndIndex).toString('utf8');
        const body = part.subarray(headerEndIndex + 4, part.length - 2);

        const nameMatch = headers.match(/name="([^"]+)"/);
        if (!nameMatch) return;

        const fieldName = nameMatch[1];
        const filenameMatch = headers.match(/filename="([^"]+)"/);

        if (filenameMatch && filenameMatch[1]) {
          const originalName = filenameMatch[1];
          const savedName = `${crypto.randomUUID()}${path.extname(originalName)}`;
          const fullPath = path.join(UPLOADS_DIR, savedName);

          fs.writeFileSync(fullPath, body);

          result.file = {
            originalName,
            savedName,
            size: body.length,
            path: fullPath
          };
        } else {
          result.fields[fieldName] = body.toString('utf8').trim();
        }
      });

      resolve(result);
    });
    req.on('error', err => reject(err));
  });
}

function splitBuffer(buf, delimiter) {
  const parts = [];
  let index = buf.indexOf(delimiter);
  while (index !== -1) {
    const currentPart = buf.subarray(0, index);
    if (currentPart.length > 0) parts.push(currentPart);
    buf = buf.subarray(index + delimiter.length);
    index = buf.indexOf(delimiter);
  }
  return parts;
}

// Backward-compatible alias
export const parsujFormularzZPlikiem = parseMultipartFormData;

'use strict';
/**
 * 生成 tabBar 图标（81x81 PNG，纯 Node 实现，无需外部依赖）
 * 风格：统一扁平风 —— 圆角方块 + 白色负空间图案
 * 运行：node scripts/gen-icons.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 81;

// ---- 简易 PNG 编码 ----
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(pixels) {
  // pixels: Uint8Array RGB, SIZE*SIZE*3
  const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 3 + 1)] = 0; // filter none
    for (let x = 0; x < SIZE * 3; x++) {
      raw[y * (SIZE * 3 + 1) + 1 + x] = pixels[y * SIZE * 3 + x];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- 图形绘制 ----

function makeCanvas() {
  return new Uint8Array(SIZE * SIZE * 3);
}

function blend(p, x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 3;
  const alpha = Math.min(Math.max(a, 0), 1);
  p[i] = Math.round(p[i] * (1 - alpha) + r * alpha);
  p[i + 1] = Math.round(p[i + 1] * (1 - alpha) + g * alpha);
  p[i + 2] = Math.round(p[i + 2] * (1 - alpha) + b * alpha);
}

/** 实心圆 */
function circle(p, cx, cy, rad, color) {
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      if (Math.hypot(x - cx, y - cy) <= rad) {
        blend(p, x, y, color[0], color[1], color[2], 1);
      }
    }
  }
}

/** 圆角矩形判定 */
function inRoundRect(x, y, box, rad) {
  if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return false;
  const cx = Math.max(box.x0 + rad, Math.min(x, box.x1 - rad));
  const cy = Math.max(box.y0 + rad, Math.min(y, box.y1 - rad));
  return Math.hypot(x - cx, y - cy) <= rad;
}

/** 填充圆角矩形 */
function fillRoundRect(p, box, rad, color) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inRoundRect(x, y, box, rad)) blend(p, x, y, color[0], color[1], color[2], 1);
    }
  }
}

const WHITE = [255, 255, 255];

/** 统一外框：圆角方块（两图标共用，保证风格一致） */
const FRAME = { x0: 13, y0: 13, x1: 68, y1: 68 };
const FRAME_RAD = 21;

/** 预约（日历）：白色表头条 + 挂环 + 日期圆点 */
function drawCalendar(p, color) {
  fillRoundRect(p, FRAME, FRAME_RAD, color);
  // 表头横条
  for (let y = 26; y <= 33; y++) {
    for (let x = 18; x <= 63; x++) blend(p, x, y, WHITE[0], WHITE[1], WHITE[2], 1);
  }
  // 挂环（白色圆点，嵌在表头两侧）
  circle(p, 28, 20, 3.4, WHITE);
  circle(p, 53, 20, 3.4, WHITE);
  // 日期圆点（白色，表头下方左右各一）
  circle(p, 28, 50, 5.2, WHITE);
  circle(p, 53, 50, 5.2, WHITE);
}

/** 我的（人）：白色圆头 + 圆肩 */
function drawPerson(p, color) {
  fillRoundRect(p, FRAME, FRAME_RAD, color);
  // 头
  circle(p, 40, 27, 11, WHITE);
  // 肩部（半圆 + 矩形）
  for (let y = 43; y <= 58; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (Math.hypot(x - 40, y - 60) <= 21 && y <= 60) {
        blend(p, x, y, WHITE[0], WHITE[1], WHITE[2], 1);
      }
    }
  }
}

const GRAY = [138, 148, 166];
const TEAL = [0, 184, 169];

const icons = {
  'tab-book.png': drawCalendar,
  'tab-book-on.png': drawCalendar,
  'tab-me.png': drawPerson,
  'tab-me-on.png': drawPerson
};

const outDir = path.join(__dirname, '..', 'miniprogram', 'images');
fs.mkdirSync(outDir, { recursive: true });

Object.keys(icons).forEach((name) => {
  const canvas = makeCanvas();
  icons[name](canvas, name.includes('on') ? TEAL : GRAY);
  fs.writeFileSync(path.join(outDir, name), encodePNG(canvas));
  console.log('生成', name);
});

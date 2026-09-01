'use strict';
/**
 * 极简 JSON 文件数据库
 * - 零依赖，数据保存在 server/data/ 目录下的 *.json 文件
 * - 内存缓存 + 原子写入（先写临时文件再 rename）
 * - 适合单人/小规模业务，上线后可平滑迁移到 MySQL / CloudBase
 */
const fs = require('fs');
const path = require('path');

class DB {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = {};
  }

  _file(name) {
    return path.join(this.dir, name + '.json');
  }

  /** 读取集合（首次读取后缓存在内存，修改后需调用 write 落盘） */
  read(name, fallback) {
    if (this.cache[name] !== undefined) return this.cache[name];
    let data = fallback;
    const f = this._file(name);
    if (fs.existsSync(f)) {
      try {
        data = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        console.error('[db] 读取失败', name, e.message);
        data = fallback;
      }
    }
    this.cache[name] = data;
    return data;
  }

  /** 将缓存中的集合写入磁盘 */
  write(name) {
    const data = this.cache[name];
    if (data === undefined) return;
    const f = this._file(name);
    const tmp = f + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, f);
    } catch (e) {
      console.error('[db] 写入失败', name, e.message);
    }
  }

  /** 直接替换整个集合并落盘 */
  save(name, data) {
    this.cache[name] = data;
    this.write(name);
  }
}

module.exports = { DB };

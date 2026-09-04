/**
 * 轻量 Markdown → rich-text nodes 解析器（零依赖）
 * 支持：# ## ### 标题、**加粗**、- / * 无序列表、1. 有序列表、> 引用、
 *       --- 分割线、![图片说明](图片链接)、换行分段。
 * 用法：const nodes = require('md.js').parse(mdText);  <rich-text nodes="{{nodes}}" />
 */

var STYLE = {
  h1: 'font-size:40rpx;font-weight:700;color:#111827;margin:28rpx 0 14rpx;',
  h2: 'font-size:36rpx;font-weight:700;color:#111827;margin:24rpx 0 12rpx;',
  h3: 'font-size:32rpx;font-weight:600;color:#1f2937;margin:20rpx 0 10rpx;',
  p: 'font-size:28rpx;line-height:1.75;color:#374151;margin:10rpx 0;',
  li: 'font-size:28rpx;line-height:1.75;color:#374151;margin:6rpx 0;',
  quote: 'font-size:26rpx;line-height:1.7;color:#4b5563;border-left:6rpx solid #00b8a9;background:#f0faf9;padding:14rpx 18rpx;margin:14rpx 0;border-radius:0 8rpx 8rpx 0;',
  quoteP: 'font-size:26rpx;line-height:1.7;color:#4b5563;margin:2rpx 0;',
  hr: 'border:none;border-top:1rpx solid #e5e7eb;margin:20rpx 0;',
  img: 'max-width:100%;width:100%;border-radius:12rpx;margin:12rpx 0;display:block;',
  strong: 'font-weight:700;color:#111827;'
};

/** 图片地址处理：以 / 开头的相对路径（服务端上传图片）自动拼上后端域名 */
function absImgUrl(u) {
  u = String(u || '');
  if (/^(https?:)?\/\//i.test(u) || !u) return u;
  if (u.charAt(0) === '/') {
    try {
      var app = getApp();
      var base = app && app.globalData && app.globalData.baseUrl;
      return base ? base.replace(/\/$/, '') + u : u;
    } catch (e) { return u; }
  }
  return u;
}

/** 行内解析：文本 + **加粗** + ![图片](链接) */
function parseInline(text) {
  var nodes = [];
  var rest = String(text);
  var IMG = /!\[([^\]]*)\]\(([^)\s]+)\)/;
  var BOLD = /\*\*([^*]+)\*\*/;
  while (rest.length) {
    var imgM = rest.match(IMG);
    var boldM = rest.match(BOLD);
    var imgIdx = imgM ? rest.indexOf(imgM[0]) : -1;
    var boldIdx = boldM ? rest.indexOf(boldM[0]) : -1;
    if (imgIdx < 0 && boldIdx < 0) {
      nodes.push({ type: 'text', text: rest });
      break;
    }
    var useImg = imgIdx >= 0 && (boldIdx < 0 || imgIdx <= boldIdx);
    if (useImg) {
      if (imgIdx > 0) nodes.push({ type: 'text', text: rest.slice(0, imgIdx) });
      nodes.push({ name: 'img', attrs: { src: absImgUrl(imgM[2]), style: STYLE.img } });
      rest = rest.slice(imgIdx + imgM[0].length);
    } else {
      if (boldIdx > 0) nodes.push({ type: 'text', text: rest.slice(0, boldIdx) });
      nodes.push({ name: 'strong', attrs: { style: STYLE.strong }, children: [{ type: 'text', text: boldM[1] }] });
      rest = rest.slice(boldIdx + boldM[0].length);
    }
  }
  return nodes;
}

function p(line) {
  return { name: 'p', attrs: { style: STYLE.p }, children: parseInline(line) };
}

/** 解析 markdown 文本为 rich-text nodes 数组 */
function parse(mdText) {
  var lines = String(mdText || '').replace(/\r\n?/g, '\n').split('\n');
  var nodes = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    var t = line.trim();
    if (!t) { i++; continue; }

    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      nodes.push({ name: 'hr', attrs: { style: STYLE.hr } });
      i++;
      continue;
    }
    // 标题
    var h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      var tag = 'h' + h[1].length;
      nodes.push({ name: tag, attrs: { style: STYLE[tag] }, children: parseInline(h[2]) });
      i++;
      continue;
    }
    // 引用块（连续 > 行合并）
    if (/^>\s?/.test(t)) {
      var quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      nodes.push({
        name: 'blockquote',
        attrs: { style: STYLE.quote },
        children: quoteLines.map(function (l) {
          return { name: 'p', attrs: { style: STYLE.quoteP }, children: parseInline(l) };
        })
      });
      continue;
    }
    // 无序列表（连续 - / * 行）
    if (/^[-*+]\s+/.test(t)) {
      var items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push({ name: 'li', attrs: { style: STYLE.li }, children: parseInline(lines[i].trim().replace(/^[-*+]\s+/, '')) });
        i++;
      }
      nodes.push({ name: 'ul', attrs: { style: 'margin:8rpx 0;padding-left:2em;' }, children: items });
      continue;
    }
    // 有序列表（连续 1. 2. 行）
    if (/^\d+[.、]\s+/.test(t)) {
      var olItems = [];
      while (i < lines.length && /^\d+[.、]\s+/.test(lines[i].trim())) {
        olItems.push({ name: 'li', attrs: { style: STYLE.li }, children: parseInline(lines[i].trim().replace(/^\d+[.、]\s+/, '')) });
        i++;
      }
      nodes.push({ name: 'ol', attrs: { style: 'margin:8rpx 0;padding-left:2em;' }, children: olItems });
      continue;
    }
    // 普通段落（单行一个 p，保留书写时的换行节奏）
    nodes.push(p(t));
    i++;
  }
  return nodes;
}

module.exports = { parse: parse };

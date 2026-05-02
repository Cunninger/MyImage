const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'public/icons/icon.svg');
const resDir = path.join(root, 'android/app/src/main/res');
const svgBuf = fs.readFileSync(svgPath);

// 各 dpi 对应的 launcher 图标尺寸（标准 Android 规范）
const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

// foreground 图标比 launcher 大 2.625x（图层规范），但内容居中
const fgSizes = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

// foreground 用纯渐变背景做大图（圆角扁平化）
const fgSvg = svgBuf.toString().replace('<rect width="512" height="512" fill="url(#bg)" rx="96"/>', '<rect width="512" height="512" fill="url(#bg)"/>');

(async () => {
  for (const [dir, size] of Object.entries(sizes)) {
    const out = path.join(resDir, dir);
    fs.mkdirSync(out, { recursive: true });
    const buf = await sharp(svgBuf).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(out, 'ic_launcher.png'), buf);
    fs.writeFileSync(path.join(out, 'ic_launcher_round.png'), buf);
    console.log(`✓ ${dir} (${size}x${size})`);
  }
  for (const [dir, size] of Object.entries(fgSizes)) {
    const out = path.join(resDir, dir);
    fs.mkdirSync(out, { recursive: true });
    const buf = await sharp(Buffer.from(fgSvg)).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(out, 'ic_launcher_foreground.png'), buf);
    console.log(`✓ ${dir}/foreground (${size}x${size})`);
  }
  console.log('All Android icons generated.');
})();

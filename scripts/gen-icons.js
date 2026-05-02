const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'public/icons/icon.svg');
const outDir = path.join(__dirname, '..', 'public/icons');
const svgBuf = fs.readFileSync(svgPath);

// 普通图标
const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

// 可遮罩图标（核心元素居中，留出 20% 安全边距）
const maskableSvg = svgBuf.toString().replace('<rect width="512" height="512" fill="url(#bg)" rx="96"/>', '<rect width="512" height="512" fill="url(#bg)"/>');

(async () => {
  for (const { name, size } of sizes) {
    await sharp(svgBuf).resize(size, size).png().toFile(path.join(outDir, name));
    console.log(`✓ ${name}`);
  }
  await sharp(Buffer.from(maskableSvg)).resize(512, 512).png().toFile(path.join(outDir, 'icon-maskable-512.png'));
  console.log('✓ icon-maskable-512.png');
})();

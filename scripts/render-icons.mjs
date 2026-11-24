import { readFileSync, writeFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const svg = readFileSync("src/app/icon.svg", "utf8");
const fullBleed = svg.replace('rx="7.5"', 'rx="0"');

async function render(page, markup, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${markup}</div></body>`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** An ICO file whose entries are PNGs, which every current browser reads. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  writeFileSync("src/app/apple-icon.png", await render(page, fullBleed, 180));
  console.log("src/app/apple-icon.png  180px");

  const images = [];
  for (const size of [16, 32]) images.push({ size, png: await render(page, svg, size) });
  writeFileSync("src/app/favicon.ico", ico(images));
  console.log("src/app/favicon.ico     16px + 32px");
} finally {
  await browser.close();
}

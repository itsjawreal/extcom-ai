import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const iconsDir = fileURLToPath(new URL("../public/icons/", import.meta.url));
const svg = readFileSync(`${iconsDir}icon.svg`, "utf8");

for (const size of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();
  writeFileSync(`${iconsDir}icon${size}.png`, png);
  console.log(`icon${size}.png written`);
}

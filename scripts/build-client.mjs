/**
 * Bundle the browser banner (src/client/banner.ts + @c15t/browser) into
 * dist/banner.js and dist/banner.css. Served by the plugin's public asset
 * route under a versioned, immutable-cached URL. No CDN.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
	entryPoints: [`${root}src/client/banner.ts`],
	bundle: true,
	minify: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	outfile: `${root}dist/banner.js`,
	// @c15t/browser ships its CSS via an import in banner.ts; esbuild emits it
	// alongside as dist/banner.css.
	loader: { ".css": "css" },
	logLevel: "info",
});

const kb = (p) => (statSync(p).size / 1024).toFixed(0);
console.log(`dist/banner.js  ${kb(`${root}dist/banner.js`)} KB`);
try {
	console.log(`dist/banner.css ${kb(`${root}dist/banner.css`)} KB`);
} catch {
	/* css may be inlined depending on the c15t entry */
}

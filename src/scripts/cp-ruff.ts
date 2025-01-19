import { copyFileSync } from 'fs';

const src = "node_modules/@astral-sh/ruff-wasm-nodejs/ruff_wasm_bg.wasm";
const dst = "bundled-out/ruff_wasm_bg.wasm";

copyFileSync(src, dst);

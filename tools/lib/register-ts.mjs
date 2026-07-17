// Entry point for `node --import ./tools/lib/register-ts.mjs <script>`.
// See ts-hooks.mjs for why this exists.
import { register } from 'node:module'
register('./ts-hooks.mjs', import.meta.url)

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // ponytail: serves the original game directory as-is so WACKY.DAT is fetched untouched;
  // narrow this to a copy step if the build ever gets deployed.
  publicDir: 'dos/WWINST',
});

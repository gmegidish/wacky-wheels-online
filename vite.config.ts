import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, isPreview }) => {
  const isPublished = command === 'build' || isPreview === true;
  return {
    // GitHub Pages serves the site from /<repository>/
    base: isPublished ? '/wacky-wheels-online/' : '/',
    // The dev server hands out the original WACKY.DAT from the local game folder. The build never includes it:
    // the published page asks each player for their own copy.
    publicDir: isPublished ? false : 'dos/WWINST',
  };
});

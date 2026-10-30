import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, isPreview }) => {
  const isPublished = command === 'build' || isPreview === true;
  return {
    // GitHub Pages serves the site from /<repository>/
    base: isPublished ? '/wacky-wheels-online/' : '/',
    // public/ holds the shareware WACKY.DAT, served next to the page in dev and in the build
  };
});

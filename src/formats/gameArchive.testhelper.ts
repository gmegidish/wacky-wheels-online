import { readFileSync } from 'node:fs';
import { type Archive, parseArchive } from './archive';

export function openGameArchive(): Archive {
  const path = new URL('../../dos/WWINST/WACKY.DAT', import.meta.url);
  return parseArchive(new Uint8Array(readFileSync(path)));
}

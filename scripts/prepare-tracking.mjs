import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dest = fileURLToPath(new URL('../src/mocap/face-runtime/', import.meta.url));
const pkg = fileURLToPath(new URL('../node_modules/@mediapipe/tasks-vision/', import.meta.url));
await mkdir(dest, { recursive: true });
for (const file of ['vision_bundle.mjs', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm']) {
    await copyFile(join(pkg, file), join(dest, file.split('/').pop()));
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
for (const [name, digest] of Object.entries({
    face_landmarker: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    hand_landmarker: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'
})) {
    const file = join(dest, name + '.task');
    const cached = await readFile(file).catch(error => {
        if (error.code !== 'ENOENT') throw error;
    });
    if (cached && sha256(cached) === digest) continue;
    const url = 'https://storage.googleapis.com/mediapipe-models/' + name + '/' + name + '/float16/1/' + name + '.task';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not download ' + name + ' (HTTP ' + response.status + ')');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== digest) throw new Error('Unexpected checksum for ' + name);
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
        await writeFile(temporary, bytes);
        await rename(temporary, file);
    } finally {
        await rm(temporary, { force: true });
    }
}

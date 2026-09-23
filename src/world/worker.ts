import { generateChunk } from './terrain';

export interface GenRequest {
  type: 'gen';
  id: number;
  cx: number;
  cz: number;
  seed: number;
}

export interface GenResponse {
  type: 'gen';
  id: number;
  cx: number;
  cz: number;
  buffer: ArrayBuffer;
}

self.onmessage = (e: MessageEvent<GenRequest>) => {
  const msg = e.data;
  if (msg.type !== 'gen') return;
  const data = generateChunk(msg.cx, msg.cz, msg.seed);
  const resp: GenResponse = {
    type: 'gen',
    id: msg.id,
    cx: msg.cx,
    cz: msg.cz,
    buffer: data.buffer as ArrayBuffer,
  };
  self.postMessage(resp, [resp.buffer]);
};

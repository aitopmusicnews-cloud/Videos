import type WaveSurfer from "wavesurfer.js";

let instance: WaveSurfer | null = null;

export function getWs(): WaveSurfer | null {
  return instance;
}

export function setWs(ws: WaveSurfer | null): void {
  instance = ws;
}

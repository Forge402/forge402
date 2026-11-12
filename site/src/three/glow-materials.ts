import * as THREE from 'three'

// ShaderMaterial output is not colour-managed, so keep colours as raw sRGB triples.
const rgb = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace)
export const EMBER = rgb(0xff5a1f)
export const HOT = rgb(0xffb547)
export const WHITE_HOT = rgb(0xfff1d2)

const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
} as const

/** Soft radial gradient used for halos and bloom-like glow sprites. */
export function createGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.14)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const tubeVert = /* glsl */ `
varying vec3 vN;
varying vec2 vUv;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const tubeFrag = /* glsl */ `
uniform float uHead, uHead2, uBase, uGain, uGain2, uTail, uPow, uFadeIn, uFadeOut;
uniform vec3 uEdge, uMid, uCore;
varying vec3 vN;
varying vec2 vUv;
float pulse(float head, float u, float tail) {
  float d = head - u;
  return d > 0.0 ? exp(-d * tail) : exp(d * 38.0);
}
void main() {
  float f = clamp(vN.z, 0.0, 1.0);
  float prof = pow(f, uPow);
  float u = vUv.x;
  float inten = uBase + uGain * pulse(uHead, u, uTail) + uGain2 * pulse(uHead2, u, uTail * 1.6);
  float heat = prof * inten;
  float fade = smoothstep(0.0, uFadeIn, u) * (1.0 - smoothstep(1.0 - uFadeOut, 1.0, u));
  vec3 col = mix(uEdge, uMid, smoothstep(0.05, 0.55, heat));
  col = mix(col, uCore, smoothstep(0.55, 1.25, heat));
  gl_FragColor = vec4(col, clamp(heat * fade, 0.0, 1.0));
}`

export type TubeParams = {
  base: number
  gain: number
  gain2?: number
  tail: number
  pow: number
  fadeIn?: number
  fadeOut?: number
}

/** Additive tube shader: radial falloff (white core -> ember rim) plus travelling light pulses along the length. */
export function createTubeMaterial(p: TubeParams) {
  return new THREE.ShaderMaterial({
    vertexShader: tubeVert,
    fragmentShader: tubeFrag,
    uniforms: {
      uHead: { value: -1 },
      uHead2: { value: -1 },
      uBase: { value: p.base },
      uGain: { value: p.gain },
      uGain2: { value: p.gain2 ?? 0 },
      uTail: { value: p.tail },
      uPow: { value: p.pow },
      uFadeIn: { value: p.fadeIn ?? 0.001 },
      uFadeOut: { value: p.fadeOut ?? 0.001 },
      uEdge: { value: EMBER },
      uMid: { value: HOT },
      uCore: { value: WHITE_HOT },
    },
    ...additive,
  })
}

const sparkVert = /* glsl */ `
attribute vec3 aVel;
attribute vec3 aOff;
attribute float aSeed;
uniform float uT, uPx, uPow;
varying float vLife;
void main() {
  float life = 0.32 + aSeed * 0.62;
  float k = 1.9;
  float s = (1.0 - exp(-k * uT)) / k;
  vec3 p = aOff + aVel * s * uPow;
  p.y -= 5.5 * uT * uT * 0.5;
  if (p.y < 0.0) p.y = -p.y * 0.3; // bounce off the striking face
  vLife = uT / life;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float alive = step(vLife, 1.0);
  gl_PointSize = uPx * (0.4 + (1.0 - vLife)) * (0.8 + aSeed * 1.6) * alive * (10.0 / -mv.z);
}`

const sparkFrag = /* glsl */ `
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.4);
  vec3 col = mix(vec3(1.0, 0.36, 0.1), vec3(1.0, 0.93, 0.75), clamp(1.0 - vLife * 1.3, 0.0, 1.0));
  gl_FragColor = vec4(col, a * pow(clamp(1.0 - vLife, 0.0, 1.0), 0.6));
}`

export function createSparkMaterial(px: number) {
  return new THREE.ShaderMaterial({
    vertexShader: sparkVert,
    fragmentShader: sparkFrag,
    uniforms: { uT: { value: 99 }, uPx: { value: px }, uPow: { value: 1 } },
    ...additive,
  })
}

const emberVert = /* glsl */ `
attribute vec4 aSeed; // phase, speed, size, flicker
uniform float uTime, uPx;
varying float vA;
varying float vHot;
void main() {
  vec3 p = position;
  float range = 10.0;
  p.y = mod(p.y + uTime * aSeed.y * 1.5 + 5.0, range) - 5.0;
  p.x += sin(uTime * 0.6 + aSeed.x * 6.28) * 0.25 + sin(p.y * 0.9 + aSeed.x * 20.0 + uTime * 0.4) * 0.18;
  p.z += cos(uTime * 0.5 + aSeed.x * 9.0) * 0.2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float edge = smoothstep(-5.0, -3.2, p.y) * (1.0 - smoothstep(3.2, 5.0, p.y));
  float flick = 0.65 + 0.35 * sin(uTime * (2.0 + aSeed.w * 4.0) + aSeed.x * 40.0);
  vA = edge * flick * (0.35 + 0.65 * aSeed.z);
  vHot = aSeed.z;
  gl_PointSize = uPx * (0.6 + aSeed.z * 1.5) * (14.0 / -mv.z);
}`

const emberFrag = /* glsl */ `
varying float vA;
varying float vHot;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6);
  vec3 col = mix(vec3(1.0, 0.33, 0.1), vec3(1.0, 0.76, 0.34), vHot);
  gl_FragColor = vec4(col, a * vA);
}`

export function createEmberMaterial(px: number) {
  return new THREE.ShaderMaterial({
    vertexShader: emberVert,
    fragmentShader: emberFrag,
    uniforms: { uTime: { value: 0 }, uPx: { value: px } },
    ...additive,
  })
}

const faceVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

const faceFrag = /* glsl */ `
uniform float uGlow, uCx;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  float x = (vUv.x - uCx) * uSize.x;
  float z = (vUv.y - 0.5) * uSize.y;
  float core = exp(-(x * x) / 0.05) * exp(-(z * z) / 0.5);
  float wide = exp(-(x * x) / 0.35) * exp(-(z * z) / 0.8);
  float h = (0.14 + 0.35 * wide + 0.75 * core) * uGlow;
  vec3 col = mix(vec3(0.55, 0.12, 0.03), vec3(1.0, 0.36, 0.1), smoothstep(0.0, 0.3, h));
  col = mix(col, vec3(1.0, 0.72, 0.28), smoothstep(0.25, 0.6, h));
  col = mix(col, vec3(1.0, 0.96, 0.85), smoothstep(0.65, 1.1, h));
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
  gl_FragColor = vec4(col, clamp(h, 0.0, 1.0) * edge);
}`

export function createStrikeFaceMaterial(width: number, depth: number, cx: number) {
  return new THREE.ShaderMaterial({
    vertexShader: faceVert,
    fragmentShader: faceFrag,
    uniforms: { uGlow: { value: 0.5 }, uCx: { value: cx }, uSize: { value: new THREE.Vector2(width, depth) } },
    ...additive,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}


import * as THREE from 'three'

// Tiny procedural HDR studio (equirect, 64x32): dark warm room + a few soft panels.
// Replaces RoomEnvironment (a scene of ~dozen lit meshes rendered into a cube) so we only pay one cheap PMREM pass.
const PANELS: { dir: [number, number, number]; k: number; rgb: [number, number, number] }[] = [
  { dir: [-0.2, 1, 0.35], k: 5, rgb: [7, 7, 7.2] }, // top softbox
  { dir: [-0.75, 0.45, -0.55], k: 7, rgb: [2.2, 3.0, 5.2] }, // cool rim
  { dir: [0.35, -0.3, 0.9], k: 5, rgb: [3.2, 1.3, 0.45] }, // warm front-low bounce
  { dir: [0.95, 0.25, 0.2], k: 6, rgb: [2.6, 2.4, 2.2] }, // side strip
]

export function createStudioEnvTexture() {
  const w = 64
  const h = 32
  const data = new Float32Array(w * h * 4)
  const d = new THREE.Vector3()
  const pd = PANELS.map((p) => new THREE.Vector3(...p.dir).normalize())
  for (let y = 0; y < h; y++) {
    const lat = Math.PI * (0.5 - (y + 0.5) / h)
    for (let x = 0; x < w; x++) {
      const lon = 2 * Math.PI * ((x + 0.5) / w) - Math.PI
      d.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon))
      const sky = 0.24 + 0.4 * Math.max(0, d.y)
      let r = sky * 1.1
      let g = sky
      let b = sky * 0.9
      PANELS.forEach((p, i) => {
        const e = Math.exp((d.dot(pd[i]) - 1) * p.k * 1.5)
        r += p.rgb[0] * e
        g += p.rgb[1] * e
        b += p.rgb[2] * e
      })
      const o = (y * w + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = 1
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType)
  t.mapping = THREE.EquirectangularReflectionMapping
  t.magFilter = t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

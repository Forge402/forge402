import * as THREE from 'three'

// Anvil in local space: horn points to -X, striking face is the flat top at y = FACE_Y.
export const FACE_Y = 0.62
export const FACE_X0 = -0.5
export const FACE_X1 = 0.9
export const ANVIL_DEPTH = 0.8

/** Side silhouette (face, step, tail, waist, flared base) extruded along Z with small bevels. */
export function createAnvilBodyGeometry() {
  const s = new THREE.Shape()
  s.moveTo(-0.55, FACE_Y)
  s.lineTo(FACE_X1, FACE_Y)
  s.lineTo(FACE_X1, 0.5) // step down to the cutting table
  s.lineTo(1.55, 0.5)
  s.lineTo(1.55, 0.3)
  s.lineTo(0.98, 0.2)
  s.quadraticCurveTo(0.58, 0.08, 0.55, -0.2) // waist, tail side
  s.quadraticCurveTo(0.52, -0.46, 0.8, -0.6)
  s.lineTo(1.02, -0.64)
  s.lineTo(1.02, -0.86)
  s.lineTo(-0.72, -0.86)
  s.lineTo(-0.72, -0.64)
  s.lineTo(-0.52, -0.6)
  s.quadraticCurveTo(-0.38, -0.46, -0.4, -0.2) // waist, horn side
  s.quadraticCurveTo(-0.42, -0.02, -0.58, 0.04)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, {
    depth: ANVIL_DEPTH,
    bevelEnabled: true,
    bevelSize: 0.028,
    bevelThickness: 0.035,
    bevelSegments: 2,
    curveSegments: 8,
  })
  g.translate(0, 0, -ANVIL_DEPTH / 2)
  return g
}

/** Tapered, slightly upturned horn (lathe), root sits inside the body shoulder. */
export function createAnvilHornGeometry() {
  const L = 1.5
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    const r = 0.3 * Math.pow(1 - t, 1.25) + 0.035 * (1 - t) + 0.012
    pts.push(new THREE.Vector2(r, t * L))
  }
  pts.push(new THREE.Vector2(0, L))
  const g = new THREE.LatheGeometry(pts, 32)
  g.rotateZ(Math.PI / 2) // length runs toward -X
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const t = -p.getX(i) / L
    p.setY(i, p.getY(i) + 0.1 * t * t) // upturned tip
    p.setZ(i, p.getZ(i) * 1.3) // flatter, wider like the body
  }
  g.translate(-0.45, 0.33, 0)
  g.computeVertexNormals()
  return g
}

/** Small noise map used as roughness variation so the metal reads as forged, not CG-smooth. */
export function createForgedRoughnessMap() {
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let i = 0; i < n * n; i++) {
    const v = 150 + Math.random() * 105
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  const t = new THREE.DataTexture(data, n, n)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(3, 3)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

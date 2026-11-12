import * as THREE from 'three'
import { createStudioEnvTexture } from './studio-env'
import {
  ANVIL_DEPTH,
  FACE_X0,
  FACE_X1,
  FACE_Y,
  createAnvilBodyGeometry,
  createAnvilHornGeometry,
  createForgedRoughnessMap,
} from './anvil-geometry'
import {
  createEmberMaterial,
  createGlowTexture,
  createSparkMaterial,
  createStrikeFaceMaterial,
  createTubeMaterial,
} from './glow-materials'

export type ForgeSceneOptions = {
  /** DOM chips, projected next to the beam ends every frame. Extra chips are hidden in compact mode. */
  chips: HTMLElement[]
  reducedMotion: boolean
  onReady?: () => void
  /** debug/preview only: freeze the timeline at this time (seconds) */
  staticTime?: number
}

const CYCLE = 1.2 // seconds between hits (alternating light / heavy strike)
const HIT = 0.36 // moment of impact inside a cycle = travel time of the stream pulse

// Beam end points, rig space (origin = strike point on the anvil face)
const ENDS_WIDE: [number, number][] = [
  [2.2, 2.6], [2.65, 1.98], [2.95, 1.38], [3.1, 0.8], [3.1, 0.22], [2.95, -0.36], [2.65, -0.94], [2.2, -1.5],
]
const ENDS_COMPACT: [number, number][] = [
  [1.3, 2.2], [1.75, 1.5], [1.9, 0.8], [1.75, 0.1], [1.3, -0.6],
]

/** frozen frame (reduced motion, poster): just after a heavy strike, sparks in the air */
export const STILL_T = CYCLE + HIT + 0.13

const damp = (cur: number, target: number, dt: number, k = 9) => cur + (target - cur) * (1 - Math.exp(-dt * k))

export function createForgeScene(container: HTMLElement, opts: ForgeSceneOptions) {
  const { chips, reducedMotion } = opts

  let w = Math.max(1, container.clientWidth)
  let h = Math.max(1, container.clientHeight)
  let compact = w < 560

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  const canvas = renderer.domElement
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .4s ease'
  container.prepend(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 60)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envSrc = createStudioEnvTexture()
  const envRT = pmrem.fromEquirectangular(envSrc)
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.95
  scene.environmentRotation.set(0, 0.9, 0)

  const glowTex = createGlowTexture()
  const disposables: { dispose(): void }[] = [glowTex, envRT, pmrem, envSrc]
  const track = <T extends { dispose(): void }>(o: T) => (disposables.push(o), o)

  // ---- rig: origin is the strike point ----
  const rig = new THREE.Group()
  scene.add(rig)
  const anvilPivot = new THREE.Group() // tilts toward the pointer, pivot = strike point
  rig.add(anvilPivot)
  const anvil = new THREE.Group()
  anvil.position.set(-0.2, -FACE_Y, 0)
  anvilPivot.add(anvil)

  const metal = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x3a3e46,
      metalness: 0.92,
      roughness: 0.36,
      roughnessMap: track(createForgedRoughnessMap()),
      clearcoat: 0.45,
      clearcoatRoughness: 0.28,
    }),
  )
  const bodyGeo = track(createAnvilBodyGeometry())
  const hornGeo = track(createAnvilHornGeometry())
  anvil.add(new THREE.Mesh(bodyGeo, metal), new THREE.Mesh(hornGeo, metal))

  // hardy + pritchel holes on the cutting table
  const holeMat = track(new THREE.MeshBasicMaterial({ color: 0x050403 }))
  const holeGeo = track(new THREE.CylinderGeometry(0.075, 0.075, 0.01, 24))
  const hole = new THREE.Mesh(holeGeo, holeMat)
  hole.position.set(1.2, 0.5 + 0.036, 0)
  const hole2 = hole.clone()
  hole2.scale.setScalar(0.55)
  hole2.position.set(1.42, 0.5 + 0.036, 0.12)
  anvil.add(hole, hole2)

  // striking face: ember -> white-hot gradient strip that pulses on every hit
  const faceW = FACE_X1 - FACE_X0
  const faceMat = track(createStrikeFaceMaterial(faceW, ANVIL_DEPTH, (0.2 - FACE_X0) / faceW))
  const faceGeo = track(new THREE.PlaneGeometry(faceW, ANVIL_DEPTH * 0.92))
  const face = new THREE.Mesh(faceGeo, faceMat)
  face.rotation.x = -Math.PI / 2
  face.position.set((FACE_X0 + FACE_X1) / 2, FACE_Y + 0.036, 0)
  face.renderOrder = 4
  anvil.add(face)

  // lights
  const key = new THREE.PointLight(0xff7a2e, 10, 7, 2)
  key.position.set(0.2, 0.7, 0.8)
  const fillWarm = new THREE.PointLight(0xff5a1f, 8, 9, 2)
  fillWarm.position.set(0.4, -1.2, 2.4)
  const rim = new THREE.DirectionalLight(0xb9ccff, 2.6)
  rim.position.set(-3, 3.5, -2.5)
  const top = new THREE.DirectionalLight(0xffffff, 0.9)
  top.position.set(-1.5, 4, 3)
  rig.add(key, fillWarm)
  scene.add(rim, top)

  const noDepth = (m: THREE.Mesh | THREE.Points, order: number) => {
    m.renderOrder = order
    m.frustumCulled = false
    ;(m.material as THREE.ShaderMaterial).depthTest = false
  }

  // ---- molten stream ----
  const streamCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(-4.7, 1.05, -0.4),
      new THREE.Vector3(-3.5, 1.2, -0.1),
      new THREE.Vector3(-2.2, 0.85, 0.05),
      new THREE.Vector3(-0.9, 0.38, 0.02),
      new THREE.Vector3(0, 0.015, 0),
    ],
    false,
    'catmullrom',
    0.5,
  )
  const streamCore = track(createTubeMaterial({ base: 0.32, gain: 1.5, tail: 2.4, pow: 1.3, fadeIn: 0.4, fadeOut: 0.0 }))
  const streamGlow = track(createTubeMaterial({ base: 0.08, gain: 0.5, tail: 2.0, pow: 1.8, fadeIn: 0.45 }))
  const streamGeoCore = track(new THREE.TubeGeometry(streamCurve, 80, 0.035, 8, false))
  const streamGeoGlow = track(new THREE.TubeGeometry(streamCurve, 80, 0.17, 8, false))
  const streamGlowMesh = new THREE.Mesh(streamGeoGlow, streamGlow)
  const streamCoreMesh = new THREE.Mesh(streamGeoCore, streamCore)
  noDepth(streamGlowMesh, 10)
  noDepth(streamCoreMesh, 11)
  rig.add(streamGlowMesh, streamCoreMesh)

  // ---- sprites: strike halo, flash ----
  const spriteMat = (color: number) =>
    track(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }))
  const halo = new THREE.Sprite(spriteMat(0xff5a1f))
  halo.renderOrder = 5
  const flash = new THREE.Sprite(spriteMat(0xfff0d0))
  flash.renderOrder = 20
  rig.add(halo, flash)

  // ---- sparks ----
  const SPARKS = compact ? 170 : 300
  const sparkGeo = track(new THREE.BufferGeometry())
  const sVel = new Float32Array(SPARKS * 3)
  const sOff = new Float32Array(SPARKS * 3)
  const sSeed = new Float32Array(SPARKS)
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3))
  sparkGeo.setAttribute('aVel', new THREE.BufferAttribute(sVel, 3))
  sparkGeo.setAttribute('aOff', new THREE.BufferAttribute(sOff, 3))
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 1))
  const seedSparks = () => {
    for (let i = 0; i < SPARKS; i++) {
      const theta = Math.pow(Math.random(), 0.8) * 1.25 // angle from vertical
      const phi = Math.random() * Math.PI * 2
      const speed = 2.2 + Math.pow(Math.random(), 1.6) * 7.4
      sVel[i * 3] = Math.cos(phi) * Math.sin(theta) * speed + speed * 0.28
      sVel[i * 3 + 1] = Math.cos(theta) * speed * 0.95
      sVel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed * 0.7
      sOff[i * 3] = (Math.random() - 0.5) * 0.35
      sOff[i * 3 + 1] = 0.03
      sOff[i * 3 + 2] = (Math.random() - 0.5) * 0.3
      sSeed[i] = Math.random()
    }
    sparkGeo.attributes.aVel.needsUpdate = true
    sparkGeo.attributes.aOff.needsUpdate = true
    sparkGeo.attributes.aSeed.needsUpdate = true
  }
  seedSparks()
  const sparkMat = track(createSparkMaterial(0))
  const sparkPts = new THREE.Points(sparkGeo, sparkMat)
  noDepth(sparkPts, 15)
  rig.add(sparkPts)

  // ---- rising embers (world space) ----
  const EMBERS = compact ? 200 : 400
  const emberGeo = track(new THREE.BufferGeometry())
  const ePos = new Float32Array(EMBERS * 3)
  const eSeed = new Float32Array(EMBERS * 4)
  for (let i = 0; i < EMBERS; i++) {
    ePos[i * 3] = (Math.random() - 0.5) * 14
    ePos[i * 3 + 1] = Math.random() * 10 - 5
    ePos[i * 3 + 2] = -2.5 + Math.random() * 4
    eSeed[i * 4] = Math.random()
    eSeed[i * 4 + 1] = 0.12 + Math.random() * 0.4
    eSeed[i * 4 + 2] = Math.random()
    eSeed[i * 4 + 3] = Math.random()
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3))
  emberGeo.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 4))
  const emberMat = track(createEmberMaterial(0))
  const embers = new THREE.Points(emberGeo, emberMat)
  noDepth(embers, 1)
  scene.add(embers)

  // ---- beams (rebuilt when the layout flips between wide and compact) ----
  type Beam = { mats: THREE.ShaderMaterial[]; node: THREE.Sprite; end: THREE.Vector3; hit: number }
  let beams: Beam[] = []
  let beamGroup: THREE.Group | null = null
  const beamDisposables: { dispose(): void }[] = []
  // compact mode shows the middle chips (shortest model ids) on 5 beams
  const chipSlot = (i: number) => (compact ? i - 2 : i)
  const buildBeams = () => {
    if (beamGroup) rig.remove(beamGroup)
    beamDisposables.forEach((d) => d.dispose())
    beamDisposables.length = 0
    beams = []
    const group = new THREE.Group()
    beamGroup = group
    const ends = compact ? ENDS_COMPACT : ENDS_WIDE
    ends.forEach(([x, y]) => {
      const end = new THREE.Vector3(x, y, 0.05)
      const ctrl = new THREE.Vector3(x * 0.55, y * 0.2 + 0.12, 0.08)
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.02, 0.05, 0), ctrl, end)
      const core = createTubeMaterial({ base: 0.2, gain: 1.25, gain2: 0.5, tail: 3.2, pow: 1.5, fadeIn: 0.04, fadeOut: 0.12 })
      const glow = createTubeMaterial({ base: 0.05, gain: 0.45, gain2: 0.2, tail: 2.5, pow: 1.7, fadeIn: 0.04, fadeOut: 0.18 })
      const gThin = new THREE.TubeGeometry(curve, 40, 0.013, 5, false)
      const gWide = new THREE.TubeGeometry(curve, 40, 0.075, 6, false)
      const mWide = new THREE.Mesh(gWide, glow)
      const mThin = new THREE.Mesh(gThin, core)
      noDepth(mWide, 8)
      noDepth(mThin, 9)
      const nodeMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a2e, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true })
      const node = new THREE.Sprite(nodeMat)
      node.position.copy(end)
      node.renderOrder = 12
      group.add(mWide, mThin, node)
      beamDisposables.push(core, glow, gThin, gWide, nodeMat)
      beams.push({ mats: [core, glow], node, end, hit: 0 })
    })
    rig.add(group)
    chips.forEach((c, i) => {
      c.style.display = chipSlot(i) < ends.length && chipSlot(i) >= 0 ? 'inline-flex' : 'none'
      c.style.fontSize = compact ? '10.5px' : '12px'
      c.style.gap = compact ? '6px' : '8px'
    })
  }

  // ---- sizing ----
  const frame = { cx: 0.4, cy: 0.55 }
  const layoutCamera = () => {
    const aspect = w / h
    const needW = compact ? 8 : 10.6
    const needH = compact ? 5.2 : 5.6
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const dist = Math.max(needH / 2 / tan, needW / aspect / 2 / tan)
    frame.cx = compact ? 1.1 : 0.15
    frame.cy = compact ? 0.45 : 0.05
    camera.aspect = aspect
    camera.position.set(frame.cx, frame.cy + dist * 0.07, dist)
    camera.lookAt(frame.cx, frame.cy, 0)
    camera.updateProjectionMatrix()
  }
  let started = false
  let disposed = false
  const resize = () => {
    w = Math.max(1, container.clientWidth)
    h = Math.max(1, container.clientHeight)
    const nextCompact = w < 560
    const dpr = Math.min(window.devicePixelRatio || 1, nextCompact ? 1.5 : 1.75)
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    sparkMat.uniforms.uPx.value = 6.5 * dpr
    emberMat.uniforms.uPx.value = 4.2 * dpr
    if (nextCompact !== compact || beams.length === 0) {
      compact = nextCompact
      buildBeams()
    }
    layoutCamera()
    if (!running && started) renderOnce()
  }

  // ---- pointer parallax ----
  let tx = 0
  let ty = 0
  let px = 0
  let py = 0
  const onPointer = (e: PointerEvent) => {
    const r = container.getBoundingClientRect()
    tx = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.4, 1.4)
    ty = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.4, 1.4)
  }
  if (!reducedMotion) window.addEventListener('pointermove', onPointer, { passive: true })

  // ---- per-frame update ----
  const tmp = new THREE.Vector3()
  const hitCache = new Float32Array(16).fill(-1)
  let time = reducedMotion ? STILL_T : 0
  let lastSince = 99
  const update = (dt: number, t: number) => {
    const tc = t % CYCLE
    const since = tc >= HIT ? tc - HIT : tc + CYCLE - HIT
    if (since < lastSince) seedSparks()
    lastSince = since
    // the strike that lands at the end of this cycle: odd = heavy, even = light
    const strike = Math.floor((t - HIT) / CYCLE) % 2 === 1 ? 1 : 0.66

    px = damp(px, tx, dt)
    py = damp(py, ty, dt)
    rig.position.y = Math.sin(t * 1.5) * 0.05
    anvilPivot.scale.setScalar(compact ? 1.05 : 1.18)
    anvilPivot.rotation.set(0.3 + py * 0.05, 0.3 + px * 0.14, Math.sin(t * 1.1) * 0.012)

    const head = Math.pow(tc / HIT, 1.6)
    streamCore.uniforms.uHead.value = head
    streamGlow.uniforms.uHead.value = head
    const flashK = Math.exp(-since * 15) * strike
    const pre = tc < HIT ? THREE.MathUtils.smoothstep(tc / HIT, 0.55, 1) : 0
    const glowK = 0.38 + 0.62 * strike * Math.exp(-since * 4.5) + 0.35 * pre
    faceMat.uniforms.uGlow.value = glowK
    key.intensity = 6 + glowK * 7 + flashK * 70
    fillWarm.intensity = 5 + 6 * strike * Math.exp(-since * 3.5)

    halo.scale.setScalar(1.8 + glowK * 1.2)
    halo.material.opacity = 0.32 + glowK * 0.4
    flash.scale.setScalar(0.5 + flashK * 2.4)
    flash.material.opacity = Math.min(1, flashK * 1.2)

    sparkMat.uniforms.uT.value = since
    sparkMat.uniforms.uPow.value = 0.8 + 0.3 * strike
    emberMat.uniforms.uTime.value = t

    beams.forEach((b, i) => {
      const s = since - i * 0.02
      const head1 = s < 0 ? -1 : s * 4 // pulse reaches the chip ~0.25 s after impact
      const head2 = (t * 0.55 + i * 0.173) % 1.6
      for (const m of b.mats) {
        m.uniforms.uHead.value = head1
        m.uniforms.uHead2.value = head2
      }
      b.hit = s > 0.25 ? Math.exp(-(s - 0.25) * 5) * strike : 0
      b.node.scale.setScalar(0.28 + b.hit * 0.55)
      b.node.material.opacity = 0.55 + b.hit * 0.45
    })

    // project beam ends to the chips (DOM)
    rig.updateMatrixWorld(true)
    camera.updateMatrixWorld()
    const gap = compact ? 7 : 9
    chips.forEach((c, i) => {
      const show = chipSlot(i) >= 0 && chipSlot(i) < beams.length
      if (c.style.display !== (show ? 'inline-flex' : 'none')) c.style.display = show ? 'inline-flex' : 'none'
    })
    // screen positions first, then keep chips apart (top to bottom) and inside the stage
    const placed: { el: HTMLElement; i: number; x: number; y: number; hh: number }[] = []
    beams.forEach((b, i) => {
      const el = chips[compact ? i + 2 : i]
      if (!el) return
      tmp.copy(b.end).applyMatrix4(rig.matrixWorld).project(camera)
      const x = Math.max(8, Math.min((tmp.x * 0.5 + 0.5) * w + gap, w - el.offsetWidth - 10)) // long ids stay inside the stage
      placed.push({ el, i, x, y: (-tmp.y * 0.5 + 0.5) * h, hh: el.offsetHeight / 2 })
    })
    placed.sort((a, b) => a.y - b.y)
    let prev = -Infinity
    for (const p of placed) {
      p.y = Math.max(p.y, p.hh + 6, prev + p.hh + 6)
      prev = p.y + p.hh
    }
    for (let k = placed.length - 1, limit = h - 6; k >= 0; k--) {
      const p = placed[k]
      p.y = Math.min(p.y, limit - p.hh)
      limit = p.y - p.hh - 6
    }
    for (const p of placed) {
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) translate(0,-50%)`
      const hv = Math.round(beams[p.i].hit * 100) / 100
      if (hitCache[p.i] !== hv) {
        hitCache[p.i] = hv
        p.el.style.setProperty('--hit', String(hv))
      }
    }
  }

  function renderOnce() {
    update(0.016, opts.staticTime ?? time)
    renderer.render(scene, camera)
  }

  // ---- loop control ----
  let running = false
  let raf = 0
  let last = 0
  let visible = true
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    time += dt
    update(dt, time)
    renderer.render(scene, camera)
  }
  const sync = () => {
    const want = visible && !document.hidden && !reducedMotion && opts.staticTime === undefined
    if (want && !running) {
      running = true
      last = performance.now()
      raf = requestAnimationFrame(tick)
    } else if (!want && running) {
      running = false
      cancelAnimationFrame(raf)
    }
  }
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    sync()
  })
  io.observe(container)
  document.addEventListener('visibilitychange', sync)
  const ro = new ResizeObserver(resize)
  ro.observe(container)

  resize()
  // compile every program off the main thread (KHR_parallel_shader_compile), then show the first frame
  const start = () => {
    if (disposed) return
    started = true
    renderOnce()
    canvas.style.opacity = '1'
    sync()
    requestAnimationFrame(() => opts.onReady?.())
  }
  renderer.compileAsync(scene, camera).then(start, start)

  return {
    dispose() {
      disposed = true
      running = false
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pointermove', onPointer)
      beamDisposables.forEach((d) => d.dispose())
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
      canvas.remove()
    },
  }
}

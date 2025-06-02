import GUI from 'lil-gui'
import {
  AmbientLight,
  AxesHelper,
  BoxGeometry,
  Clock,
  GridHelper,
  LoadingManager,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  PointLightHelper,
  Scene,
  WebGLRenderer,
  MeshBasicMaterial,
  DoubleSide,
  RepeatWrapping,
  Object3D,
  Vector3,
  BufferGeometry,
  BufferAttribute,
} from 'three'
import { DragControls } from 'three/addons/controls/DragControls.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import Stats from 'stats.js'
import { toggleFullScreen } from './helpers/fullscreen'
import { resizeRendererToDisplaySize } from './helpers/responsiveness'
import { createGridTexture } from './helpers/plane'
import { getVerticesFromObject, shapeMatching } from './helpers/shapeMatching'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import './style.css'

const CANVAS_ID = 'scene'

// Global variables
let canvas: HTMLElement
let renderer: WebGLRenderer
let scene: Scene
let loadingManager: LoadingManager
let ambientLight: AmbientLight
let pointLight: PointLight
let cube: Mesh
let camera: PerspectiveCamera
let cameraControls: OrbitControls
let dragControls: DragControls
let axesHelper: AxesHelper
let pointLightHelper: PointLightHelper
let clock: Clock
let stats: Stats
let gui: GUI

// Simulation parameters interface
interface SimulationParams {
  // Physics
  dampingFactor: number
  Rb: number // Rayleigh beta (velocity damping)
  beta: number // Linear/rotation mix
  tau: number // Elasticity
  perturbation: number
  dt: number // Time step
  
  // Forces
  Famplitude: number // Force amplitude
  pickForce: number // Picking force
  hasGravity: boolean
  
  // Deformation type
  deformationType: 'rotation' | 'linear' | 'quadratic'
  
  // Visualization
  showWireframe: boolean
  showVertexMarkers: boolean
  showForceField: boolean
  showFixedPoints: boolean
  
  // Control
  pause: boolean
  
  // Stats
  fps: number
  vertices: number
  triangles: number
  memoryUsage: number
}

// Initialize simulation parameters
const simParams: SimulationParams = {
  dampingFactor: 0.1,
  Rb: 0.1,
  beta: 0.8,
  tau: 0.8,
  perturbation: 0.1,
  dt: 0.016,
  Famplitude: 10,
  pickForce: 10,
  hasGravity: false,
  deformationType: 'linear',
  showWireframe: false,
  showVertexMarkers: false,
  showForceField: false,
  showFixedPoints: true,
  pause: false,
  fps: 0,
  vertices: 0,
  triangles: 0,
  memoryUsage: 0
}

// Animation and interaction state
const animation = { enabled: false, play: false }
const dragableObjects: Object3D[] = []
const vertexMarkers: Mesh[] = []
const fixedVertices: Set<number> = new Set()
const fixedVertexMarkers: Mesh[] = []
const initialVertices: Map<Object3D, Vector3[]> = new Map()
const initialMasses: Map<Object3D, number[]> = new Map()
const initialPositions: Map<Object3D, Vector3> = new Map()

// User input state
const userInput = {
  isShiftPressed: false,
  isCtrlPressed: false,
  forceDirection: { x: 0, y: 0, z: 0 },
  draggedObject: null as Object3D | null,
  draggedVertex: -1
}

// Statistics display object for GUI
const statsDisplay = {
  fps: '0',
  vertices: '0',
  triangles: '0',
  memory: '0 KB'
}

// OBJ Loader
const objLoader = new OBJLoader(loadingManager)

init()
animate()

function init() {
  // ===== 🖼️ CANVAS, RENDERER, & SCENE =====
  {
    canvas = document.querySelector(`canvas#${CANVAS_ID}`)!
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
    scene = new Scene()
  }

  // ===== 👨🏻‍💼 LOADING MANAGER =====
  {
    loadingManager = new LoadingManager()
    loadingManager.onStart = () => console.log('loading started')
    loadingManager.onProgress = (url: string, loaded: number, total: number) => {
      console.log('loading in progress:', `${url} -> ${loaded} / ${total}`)
    }
    loadingManager.onLoad = () => console.log('loaded!')
    loadingManager.onError = () => console.log('❌ error while loading')
  }

  // ===== 💡 LIGHTS =====
  {
    ambientLight = new AmbientLight('white', 0.4)
    pointLight = new PointLight('white', 20, 100)
    pointLight.position.set(-2, 2, 2)
    pointLight.castShadow = true
    pointLight.shadow.radius = 4
    pointLight.shadow.camera.near = 0.1
    pointLight.shadow.camera.far = 1000
    pointLight.shadow.mapSize.width = 2048
    pointLight.shadow.mapSize.height = 2048
    scene.add(ambientLight)
    scene.add(pointLight)
  }

  // ===== 📦 OBJECTS =====
  {
    // Create default cube
    const cubeVerticesInit = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ]

    const positions = new Float32Array(cubeVerticesInit.flat())
    const cubeGeometry = new BufferGeometry()
    cubeGeometry.setAttribute('position', new BufferAttribute(positions, 3))

    const indices = [
      0, 1, 2, 0, 2, 3, // front
      4, 6, 5, 4, 7, 6, // back
      3, 2, 6, 3, 6, 7, // top
      0, 5, 1, 0, 4, 5, // bottom
      1, 5, 6, 1, 6, 2, // right
      4, 0, 3, 4, 3, 7, // left
    ]
    cubeGeometry.setIndex(indices)
    cubeGeometry.computeVertexNormals()

    const material = new MeshStandardMaterial({
      color: '#f69f1f',
      metalness: 0.5,
      roughness: 0.7,
      side: DoubleSide,
    })

    cube = new Mesh(cubeGeometry, material)
    cube.castShadow = true
    cube.position.y = 0.5
    scene.add(cube)

    // Store initial data
    const cubeVertices = cubeGeometry.attributes.position.array as Float32Array
    const cubeVerticesVec3: Vector3[] = []
    for (let i = 0; i < cubeVertices.length; i += 3) {
      cubeVerticesVec3.push(new Vector3(cubeVertices[i], cubeVertices[i + 1], cubeVertices[i + 2]))
    }

    initialVertices.set(cube, cubeVerticesVec3)
    initialMasses.set(cube, cubeVerticesVec3.map(() => 1))
    initialPositions.set(cube, cube.position.clone())

    // Ground plane
    const gridTexture = createGridTexture()
    gridTexture.wrapS = RepeatWrapping
    gridTexture.wrapT = RepeatWrapping
    gridTexture.repeat.set(10, 10)

    const planeGeometry = new PlaneGeometry(20, 20)
    const planeMaterial = new MeshLambertMaterial({
      map: gridTexture,
      side: DoubleSide,
      transparent: true,
      opacity: 0.6,
    })
    const plane = new Mesh(planeGeometry, planeMaterial)
    plane.rotateX(Math.PI / 2)
    plane.receiveShadow = true
    scene.add(plane)

    dragableObjects.push(cube)
  }

  // ===== 🎥 CAMERA =====
  {
    camera = new PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    camera.position.set(2, 2, 5)
  }

  // ===== 🕹️ CONTROLS =====
  setupControls()

  // ===== 🪄 HELPERS =====
  {
    axesHelper = new AxesHelper(4)
    axesHelper.visible = false
    scene.add(axesHelper)

    pointLightHelper = new PointLightHelper(pointLight, undefined, 'orange')
    pointLightHelper.visible = false
    scene.add(pointLightHelper)

    const gridHelper = new GridHelper(50, 50, 'teal', 'darkgray')
    gridHelper.position.y = -0.01
    scene.add(gridHelper)
  }

  // ===== 📈 STATS & CLOCK =====
  {
    clock = new Clock()
    clock.start()
    stats = new Stats()
    document.body.appendChild(stats.dom)
  }

  // ===== 🎮 GUI =====
  setupGUI()

  // ===== ⌨️ KEYBOARD CONTROLS =====
  setupKeyboardControls()
}

function setupControls() {
  cameraControls = new OrbitControls(camera, canvas)
  cameraControls.target = cube.position.clone()
  cameraControls.enableDamping = true
  cameraControls.autoRotate = false
  cameraControls.update()

  dragControls = new DragControls(dragableObjects, camera, renderer.domElement)
  
  // Drag event handlers
  dragControls.addEventListener('hoveron', (event) => {
    const mesh = event.object as Mesh
    const material = mesh.material as MeshStandardMaterial
    material.emissive.set('green')
  })

  dragControls.addEventListener('hoveroff', (event) => {
    const mesh = event.object as Mesh
    const material = mesh.material as MeshStandardMaterial
    material.emissive.set('black')
  })

  dragControls.addEventListener('dragstart', (event) => {
    const mesh = event.object as Mesh
    const material = mesh.material as MeshStandardMaterial
    cameraControls.enabled = false
    animation.play = false
    material.emissive.set('orange')
    material.opacity = 0.7
    material.needsUpdate = true

    if (simParams.showVertexMarkers) {
      showVertices(event.object)
    }
  })

  dragControls.addEventListener('dragend', (event) => {
    cameraControls.enabled = true
    animation.play = true
    const mesh = event.object as Mesh
    const material = mesh.material as MeshStandardMaterial
    material.emissive.set('black')
    material.opacity = 1
    material.needsUpdate = true

    hideVertexMarkers()
  })

  dragControls.addEventListener('drag', (event) => {
    if (simParams.showVertexMarkers) {
      updateVertexMarkers(event.object)
    }

    const initialVerts = initialVertices.get(event.object)
    const initialPos = initialPositions.get(event.object)!
    const masses = initialMasses.get(event.object)

    if (initialVerts && masses && initialPos) {
      shapeMatching(event.object, initialVerts, initialPos, masses, simParams.dampingFactor)
      if (simParams.showVertexMarkers) {
        updateVertexMarkers(event.object)
      }
    }
  })

  dragControls.enabled = true

  // Mouse controls for vertex fixing (Shift+Click)
  canvas.addEventListener('click', handleCanvasClick)
  
  // Full screen on double click
  window.addEventListener('dblclick', (event) => {
    if (event.target === canvas) {
      toggleFullScreen(canvas)
    }
  })

  // Add control hints
  addControlHints()
}

function setupGUI() {
  gui = new GUI({ title: '🎮 Meshless Deformation Control', width: 350 })

  // Model folder
  const modelFolder = gui.addFolder('Model')
  modelFolder.add({
    loadOBJ: () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.obj'
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          loadOBJFile(file)
        }
      }
      input.click()
    }
  }, 'loadOBJ').name('Load OBJ File')

  // Physics folder
  const physicsFolder = gui.addFolder('Physics')
  physicsFolder.add(simParams, 'Rb', 0, 10).name('Velocity Damping')
  physicsFolder.add(simParams, 'Famplitude', 0, 1000).name('Force Amplitude')
  physicsFolder.add(simParams, 'pickForce', 1, 100).name('Picking Force')
  physicsFolder.add(simParams, 'tau', 0, 1).name('Tau (Elasticity)')
  physicsFolder.add(simParams, 'beta', 0, 1).name('Beta (Linear/Rotation Mix)')
  physicsFolder.add(simParams, 'perturbation', 0, 0.1).name('Regularization')
  physicsFolder.add(simParams, 'dt', 0.001, 1.0).name('Time Step')
  physicsFolder.add(simParams, 'hasGravity').name('Activate Gravity')
  physicsFolder.add(simParams, 'pause').name('Pause')

  // Deformation Types folder
  const deformationFolder = gui.addFolder('Deformation Types')
  const deformationTypes = {
    'Rotation': 'rotation' as const,
    'Linear': 'linear' as const,
    'Quadratic': 'quadratic' as const
  }
  deformationFolder.add(simParams, 'deformationType', deformationTypes).name('Type')

  // Visualization folder
  const visualizationFolder = gui.addFolder('Visualization')
  visualizationFolder.add(simParams, 'showWireframe').name('Show Wireframe').onChange((value: boolean) => {
    const material = cube.material as MeshStandardMaterial
    material.wireframe = value
  })
  visualizationFolder.add(simParams, 'showVertexMarkers').name('Show Vertex Markers')
  visualizationFolder.add(simParams, 'showForceField').name('Show Force Field')
  visualizationFolder.add(simParams, 'showFixedPoints').name('Show Fixed Points').onChange((value: boolean) => {
    fixedVertexMarkers.forEach(marker => {
      marker.visible = value
    })
  })

  // Shape Matching folder
  const simulationFolder = gui.addFolder('Shape Matching')
  simulationFolder.add(simParams, 'dampingFactor', 0.005, 1).name('Damping Factor')
  simulationFolder.add({
    applyRandomForce: () => {
      const force = new Vector3(
        (Math.random() - 0.5) * simParams.Famplitude,
        (Math.random() - 0.5) * simParams.Famplitude,
        (Math.random() - 0.5) * simParams.Famplitude
      )
      applyForceAndSimulate(cube, force)
    }
  }, 'applyRandomForce').name('Apply Random Force')

  // Statistics folder
  const dataFolder = gui.addFolder('Statistics')
  dataFolder.add(statsDisplay, 'fps').name('FPS').listen()
  dataFolder.add(statsDisplay, 'vertices').name('Vertices').listen()
  dataFolder.add(statsDisplay, 'triangles').name('Triangles').listen()
  dataFolder.add(statsDisplay, 'memory').name('Memory Usage').listen()

  // Controls folder
  const controlsFolder = gui.addFolder('Controls')
  controlsFolder.add(dragControls, 'enabled').name('Drag Controls')

  // Lights folder
  const lightsFolder = gui.addFolder('Lights')
  lightsFolder.add(pointLight, 'visible').name('Point Light')
  lightsFolder.add(ambientLight, 'visible').name('Ambient Light')

  // Helpers folder
  const helpersFolder = gui.addFolder('Helpers')
  helpersFolder.add(axesHelper, 'visible').name('Axes')
  helpersFolder.add(pointLightHelper, 'visible').name('Point Light Helper')

  // Camera folder
  const cameraFolder = gui.addFolder('Camera')
  cameraFolder.add(cameraControls, 'autoRotate').name('Auto Rotate')

  // Persist GUI state
  gui.onFinishChange(() => {
    const guiState = gui.save()
    localStorage.setItem('guiState', JSON.stringify(guiState))
  })

  // Load GUI state
  const guiState = localStorage.getItem('guiState')
  if (guiState) gui.load(JSON.parse(guiState))

  // Reset button
  gui.add({
    reset: () => {
      localStorage.removeItem('guiState')
      gui.reset()
    }
  }, 'reset').name('RESET GUI')
}

function setupKeyboardControls() {
  window.addEventListener('keydown', (event) => {
    userInput.isShiftPressed = event.shiftKey
    userInput.isCtrlPressed = event.ctrlKey

    // Force application keys (based on reference project)
    switch (event.key.toLowerCase()) {
      case 'i': // Up force
        applyDirectionalForce(new Vector3(0, simParams.Famplitude, 0))
        break
      case 'k': // Down force
        applyDirectionalForce(new Vector3(0, -simParams.Famplitude, 0))
        break
      case 'j': // Left force
        applyDirectionalForce(new Vector3(-simParams.Famplitude, 0, 0))
        break
      case 'l': // Right force
        applyDirectionalForce(new Vector3(simParams.Famplitude, 0, 0))
        break
      case ' ': // Forward force (space)
        event.preventDefault()
        applyDirectionalForce(new Vector3(0, 0, simParams.Famplitude))
        break
      case 'b': // Backward force
        applyDirectionalForce(new Vector3(0, 0, -simParams.Famplitude))
        break
    }
  })

  window.addEventListener('keyup', (event) => {
    userInput.isShiftPressed = event.shiftKey
    userInput.isCtrlPressed = event.ctrlKey
  })
}

function handleCanvasClick(event: MouseEvent) {
  if (userInput.isShiftPressed) {
    // Fix/unfix vertex
    // TODO: Implement vertex picking for fixing
    console.log('Shift+Click: Fix/unfix vertex functionality')
  }
}

function addControlHints() {
  const hintElement = document.createElement('div')
  hintElement.innerHTML = `
    <strong>Controls:</strong><br>
    • Drag objects to move them<br>
    • Shift+Click: Fix/unfix vertices<br>
    • IJKL: Apply directional forces<br>
    • Space/B: Forward/backward forces<br>
    • Double-click: Toggle fullscreen
  `
  hintElement.style.position = 'absolute'
  hintElement.style.bottom = '10px'
  hintElement.style.left = '10px'
  hintElement.style.color = 'white'
  hintElement.style.padding = '10px'
  hintElement.style.backgroundColor = 'rgba(0,0,0,0.7)'
  hintElement.style.borderRadius = '8px'
  hintElement.style.fontSize = '12px'
  hintElement.style.lineHeight = '1.4'
  hintElement.style.maxWidth = '200px'
  document.body.appendChild(hintElement)
}

function loadOBJFile(file: File) {
  const reader = new FileReader()
  reader.onload = (event) => {
    const content = event.target?.result as string
    if (content) {
      try {
        const object = objLoader.parse(content)
        
        // Remove existing objects from scene
        dragableObjects.forEach(obj => scene.remove(obj))
        dragableObjects.length = 0
        
        // Add new object
        object.scale.set(0.01, 0.01, 0.01)
        object.position.y = 0.5
        scene.add(object)
        
        // Store object data
        const vertices = getVerticesFromObject(object)
        initialVertices.set(object, vertices)
        initialMasses.set(object, vertices.map(() => 1))
        initialPositions.set(object, object.position.clone())
        
        dragableObjects.push(object)
        
        // Update drag controls
        dragControls.deactivate()
        dragControls = new DragControls(dragableObjects, camera, renderer.domElement)
        setupDragEventListeners()
        
        console.log(`Loaded OBJ: ${file.name}`)
      } catch (error) {
        console.error('Error loading OBJ file:', error)
      }
    }
  }
  reader.readAsText(file)
}

function setupDragEventListeners() {
  dragControls.addEventListener('hoveron', (event) => {
    const mesh = event.object as Mesh
    if (mesh.material instanceof MeshStandardMaterial) {
      mesh.material.emissive.set('green')
    }
  })

  dragControls.addEventListener('hoveroff', (event) => {
    const mesh = event.object as Mesh
    if (mesh.material instanceof MeshStandardMaterial) {
      mesh.material.emissive.set('black')
    }
  })

  // Add other event listeners...
}

function applyDirectionalForce(force: Vector3) {
  if (dragableObjects.length > 0) {
    applyForceAndSimulate(dragableObjects[0], force)
  }
}

function animate() {
  requestAnimationFrame(animate)
  
  stats.begin()
  
  // Update statistics
  updateStatistics()
  
  // Physics simulation
  if (!simParams.pause && animation.enabled && animation.play) {
    for (const object of dragableObjects) {
      const initialVerts = initialVertices.get(object)
      const initialPos = initialPositions.get(object)
      const masses = initialMasses.get(object)

      if (initialVerts && initialPos && masses) {
        shapeMatching(object, initialVerts, initialPos, masses, simParams.dampingFactor)
      }
    }
  }

  // Handle responsive canvas
  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }

  cameraControls.update()
  renderer.render(scene, camera)
  stats.end()
}

function updateStatistics() {
  statsDisplay.fps = Math.round(1 / clock.getDelta()).toString()
  statsDisplay.vertices = dragableObjects.reduce((total, obj) => {
    const vertices = getVerticesFromObject(obj)
    return total + vertices.length
  }, 0).toString()
  statsDisplay.triangles = '0' // TODO: Calculate triangles
  statsDisplay.memory = Math.round(performance.memory?.usedJSHeapSize / 1024 || 0) + ' KB'
}

// Vertex visualization functions
function showVertices(object: Object3D) {
  hideVertexMarkers()
  
  const vertices = getVerticesFromObject(object)
  const markerGeometry = new BoxGeometry(0.05, 0.05, 0.05)
  const markerMaterial = new MeshBasicMaterial({ color: 'red' })

  vertices.forEach(vertex => {
    const worldVertex = vertex.clone()
    worldVertex.applyMatrix4(object.matrixWorld)

    const marker = new Mesh(markerGeometry, markerMaterial)
    marker.position.copy(worldVertex)
    scene.add(marker)
    vertexMarkers.push(marker)
  })
}

function updateVertexMarkers(object: Object3D) {
  const vertices = getVerticesFromObject(object)

  for (let i = 0; i < vertices.length && i < vertexMarkers.length; i++) {
    const worldVertex = vertices[i].clone()
    worldVertex.applyMatrix4(object.matrixWorld)
    vertexMarkers[i].position.copy(worldVertex)
  }
}

function hideVertexMarkers() {
  vertexMarkers.forEach(marker => scene.remove(marker))
  vertexMarkers.length = 0
}

function applyForceAndSimulate(object: Object3D, force: Vector3) {
  const initialVerts = initialVertices.get(object)
  const initialPos = initialPositions.get(object)
  const masses = initialMasses.get(object)

  if (!initialVerts || !initialPos || !masses) return

  if (simParams.showVertexMarkers) {
    showVertices(object)
  }

  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry
      if (geometry instanceof BufferGeometry) {
        const positionAttr = geometry.attributes.position

        const numVerticesToAffect = Math.max(1, Math.floor(positionAttr.count * (0.2 + Math.random() * 0.2)))

        for (let i = 0; i < numVerticesToAffect; i++) {
          const randomVertexIndex = Math.floor(Math.random() * positionAttr.count)
          const vertex = new Vector3().fromBufferAttribute(positionAttr, randomVertexIndex)

          const vertexForce = force.clone().multiplyScalar(0.8 + Math.random() * 0.4)
          vertex.add(vertexForce)

          positionAttr.setXYZ(randomVertexIndex, vertex.x, vertex.y, vertex.z)
        }

        positionAttr.needsUpdate = true
      }
    }
  })

  if (simParams.showVertexMarkers) {
    updateVertexMarkers(object)
  }

  animation.enabled = true
  animation.play = true
}

export { gui }

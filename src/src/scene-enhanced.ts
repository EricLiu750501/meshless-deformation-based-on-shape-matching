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
  Box3,
} from 'three'
import { DragControls } from 'three/addons/controls/DragControls.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import Stats from 'stats.js'
import { toggleFullScreen } from './helpers/fullscreen'
import { resizeRendererToDisplaySize } from './helpers/responsiveness'
import { createGridTexture } from './helpers/plane'
import { getVerticesFromObject, shapeMatching } from './helpers/shapeMatching'
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
  
  // Deformation type
  deformationType: 'rotation' | 'linear' | 'quadratic'
  
  // Model loading
  adaptiveScaling: boolean
  targetSize: number
  autoCenter: boolean
  
  // Auto-restore
  autoRestore: boolean
  restoreSpeed: number
  
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
  dt: 0.016,  Famplitude: 10,
  pickForce: 10,
  deformationType: 'linear',
  adaptiveScaling: true,
  targetSize: 2,
  autoCenter: true,
  autoRestore: true,
  restoreSpeed: 0.02,
  showWireframe: false,
  showVertexMarkers: false,
  showForceField: false,
  showFixedPoints: true,
  pause: true,  // Default to paused for stability
  fps: 0,
  vertices: 0,
  triangles: 0,
  memoryUsage: 0
}

// Animation and interaction state
const animation = { enabled: false, play: false }
const dragableObjects: Object3D[] = []
const vertexMarkers: Mesh[] = []
const fixedVertexMarkers: Mesh[] = []
const initialVertices: Map<Object3D, Vector3[]> = new Map()
const initialMasses: Map<Object3D, number[]> = new Map()
const initialPositions: Map<Object3D, Vector3> = new Map()

// Auto-restore throttling
let lastAutoRestoreLog = 0

// User input state
const userInput = {
  isShiftPressed: false,
  isCtrlPressed: false,
  forceDirection: { x: 0, y: 0, z: 0 },
  draggedObject: null as Object3D | null,
  draggedVertex: -1,
  isPicking: false,
  pickedVertexIndex: -1,
  hasActiveForce: false, // Track if forces are being actively applied
  activeKeys: new Set<string>()
}

// Statistics display object for GUI
const statsDisplay = {
  fps: '0',
  vertices: '0',
  triangles: '0',  memory: '0 KB'
}

// OBJ Loader (will be initialized after loadingManager)
let objLoader: OBJLoader

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
    
    // Initialize OBJ Loader after loading manager
    objLoader = new OBJLoader(loadingManager)
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

    // Mark that forces are being applied during drag
    userInput.hasActiveForce = true
    userInput.draggedObject = event.object

    if (simParams.showVertexMarkers) {
      showVertices(event.object)
    }
  })
  dragControls.addEventListener('dragend', (event) => {
    cameraControls.enabled = true
    // Don't automatically start animation - let user control it
    // animation.play = true
    const mesh = event.object as Mesh
    const material = mesh.material as MeshStandardMaterial
    material.emissive.set('black')
    material.opacity = 1
    material.needsUpdate = true

    // Clear force application state
    userInput.hasActiveForce = false
    userInput.draggedObject = null

    hideVertexMarkers()
    
    // Validate object state after dragging
    if (!validateObjectState(event.object)) {
      console.warn('Object became unstable during drag, resetting')
      resetObjectToSafeState(event.object)
    }
    
    console.log('Drag ended, auto-restore can proceed')
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
  
  modelFolder.add(simParams, 'adaptiveScaling').name('Adaptive Scaling')
  modelFolder.add(simParams, 'targetSize', 0.5, 5).name('Target Size').onChange(() => {
    // Re-apply scaling to current objects if adaptive scaling is enabled
    if (simParams.adaptiveScaling && dragableObjects.length > 0) {
      const object = dragableObjects[0]
      const scaleFactor = calculateAdaptiveScale(object, simParams.targetSize)
      object.scale.set(scaleFactor, scaleFactor, scaleFactor)
      if (simParams.autoCenter) {
        positionObjectAboveGround(object)
      }
    }
  })
  modelFolder.add(simParams, 'autoCenter').name('Auto Center')
    modelFolder.add({
    loadTeapot: () => {
      fetch('/meshless-deformation-based-on-shape-matching/public/teapot.obj')
        .then(response => response.text())
        .then(content => {
          try {
            const object = objLoader.parse(content)
            loadProcessedObject(object, 'teapot.obj')
          } catch (error) {
            console.error('Error loading teapot:', error)
          }
        })
    }
  }, 'loadTeapot').name('Load Teapot')
  
  modelFolder.add({
    loadCube: () => {
      fetch('/meshless-deformation-based-on-shape-matching/public/cube.obj')
        .then(response => response.text())
        .then(content => {
          try {
            const object = objLoader.parse(content)
            loadProcessedObject(object, 'cube.obj')
          } catch (error) {
            console.error('Error loading cube:', error)
          }
        })
    }
  }, 'loadCube').name('Load Cube (OBJ)')
  
  modelFolder.add({
    loadDefaultCube: () => {
      // Remove existing objects from scene
      dragableObjects.forEach(obj => scene.remove(obj))
      dragableObjects.length = 0
      
      // Create default cube geometry
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

      const defaultCube = new Mesh(cubeGeometry, material)
      defaultCube.castShadow = true
      defaultCube.position.y = 0.5
      
      // Store initial data
      const cubeVertices = cubeGeometry.attributes.position.array as Float32Array
      const cubeVerticesVec3: Vector3[] = []
      for (let i = 0; i < cubeVertices.length; i += 3) {
        cubeVerticesVec3.push(new Vector3(cubeVertices[i], cubeVertices[i + 1], cubeVertices[i + 2]))
      }

      initialVertices.set(defaultCube, cubeVerticesVec3)
      initialMasses.set(defaultCube, cubeVerticesVec3.map(() => 1))
      initialPositions.set(defaultCube, defaultCube.position.clone())

      scene.add(defaultCube)
      dragableObjects.push(defaultCube)
      
      // Update drag controls
      dragControls.deactivate()
      dragControls = new DragControls(dragableObjects, camera, renderer.domElement)
      setupDragEventListeners()
      
      // Update camera target
      cameraControls.target.copy(defaultCube.position)
      cameraControls.update()
      
      // Set simulation to paused state
      simParams.pause = true
      
      console.log('Default cube loaded successfully')
    }
  }, 'loadDefaultCube').name('Load Default Cube')

  // Physics folder
  const physicsFolder = gui.addFolder('Physics')
  physicsFolder.add(simParams, 'Rb', 0, 10).name('Velocity Damping')
  physicsFolder.add(simParams, 'Famplitude', 0, 1000).name('Force Amplitude')
  physicsFolder.add(simParams, 'pickForce', 1, 100).name('Picking Force')
  physicsFolder.add(simParams, 'tau', 0, 1).name('Tau (Elasticity)')
  physicsFolder.add(simParams, 'beta', 0, 1).name('Beta (Linear/Rotation Mix)')
  physicsFolder.add(simParams, 'perturbation', 0, 0.1).name('Regularization')
  physicsFolder.add(simParams, 'dt', 0.001, 1.0).name('Time Step')
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
  })  // Shape Matching folder
  const simulationFolder = gui.addFolder('Shape Matching')
  simulationFolder.add(simParams, 'dampingFactor', 0.005, 1).name('Damping Factor')
    // Auto restoration controls
  simulationFolder.add(simParams, 'autoRestore').name('Auto Restore').onChange((value: boolean) => {
    console.log('Auto restore:', value ? 'enabled' : 'disabled')
  })
  simulationFolder.add(simParams, 'restoreSpeed', 0.001, 0.2).name('Restore Speed')
  
  simulationFolder.add({
    applyRandomForce: () => {
      if (dragableObjects.length > 0) {
        const force = new Vector3(
          (Math.random() - 0.5) * simParams.Famplitude * 0.1, // Reduced force
          (Math.random() - 0.5) * simParams.Famplitude * 0.1,
          (Math.random() - 0.5) * simParams.Famplitude * 0.1
        )
        applyForceAndSimulate(dragableObjects[0], force)
      }
    }
  }, 'applyRandomForce').name('🎲 Apply Random Force')

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

    // Track active keys for auto-restore system
    userInput.activeKeys.add(event.key.toLowerCase())

    // Force application keys (based on reference project)
    switch (event.key.toLowerCase()) {
      case 'i': // Up force
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(0, simParams.Famplitude, 0))
        break
      case 'k': // Down force
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(0, -simParams.Famplitude, 0))
        break
      case 'j': // Left force
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(-simParams.Famplitude, 0, 0))
        break
      case 'l': // Right force
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(simParams.Famplitude, 0, 0))
        break
      case ' ': // Forward force (space)
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(0, 0, simParams.Famplitude))
        break
      case 'b': // Backward force
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(0, 0, -simParams.Famplitude))
        break
    }
  })

  window.addEventListener('keyup', (event) => {
    userInput.isShiftPressed = event.shiftKey
    userInput.isCtrlPressed = event.ctrlKey
    
    // Remove key from active keys
    userInput.activeKeys.delete(event.key.toLowerCase())
    
    // Check if any force keys are still active
    const forceKeys = ['i', 'k', 'j', 'l', ' ', 'b']
    const hasActiveForceKeys = forceKeys.some(key => userInput.activeKeys.has(key))
    
    if (!hasActiveForceKeys) {
      userInput.hasActiveForce = false
      console.log('All force keys released, auto-restore can proceed')
    }
  })
}

function handleCanvasClick(_event: MouseEvent) {
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

// Calculate adaptive scale for loaded objects
function calculateAdaptiveScale(object: Object3D, targetSize: number = 2): number {
  // Calculate bounding box
  const box = new Box3().setFromObject(object)
  const size = box.getSize(new Vector3())
  
  // Get the largest dimension
  const maxDimension = Math.max(size.x, size.y, size.z)
  
  // Calculate scale factor to fit within target size
  const scaleFactor = maxDimension > 0 ? targetSize / maxDimension : 1
  
  console.log(`Object dimensions: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`)
  console.log(`Max dimension: ${maxDimension.toFixed(2)}, Scale factor: ${scaleFactor.toFixed(4)}`)
  
  return scaleFactor
}

// Position object appropriately after scaling
function positionObjectAboveGround(object: Object3D): void {
  const box = new Box3().setFromObject(object)
  const size = box.getSize(new Vector3())
  
  // Position object so its bottom touches the ground (y = 0)
  object.position.y = size.y / 2 + 0.1 // Small offset above ground
  
  console.log(`Object positioned at y: ${object.position.y.toFixed(2)}`)
}

// Validate object stability and position
function validateObjectState(object: Object3D): boolean {
  const position = object.position
  const scale = object.scale
  
  // Check for invalid positions (NaN, Infinity, or too far from origin)
  const maxDistance = 1000
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
    console.warn('Invalid position detected:', position)
    return false
  }
  
  if (position.length() > maxDistance) {
    console.warn('Object too far from origin:', position.length())
    return false
  }
  
  // Check for invalid scale
  if (!Number.isFinite(scale.x) || !Number.isFinite(scale.y) || !Number.isFinite(scale.z)) {
    console.warn('Invalid scale detected:', scale)
    return false
  }
  
  if (scale.x === 0 || scale.y === 0 || scale.z === 0) {
    console.warn('Zero scale detected:', scale)
    return false
  }
  
  return true
}

// Reset object to safe state
function resetObjectToSafeState(object: Object3D): void {
  const initialPos = initialPositions.get(object)
  const initialVerts = initialVertices.get(object)
  
  if (initialPos) {
    // Reset transform
    object.position.copy(initialPos)
    object.rotation.set(0, 0, 0)
    
    // Reset scale based on whether adaptive scaling is enabled
    if (simParams.adaptiveScaling) {
      const scaleFactor = calculateAdaptiveScale(object, simParams.targetSize)
      object.scale.set(scaleFactor, scaleFactor, scaleFactor)
    } else {
      object.scale.set(1, 1, 1)
    }
    
    console.log('Object transform reset to safe state')
  }
  
  // Reset geometry vertices to initial state
  if (initialVerts && initialVerts.length > 0) {
    let vertexOffset = 0
    
    object.traverse((child) => {
      if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
        const positionAttr = child.geometry.attributes.position
        
        if (positionAttr) {
          // Reset vertices for this mesh
          for (let i = 0; i < positionAttr.count; i++) {
            const globalVertexIndex = vertexOffset + i
            
            if (globalVertexIndex < initialVerts.length) {
              const vertex = initialVerts[globalVertexIndex]
              positionAttr.setXYZ(i, vertex.x, vertex.y, vertex.z)
            }
          }
          
          positionAttr.needsUpdate = true
          child.geometry.computeVertexNormals()
          child.geometry.computeBoundingSphere()
          
          // Update vertex offset for next mesh
          vertexOffset += positionAttr.count
        }
      }
    })
    
    console.log(`Reset ${initialVerts.length} vertices to initial positions`)
  }
  
  // Stop any animation to prevent immediate re-deformation
  animation.enabled = false
  animation.play = false
  simParams.pause = true
  
  console.log('✅ Object completely reset to initial state')
}

function loadOBJFile(file: File) {
  const reader = new FileReader()
  reader.onload = (event) => {
    const content = event.target?.result as string
    if (content) {
      try {
        const object = objLoader.parse(content)
        loadProcessedObject(object, file.name)
      } catch (error) {
        console.error('Error loading OBJ file:', error)
      }
    }
  }
  reader.readAsText(file)
}

function loadProcessedObject(object: Object3D, fileName: string) {
  // Remove existing objects from scene
  dragableObjects.forEach(obj => scene.remove(obj))
  dragableObjects.length = 0
  
  // Stop any ongoing animation to prevent instability
  animation.enabled = false
  animation.play = false
  
  // Apply adaptive scaling if enabled
  if (simParams.adaptiveScaling) {
    const scaleFactor = calculateAdaptiveScale(object, simParams.targetSize)
    object.scale.set(scaleFactor, scaleFactor, scaleFactor)
    console.log(`Applied adaptive scale: ${scaleFactor.toFixed(4)} for ${fileName}`)
  } else {
    // Use fixed scale
    object.scale.set(0.01, 0.01, 0.01)
    console.log(`Applied fixed scale: 0.01 for ${fileName}`)
  }
  
  // Position object appropriately
  if (simParams.autoCenter) {
    positionObjectAboveGround(object)
  } else {
    object.position.y = 0.5
  }
  
  // Validate object state before proceeding
  if (!validateObjectState(object)) {
    console.error('Object failed validation, resetting to safe state')
    object.position.set(0, 1, 0)
    object.rotation.set(0, 0, 0)
    object.scale.set(1, 1, 1)
  }
  
  // Apply material to all meshes in the object
  object.traverse((child) => {
    if (child instanceof Mesh) {
      const material = new MeshStandardMaterial({
        color: '#f69f1f',
        metalness: 0.5,
        roughness: 0.7,
        side: DoubleSide,
      })
      child.material = material
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  
  scene.add(object)
  
  // Store object data AFTER positioning and validation
  const vertices = getVerticesFromObject(object)
  initialVertices.set(object, vertices)
  initialMasses.set(object, vertices.map(() => 1))
  initialPositions.set(object, object.position.clone())
  
  dragableObjects.push(object)
  
  // Update drag controls
  dragControls.deactivate()
  dragControls = new DragControls(dragableObjects, camera, renderer.domElement)
  setupDragEventListeners()
  
  // Update camera target to focus on the new object
  cameraControls.target.copy(object.position)
  cameraControls.update()
  
  // Set simulation to paused state for manual control
  simParams.pause = true
  
  console.log(`Successfully loaded: ${fileName}`)
  console.log('💡 Tip: Physics simulation is paused. Uncheck "Pause" in GUI to enable physics.')
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
    // Don't automatically start animation - let user control it
    const mesh = event.object as Mesh
    const material = mesh.material as MeshStandardMaterial
    material.emissive.set('black')
    material.opacity = 1
    material.needsUpdate = true

    hideVertexMarkers()
    
    // Validate object state after dragging
    if (!validateObjectState(event.object)) {
      console.warn('Object became unstable during drag, resetting')
      resetObjectToSafeState(event.object)
    }
  })

  dragControls.addEventListener('drag', (event) => {
    if (simParams.showVertexMarkers) {
      updateVertexMarkers(event.object)
    }

    const initialVerts = initialVertices.get(event.object)
    const initialPos = initialPositions.get(event.object)!
    const masses = initialMasses.get(event.object)

    if (initialVerts && masses && initialPos) {
      try {
        shapeMatching(event.object, initialVerts, initialPos, masses, simParams.dampingFactor)
        if (simParams.showVertexMarkers) {
          updateVertexMarkers(event.object)
        }
        
        // Validate after shape matching
        if (!validateObjectState(event.object)) {
          console.warn('Shape matching caused instability')
          resetObjectToSafeState(event.object)
        }
      } catch (error) {
        console.error('Error during drag shape matching:', error)
        resetObjectToSafeState(event.object)
      }
    }
  })
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
  
  // Validate all objects before physics simulation
  for (const object of dragableObjects) {
    if (!validateObjectState(object)) {
      console.warn('Object instability detected, resetting')
      resetObjectToSafeState(object)
      animation.enabled = false
      animation.play = false
      simParams.pause = true
    }
  }
  
  // Physics simulation
  if (!simParams.pause && animation.enabled && animation.play) {
    for (const object of dragableObjects) {
      const initialVerts = initialVertices.get(object)
      const initialPos = initialPositions.get(object)
      const masses = initialMasses.get(object)

      if (initialVerts && initialPos && masses) {
        try {
          shapeMatching(object, initialVerts, initialPos, masses, simParams.dampingFactor)
          
          // Validate object after physics update
          if (!validateObjectState(object)) {
            console.warn('Physics caused instability, stopping simulation')
            resetObjectToSafeState(object)
            animation.enabled = false
            animation.play = false
            simParams.pause = true
          }
        } catch (error) {
          console.error('Error in shape matching:', error)
          resetObjectToSafeState(object)
          animation.enabled = false
          animation.play = false
          simParams.pause = true
        }
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

  // Apply auto-restore if enabled
  applyAutoRestore()
}

// Auto restoration function - gradually restore shape when no forces are applied
function applyAutoRestore() {
  const now = performance.now()
  const shouldLog = now - lastAutoRestoreLog > 2000 // Log every 2 seconds max
  
  if (shouldLog) {
    console.log(`=== Auto Restore Check ===`)
    console.log(`simParams.autoRestore: ${simParams.autoRestore}`)
    console.log(`userInput.hasActiveForce: ${userInput.hasActiveForce}`)
    console.log(`userInput.isPicking: ${userInput.isPicking}`)
    console.log(`userInput.activeKeys size: ${userInput.activeKeys.size}`)
    console.log(`dragableObjects length: ${dragableObjects.length}`)
    lastAutoRestoreLog = now
  }
  
  if (!simParams.autoRestore || userInput.hasActiveForce || userInput.isPicking) {
    if (shouldLog) {
      console.log('Skipping auto restore:', {
        autoRestore: simParams.autoRestore,
        hasActiveForce: userInput.hasActiveForce,
        isPicking: userInput.isPicking,
        activeKeysSize: userInput.activeKeys.size,
        activeKeys: Array.from(userInput.activeKeys)
      })
    }
    return // Skip auto restore if disabled or forces are active
  }
  
  if (shouldLog) {
    console.log('✅ Auto restore conditions met - proceeding with restoration')
  }
  
  dragableObjects.forEach((object, index) => {
    const originalVertices = initialVertices.get(object)
    
    if (!originalVertices) {
      if (shouldLog) {
        console.log(`❌ No original vertices found for object ${index}:`, object.constructor.name)
      }
      return
    }

    if (shouldLog) {
      console.log(`🔧 Restoring object ${index} with ${originalVertices.length} original vertices`)
    }

    // Handle mesh objects (including complex OBJ files with multiple meshes)
    object.traverse((child) => {
      if (child instanceof Mesh) {
        const geometry = child.geometry as BufferGeometry
        const positionAttr = geometry.attributes.position
        let hasChanges = false
        let vertexOffset = 0

        // Calculate vertex offset for this mesh within the parent object
        const parent = child.parent
        if (parent && parent !== object) {
          // Find all previous mesh siblings to calculate offset
          parent.children.forEach((sibling) => {
            if (sibling === child) return // Stop when we reach current child
            if (sibling instanceof Mesh) {
              const siblingGeometry = sibling.geometry as BufferGeometry
              vertexOffset += siblingGeometry.attributes.position.count
            }
          })
        }

        // Gradually move each vertex towards its original position
        for (let i = 0; i < positionAttr.count; i++) {
          const globalVertexIndex = vertexOffset + i
          
          // Skip if this vertex doesn't have original data
          if (globalVertexIndex >= originalVertices.length) {
            continue
          }

          const currentPos = new Vector3(
            positionAttr.getX(i),
            positionAttr.getY(i),
            positionAttr.getZ(i)
          )
          
          // Get original position directly - it's already in the correct local space
          const originalPos = originalVertices[globalVertexIndex].clone()
          
          // Check if the vertex is significantly displaced from its original shape
          const distance = currentPos.distanceTo(originalPos)
          if (distance > 0.001) { // Only apply restoration if vertex is displaced
            // Gradually move towards original position with adaptive restore speed
            const adaptiveRestoreSpeed = Math.min(simParams.restoreSpeed * (1 + distance), 0.1)
            const restoredPos = currentPos.lerp(originalPos, adaptiveRestoreSpeed)
            
            // Validate restored position
            if (Number.isFinite(restoredPos.x) && Number.isFinite(restoredPos.y) && Number.isFinite(restoredPos.z)) {
              positionAttr.setXYZ(i, restoredPos.x, restoredPos.y, restoredPos.z)
              hasChanges = true
            }
          }
        }

        // Update geometry if changes were made
        if (hasChanges) {
          positionAttr.needsUpdate = true
          geometry.computeBoundingSphere()
          geometry.computeVertexNormals()
        }
      }
    })
    
    // Note: We do NOT restore object position here - only shape
    // The object position should remain where the user moved it
  })
}

function updateStatistics() {
  statsDisplay.fps = Math.round(1 / clock.getDelta()).toString()
  statsDisplay.vertices = dragableObjects.reduce((total, obj) => {
    const vertices = getVerticesFromObject(obj)
    return total + vertices.length
  }, 0).toString()
  statsDisplay.triangles = '0' // TODO: Calculate triangles
  
  // Safe memory usage calculation with type assertion
  const performanceAny = performance as any
  const memoryUsage = performanceAny.memory?.usedJSHeapSize || 0
  statsDisplay.memory = Math.round(memoryUsage / 1024) + ' KB'
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

  if (!initialVerts || !initialPos || !masses) {
    console.warn('Cannot apply force: object data not found')
    return
  }

  // Validate object state before applying force
  if (!validateObjectState(object)) {
    console.warn('Cannot apply force: object in invalid state')
    resetObjectToSafeState(object)
    return
  }

  if (simParams.showVertexMarkers) {
    showVertices(object)
  }

  // Limit force magnitude for stability
  const maxForce = 50
  const limitedForce = force.clone()
  if (limitedForce.length() > maxForce) {
    limitedForce.normalize().multiplyScalar(maxForce)
    console.log(`Force limited to ${maxForce} for stability`)
  }

  let modifiedVertices = 0
  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry
      if (geometry instanceof BufferGeometry) {
        const positionAttr = geometry.attributes.position

        // Reduce the number of affected vertices for better control
        const numVerticesToAffect = Math.max(1, Math.floor(positionAttr.count * (0.1 + Math.random() * 0.1)))

        for (let i = 0; i < numVerticesToAffect; i++) {
          const randomVertexIndex = Math.floor(Math.random() * positionAttr.count)
          const vertex = new Vector3().fromBufferAttribute(positionAttr, randomVertexIndex)

          // Apply smaller, more controlled force
          const vertexForce = limitedForce.clone().multiplyScalar(0.1 + Math.random() * 0.1)
          vertex.add(vertexForce)

          // Validate vertex position
          if (Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z)) {
            positionAttr.setXYZ(randomVertexIndex, vertex.x, vertex.y, vertex.z)
            modifiedVertices++
          }
        }

        positionAttr.needsUpdate = true
      }
    }
  })

  if (simParams.showVertexMarkers) {
    updateVertexMarkers(object)
  }

  // Only enable animation if simulation is not paused
  if (!simParams.pause) {
    animation.enabled = true
    animation.play = true
  }

  console.log(`Applied force to ${modifiedVertices} vertices`)
}

export { gui }

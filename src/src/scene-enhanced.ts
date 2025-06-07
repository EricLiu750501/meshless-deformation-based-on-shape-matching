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
  SphereGeometry,
  WebGLRenderer,
  MeshBasicMaterial,
  DoubleSide,
  RepeatWrapping,
  Object3D,
  Vector3,
  Vector2,
  BufferGeometry,
  BufferAttribute,
  Box3,
  Raycaster,
} from 'three'
import { DragControls } from 'three/addons/controls/DragControls.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import Stats from 'stats.js'
import { toggleFullScreen } from './helpers/fullscreen'
import { resizeRendererToDisplaySize } from './helpers/responsiveness'
import { createGridTexture } from './helpers/plane'
import { 
  getVerticesFromObject, 
  shapeMatching,
  enhancedShapeMatchingWithPhysics,
  initializePhysicsState,
  PhysicsState,
  ShapeMatchingParams
} from './helpers/shapeMatching'
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

// Initialize simulation parameters - Matching C++ reference implementation EXACTLY
const simParams: SimulationParams = {
  dampingFactor: 0.0,    // Rb_ = 0.0 in C++ (no Rayleigh damping by default)
  Rb: 0.0,               // Rayleigh beta damping coefficient (C++ default)
  beta: 0.0,             // Shape matching beta parameter (C++ default) 
  tau: 1.0,              // Elastic time constant (C++ default)
  perturbation: 0.1,     // Regularization perturbation (C++ default)
  dt: 0.016,             // Standard 60fps time step (C++ uses variable dt)
  Famplitude: 10.0,      // Force amplitude (increased for better visibility)
  pickForce: 5.0,        // Picking force (increased for better effect)
  deformationType: 'rotation', // Start with rotation mode
  adaptiveScaling: true,
  targetSize: 2,
  autoCenter: true,  autoRestore: true,
  restoreSpeed: 0.02,
  showWireframe: false,
  showVertexMarkers: false,
  showForceField: false,
  showFixedPoints: true,
  pause: false,  // Default to active physics simulation
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

// Physics state for enhanced shape matching
const physicsStates: Map<Object3D, PhysicsState> = new Map()
const fixedVerticesMap: Map<Object3D, Set<number>> = new Map()

// Auto-restore throttling (removed unused variable)

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
  activeKeys: new Set<string>() // Track which keys are currently pressed
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
    }    initialVertices.set(cube, cubeVerticesVec3)
    initialMasses.set(cube, cubeVerticesVec3.map(() => 1))
    initialPositions.set(cube, cube.position.clone())    // Initialize physics state for enhanced shape matching
    const physicsState = initializePhysicsState(cube, cubeVerticesVec3)
    physicsStates.set(cube, physicsState)
      // Initialize fixed vertices set (empty by default)
    fixedVerticesMap.set(cube, new Set<number>())
    
    // Add cube to dragable objects array
    dragableObjects.push(cube)
    
    // Add initial small perturbation to trigger physics simulation
    // This helps demonstrate that the deformation system is working
    setTimeout(() => {
      const physicsState = physicsStates.get(cube)
      if (physicsState) {
        // Apply small random forces to some vertices to create initial deformation
        for (let i = 0; i < Math.min(3, physicsState.forces.length); i++) {
          const randomForce = new Vector3(
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5
          )
          physicsState.forces[i].add(randomForce)
        }
        console.log('Applied initial perturbation forces to demonstrate deformation')
      }
    }, 1000) // Wait 1 second after initialization

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
  }

  // ===== 🎥 CAMERA =====
  {
    camera = new PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    camera.position.set(2, 2, 5)
  }
  // ===== 🕹️ CONTROLS =====
  setupControls()
  setupVertexPicking()

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
  // ===== 🎯 VERTEX PICKING =====
  setupVertexPicking()
  
  // ===== 🎬 ENABLE ANIMATION =====
  // Enable physics animation by default for continuous simulation
  animation.enabled = true
  animation.play = true
  console.log('Physics animation enabled for continuous shape matching simulation')
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
    }    const initialVerts = initialVertices.get(event.object)
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
  // Setup keyboard controls
  setupKeyboardControls()

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
      }      initialVertices.set(defaultCube, cubeVerticesVec3)
      initialMasses.set(defaultCube, cubeVerticesVec3.map(() => 1))
      initialPositions.set(defaultCube, defaultCube.position.clone())

      // Initialize physics state for enhanced shape matching
      const physicsState = initializePhysicsState(defaultCube, cubeVerticesVec3)
      physicsStates.set(defaultCube, physicsState)
      
      // Initialize fixed vertices set (empty by default)
      fixedVerticesMap.set(defaultCube, new Set<number>())

      scene.add(defaultCube)
      dragableObjects.push(defaultCube)
        // Update drag controls
      dragControls.disconnect()
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
    userInput.activeKeys.add(event.key.toLowerCase())    // Force application keys (C++ style directional forces)
    switch (event.key.toLowerCase()) {
      case 'i': // Up force (positive Y)
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(0, simParams.Famplitude, 0))
        console.log('Applied UP force via keyboard (i key)')
        break
      case 'k': // Down force (negative Y)
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(0, -simParams.Famplitude, 0))
        console.log('Applied DOWN force via keyboard (k key)')
        break
      case 'j': // Left force (negative X)
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(-simParams.Famplitude, 0, 0))
        console.log('Applied LEFT force via keyboard (j key)')
        break
      case 'l': // Right force (positive X)
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(simParams.Famplitude, 0, 0))
        console.log('Applied RIGHT force via keyboard (l key)')
        break
      case ' ': // Forward force (positive Z)
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(0, 0, simParams.Famplitude))
        console.log('Applied FORWARD force via keyboard (space key)')
        break
      case 'b': // Backward force (negative Z)
        event.preventDefault()
        userInput.hasActiveForce = true
        applyDirectionalForce(new Vector3(0, 0, -simParams.Famplitude))
        console.log('Applied BACKWARD force via keyboard (b key)')
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

function handleCanvasClick(event: MouseEvent) {
  if (userInput.isShiftPressed) {
    // Fix/unfix vertex using enhanced physics system
    handleVertexFixing(event)
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
  const vertices = getVerticesFromObject(object);
  
  initialVertices.set(object, vertices)
  initialMasses.set(object, vertices.map(() => 1))
  initialPositions.set(object, object.position.clone())
  
  // Initialize physics state for enhanced shape matching
  const physicsState = initializePhysicsState(object, vertices)
  physicsStates.set(object, physicsState)
  
  // Initialize fixed vertices set (empty by default)
  fixedVerticesMap.set(object, new Set<number>())
  
  dragableObjects.push(object)
  
  // Update drag controls
  dragControls.disconnect()
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
    }    const initialVerts = initialVertices.get(event.object)
    const initialPos = initialPositions.get(event.object)!
    const masses = initialMasses.get(event.object)

    if (initialVerts && initialPos && masses) {
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

// C++-style vertex picking and dragging functionality
function setupVertexPicking() {
  const raycaster = new Raycaster()
  const mouse = new Vector2()
  
  canvas.addEventListener('mousedown', (event) => {
    if (event.shiftKey) {
      // Calculate mouse position in normalized device coordinates
      const rect = canvas.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      
      raycaster.setFromCamera(mouse, camera)
      
      // Find closest vertex to ray intersection
      for (const object of dragableObjects) {
        const physicsState = physicsStates.get(object)
        if (!physicsState) continue
        
        const intersects = raycaster.intersectObject(object, true)
        if (intersects.length > 0) {
          const intersectionPoint = intersects[0].point
          
          // Find closest vertex to intersection point
          let closestVertexIndex = -1
          let minDistance = Infinity
          
          for (let i = 0; i < physicsState.positions.length; i++) {
            const distance = physicsState.positions[i].distanceTo(intersectionPoint)
            if (distance < minDistance) {
              minDistance = distance
              closestVertexIndex = i
            }
          }
          
          if (closestVertexIndex !== -1 && minDistance < 0.5) {
            // Toggle fixed state of vertex
            const fixedVertices = fixedVerticesMap.get(object) || new Set()
            if (fixedVertices.has(closestVertexIndex)) {
              fixedVertices.delete(closestVertexIndex)
              console.log(`Unfixed vertex ${closestVertexIndex}`)
            } else {
              fixedVertices.add(closestVertexIndex)
              console.log(`Fixed vertex ${closestVertexIndex}`)
            }
            fixedVerticesMap.set(object, fixedVertices)
            
            // Update GUI display
            updateFixedVertexVisualization(object)
          }
        }
      }
    }
  })
}

// Visualize fixed vertices
function updateFixedVertexVisualization(object: Object3D) {
  // Clear existing fixed vertex markers
  fixedVertexMarkers.forEach(marker => {
    if (marker.parent) {
      marker.parent.remove(marker)
    } else {
      scene.remove(marker)
    }
  })
  fixedVertexMarkers.length = 0
  
  if (!simParams.showFixedPoints) return
  
  const fixedVertices = fixedVerticesMap.get(object)
  
  if (!fixedVertices || fixedVertices.size === 0) return
  
  // Use the same approach as scene.ts: get vertex positions from mesh geometry
  let vertexIndex = 0
  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry as BufferGeometry
      const position = geometry.attributes.position
      
      for (let i = 0; i < position.count; i++) {
        if (fixedVertices.has(vertexIndex)) {
          // Get vertex position in local coordinates
          const localVertex = new Vector3().fromBufferAttribute(position, i)
          
          // Create blue sphere marker for fixed vertex
          const markerGeometry = new SphereGeometry(0.04, 8, 6)
          const markerMaterial = new MeshBasicMaterial({ color: 'blue' })
          const marker = new Mesh(markerGeometry, markerMaterial)
          
          // Set position in local coordinates relative to the mesh
          marker.position.copy(localVertex)
          marker.userData = { vertexIndex, parentObject: child }
          
          // Add marker as child of the mesh so it moves with the object
          child.add(marker)
          fixedVertexMarkers.push(marker)
        }
        vertexIndex++
      }
    }
  })
}

// Enhanced vertex fixing for scene-enhanced.ts using physics state
function handleVertexFixing(event: MouseEvent) {
  // Calculate mouse position in normalized device coordinates
  const rect = canvas.getBoundingClientRect()
  const mouse = new Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  )

  const raycaster = new Raycaster()
  raycaster.setFromCamera(mouse, camera)

  // Find intersections with dragable objects
  const intersects = raycaster.intersectObjects(dragableObjects, true)
  
  if (intersects.length > 0) {
    const intersect = intersects[0]
    const clickedMesh = intersect.object
    
    // Find the parent dragable object
    let parentObject: Object3D | null = null
    for (const dragableObj of dragableObjects) {
      if (dragableObj === clickedMesh || dragableObj.getObjectByProperty('uuid', clickedMesh.uuid)) {
        parentObject = dragableObj
        break
      }
    }
    
    if (!parentObject) {
      console.warn('Could not find parent dragable object')
      return
    }

    const physicsState = physicsStates.get(parentObject)
    const fixedVertices = fixedVerticesMap.get(parentObject)
    
    if (!physicsState || !fixedVertices) {
      console.warn('Physics state or fixed vertices not found for object')
      return
    }

    try {
      // Calculate intersection point in world coordinates
      const intersectionPoint = intersect.point.clone()
      
      // Find closest vertex in physics state
      let closestVertexIndex = -1
      let minDistance = Infinity
      
      for (let i = 0; i < physicsState.positions.length; i++) {
        // Transform physics position to world coordinates by applying object's matrix
        const worldPosition = physicsState.positions[i].clone()
        worldPosition.applyMatrix4(parentObject.matrixWorld)
        
        const distance = worldPosition.distanceTo(intersectionPoint)
        if (distance < minDistance) {
          minDistance = distance
          closestVertexIndex = i
        }
      }
      
      // Check if we found a close enough vertex (distance threshold)
      if (closestVertexIndex !== -1 && minDistance < 0.5) {
        // Toggle fixed state of vertex
        if (fixedVertices.has(closestVertexIndex)) {
          fixedVertices.delete(closestVertexIndex)
          console.log(`Vertex ${closestVertexIndex} unfixed (distance: ${minDistance.toFixed(3)})`)
        } else {
          fixedVertices.add(closestVertexIndex)
          console.log(`Vertex ${closestVertexIndex} fixed (distance: ${minDistance.toFixed(3)})`)
        }
        
        // Update the fixed vertices map
        fixedVerticesMap.set(parentObject, fixedVertices)
        
        // Update visual representation of fixed vertices
        updateFixedVertexVisualization(parentObject)
      } else {
        console.log(`No vertex close enough to click point (closest distance: ${minDistance.toFixed(3)})`)
      }
    } catch (error) {
      console.error('Error in handleVertexFixing:', error)
    }
  }
}

// Apply distributed force to physics state (Fixed C++ algorithm implementation)
// Based on deformable_mesh.cpp lines 93-130
function applyDistributedForceToPhysicsState(physicsState: PhysicsState, forceLocation: Vector3, force: Vector3) {
  const { positions, forces } = physicsState
  const numVertices = positions.length

  // Normalize force direction (matching C++ force.normalized())
  const direction = force.clone().normalize()
  
  // Use the provided force location (already calculated by applyDirectionalForce)
  // Don't recalculate to avoid overriding specific directional positioning
  const actualForceLocation = forceLocation
  
  console.log(`=== Force Distribution Debug ===`)
  console.log(`Force vector: (${force.x.toFixed(3)}, ${force.y.toFixed(3)}, ${force.z.toFixed(3)})`)
  console.log(`Force direction (normalized): (${direction.x.toFixed(3)}, ${direction.y.toFixed(3)}, ${direction.z.toFixed(3)})`)
  console.log(`Using force location: (${actualForceLocation.x.toFixed(3)}, ${actualForceLocation.y.toFixed(3)}, ${actualForceLocation.z.toFixed(3)})`)
  console.log(`Number of vertices: ${numVertices}`)
    // Build test function for distributing the force on the mesh (matching C++ algorithm)
  const t: number[] = new Array(numVertices).fill(0)
  let debugCount = 0
  let validAngles = 0
  let totalAngles = 0

  for (let i = 0; i < numVertices; i++) {
    // Calculate relative position vector: r = x[i] - location
    const r = positions[i].clone().sub(actualForceLocation)
    
    // Skip if vertex is at the exact force location
    const rNorm = r.length()
    if (rNorm < 1e-10) {
      t[i] = 1.0 // Maximum weight for vertices at force location
      if (debugCount < 5) {
        console.log(`Vertex ${i}: At force location, weight = 1.0`)
        debugCount++
      }
      continue
    }

    // Calculate projection: s1 = r.dot(-direction) (exact C++ match)
    const negDirection = direction.clone().negate()
    const s1 = r.dot(negDirection)
    
    // Calculate angle: theta = acos(s1 / r.norm()) (exact C++ match)
    const cosTheta = s1 / rNorm
    
    // Clamp cosTheta to valid range [-1, 1] to avoid NaN from acos
    const clampedCosTheta = Math.max(-1, Math.min(1, cosTheta))
    const theta = Math.acos(clampedCosTheta)
    
    totalAngles++
    
    // Apply test function: t(i) = exp(-theta) if abs(theta) < π/2, else 0
    if (Math.abs(theta) < Math.PI / 2.0) {
      t[i] = Math.exp(-theta)
      validAngles++
      if (debugCount < 5) {
        console.log(`Vertex ${i}: r=(${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)}), rNorm=${rNorm.toFixed(3)}, s1=${s1.toFixed(3)}, cosTheta=${cosTheta.toFixed(3)}, theta=${theta.toFixed(3)}, weight=${t[i].toFixed(4)}`)
        debugCount++
      }
    } else {
      t[i] = 0.0
      if (debugCount < 5) {
        console.log(`Vertex ${i}: r=(${r.x.toFixed(2)}, ${r.y.toFixed(2)}, ${r.z.toFixed(2)}), theta=${theta.toFixed(3)} > π/2, weight=0 (outside cone)`)
        debugCount++
      }
    }
  }

  // Enhanced debugging information
  console.log(`Angle analysis: ${validAngles}/${totalAngles} vertices have valid angles (< π/2)`)
  
  // Count non-zero weights for debugging
  const nonZeroWeights = t.filter(weight => weight > 0).length
  console.log(`Non-zero weights: ${nonZeroWeights}/${numVertices}`)

  // Find maximum weight for normalization (matching C++ tmax)
  const tmax = Math.max(...t)
  console.log(`Max weight (tmax): ${tmax}`)
  
  // If all weights are zero, try alternative strategy: use distance-based fallback
  if (tmax < 1e-10) {
    console.warn('All test function values are zero, using distance-based fallback')
    
    // Fallback: Use distance-based force distribution
    for (let i = 0; i < numVertices; i++) {
      const r = positions[i].clone().sub(forceLocation)
      const distance = r.length()
      
      if (distance < 1e-10) {
        t[i] = 1.0
      } else {
        // Exponential falloff based on distance (normalized to object size)
        const maxDistance = 2.0 // Assume object fits in 2-unit cube
        const normalizedDistance = Math.min(distance / maxDistance, 1.0)
        t[i] = Math.exp(-2.0 * normalizedDistance)
      }
    }
    
    const fallbackTmax = Math.max(...t)
    if (fallbackTmax < 1e-10) {
      console.error('Even fallback method failed, skipping force application')
      return
    }
    
    console.log(`Using distance-based fallback, new tmax: ${fallbackTmax}`)
    
    // Apply fallback forces
    for (let i = 0; i < numVertices; i++) {
      const normalizedWeight = t[i] / fallbackTmax
      const clampedWeight = Math.max(0.0, Math.min(1.0, normalizedWeight))
      const vertexForce = force.clone().multiplyScalar(clampedWeight)
      forces[i].add(vertexForce)
    }
    
    console.log(`Applied distance-based force distribution to ${numVertices} vertices`)
    return
  }

  // Calculate force interpolation weight (matching C++ force_interpolation_weight)
  const forceInterpolationWeight = 1.0 / tmax

  // Apply weighted forces to each vertex (matching C++ force computation)
  for (let i = 0; i < numVertices; i++) {
    // Calculate normalized weight for this vertex
    const normalizedWeight = t[i] * forceInterpolationWeight
    
    // Ensure weight is in [0,1] range (matching C++ assertion)
    const clampedWeight = Math.max(0.0, Math.min(1.0, normalizedWeight))
    
    // Apply weighted force: f[i] = weight * force (matching C++ f.block computation)
    const vertexForce = force.clone().multiplyScalar(clampedWeight)
    forces[i].add(vertexForce)
  }

  console.log(`Applied C++ style angular force distribution to ${numVertices} vertices`)
  console.log(`Force interpolation weight: ${forceInterpolationWeight.toFixed(4)}`)
}

function applyForceAndSimulate(object: Object3D, force: Vector3, location?: Vector3) {
  const physicsState = physicsStates.get(object)

  if (!physicsState) {
    console.warn('Cannot apply force: physics state not found for object')
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

  // Calculate geometric center if no location specified (matching C++ behavior)
  let forceLocation = location
  if (!forceLocation) {
    forceLocation = calculateGeometricCenter(object)
  }

  // Apply force using C++-style distance-based distribution to physics state
  applyDistributedForceToPhysicsState(physicsState, forceLocation, force)
  if (simParams.showVertexMarkers) {
    updateVertexMarkers(object)
  }

  // Enable animation when force is applied (even if globally paused)
  // This ensures immediate visual feedback when applying forces
  animation.enabled = true
  animation.play = true
  
  // Temporarily unpause simulation to show deformation
  const wasInitiallyPaused = simParams.pause
  simParams.pause = false
  
  // Auto-pause after a short duration to allow user control
  setTimeout(() => {
    if (wasInitiallyPaused) {
      // Only re-pause if it was initially paused and no other forces are active
      if (!userInput.hasActiveForce && userInput.activeKeys.size === 0) {
        simParams.pause = true
        console.log('Auto-paused simulation after force application')
      }
    }
  }, 2000) // Allow 2 seconds of simulation

  console.log(`Applied distributed force from location (${forceLocation.x.toFixed(2)}, ${forceLocation.y.toFixed(2)}, ${forceLocation.z.toFixed(2)})`)
}

// Calculate geometric center of object (matching C++ geometric_center calculation)
function calculateGeometricCenter(object: Object3D): Vector3 {
  const vertices = getVerticesFromObject(object)
  const center = new Vector3()
  
  if (vertices.length === 0) {
    return center
  }

  for (const vertex of vertices) {
    center.add(vertex)
  }
  
  center.divideScalar(vertices.length)
  return center
}

// Animate function - main animation loop
function animate() {
  requestAnimationFrame(animate)
  
  stats.begin()
  
  // Update statistics
  updateStatistics()  // Physics simulation
  if (!simParams.pause && animation.enabled && animation.play) {
    // Run physics simulation continuously for all objects
    // This allows for gravity, elastic forces, and other physics effects
    for (const object of dragableObjects) {
      // Validate object state before shape matching
      if (!validateObjectState(object)) {
        console.warn("Object state validation failed, skipping physics simulation")
        continue
      }
        const initialVerts = initialVertices.get(object)
      const initialPos = initialPositions.get(object)
      const masses = initialMasses.get(object)
      const physicsState = physicsStates.get(object)

      if (initialVerts && initialPos && masses && physicsState) {
        try {
          // Create shape matching parameters from simulation parameters
          const shapeMatchingParams: ShapeMatchingParams = {
            deformationType: simParams.deformationType,
            beta: simParams.beta,
            tau: simParams.tau,
            perturbation: simParams.perturbation,
            dampingFactor: simParams.dampingFactor,
            fixedVertices: fixedVerticesMap.get(object)
          }
          
          // Use physics-based shape matching instead of basic shape matching
          enhancedShapeMatchingWithPhysics(object, physicsState, shapeMatchingParams, simParams.dt)
          
          // Validate after shape matching
          if (!validateObjectState(object)) {
            console.warn("Object state corrupted after shape matching, resetting to safe state")
            resetObjectToSafeState(object)
          }
          
          // Update vertex markers if enabled
          if (simParams.showVertexMarkers) {
            updateVertexMarkers(object)
          }
        } catch (error) {
          console.error("Error during shape matching:", error)
          resetObjectToSafeState(object)
        }
      }
    }
  }
  
  // Apply auto restoration when simulation is paused or not active
  applyAutoRestore()

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

// Update statistics
function updateStatistics() {
  statsDisplay.fps = Math.round(1 / clock.getDelta()).toString()
  
  let totalVertices = 0
  try {
    totalVertices = dragableObjects.reduce((total, obj) => {
      // Validate object before processing
      if (!obj || !obj.position || !obj.scale || !obj.rotation) {
        console.warn("Invalid object found in dragableObjects, skipping")
        return total
      }
      
      try {
        const vertices = getVerticesFromObject(obj)
        return total + vertices.length
      } catch (error) {
        console.error("Error getting vertices from object:", error)
        return total
      }
    }, 0)
  } catch (error) {
    console.error("Error in vertex counting:", error)
    totalVertices = 0
  }
  
  statsDisplay.vertices = totalVertices.toString()
  statsDisplay.triangles = '0' // TODO: Calculate triangles
  
  // Safe memory usage check
  if (typeof (performance as any).memory !== 'undefined') {
    statsDisplay.memory = Math.round((performance as any).memory.usedJSHeapSize / 1024) + ' KB'
  } else {
    statsDisplay.memory = 'N/A'
  }
}

// Auto restoration function - simplified version for enhanced scene
function applyAutoRestore() {
  // Simple auto restore - can be enhanced later
  if (!simParams.autoRestore) {
    return
  }
  
  // Check if auto restore should be applied
  const shouldRestore = !userInput.hasActiveForce && 
                       userInput.activeKeys.size === 0 && 
                       !userInput.isPicking &&
                       simParams.pause
  
  if (!shouldRestore) {
    return
  }
  
  // Apply gradual restoration to each object
  dragableObjects.forEach((object) => {
    const originalVertices = initialVertices.get(object)
    
    if (!originalVertices) {
      return
    }
    
    // Restore object vertices gradually
    object.traverse((child) => {
      if (child instanceof Mesh) {
        const geometry = child.geometry as BufferGeometry
        const positionAttr = geometry.attributes.position
        let hasChanges = false
        
        for (let i = 0; i < positionAttr.count && i < originalVertices.length; i++) {
          const currentPos = new Vector3(
            positionAttr.getX(i),
            positionAttr.getY(i),
            positionAttr.getZ(i)
          )
          
          const originalPos = originalVertices[i].clone()
          const distance = currentPos.distanceTo(originalPos)
          
          if (distance > 0.001) {
            const restoredPos = currentPos.lerp(originalPos, simParams.restoreSpeed)
            positionAttr.setXYZ(i, restoredPos.x, restoredPos.y, restoredPos.z)
            hasChanges = true
          }
        }
        
        if (hasChanges) {
          positionAttr.needsUpdate = true
          geometry.computeBoundingSphere()
          geometry.computeVertexNormals()
        }
      }
    })
  })
}

export { gui }

// Force direction indicator functions
function showForceIndicator(direction: string, forceVector: Vector3) {
  // Remove existing force indicator
  hideForceIndicator()
  
  // Create force indicator element
  const indicator = document.createElement('div')
  indicator.id = 'force-indicator'
  indicator.innerHTML = `
    <div><strong>Force Applied: ${direction}</strong></div>
    <div>Direction: (${forceVector.x.toFixed(2)}, ${forceVector.y.toFixed(2)}, ${forceVector.z.toFixed(2)})</div>
    <div>Magnitude: ${forceVector.length().toFixed(2)}</div>
  `
  indicator.style.position = 'absolute'
  indicator.style.top = '20px'
  indicator.style.right = '20px'
  indicator.style.color = 'white'
  indicator.style.padding = '15px 20px'
  indicator.style.backgroundColor = 'rgba(0, 100, 255, 0.9)'
  indicator.style.borderRadius = '10px'
  indicator.style.fontSize = '14px'
  indicator.style.fontFamily = 'monospace'
  indicator.style.zIndex = '1000'
  indicator.style.border = '2px solid #0066cc'
  indicator.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)'
  
  document.body.appendChild(indicator)
  
  // Auto-hide after 3 seconds
  setTimeout(hideForceIndicator, 3000)
}

function hideForceIndicator() {
  const existingIndicator = document.getElementById('force-indicator')
  if (existingIndicator) {
    existingIndicator.remove()
  }
}

// Enhanced directional force application with specific force points
function applyDirectionalForce(force: Vector3) {
  if (dragableObjects.length > 0) {
    const object = dragableObjects[0]
    const physicsState = physicsStates.get(object)
    
    if (!physicsState) {
      console.warn('No physics state found for directional force')
      return
    }
    
    // Calculate specific force application point based on exact force direction
    const forceLocation = calculateSpecificForceLocation(physicsState, force)
    
    // Determine direction name for indicator
    let directionName = 'CUSTOM'
    if (force.y > 0 && Math.abs(force.x) < 0.1 && Math.abs(force.z) < 0.1) directionName = 'UP'
    else if (force.y < 0 && Math.abs(force.x) < 0.1 && Math.abs(force.z) < 0.1) directionName = 'DOWN'
    else if (force.x < 0 && Math.abs(force.y) < 0.1 && Math.abs(force.z) < 0.1) directionName = 'LEFT'
    else if (force.x > 0 && Math.abs(force.y) < 0.1 && Math.abs(force.z) < 0.1) directionName = 'RIGHT'
    else if (force.z > 0 && Math.abs(force.x) < 0.1 && Math.abs(force.y) < 0.1) directionName = 'FORWARD'
    else if (force.z < 0 && Math.abs(force.x) < 0.1 && Math.abs(force.y) < 0.1) directionName = 'BACKWARD'
    
    // Show visual indicator
    showForceIndicator(directionName, force)
    
    console.log(`=== Directional Force Application ===`)
    console.log(`Direction: ${directionName}`)
    console.log(`Force: (${force.x.toFixed(3)}, ${force.y.toFixed(3)}, ${force.z.toFixed(3)})`)
    console.log(`Force location: (${forceLocation.x.toFixed(3)}, ${forceLocation.y.toFixed(3)}, ${forceLocation.z.toFixed(3)})`)
    
    // Apply force with specific location
    applyForceAndSimulate(object, force, forceLocation)
    
    console.log(`Applied ${directionName} force from specific location`)
  } else {
    console.warn('No objects available to apply directional force to')
  }
}

// Calculate specific force location based on exact force direction
function calculateSpecificForceLocation(physicsState: PhysicsState, force: Vector3): Vector3 {
  const { positions } = physicsState
  const numVertices = positions.length
  
  // Calculate bounding box from physics state positions
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  
  for (let i = 0; i < numVertices; i++) {
    const pos = positions[i]
    min.x = Math.min(min.x, pos.x)
    min.y = Math.min(min.y, pos.y)
    min.z = Math.min(min.z, pos.z)
    max.x = Math.max(max.x, pos.x)
    max.y = Math.max(max.y, pos.y)
    max.z = Math.max(max.z, pos.z)
  }
  
  const center = min.clone().add(max).multiplyScalar(0.5)
  const size = max.clone().sub(min)
  
  console.log(`=== calculateSpecificForceLocation Debug ===`)
  console.log(`Bounding box: min=(${min.x.toFixed(3)}, ${min.y.toFixed(3)}, ${min.z.toFixed(3)})`)
  console.log(`Bounding box: max=(${max.x.toFixed(3)}, ${max.y.toFixed(3)}, ${max.z.toFixed(3)})`)
  console.log(`Center: (${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)})`)
  console.log(`Size: (${size.x.toFixed(3)}, ${size.y.toFixed(3)}, ${size.z.toFixed(3)})`)
  console.log(`Force vector: (${force.x.toFixed(3)}, ${force.y.toFixed(3)}, ${force.z.toFixed(3)})`)
  
  let forceLocation: Vector3
  let locationDescription: string
  
  // Check exact force direction and choose appropriate point
  if (Math.abs(force.y) > Math.abs(force.x) && Math.abs(force.y) > Math.abs(force.z)) {
    // Primary Y direction
    if (force.y > 0) {
      // UP force (i key) -> apply from bottom center, but slightly inside the object
      forceLocation = new Vector3(center.x, min.y + size.y * 0.1, center.z)
      locationDescription = "UP force from bottom center"
    } else {
      // DOWN force (k key) -> apply from top center, but slightly inside the object
      forceLocation = new Vector3(center.x, max.y - size.y * 0.1, center.z)
      locationDescription = "DOWN force from top center"
    }
  } else if (Math.abs(force.x) > Math.abs(force.y) && Math.abs(force.x) > Math.abs(force.z)) {
    // Primary X direction
    if (force.x > 0) {
      // RIGHT force (l key) -> apply from left center, but slightly inside the object
      forceLocation = new Vector3(min.x + size.x * 0.1, center.y, center.z)
      locationDescription = "RIGHT force from left center"
    } else {
      // LEFT force (j key) -> apply from right center, but slightly inside the object
      forceLocation = new Vector3(max.x - size.x * 0.1, center.y, center.z)
      locationDescription = "LEFT force from right center"
    }
  } else if (Math.abs(force.z) > Math.abs(force.x) && Math.abs(force.z) > Math.abs(force.y)) {
    // Primary Z direction
    if (force.z > 0) {
      // FORWARD force (space key) -> apply from back center, but slightly inside the object
      forceLocation = new Vector3(center.x, center.y, min.z + size.z * 0.1)
      locationDescription = "FORWARD force from back center"
    } else {
      // BACKWARD force (b key) -> apply from front center, but slightly inside the object
      forceLocation = new Vector3(center.x, center.y, max.z - size.z * 0.1)
      locationDescription = "BACKWARD force from front center"
    }
  } else {
    // Fallback to center
    forceLocation = center.clone()
    locationDescription = "Fallback to center"
  }
  
  console.log(`Selected: ${locationDescription}`)
  console.log(`Force location: (${forceLocation.x.toFixed(3)}, ${forceLocation.y.toFixed(3)}, ${forceLocation.z.toFixed(3)})`)
  
  return forceLocation
}

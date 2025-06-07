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
  Raycaster,  Vector2,
  SphereGeometry,
  Box3,
  Box3Helper,
} from 'three'
import { DragControls } from 'three/addons/controls/DragControls.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import Stats from 'stats.js'
import { toggleFullScreen } from './helpers/fullscreen'
import { resizeRendererToDisplaySize } from './helpers/responsiveness'
import { createGridTexture } from './helpers/plane'
import { getVerticesFromObject, enhancedShapeMatching } from './helpers/shapeMatching'
import type { ShapeMatchingParams } from './helpers/shapeMatching'
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
let objLoader: OBJLoader
let raycaster: Raycaster
let mouse: Vector2

// Bounding box helper
let boundingBoxHelper: Object3D | null = null

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
    // Visualization
  showWireframe: boolean
  showVertexMarkers: boolean
  showForceField: boolean
  showTriangles: boolean
  showBoundingBox: boolean
  showFixedPoints: boolean
    // Control
  pause: boolean
  autoRestore: boolean // Auto restore to original shape
  restoreSpeed: number // Speed of auto restoration
  
  // Stats
  fps: number
  vertices: number
  triangles: number
  memoryUsage: number
}

// Initialize simulation parameters
const simParams: SimulationParams = {
  dampingFactor: 0.05, // Reduced for more stability
  Rb: 0.1,
  beta: 0.3, // Reduced to favor rotation over linear/quadratic
  tau: 0.8,  perturbation: 1e-4, // Increased for better numerical stability
  dt: 0.016,
  Famplitude: 0.1, // Increased slightly for better effect with scaled objects
  pickForce: 5, // Reduced picking force
  deformationType: 'rotation', // Start with the most stable deformation type
  showWireframe: false,
  showVertexMarkers: false,  showForceField: false,
  showTriangles: false,
  showBoundingBox: false,
  showFixedPoints: true,
  pause: false,
  autoRestore: true, // Auto restore to original shape when no forces applied
  restoreSpeed: 0.05, // Speed of auto restoration
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
const objectScaleFactors: Map<Object3D, number> = new Map()

// Auto-restore throttling
let lastAutoRestoreLog = 0;

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
  triangles: '0',
  memory: '0 KB'
}

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
    
    // Initialize OBJ loader after loading manager
    objLoader = new OBJLoader(loadingManager)
  }

  // ===== 🔍 RAYCASTER =====
  {
    raycaster = new Raycaster()
    mouse = new Vector2()
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
    initialPositions.set(cube, cube.position.clone())
    objectScaleFactors.set(cube, 1) // Default cube has scale factor 1

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

  dragControls.addEventListener('hoveroff', (event) => {    const mesh = event.object as Mesh
    const material = mesh.material as MeshStandardMaterial
    material.emissive.set('black')
  })

  dragControls.addEventListener('dragstart', (event) => {
    const mesh = event.object as Mesh
    const material = mesh.material as MeshStandardMaterial
    cameraControls.enabled = false
    animation.play = true // Enable animation for dragging
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
    
    // Additional safeguard: clear picking state if it's still active
    if (userInput.isPicking) {
      console.log('Dragend detected while picking, clearing picking state')
      userInput.isPicking = false
      userInput.pickedVertexIndex = -1
      if (userInput.draggedObject) {
        userInput.draggedObject = null
      }
    }
    
    // Trigger auto restoration after drag ends with a delay
    setTimeout(() => {
      console.log('Drag ended, enabling auto restoration')
      // Auto restoration will be handled by the animate loop since hasActiveForce will be false
    }, 300) // Small delay to allow animation to settle
  })
  dragControls.addEventListener('drag', (event) => {
    if (simParams.showVertexMarkers) {
      updateVertexMarkers(event.object)
    }
    
    const initialVerts = initialVertices.get(event.object)
    const initialPos = initialPositions.get(event.object)!
    const masses = initialMasses.get(event.object)

    if (initialVerts && masses && initialPos) {
      const shapeMatchingParams: ShapeMatchingParams = {
        deformationType: simParams.deformationType,
        beta: simParams.beta,
        tau: simParams.tau,
        perturbation: simParams.perturbation,
        dampingFactor: simParams.dampingFactor,
        fixedVertices: fixedVertices
      }
      
      enhancedShapeMatching(event.object, initialVerts, initialPos, masses, shapeMatchingParams)
      if (simParams.showVertexMarkers) {
        updateVertexMarkers(event.object)
      }
    }
  })

  dragControls.enabled = true
  // Mouse controls for vertex fixing (Shift+Click)
  canvas.addEventListener('click', handleCanvasClick)
  
  // Mouse move for vertex picking
  canvas.addEventListener('mousemove', handleMouseMove)
  
  // Mouse up to end picking
  canvas.addEventListener('mouseup', handleMouseUp)
  
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
  
  // Add preset object loading buttons
  modelFolder.add({
    loadCube: () => {
      loadDefaultCube()
    }
  }, 'loadCube').name('Load Default Cube')
    modelFolder.add({
    loadTeapot: () => {
      loadPresetOBJ('/teapot.obj')
    }
  }, 'loadTeapot').name('Load Teapot')
  
  modelFolder.add({
    loadCubeOBJ: () => {
      loadPresetOBJ('/cube.obj')
    }
  }, 'loadCubeOBJ').name('Load Cube OBJ')
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
    // Apply to all dragable objects, not just cube
    dragableObjects.forEach(obj => {
      obj.traverse((child) => {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          child.material.wireframe = value
        }
      })
    })
  })
  visualizationFolder.add(simParams, 'showVertexMarkers').name('Show Vertex Markers')
  visualizationFolder.add(simParams, 'showForceField').name('Show Force Field')
  visualizationFolder.add(simParams, 'showTriangles').name('Show Triangles').onChange((value: boolean) => {
    // Apply to all dragable objects
    dragableObjects.forEach(obj => {
      obj.traverse((child) => {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          if (value) {
            child.material.wireframe = false
            // Could add a separate wireframe mesh here for better visualization
          }
        }
      })
    })
  })
  visualizationFolder.add(simParams, 'showBoundingBox').name('Show Bounding Box').onChange((value: boolean) => {
    // Will implement bounding box visibility logic here
    updateBoundingBoxVisibility(value)
  })
  visualizationFolder.add(simParams, 'showFixedPoints').name('Show Fixed Points').onChange((value: boolean) => {
    fixedVertexMarkers.forEach(marker => {
      marker.visible = value
    })
  })
  // Shape Matching folder
  const simulationFolder = gui.addFolder('Shape Matching')
  simulationFolder.add(simParams, 'dampingFactor', 0.005, 1).name('Damping Factor')
  
  // Auto restoration controls
  simulationFolder.add(simParams, 'autoRestore').name('Auto Restore').onChange((value: boolean) => {
    console.log('Auto restore:', value ? 'enabled' : 'disabled')
  })
  simulationFolder.add(simParams, 'restoreSpeed', 0.001, 0.2).name('Restore Speed')
    simulationFolder.add({
    applyRandomForce: () => {
      const force = new Vector3(
        (Math.random() - 0.5) * simParams.Famplitude,
        (Math.random() - 0.5) * simParams.Famplitude,
        (Math.random() - 0.5) * simParams.Famplitude
      )
      // Apply to the first available object instead of hardcoded cube
      if (dragableObjects.length > 0) {
        applyForceAndSimulate(dragableObjects[0], force)
      } else {
        console.warn('No objects available to apply force to')
      }
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

    const key = event.key.toLowerCase()
      // Track force keys
    if (['i', 'k', 'j', 'l', ' ', 'b', 'r'].includes(key)) {
      userInput.activeKeys.add(key)
      userInput.hasActiveForce = true
    }

    // Force application keys (based on reference project)
    switch (key) {      case 'i': // Up force
        event.preventDefault()
        applyDirectionalForce(new Vector3(0, simParams.Famplitude, 0))
        showForceIndicator('UP')
        break
      case 'k': // Down force
        event.preventDefault()
        applyDirectionalForce(new Vector3(0, -simParams.Famplitude, 0))
        showForceIndicator('DOWN')
        break
      case 'j': // Left force
        event.preventDefault()
        applyDirectionalForce(new Vector3(-simParams.Famplitude, 0, 0))
        showForceIndicator('LEFT')
        break
      case 'l': // Right force
        event.preventDefault()
        applyDirectionalForce(new Vector3(simParams.Famplitude, 0, 0))
        showForceIndicator('RIGHT')
        break
      case ' ': // Forward force (space)
        event.preventDefault()
        applyDirectionalForce(new Vector3(0, 0, simParams.Famplitude))
        showForceIndicator('FORWARD')
        break
      case 'b': // Backward force
        event.preventDefault()
        applyDirectionalForce(new Vector3(0, 0, -simParams.Famplitude))
        showForceIndicator('BACKWARD')
        break
      case 'r': // Reset all objects to original shape
        event.preventDefault()
        resetAllObjectsToOriginal()
        showForceIndicator('RESET')
        break
    }
  })
  window.addEventListener('keyup', (event) => {
    userInput.isShiftPressed = event.shiftKey
    userInput.isCtrlPressed = event.ctrlKey
    
    const key = event.key.toLowerCase()
    
    // Remove from active keys and update force state
    if (userInput.activeKeys.has(key)) {
      userInput.activeKeys.delete(key)
    }
    
    // Clear hasActiveForce when no keys are active
    userInput.hasActiveForce = userInput.activeKeys.size > 0
    
    // Additional safety check - clear force state completely when no force keys are pressed
    if (userInput.activeKeys.size === 0) {
      userInput.hasActiveForce = false
      console.log('All force keys released, cleared hasActiveForce')
    }
    
    hideForceIndicator()
  })
}

function showForceIndicator(direction: string) {
  // Remove existing force indicator
  hideForceIndicator()
  
  // Create force indicator element
  const indicator = document.createElement('div')
  indicator.id = 'force-indicator'
  indicator.innerHTML = `<strong>Force Applied: ${direction}</strong>`
  indicator.style.position = 'absolute'
  indicator.style.top = '20px'
  indicator.style.left = '50%'
  indicator.style.transform = 'translateX(-50%)'
  indicator.style.color = 'white'
  indicator.style.padding = '10px 20px'
  indicator.style.backgroundColor = 'rgba(255, 100, 100, 0.8)'
  indicator.style.borderRadius = '8px'
  indicator.style.fontSize = '16px'
  indicator.style.fontWeight = 'bold'
  indicator.style.zIndex = '1000'
  indicator.style.border = '2px solid red'
  
  document.body.appendChild(indicator)
  
  // Auto-hide after 2 seconds
  setTimeout(hideForceIndicator, 2000)
}

function hideForceIndicator() {
  const indicator = document.getElementById('force-indicator')
  if (indicator) {
    indicator.remove()
  }
}

function handleCanvasClick(event: MouseEvent) {
  // Update mouse coordinates
  const rect = canvas.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  // Update raycaster
  raycaster.setFromCamera(mouse, camera)
  
  // Find intersections with dragable objects and their children
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
    
    if (userInput.isShiftPressed) {
      // Fix/unfix vertex functionality - pass parent object and intersect info
      handleVertexFixing(parentObject, intersect)
    } else if (userInput.isCtrlPressed) {
      // Start vertex picking - pass the clicked mesh
      handleVertexPicking(clickedMesh, intersect)
    }
  }
}

function calculateGlobalVertexIndex(parentObject: Object3D, targetMesh: Mesh, localVertexIndex: number): number {
  let globalIndex = 0
  let found = false
  
  parentObject.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry as BufferGeometry
      const positionAttr = geometry.attributes.position
      
      if (child === targetMesh) {
        // Found the target mesh, add the local vertex index
        globalIndex += localVertexIndex
        found = true
        return // Stop traversal
      } else {
        // Add all vertices from this mesh to the global index
        globalIndex += positionAttr.count
      }
    }
  })
  
  return found ? globalIndex : -1
}

function handleVertexFixing(parentObject: Object3D, intersect: any) {
  if (intersect.face && intersect.object instanceof Mesh) {
    try {
      const mesh = intersect.object as Mesh
      const geometry = mesh.geometry as BufferGeometry
      const position = geometry.attributes.position
      
      // Validate geometry and position attribute
      if (!position || position.count === 0) {
        console.warn('Invalid geometry or position attribute')
        return
      }
      
      // Force update mesh's world matrix to ensure accurate transformations
      mesh.updateMatrixWorld(true)
      
      // Get the closest vertex to the intersection point
      const vertices = [intersect.face.a, intersect.face.b, intersect.face.c]
      
      // Validate face vertex indices
      const maxIndex = position.count - 1
      const validVertices = vertices.filter(idx => idx >= 0 && idx <= maxIndex)
      if (validVertices.length === 0) {
        console.warn('No valid vertex indices found in face')
        return
      }
      
      let closestVertex = validVertices[0]
      let minDistance = Infinity
      
      const intersectionPoint = intersect.point.clone()
      
      // Safely invert the matrix with error checking
      const worldMatrixInverse = mesh.matrixWorld.clone()
      const determinant = worldMatrixInverse.determinant()
      if (Math.abs(determinant) < 1e-10) {
        console.warn('Mesh matrix is not invertible, using face center approach')
        // Fallback: use the first vertex of the face
        closestVertex = validVertices[0]
      } else {
        worldMatrixInverse.invert()
        intersectionPoint.applyMatrix4(worldMatrixInverse)
        
        // Find closest vertex with bounds checking
        for (const vertexIndex of validVertices) {
          const vertex = new Vector3().fromBufferAttribute(position, vertexIndex)
          
          // Validate vertex position
          if (!isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z)) {
            console.warn(`Invalid vertex position at index ${vertexIndex}`)
            continue
          }
          
          const distance = vertex.distanceTo(intersectionPoint)
          if (distance < minDistance) {
            minDistance = distance
            closestVertex = vertexIndex
          }
        }
      }
      
      // Double-check that closestVertex is valid
      if (closestVertex < 0 || closestVertex >= position.count) {
        console.warn(`Invalid vertex index: ${closestVertex}`)
        return
      }
      
      // Calculate global vertex index for the parent object
      const globalVertexIndex = calculateGlobalVertexIndex(parentObject, mesh, closestVertex)
      if (globalVertexIndex === -1) {
        console.warn('Could not calculate global vertex index')
        return
      }
      
      // Toggle fixed state using global index
      if (fixedVertices.has(globalVertexIndex)) {
        fixedVertices.delete(globalVertexIndex)
        removeFixedVertexMarker(mesh, closestVertex)
        console.log(`Vertex ${globalVertexIndex} (local: ${closestVertex}) unfixed`)
      } else {
        fixedVertices.add(globalVertexIndex)
        addFixedVertexMarker(mesh, closestVertex)
        console.log(`Vertex ${globalVertexIndex} (local: ${closestVertex}) fixed`)
      }
    } catch (error) {
      console.error('Error in handleVertexFixing:', error)
      console.warn('Failed to fix/unfix vertex due to error')
    }
  }
}

function handleVertexPicking(object: Object3D, intersect: any) {
  if (intersect.face && object instanceof Mesh) {
    const geometry = object.geometry as BufferGeometry
    const position = geometry.attributes.position
    
    // Get the closest vertex to the intersection point
    const vertices = [intersect.face.a, intersect.face.b, intersect.face.c]
    let closestVertex = vertices[0]
    let minDistance = Infinity
    
    const intersectionPoint = intersect.point.clone()
    intersectionPoint.applyMatrix4(object.matrixWorld.clone().invert())
    
    for (const vertexIndex of vertices) {
      const vertex = new Vector3().fromBufferAttribute(position, vertexIndex)
      const distance = vertex.distanceTo(intersectionPoint)
      if (distance < minDistance) {
        minDistance = distance
        closestVertex = vertexIndex
      }
    }
    
    // Start picking mode
    userInput.isPicking = true
    userInput.pickedVertexIndex = closestVertex
    userInput.draggedObject = object
    
    console.log(`Started picking vertex ${closestVertex}`)
    
    // Disable camera controls while picking
    cameraControls.enabled = false
  }
}

function addFixedVertexMarker(object: Object3D, vertexIndex: number) {
  if (object instanceof Mesh) {
    const geometry = object.geometry as BufferGeometry
    const position = geometry.attributes.position
    const vertex = new Vector3().fromBufferAttribute(position, vertexIndex)
    
    // Create red sphere marker for fixed vertex
    const markerGeometry = new SphereGeometry(0.02, 8, 6)
    const markerMaterial = new MeshBasicMaterial({ color: 'red' })
    const marker = new Mesh(markerGeometry, markerMaterial)
    
    // Set position in local coordinates relative to the object
    marker.position.copy(vertex)
    marker.userData = { vertexIndex, parentObject: object }
    
    // Add marker as child of the object so it moves with the object
    object.add(marker)
    fixedVertexMarkers.push(marker)
    
    console.log(`Fixed vertex marker added at vertex ${vertexIndex}`)
  }
}

function removeFixedVertexMarker(object: Object3D, vertexIndex: number) {
  const markerIndex = fixedVertexMarkers.findIndex(marker => 
    marker.userData.vertexIndex === vertexIndex && marker.userData.parentObject === object
  )
  
  if (markerIndex !== -1) {
    const marker = fixedVertexMarkers[markerIndex]
    // Remove from parent object instead of scene
    if (marker.parent) {
      marker.parent.remove(marker)
    }
    fixedVertexMarkers.splice(markerIndex, 1)
    console.log(`Fixed vertex marker removed from vertex ${vertexIndex}`)
  }
}

function addControlHints() {
  const hintElement = document.createElement('div')
  hintElement.innerHTML = `
    <strong>Controls:</strong><br>
    • Drag objects to move them<br>
    • Shift+Click: Fix/unfix vertices<br>
    • Ctrl+Drag: Manipulate vertices (auto-restore on release)<br>
    • IJKL: Apply directional forces<br>
    • Space/B: Forward/backward forces<br>
    • Double-click: Toggle fullscreen<br>
    • R: Reset all objects to original shape
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
        loadObjectIntoScene(object, file.name)
      } catch (error) {
        console.error('Error loading OBJ file:', error)
      }
    }
  }
  reader.readAsText(file)
}

function loadPresetOBJ(url: string) {
  objLoader.load(
    url,
    (object) => {
      loadObjectIntoScene(object, url)
    },
    (progress) => {
      console.log('Loading progress:', progress)
    },
    (error) => {
      console.error('Error loading preset OBJ:', error)
    }
  )
}

function loadDefaultCube() {
  // Clear existing objects
  clearScene()
  
  // Recreate the default cube (same as in init)
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

  const newCube = new Mesh(cubeGeometry, material)
  loadObjectIntoScene(newCube, 'Default Cube')
}

function loadObjectIntoScene(object: Object3D, objectName: string) {
  // Clear existing objects and state
  clearScene()
  
  // Debug: Log the structure of the loaded object
  console.log(`Loading object: ${objectName}`)
  console.log(`Object type: ${object.constructor.name}`)
  console.log(`Object children count: ${object.children.length}`)
  
  // Setup object properties
  object.traverse((child) => {
    if (child instanceof Mesh) {
      console.log(`Found mesh: ${child.constructor.name} with ${child.geometry.attributes.position?.count || 0} vertices`)
      
      // Setup material if needed
      if (!child.material) {
        child.material = new MeshStandardMaterial({
          color: '#f69f1f',
          metalness: 0.5,
          roughness: 0.7,
          side: DoubleSide,
        })
      }
      
      // Ensure material is MeshStandardMaterial for consistency
      if (!(child.material instanceof MeshStandardMaterial)) {
        child.material = new MeshStandardMaterial({
          color: '#f69f1f',
          metalness: 0.5,
          roughness: 0.7,
          side: DoubleSide,
        })
      }
      
      // Enable shadows
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  
  // Smart scaling based on object's bounding box
  const box = new Box3().setFromObject(object)
  const size = box.getSize(new Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z)
  
  // Target size: scale object so its largest dimension is around 1-2 units
  const targetSize = 1.5
  const scaleFactor = maxDimension > 0 ? targetSize / maxDimension : 1
  
  object.scale.set(scaleFactor, scaleFactor, scaleFactor)
  
  // Center the object and position it appropriately
  const center = box.getCenter(new Vector3())
  object.position.set(-center.x * scaleFactor, 0.5, -center.z * scaleFactor)
  
  console.log(`Object scaling info:`)
  console.log(`  Original size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`)
  console.log(`  Max dimension: ${maxDimension.toFixed(2)}`)
  console.log(`  Scale factor: ${scaleFactor.toFixed(4)}`)
  console.log(`  Final size: ${(size.x * scaleFactor).toFixed(2)} x ${(size.y * scaleFactor).toFixed(2)} x ${(size.z * scaleFactor).toFixed(2)}`)
    // Add to scene
  scene.add(object)
  
  // Enhanced geometry computation for better meshless deformation
  object.traverse((child) => {
    if (child instanceof Mesh && child.geometry) {
      // Compute bounding sphere for better physics simulation
      child.geometry.computeBoundingSphere()
      // Ensure vertex normals are computed for proper rendering
      child.geometry.computeVertexNormals()
      // Compute tangents if UV coordinates exist
      if (child.geometry.attributes.uv) {
        try {
          child.geometry.computeTangents()
        } catch (e) {
          console.log('Could not compute tangents for mesh, continuing without them')
        }
      }
      
      console.log(`Enhanced mesh geometry computation completed for: ${child.constructor.name}`)
      console.log(`  Bounding sphere radius: ${child.geometry.boundingSphere?.radius.toFixed(4) || 'N/A'}`)
    }
  })
  
  // Store object data for shape matching
  const vertices = getVerticesFromObject(object)
  initialVertices.set(object, vertices)
  initialMasses.set(object, vertices.map(() => 1))
  initialPositions.set(object, object.position.clone())
  objectScaleFactors.set(object, scaleFactor)
  
  dragableObjects.push(object)
  
  // Update drag controls
  dragControls.deactivate()
  dragControls = new DragControls(dragableObjects, camera, renderer.domElement)
  setupDragEventListeners()
  
  // Camera alignment - equivalent to C++ viewer.core().align_camera_center()
  alignCameraToObject(object)
  
  // Enable animation system for meshless deformation
  animation.enabled = true
  animation.play = true
  
  // Update statistics immediately (C++ pattern: immediate stats update)
  updateObjectStatistics(object, objectName)
  
  // Update global cube reference for compatibility
  cube = object as Mesh
  
  console.log(`=== Successfully loaded object: ${objectName} ===`)
  console.log(`Total vertices: ${vertices.length}`)
  console.log(`Animation enabled: ${animation.enabled}`)
  console.log(`Animation playing: ${animation.play}`)
  console.log(`Object ready for meshless deformation with complete functionality`)
  console.log(`  - Vertex fixing (Shift+Click): Ready`)
  console.log(`  - Force application (IJKL keys): Ready`)
  console.log(`  - Auto-restoration: Ready`)
  console.log(`  - Shape matching: Ready`)
  
  // Align camera to the newly loaded object
  alignCameraToObject(object)
  
  // Update object statistics in the GUI
  updateObjectStatistics(object, objectName)
}

function clearScene() {
  // Remove existing objects from scene
  dragableObjects.forEach(obj => {
    scene.remove(obj)
    // Clean up object data
    initialVertices.delete(obj)
    initialMasses.delete(obj)
    initialPositions.delete(obj)
    objectScaleFactors.delete(obj)
  })
  dragableObjects.length = 0
  
  // Clear fixed vertices and their markers
  fixedVertices.clear()
  clearAllFixedVertexMarkers()
  
  // Clear regular vertex markers
  hideVertexMarkers()
  
  // Reset animation state
  animation.enabled = false
  animation.play = false
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
    if (mesh.material instanceof MeshStandardMaterial) {
      cameraControls.enabled = false
      animation.play = false
      mesh.material.emissive.set('orange')
      mesh.material.opacity = 0.7
      mesh.material.needsUpdate = true
    }

    if (simParams.showVertexMarkers) {
      showVertices(event.object)
    }
  })

  dragControls.addEventListener('dragend', (event) => {
    const mesh = event.object as Mesh
    if (mesh.material instanceof MeshStandardMaterial) {
      cameraControls.enabled = true
      animation.play = true
      mesh.material.emissive.set('black')
      mesh.material.opacity = 1
      mesh.material.needsUpdate = true
    }

    hideVertexMarkers()
  })

  dragControls.addEventListener('drag', (event) => {
    if (simParams.showVertexMarkers) {
      updateVertexMarkers(event.object)
    }
    
    const initialVerts = initialVertices.get(event.object)
    const initialPos = initialPositions.get(event.object)
    const masses = initialMasses.get(event.object)

    if (initialVerts && masses && initialPos) {
      const shapeMatchingParams: ShapeMatchingParams = {
        deformationType: simParams.deformationType,
        beta: simParams.beta,
        tau: simParams.tau,
        perturbation: simParams.perturbation,
        dampingFactor: simParams.dampingFactor,
        fixedVertices: fixedVertices
      }
      
      enhancedShapeMatching(event.object, initialVerts, initialPos, masses, shapeMatchingParams)
      if (simParams.showVertexMarkers) {
        updateVertexMarkers(event.object)
      }
    }
  })

  dragControls.enabled = true
}

function applyDirectionalForce(force: Vector3) {
  if (dragableObjects.length > 0) {
    applyForceAndSimulate(dragableObjects[0], force)
  } else {
    console.warn('No objects available to apply directional force to')
  }
}

function animate() {
  requestAnimationFrame(animate)
  
  stats.begin()
  
  // Update statistics
  updateStatistics()  // Physics simulation
  if (!simParams.pause && animation.enabled && animation.play) {
    // Only apply shape matching if there are active forces or ongoing deformation
    const hasActiveDeformation = userInput.hasActiveForce || userInput.isPicking || userInput.activeKeys.size > 0;
    
    if (hasActiveDeformation) {
      for (const object of dragableObjects) {
        // CRITICAL: Validate object state before shape matching
        if (!validateObjectState(object)) {
          console.warn("Object state validation failed, skipping physics simulation");
          continue;
        }
        
        const initialVerts = initialVertices.get(object)
        const initialPos = initialPositions.get(object)
        const masses = initialMasses.get(object)

        if (initialVerts && initialPos && masses) {
          // Create shape matching parameters from simulation parameters
          const shapeMatchingParams: ShapeMatchingParams = {
            deformationType: simParams.deformationType,
            beta: simParams.beta,
            tau: simParams.tau,
            perturbation: simParams.perturbation,
            dampingFactor: simParams.dampingFactor,
            fixedVertices: fixedVertices
          }
            enhancedShapeMatching(object, initialVerts, initialPos, masses, shapeMatchingParams)
          
          // CRITICAL: Validate object state after shape matching
          if (!validateObjectState(object)) {
            console.warn("Object state corrupted after shape matching, resetting to safe state");
            // Reset geometry to initial state if corrupted
            resetObjectToSafeState(object, initialVerts, initialPos);
          }
          
          // Force complete mesh refresh after shape matching
          object.traverse((child) => {
            if (child instanceof Mesh) {
              const geometry = child.geometry as BufferGeometry
              geometry.computeBoundingSphere()
              geometry.computeVertexNormals()
            }
          })
        }
      }
      
      // Complete refresh of fixed vertex markers after deformation
      updateFixedVertexMarkers()
    } else {
      // No active deformation - pause animation to save CPU
      animation.play = false
      console.log('No active deformation detected, pausing animation loop')
    }
  }
    // Apply auto restoration when simulation is paused or not active
  applyAutoRestore()
    
  // Update bounding box if visible
  if (simParams.showBoundingBox && boundingBoxHelper && cube) {
    const box = new Box3().setFromObject(cube)
    ;(boundingBoxHelper as Box3Helper).box.copy(box)
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

// Camera alignment function - equivalent to viewer.core().align_camera_center()
function alignCameraToObject(object: Object3D) {
  const box = new Box3().setFromObject(object)
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  
  // Calculate optimal camera distance based on object size
  const maxDimension = Math.max(size.x, size.y, size.z)
  const fov = camera.fov * (Math.PI / 180)
  const cameraDistance = maxDimension / (2 * Math.tan(fov / 2)) * 1.5
  
  // Position camera to view the object optimally
  camera.position.set(
    center.x + cameraDistance,
    center.y + cameraDistance * 0.5,
    center.z + cameraDistance
  )
  
  // Make camera look at the object center
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  
  // Update orbit controls target
  cameraControls.target.copy(center)
  cameraControls.update()
  
  console.log(`Camera aligned to object center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`)
  console.log(`Camera distance: ${cameraDistance.toFixed(2)}`)
}

// Reset all objects to their original shape and position
function resetAllObjectsToOriginal() {
  console.log('Resetting all objects to original shape...')
  
  dragableObjects.forEach(object => {
    restoreOriginalShape(object)
  })
  
  // Clear all fixed vertices
  fixedVertices.clear()
  clearAllFixedVertexMarkers()
  
  // Reset user input state
  userInput.hasActiveForce = false
  userInput.activeKeys.clear()
  userInput.isPicking = false
  userInput.pickedVertexIndex = -1
  userInput.draggedObject = null
  
  // Update statistics
  if (dragableObjects.length > 0) {
    updateObjectStatistics(dragableObjects[0], 'Reset Object')
  }
  
  console.log('All objects reset to original state')
}

function updateObjectStatistics(object: Object3D, objectName: string) {
  let totalVertices = 0
  let totalTriangles = 0
  let totalMemory = 0
  
  object.traverse((child) => {
    if (child instanceof Mesh && child.geometry) {
      const geometry = child.geometry
      const vertexCount = geometry.attributes.position?.count || 0
      const indexCount = geometry.index?.count || 0
      const triangleCount = indexCount > 0 ? indexCount / 3 : vertexCount / 3
      
      totalVertices += vertexCount
      totalTriangles += triangleCount
      
      // Estimate memory usage (simplified calculation)
      const positionArray = geometry.attributes.position?.array
      const normalArray = geometry.attributes.normal?.array
      const uvArray = geometry.attributes.uv?.array
      const indexArray = geometry.index?.array
      
      let meshMemory = 0
      if (positionArray) meshMemory += positionArray.length * 4 // Float32 = 4 bytes
      if (normalArray) meshMemory += normalArray.length * 4
      if (uvArray) meshMemory += uvArray.length * 4
      if (indexArray) meshMemory += indexArray.length * 2 // Uint16 = 2 bytes typically
      
      totalMemory += meshMemory
    }
  })
    // Update global statistics
  simParams.vertices = totalVertices
  simParams.triangles = Math.floor(totalTriangles)
  simParams.memoryUsage = totalMemory
  
  // Update GUI display statistics
  statsDisplay.vertices = totalVertices.toString()
  statsDisplay.triangles = Math.floor(totalTriangles).toString()
  statsDisplay.memory = (totalMemory / 1024).toFixed(2) + ' KB'
  
  console.log(`=== Object Statistics for ${objectName} ===`)
  console.log(`Vertices: ${totalVertices}`)
  console.log(`Triangles: ${Math.floor(totalTriangles)}`)
  console.log(`Memory usage: ${(totalMemory / 1024).toFixed(2)} KB`)
  console.log(`Scale factor: ${objectScaleFactors.get(object)?.toFixed(4) || 'N/A'}`)
    // Refresh GUI controllers if they exist
  if (gui) {
    // GUI will automatically reflect the updated simParams values
    console.log('GUI statistics updated')
  }
}

// Validate object state to prevent infinite coordinates
function validateObjectState(object: Object3D): boolean {
  try {
    // Check object properties
    if (!object || !object.position || !object.scale || !object.rotation) {
      console.warn("Object missing essential properties");
      return false;
    }
    
    // Check position
    if (!isFinite(object.position.x) || !isFinite(object.position.y) || !isFinite(object.position.z) ||
        isNaN(object.position.x) || isNaN(object.position.y) || isNaN(object.position.z)) {
      console.warn("Object has invalid position:", object.position);
      object.position.set(0, 0.5, 0); // Reset to safe position
      return false;
    }
    
    // Check scale
    if (!isFinite(object.scale.x) || !isFinite(object.scale.y) || !isFinite(object.scale.z) ||
        isNaN(object.scale.x) || isNaN(object.scale.y) || isNaN(object.scale.z) ||
        object.scale.x <= 0 || object.scale.y <= 0 || object.scale.z <= 0) {
      console.warn("Object has invalid scale:", object.scale);
      object.scale.set(1, 1, 1); // Reset to safe scale
      return false;
    }
    
    // Check rotation
    if (!isFinite(object.rotation.x) || !isFinite(object.rotation.y) || !isFinite(object.rotation.z) ||
        isNaN(object.rotation.x) || isNaN(object.rotation.y) || isNaN(object.rotation.z)) {
      console.warn("Object has invalid rotation:", object.rotation);
      object.rotation.set(0, 0, 0); // Reset to safe rotation
      return false;
    }
    
    // Check matrix
    object.updateMatrixWorld(true);
    const matrix = object.matrixWorld;
    const hasInvalidMatrix = matrix.elements.some(element => 
      !isFinite(element) || isNaN(element) || element === Infinity || element === -Infinity
    );
    
    if (hasInvalidMatrix) {
      console.warn("Object has invalid matrix, resetting to identity");
      object.position.set(0, 0.5, 0);
      object.rotation.set(0, 0, 0);
      object.scale.set(1, 1, 1);
      object.updateMatrixWorld(true);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("Error validating object state:", error);
    return false;
  }
}

// Reset object to safe state if corrupted
function resetObjectToSafeState(object: Object3D, initialVerts: Vector3[], initialPos: Vector3) {
  try {
    console.log("Resetting object to safe state");
    
    // Reset transform
    object.position.copy(initialPos);
    object.rotation.set(0, 0, 0);
    object.scale.set(1, 1, 1);
    object.updateMatrixWorld(true);
    
    // Reset geometry vertices to initial state
    let vertexIndex = 0;
    object.traverse((child) => {
      if (child instanceof Mesh) {
        const geometry = child.geometry as BufferGeometry;
        const positionAttr = geometry.attributes.position;
        
        for (let i = 0; i < positionAttr.count && vertexIndex < initialVerts.length; i++) {
          const vertex = initialVerts[vertexIndex];
          positionAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
          vertexIndex++;
        }
        
        positionAttr.needsUpdate = true;
        geometry.computeBoundingSphere();
        geometry.computeVertexNormals();
      }
    });
    
    console.log("Object reset to safe state completed");
  } catch (error) {
    console.error("Error resetting object to safe state:", error);
  }
}

function updateStatistics() {
  statsDisplay.fps = Math.round(1 / clock.getDelta()).toString()
  
  let totalVertices = 0;
  try {
    totalVertices = dragableObjects.reduce((total, obj) => {
      // Validate object before processing
      if (!obj || !obj.position || !obj.scale || !obj.rotation) {
        console.warn("Invalid object found in dragableObjects, skipping");
        return total;
      }
      
      // Check for invalid transforms
      if (!isFinite(obj.position.x) || !isFinite(obj.position.y) || !isFinite(obj.position.z) ||
          !isFinite(obj.scale.x) || !isFinite(obj.scale.y) || !isFinite(obj.scale.z) ||
          !isFinite(obj.rotation.x) || !isFinite(obj.rotation.y) || !isFinite(obj.rotation.z)) {
        console.warn("Object with invalid transform found, skipping vertex count");
        return total;
      }
        try {
        const vertices = getVerticesFromObject(obj);
        
        // CRITICAL: Check if any vertices are invalid and fix immediately
        const hasInvalidVertices = vertices.some(v => 
          !isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z) ||
          isNaN(v.x) || isNaN(v.y) || isNaN(v.z)
        );
        
        if (hasInvalidVertices) {
          console.warn("Invalid vertices detected in object, attempting to fix");
          const initialVerts = initialVertices.get(obj);
          const initialPos = initialPositions.get(obj);
          
          if (initialVerts && initialPos) {
            resetObjectToSafeState(obj, initialVerts, initialPos);
            // Re-get vertices after reset
            const fixedVertices = getVerticesFromObject(obj);
            return total + fixedVertices.length;
          } else {
            console.warn("No initial data available for object reset, skipping");
            return total;
          }
        }
        
        return total + vertices.length;
      } catch (error) {
        console.error("Error getting vertices from object:", error);
        return total;
      }
    }, 0);
  } catch (error) {
    console.error("Error in vertex counting:", error);
    totalVertices = 0;
  }
  
  statsDisplay.vertices = totalVertices.toString();
  statsDisplay.triangles = '0' // TODO: Calculate triangles
  
  // Safe memory usage check
  if (typeof (performance as any).memory !== 'undefined') {
    statsDisplay.memory = Math.round((performance as any).memory.usedJSHeapSize / 1024) + ' KB'
  } else {
    statsDisplay.memory = 'N/A'
  }
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

function updateFixedVertexMarkers() {
  // Complete refresh approach: clear all existing markers and recreate them
  clearAllFixedVertexMarkers()
  
  // Recreate all fixed vertex markers from scratch
  fixedVertices.forEach(vertexIndex => {
    // Find the object that contains this vertex
    for (const object of dragableObjects) {
      if (object instanceof Mesh) {
        const geometry = object.geometry as BufferGeometry
        const position = geometry.attributes.position
        
        // Check if this vertex index is valid for this object
        if (vertexIndex < position.count) {
          addFixedVertexMarker(object, vertexIndex)
          break // Found the object, no need to check others
        }
      }
    }
  })
}

function clearAllFixedVertexMarkers() {
  // Remove all existing fixed vertex markers from their parent objects
  fixedVertexMarkers.forEach(marker => {
    if (marker.parent) {
      marker.parent.remove(marker)
    }
  })
  fixedVertexMarkers.length = 0
}

function applyForceAndSimulate(object: Object3D, force: Vector3) {
  const initialVerts = initialVertices.get(object)
  const initialPos = initialPositions.get(object)
  const masses = initialMasses.get(object)
  const scaleFactor = objectScaleFactors.get(object) || 1

  console.log(`=== applyForceAndSimulate Debug ===`)
  console.log(`Object:`, object.constructor.name)
  console.log(`Initial vertices found:`, !!initialVerts, initialVerts?.length || 0)
  console.log(`Initial position found:`, !!initialPos)
  console.log(`Masses found:`, !!masses, masses?.length || 0)
  console.log(`Scale factor:`, scaleFactor)

  if (!initialVerts || !initialPos || !masses) {
    console.error('Missing required data for force application!')
    console.error('initialVerts:', !!initialVerts)
    console.error('initialPos:', !!initialPos) 
    console.error('masses:', !!masses)
    
    // Clear active force state when force application fails
    userInput.hasActiveForce = false
    userInput.activeKeys.clear()
    console.log('Cleared hasActiveForce due to missing data')
    return
  }

  // Adjust force based on object scale to prevent objects from flying away
  // Smaller objects (smaller scale factor) need proportionally smaller forces
  const adjustedForce = force.clone().multiplyScalar(scaleFactor)
  
  console.log(`Applying force with scale factor ${scaleFactor.toFixed(4)}`)
  console.log(`Original force magnitude: ${force.length().toFixed(4)}`)
  console.log(`Adjusted force magnitude: ${adjustedForce.length().toFixed(4)}`)

  if (simParams.showVertexMarkers) {
    showVertices(object)
  }

  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry
      if (geometry instanceof BufferGeometry) {
        const positionAttr = geometry.attributes.position

        const numVerticesToAffect = Math.max(1, Math.floor(positionAttr.count * (0.2 + Math.random() * 0.2)))
        let affectedCount = 0

        // Create a new position array for complete refresh
        const newPositions = new Float32Array(positionAttr.count * 3)
        
        // Copy current positions first
        for (let i = 0; i < positionAttr.count; i++) {
          newPositions[i * 3] = positionAttr.getX(i)
          newPositions[i * 3 + 1] = positionAttr.getY(i)
          newPositions[i * 3 + 2] = positionAttr.getZ(i)
        }

        // Try to affect the desired number of vertices, but skip fixed vertices
        while (affectedCount < numVerticesToAffect) {
          const randomVertexIndex = Math.floor(Math.random() * positionAttr.count)
          
          // Skip if this vertex is fixed
          if (fixedVertices.has(randomVertexIndex)) {
            continue
          }
            const vertex = new Vector3().fromBufferAttribute(positionAttr, randomVertexIndex)

          const vertexForce = adjustedForce.clone().multiplyScalar(0.8 + Math.random() * 0.4)
          vertex.add(vertexForce)

          // Update in the new position array
          newPositions[randomVertexIndex * 3] = vertex.x
          newPositions[randomVertexIndex * 3 + 1] = vertex.y
          newPositions[randomVertexIndex * 3 + 2] = vertex.z
          affectedCount++
        }

        // Complete refresh: replace the entire position array
        positionAttr.array = newPositions
        positionAttr.needsUpdate = true
        
        // Force geometry update
        geometry.attributes.position = positionAttr
        geometry.computeBoundingSphere()
      }
    }
  })

  if (simParams.showVertexMarkers) {
    updateVertexMarkers(object)
  }
  // Complete refresh of fixed vertex markers to prevent residual images
  updateFixedVertexMarkers()
  animation.enabled = true
  animation.play = true
  
  console.log('Force applied - restarting animation for deformation processing')
  
  // Clear active force state after successful force application
  // Use setTimeout to allow a brief delay before auto-restore can begin
  setTimeout(() => {
    userInput.hasActiveForce = false
    userInput.activeKeys.clear()
    console.log('Cleared hasActiveForce after force application completed')
  }, 100) // 100ms delay to prevent immediate restoration
}

function handleMouseMove(event: MouseEvent) {
  if (userInput.isPicking && userInput.draggedObject && userInput.pickedVertexIndex !== -1) {
    // Set active force when dragging
    userInput.hasActiveForce = true
    
    // Update mouse coordinates
    const rect = canvas.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    // Update raycaster
    raycaster.setFromCamera(mouse, camera)
    
    // Cast ray to a virtual plane for vertex dragging
    const distance = camera.position.distanceTo(userInput.draggedObject.position)
    const intersectionPoint = new Vector3()
    
    raycaster.ray.at(distance, intersectionPoint)
    
    // Apply the movement to the vertex
    if (userInput.draggedObject instanceof Mesh) {
      const geometry = userInput.draggedObject.geometry as BufferGeometry
      const position = geometry.attributes.position
      
      // Convert world space movement to object space
      const localPoint = intersectionPoint.clone()
      localPoint.applyMatrix4(userInput.draggedObject.matrixWorld.clone().invert())
      
      // Apply force based on movement
      const currentVertex = new Vector3().fromBufferAttribute(position, userInput.pickedVertexIndex)
      const force = localPoint.clone().sub(currentVertex).multiplyScalar(simParams.pickForce * 0.1)
      
      // Apply the force
      currentVertex.add(force)
      position.setXYZ(userInput.pickedVertexIndex, currentVertex.x, currentVertex.y, currentVertex.z)
      position.needsUpdate = true
      
      // Trigger shape matching with error handling
      const initialVerts = initialVertices.get(userInput.draggedObject)
      const initialPos = initialPositions.get(userInput.draggedObject)
      const masses = initialMasses.get(userInput.draggedObject)
      
      if (initialVerts && initialPos && masses) {
        try {
          const shapeMatchingParams: ShapeMatchingParams = {
            deformationType: simParams.deformationType,
            beta: simParams.beta,
            tau: simParams.tau,
            perturbation: simParams.perturbation,
            dampingFactor: simParams.dampingFactor,
            fixedVertices: fixedVertices
          }
          
          enhancedShapeMatching(userInput.draggedObject, initialVerts, initialPos, masses, shapeMatchingParams)
        } catch (error) {
          console.warn('Shape matching failed during vertex dragging:', error)
          // Continue with the operation - the vertex position has already been updated
        }
      }
    }
  }
}

function updateBoundingBoxVisibility(visible: boolean) {
  if (visible) {
    // Create bounding box helper if it doesn't exist
    if (!boundingBoxHelper && dragableObjects.length > 0) {
      const box = new Box3().setFromObject(dragableObjects[0])
      boundingBoxHelper = new Box3Helper(box, 0xffff00) // Yellow color
      scene.add(boundingBoxHelper)
    } else if (boundingBoxHelper && dragableObjects.length > 0) {
      // Update bounding box to current object state
      const box = new Box3().setFromObject(dragableObjects[0])
      ;(boundingBoxHelper as Box3Helper).box.copy(box)
      boundingBoxHelper.visible = true
    }
  } else if (boundingBoxHelper) {
    boundingBoxHelper.visible = false
  }
}

function handleMouseUp(_event: MouseEvent) {
  if (userInput.isPicking) {
    console.log('Mouse up detected during picking, cleaning up state')
    
    // Always reset picking state first
    userInput.isPicking = false
    userInput.pickedVertexIndex = -1
    
    // Restore original shape when mouse is released
    if (userInput.draggedObject) {
      restoreOriginalShape(userInput.draggedObject)
      userInput.draggedObject = null
    }
    
    // Clear active force with small delay to allow restoration to complete
    setTimeout(() => {
      userInput.hasActiveForce = false
      userInput.activeKeys.clear()
      console.log('Ended vertex picking and cleared hasActiveForce after delay')
    }, 200) // 200ms delay for Ctrl+drag operations
    
    cameraControls.enabled = true
    console.log('Ended vertex picking and restored original shape')
  }
}

function restoreOriginalShape(object: Object3D) {
  const originalVertices = initialVertices.get(object)
  
  if (!originalVertices) {
    console.warn('No original vertices found for object')
    return
  }
  
  console.log('Restoring original shape (preserving position)...')
  
  // Handle complex objects with multiple meshes - restore shape only
  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry as BufferGeometry
      const positionAttr = geometry.attributes.position
      let vertexOffset = 0

      // Calculate vertex offset for this mesh within the parent object
      const parent = child.parent
      if (parent && parent !== object) {
        parent.children.forEach((sibling) => {
          if (sibling === child) return
          if (sibling instanceof Mesh) {
            const siblingGeometry = sibling.geometry as BufferGeometry
            vertexOffset += siblingGeometry.attributes.position.count
          }
        })
      }

      // Restore original vertex positions (shape only, not object position)
      for (let i = 0; i < positionAttr.count; i++) {
        const globalVertexIndex = vertexOffset + i
        
        if (globalVertexIndex < originalVertices.length) {
          const originalVertex = originalVertices[globalVertexIndex].clone()
          
          // Use original vertex position directly in object's local space
          // No matrix transformations needed for shape restoration
          positionAttr.setXYZ(i, originalVertex.x, originalVertex.y, originalVertex.z)
        }
      }
      
      positionAttr.needsUpdate = true
      geometry.computeBoundingSphere()
      geometry.computeVertexNormals()
    }
  })

  // DO NOT restore object position - only restore the shape
  // The object should remain where the user positioned it

  // Update fixed vertex markers to match restored positions
  updateVertexMarkers(object)
  updateFixedVertexMarkers()
  
  console.log('Original shape restored (position preserved):', object.name || 'unnamed')
}

// Auto restoration function - gradually restore shape when no forces are applied
function applyAutoRestore() {
  const now = performance.now();
  const shouldLog = now - lastAutoRestoreLog > 2000; // Log every 2 seconds max
  
  if (shouldLog) {
    console.log(`=== Auto Restore Check ===`)
    console.log(`simParams.autoRestore: ${simParams.autoRestore}`)
    console.log(`userInput.hasActiveForce: ${userInput.hasActiveForce}`)
    console.log(`userInput.isPicking: ${userInput.isPicking}`)
    console.log(`userInput.activeKeys size: ${userInput.activeKeys.size}`)
    console.log(`dragableObjects length: ${dragableObjects.length}`)
    lastAutoRestoreLog = now;
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
        let vertexOffset = 0// Calculate vertex offset for this mesh within the parent object
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

          // Skip fixed vertices
          if (fixedVertices.has(globalVertexIndex)) {
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
            if (isFinite(restoredPos.x) && isFinite(restoredPos.y) && isFinite(restoredPos.z)) {
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
    })    // Note: We do NOT restore object position here - only shape
    // The object position should remain where the user moved it
  })
}

export { gui }

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
  hasGravity: boolean
  
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
  tau: 0.8,
  perturbation: 1e-4, // Increased for better numerical stability
  dt: 0.016,
  Famplitude: 0.05, // Reduced force amplitude for better control
  pickForce: 5, // Reduced picking force
  hasGravity: false,
  deformationType: 'rotation', // Start with the most stable deformation type
  showWireframe: false,
  showVertexMarkers: false,
  showForceField: false,
  showTriangles: false,  showBoundingBox: false,
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
    }    const initialVerts = initialVertices.get(event.object)
    const initialPos = initialPositions.get(event.object)!
    const masses = initialMasses.get(event.object)

    if (initialVerts && masses && initialPos) {      const shapeMatchingParams: ShapeMatchingParams = {
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
  visualizationFolder.add(simParams, 'showTriangles').name('Show Triangles').onChange((value: boolean) => {
    // This shows the mesh structure - for now using wireframe
    // In a more advanced implementation, this could show triangle edges as separate lines
    if (cube) {
      const material = cube.material as MeshStandardMaterial
      // We differentiate from wireframe by showing both solid and wireframe
      if (value) {
        material.wireframe = false
        // Could add a separate wireframe mesh here for better visualization
      }
    }
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

    const key = event.key.toLowerCase()
    
    // Track force keys
    if (['i', 'k', 'j', 'l', ' ', 'b'].includes(key)) {
      userInput.activeKeys.add(key)
      userInput.hasActiveForce = true
    }

    // Force application keys (based on reference project)
    switch (key) {
      case 'i': // Up force
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
    }
  })

  window.addEventListener('keyup', (event) => {
    userInput.isShiftPressed = event.shiftKey
    userInput.isCtrlPressed = event.ctrlKey
    
    const key = event.key.toLowerCase()
    
    // Remove from active keys and update force state
    if (userInput.activeKeys.has(key)) {
      userInput.activeKeys.delete(key)
      userInput.hasActiveForce = userInput.activeKeys.size > 0
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
  
  // Find intersections with dragable objects
  const intersects = raycaster.intersectObjects(dragableObjects, true)
  
  if (intersects.length > 0) {
    const intersect = intersects[0]
    const object = intersect.object
    
    if (userInput.isShiftPressed) {
      // Fix/unfix vertex functionality
      handleVertexFixing(object, intersect)
    } else if (userInput.isCtrlPressed) {
      // Start vertex picking
      handleVertexPicking(object, intersect)
    }
  }
}

function handleVertexFixing(object: Object3D, intersect: any) {
  if (intersect.face && object instanceof Mesh) {
    try {
      const geometry = object.geometry as BufferGeometry
      const position = geometry.attributes.position
      
      // Validate geometry and position attribute
      if (!position || position.count === 0) {
        console.warn('Invalid geometry or position attribute')
        return
      }
      
      // Force update object's world matrix to ensure accurate transformations
      object.updateMatrixWorld(true)
      
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
      const worldMatrixInverse = object.matrixWorld.clone()
      const determinant = worldMatrixInverse.determinant()
      if (Math.abs(determinant) < 1e-10) {
        console.warn('Object matrix is not invertible, using face center approach')
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
      
      // Toggle fixed state
      if (fixedVertices.has(closestVertex)) {
        fixedVertices.delete(closestVertex)
        removeFixedVertexMarker(object, closestVertex)
        console.log(`Vertex ${closestVertex} unfixed`)
      } else {
        fixedVertices.add(closestVertex)
        addFixedVertexMarker(object, closestVertex)
        console.log(`Vertex ${closestVertex} fixed`)
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
  updateStatistics()  // Physics simulation
  if (!simParams.pause && animation.enabled && animation.play) {
    for (const object of dragableObjects) {
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
        
        // Force complete mesh refresh after shape matching
        if (object instanceof Mesh) {
          const geometry = object.geometry as BufferGeometry
          geometry.computeBoundingSphere()
        }
      }
    }
    
    // Complete refresh of fixed vertex markers after deformation
    updateFixedVertexMarkers()
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

function updateStatistics() {
  statsDisplay.fps = Math.round(1 / clock.getDelta()).toString()
  statsDisplay.vertices = dragableObjects.reduce((total, obj) => {
    const vertices = getVerticesFromObject(obj)
    return total + vertices.length
  }, 0).toString()
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

          const vertexForce = force.clone().multiplyScalar(0.8 + Math.random() * 0.4)
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
      
      // Trigger shape matching
      const initialVerts = initialVertices.get(userInput.draggedObject)
      const initialPos = initialPositions.get(userInput.draggedObject)
      const masses = initialMasses.get(userInput.draggedObject)
        if (initialVerts && initialPos && masses) {        const shapeMatchingParams: ShapeMatchingParams = {
          deformationType: simParams.deformationType,
          beta: simParams.beta,
          tau: simParams.tau,
          perturbation: simParams.perturbation,
          dampingFactor: simParams.dampingFactor,
          fixedVertices: fixedVertices
        }
        
        enhancedShapeMatching(userInput.draggedObject, initialVerts, initialPos, masses, shapeMatchingParams)
      }
    }
  }
}

function updateBoundingBoxVisibility(visible: boolean) {
  if (visible) {
    // Create bounding box helper if it doesn't exist
    if (!boundingBoxHelper && cube) {
      const box = new Box3().setFromObject(cube)
      boundingBoxHelper = new Box3Helper(box, 0xffff00) // Yellow color
      scene.add(boundingBoxHelper)
    } else if (boundingBoxHelper && cube) {
      // Update bounding box to current object state
      const box = new Box3().setFromObject(cube)
      ;(boundingBoxHelper as Box3Helper).box.copy(box)
      boundingBoxHelper.visible = true
    }
  } else if (boundingBoxHelper) {
    boundingBoxHelper.visible = false
  }
}

function handleMouseUp(_event: MouseEvent) {
  if (userInput.isPicking) {
    userInput.isPicking = false
    userInput.pickedVertexIndex = -1
    userInput.hasActiveForce = false // Clear active force when releasing mouse
    
    // Restore original shape when mouse is released
    if (userInput.draggedObject) {
      restoreOriginalShape(userInput.draggedObject)
      userInput.draggedObject = null
    }
    
    cameraControls.enabled = true
    console.log('Ended vertex picking and restored original shape')
  }
}

function restoreOriginalShape(object: Object3D) {
  const originalVertices = initialVertices.get(object)
  if (!originalVertices || !(object instanceof Mesh)) {
    console.warn('No original vertices found for object')
    return
  }
  
  const geometry = object.geometry as BufferGeometry
  const positionAttr = geometry.attributes.position
  
  // Restore original vertex positions
  for (let i = 0; i < Math.min(originalVertices.length, positionAttr.count); i++) {
    const originalVertex = originalVertices[i]
    positionAttr.setXYZ(i, originalVertex.x, originalVertex.y, originalVertex.z)
  }
  
  positionAttr.needsUpdate = true
    // Update fixed vertex markers to match restored positions
  updateVertexMarkers(object)
  
  console.log('Original shape restored')
}

// Auto restoration function - gradually restore shape when no forces are applied
function applyAutoRestore() {
  if (!simParams.autoRestore || userInput.hasActiveForce || userInput.isPicking) {
    return // Skip auto restore if disabled or forces are active
  }

  dragableObjects.forEach(object => {
    const originalVertices = initialVertices.get(object)
    if (!originalVertices || !(object instanceof Mesh)) {
      return
    }

    const geometry = object.geometry as BufferGeometry
    const positionAttr = geometry.attributes.position
    let hasChanges = false

    // Gradually move each vertex towards its original position
    for (let i = 0; i < Math.min(originalVertices.length, positionAttr.count); i++) {
      const currentPos = new Vector3(
        positionAttr.getX(i),
        positionAttr.getY(i),
        positionAttr.getZ(i)
      )
      
      const originalPos = originalVertices[i].clone()
      
      // Check if the vertex is significantly displaced
      const distance = currentPos.distanceTo(originalPos)
      if (distance > 0.001) { // Only apply restoration if vertex is displaced
        // Gradually move towards original position
        const restoredPos = currentPos.lerp(originalPos, simParams.restoreSpeed)
        positionAttr.setXYZ(i, restoredPos.x, restoredPos.y, restoredPos.z)
        hasChanges = true
      }
    }

    if (hasChanges) {
      positionAttr.needsUpdate = true
    }
  })
}

export { gui }

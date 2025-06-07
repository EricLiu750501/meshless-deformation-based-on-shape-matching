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
  // MeshNormalMaterial,
  BufferAttribute,


} from 'three'
import { DragControls } from 'three/addons/controls/DragControls.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import Stats from 'stats.js'
// import * as animations from './helpers/animations'
import { toggleFullScreen } from './helpers/fullscreen'
import { resizeRendererToDisplaySize } from './helpers/responsiveness'
import { createGridTexture } from './helpers/plane'
// import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import './style.css'
import {getVerticesFromObject, shapeMatching} from './helpers/shapeMatching'

import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
const CANVAS_ID = 'scene'

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

let objListFolder:GUI

// Simulation parameters interface
interface SimulationParams {
  // Physics
  dampingFactor: number;
  Rb: number; // Rayleigh beta (velocity damping)
  beta: number; // Linear/rotation mix
  tau: number; // Elasticity
  perturbation: number;
  dt: number; // Time step
  
  // Forces
  Famplitude: number; // Force amplitude
  pickForce: number; // Picking force
  hasGravity: boolean;
  
  // Deformation type
  deformationType: 'rotation' | 'linear' | 'quadratic';
  
  // Visualization
  showWireframe: boolean;
  showVertexMarkers: boolean;
  showForceField: boolean;
  showFixedPoints: boolean;
  
  // Control
  pause: boolean;
  
  // Stats
  fps: number;
  vertices: number;
  triangles: number;
  memoryUsage: number;
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
};

const animation = { enabled: false, play: false }
const dragableObject: Object3D[] = [] ;
const vertexMarkers: Mesh[] = [];
const fixedVertices: Set<number> = new Set(); // Track fixed vertices
const fixedVertexMarkers: Mesh[] = [];
const initialVertices: Map<Object3D, Vector3[]> = new Map();
const initialMasses: Map<Object3D, number[]> = new Map();
const initialPositions: Map<Object3D, Vector3> = new Map();

// User input state
const userInput = {
  isShiftPressed: false,
  isCtrlPressed: false,
  forceDirection: { x: 0, y: 0, z: 0 }
};


//
// loader.load(
// 	// resource URL
// 	'cube.obj',
// 	// called when resource is loaded
// 	function ( object ) {
//     object.scale.set(0.01, 0.01, 0.01);
//     console.log(getVerticesFromObject(object));
// 		scene.add( object );
// 		dragableObject.push(object);
//
//
// 	},
// 	// called when loading is in progress
// 	function ( xhr ) {
//
// 		console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' );
//
// 	},
// 	// called when loading has errors
// 	function ( error ) {
//
// 		console.log( 'An error happened', error );
//
// 	}
// );


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

    loadingManager.onStart = () => {
      console.log('loading started')
    }
    loadingManager.onProgress = (url, loaded, total) => {
      console.log('loading in progress:')
      console.log(`${url} -> ${loaded} / ${total}`)
    }
    loadingManager.onLoad = () => {
      console.log('loaded!')
    }
    loadingManager.onError = () => {
      console.log('❌ error while loading')
    }
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
    // const sideLength = 1
    // const cubeGeometry = new BoxGeometry(sideLength, sideLength, sideLength)
    // const cubeMaterial = new MeshStandardMaterial({
    //   color: '#f69f1f',
    //   metalness: 0.5,
    //   roughness: 0.7,
    //   side: DoubleSide,
    // })
    // cube = new Mesh(cubeGeometry, cubeMaterial)
    // // console.log(getVerticesFromObject(cube))
    // console.log('cube', cube);
    // cube.castShadow = true
    // cube.position.y = 0.5

    const cubeVerticesInit = [
      [-0.5, -0.5, -0.5],
      [ 0.5, -0.5, -0.5],
      [ 0.5,  0.5, -0.5],
      [-0.5,  0.5, -0.5],
      [-0.5, -0.5,  0.5],
      [ 0.5, -0.5,  0.5],
      [ 0.5,  0.5,  0.5],
      [-0.5,  0.5,  0.5],
    ]

    const positions = new Float32Array(cubeVerticesInit.flat())
    const cubeGeometry = new BufferGeometry()
    cubeGeometry.setAttribute('position', new BufferAttribute(positions, 3))

    // 可選：用索引資料建立面
    const indices = [
      // 前面
      0, 1, 2, 0, 2, 3,
      // 後面
      4, 6, 5, 4, 7, 6,
      // 上面
      3, 2, 6, 3, 6, 7,
      // 下面
      0, 5, 1, 0, 4, 5,
      // 右面
      1, 5, 6, 1, 6, 2,
      // 左面
      4, 0, 3, 4, 3, 7,
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




    // Store initial vertices and masses for the cube
    const cubeVertices = cubeGeometry.attributes.position.array as Float32Array
    const merged = BufferGeometryUtils.mergeVertices(cube.geometry)
    console.log('merged vertex count:', merged.attributes.position)
    const cubeVerticesVec3: Vector3[] = [];
    for(let i = 0; i < cubeVertices.length; i += 3) {
      cubeVerticesVec3.push(new Vector3(cubeVertices[i], cubeVertices[i+1], cubeVertices[i+2]));
    }

    initialVertices.set(cube, cubeVerticesVec3);
    initialMasses.set(cube, cubeVerticesVec3.map(() => 1)); // Each vertex has mass 1
    initialPositions.set(cube, cube.position.clone());

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

    scene.add(cube)
    scene.add(plane)

    dragableObject.push(cube)

  }

  // ===== 🎥 CAMERA =====
{
    camera = new PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    camera.position.set(2, 2, 5)
  }

  // ===== 🕹️ CONTROLS =====
{
    cameraControls = new OrbitControls(camera, canvas)
    cameraControls.target = cube.position.clone()
    cameraControls.enableDamping = true
    cameraControls.autoRotate = false
    cameraControls.update()

    dragControls = new DragControls(dragableObject, camera, renderer.domElement)
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

      showVertices(event.object)
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
      // console.log("v", getWorldVertices(event.object));
      updateVertexMarkers(event.object);

      // const object:Mesh = event.object as Mesh;

      // const currentVertices = getWorldVertices(object);
      const initialVerts = initialVertices.get(event.object);
      const initialPos:Vector3 = initialPositions.get(event.object)!;
      const masses = initialMasses.get(event.object);

      // console.log("Current Vertices", currentVertices);


      // Apply shape matching if we have the needed data
      if (initialVerts && masses && initialPos) {
        // We apply to the object's local vertices
        shapeMatching(event.object, initialVerts, initialPos, masses);

        // Update vertex markers after shape matching
        updateVertexMarkers(event.object);
      }
    })
    dragControls.enabled = true

    // Add a hint for users
    const hintElement = document.createElement('div')
    hintElement.innerHTML = 'Click and drag the cube to move it (not Chrome Browser may not work)'
    hintElement.style.position = 'absolute'
    hintElement.style.bottom = '10px'
    hintElement.style.left = '10px'
    hintElement.style.color = 'white'
    hintElement.style.padding = '5px'
    hintElement.style.backgroundColor = 'rgba(0,0,0,0.5)'
    hintElement.style.borderRadius = '5px'
    document.body.appendChild(hintElement)
    // setTimeout(() => hintElement.style.display = 'none', 5000)

    // Full screen
    window.addEventListener('dblclick', (event) => {
      if (event.target === canvas) {
        toggleFullScreen(canvas)
      }
    })
  }

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
  // ==== 🐞 DEBUG GUI ====
{
    gui = new GUI({ title: '🎮 Meshless Deformation Control', width: 350 })

    // Model folder
    const modelFolder = gui.addFolder('Model')
    modelFolder.add({ loadOBJ: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.obj';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          console.log('OBJ file selected:', file.name);
          // TODO: Implement OBJ loading functionality
        }
      };
      input.click();
    }}, 'loadOBJ').name('Load OBJ File');

    // Integration/Physics folder
    const physicsFolder = gui.addFolder('Physics')
    physicsFolder.add(simParams, 'Rb', 0, 10).name('Velocity Damping');
    physicsFolder.add(simParams, 'Famplitude', 0, 1000).name('Force Amplitude');
    physicsFolder.add(simParams, 'pickForce', 1, 100).name('Picking Force');
    physicsFolder.add(simParams, 'tau', 0, 1).name('Tau (Elasticity)');
    physicsFolder.add(simParams, 'beta', 0, 1).name('Beta (Linear/Rotation Mix)');
    physicsFolder.add(simParams, 'perturbation', 0, 0.1).name('Regularization');
    physicsFolder.add(simParams, 'dt', 0.001, 1.0).name('Time Step');
    physicsFolder.add(simParams, 'hasGravity').name('Activate Gravity');
    physicsFolder.add(simParams, 'pause').name('Pause');

    // Deformation Types folder
    const deformationFolder = gui.addFolder('Deformation Types')
    const deformationTypes = { 'Rotation': 'rotation', 'Linear': 'linear', 'Quadratic': 'quadratic' };
    deformationFolder.add(simParams, 'deformationType', deformationTypes).name('Type');

    // Visualization folder
    const visualizationFolder = gui.addFolder('Visualization')
    visualizationFolder.add(simParams, 'showWireframe').name('Show Wireframe').onChange((value: boolean) => {
      const material = cube.material as MeshStandardMaterial;
      material.wireframe = value;
    });
    visualizationFolder.add(simParams, 'showVertexMarkers').name('Show Vertex Markers');
    visualizationFolder.add(simParams, 'showForceField').name('Show Force Field');
    visualizationFolder.add(simParams, 'showFixedPoints').name('Show Fixed Points');

    // Shape Matching folder  
    const simulationFolder = gui.addFolder('Shape Matching')
    simulationFolder.add(simParams, 'dampingFactor', 0.005, 1).name('Damping Factor');
    simulationFolder.add({ 
      applyRandomForce: () => {
        const force = new Vector3(
          (Math.random() - 0.5) * 2,
          0, 0
        );
        applyForceAndSimulate(cube, force);
      }
    }, 'applyRandomForce').name('Apply Random Force');

    // Data/Statistics folder
    const dataFolder = gui.addFolder('Statistics')
    const statsDisplay = {
      fps: '0',
      vertices: '0', 
      triangles: '0',
      memory: '0 KB'
    };
    dataFolder.add(statsDisplay, 'fps').name('FPS').listen();
    dataFolder.add(statsDisplay, 'vertices').name('Vertices').listen();
    dataFolder.add(statsDisplay, 'triangles').name('Triangles').listen();
    dataFolder.add(statsDisplay, 'memory').name('Memory Usage').listen();

    // Controls folder (from original)
    const controlsFolder = gui.addFolder('Controls')
    controlsFolder.add(dragControls, 'enabled').name('drag controls').setValue(true)

    const lightsFolder = gui.addFolder('Lights')
    lightsFolder.add(pointLight, 'visible').name('point light')
    lightsFolder.add(ambientLight, 'visible').name('ambient light')

    const helpersFolder = gui.addFolder('Helpers')
    helpersFolder.add(axesHelper, 'visible').name('axes')
    helpersFolder.add(pointLightHelper, 'visible').name('pointLight')

    const cameraFolder = gui.addFolder('Camera')
    cameraFolder.add(cameraControls, 'autoRotate')
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          // TODO: Implement OBJ loading
          console.log('OBJ file selected:', file.name);
        }
      };
      input.click();
    }}, 'loadOBJ').name('Load OBJ File');

    // Integration/Physics folder
    const physicsFolder = gui.addFolder('Physics')
    physicsFolder.add(simParams, 'Rb', 0, 10).name('Velocity Damping');
    physicsFolder.add(simParams, 'Famplitude', 0, 1000).name('Force Amplitude');
    physicsFolder.add(simParams, 'pickForce', 1, 100).name('Picking Force');
    physicsFolder.add(simParams, 'tau', 0, 1).name('Tau (Elasticity)');
    physicsFolder.add(simParams, 'beta', 0, 1).name('Beta (Linear/Rotation Mix)');
    physicsFolder.add(simParams, 'perturbation', 0, 0.1).name('Regularization');
    physicsFolder.add(simParams, 'dt', 0.001, 1.0).name('Time Step');
    physicsFolder.add(simParams, 'hasGravity').name('Activate Gravity');
    physicsFolder.add(simParams, 'pause').name('Pause');

    // Deformation Types folder
    const deformationFolder = gui.addFolder('Deformation Types')
    const deformationTypes = { 'Rotation': 'rotation', 'Linear': 'linear', 'Quadratic': 'quadratic' };
    deformationFolder.add(simParams, 'deformationType', deformationTypes).name('Type');

    // Visualization folder
    const visualizationFolder = gui.addFolder('Visualization')    visualizationFolder.add(simParams, 'showWireframe').name('Show Wireframe').onChange((value: boolean) => {
      const material = cube.material as MeshStandardMaterial;
      material.wireframe = value;
    });
    visualizationFolder.add(simParams, 'showVertexMarkers').name('Show Vertex Markers');
    visualizationFolder.add(simParams, 'showForceField').name('Show Force Field');
    visualizationFolder.add(simParams, 'showFixedPoints').name('Show Fixed Points');

    // Shape Matching folder
    const simulationFolder = gui.addFolder('Shape Matching')
    simulationFolder.add(simParams, 'dampingFactor', 0.005, 1).name('Damping Factor');
    simulationFolder.add({ 
      applyRandomForce: () => {
        const force = new Vector3(
          (Math.random() - 0.5) * 2,
          0, 0
        );
        applyForceAndSimulate(cube, force);
      }
    }, 'applyRandomForce').name('Apply Random Force');

    // Data/Statistics folder
    const dataFolder = gui.addFolder('Statistics')
    const statsDisplay = {
      fps: '0',
      vertices: '0', 
      triangles: '0',
      memory: '0 KB'
    };
    dataFolder.add(statsDisplay, 'fps').name('FPS').listen();
    dataFolder.add(statsDisplay, 'vertices').name('Vertices').listen();
    dataFolder.add(statsDisplay, 'triangles').name('Triangles').listen();
    dataFolder.add(statsDisplay, 'memory').name('Memory Usage').listen();
    // objListFolder = gui.addFolder('OBJ Files') 




    // persist GUI state in local storage on changes
    gui.onFinishChange(() => {
      const guiState = gui.save()
      localStorage.setItem('guiState', JSON.stringify(guiState))
    })

    // load GUI state if available in local storage
    const guiState = localStorage.getItem('guiState')
    if (guiState) gui.load(JSON.parse(guiState))

    // reset GUI state button
    const resetGui = () => {
      localStorage.removeItem('guiState')
      gui.reset()
    }
    gui.add({ resetGui }, 'resetGui').name('RESET')

    // gui.close()
  }
}

function animate() {
  requestAnimationFrame(animate)

  stats.begin()
  if (animation.enabled && animation.play) {
    // animations.rotate(cube, clock, Math.PI / 3)
    // animations.bounce(cube, clock, 1, 0.5, 0.5)
    if (animation.enabled && animation.play) {
      // Apply shape matching to all objects with stored data
      for (const object of dragableObject) {
        const initialVerts = initialVertices.get(object);
        const initialPos = initialPositions.get(object);
        const masses = initialMasses.get(object);

        if (initialVerts && initialPos && masses) {
          shapeMatching(object, initialVerts, initialPos, masses, shapeMatchingOptions.dampingFactor);
        }
      }
    }

  }

  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement
    camera.aspect = canvas.clientWidth / canvas.clientHeight
    camera.updateProjectionMatrix()
  }

  cameraControls.update()

  renderer.render(scene, camera)
  stats.end()
}

// Helper function to show vertices of an object
function showVertices(object: Object3D) {
  // Clear any existing markers
  hideVertexMarkers();

  // Get vertices from the object
  const vertices = getVerticesFromObject(object);

  // Create a marker for each vertex
  const markerGeometry = new BoxGeometry(0.05, 0.05, 0.05);
  const markerMaterial = new MeshBasicMaterial({ color: 'red' });

  vertices.forEach(vertex => {
    // Apply object's world matrix to transform the vertex
    const worldVertex = vertex.clone();
    worldVertex.applyMatrix4(object.matrixWorld);

    const marker = new Mesh(markerGeometry, markerMaterial);
    marker.position.copy(worldVertex);
    scene.add(marker);
    vertexMarkers.push(marker);
  });
}

// Helper function to update vertex marker positions
function updateVertexMarkers(object: Object3D) {
  // Get current vertices
  const vertices = getVerticesFromObject(object);

  // Update marker positions
  for (let i = 0; i < vertices.length && i < vertexMarkers.length; i++) {
    // Apply object's world matrix to transform the vertex
    const worldVertex = vertices[i].clone();
    worldVertex.applyMatrix4(object.matrixWorld);
    vertexMarkers[i].position.copy(worldVertex);
  }
}

// Helper function to hide vertex markers
function hideVertexMarkers() {
  vertexMarkers.forEach(marker => {
    scene.remove(marker);
  });
  vertexMarkers.length = 0;
}

// Function to apply force to multiple random vertices
function applyForceAndSimulate(object: Object3D, force: Vector3) {
  // Get initial data
  const initialVerts = initialVertices.get(object);
  const initialPos = initialPositions.get(object);
  const masses = initialMasses.get(object);

  if (!initialVerts || !initialPos || !masses) return;

  // Show vertices
  showVertices(object);

  // Select multiple random vertices to apply force to
  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry;
      if (geometry instanceof BufferGeometry) {
        const positionAttr = geometry.attributes.position;

        // Determine how many vertices to affect (20-40% of total)
        const numVerticesToAffect = Math.max(1, Math.floor(positionAttr.count * (0.2 + Math.random() * 0.2)));
        console.log(`Applying force to ${numVerticesToAffect} vertices`);

        // Affect multiple random vertices
        for (let i = 0; i < numVerticesToAffect; i++) {
          const randomVertexIndex = Math.floor(Math.random() * positionAttr.count);
          const vertex = new Vector3().fromBufferAttribute(positionAttr, randomVertexIndex);

          // Vary the force slightly for each vertex for more natural deformation
          const vertexForce = force.clone().multiplyScalar(0.8 + Math.random() * 0.4);

          // Apply "force" by moving the vertex
          vertex.add(vertexForce);

          // Update the position of this vertex
          positionAttr.setXYZ(randomVertexIndex, vertex.x, vertex.y, vertex.z);
        }

        positionAttr.needsUpdate = true;
      }
    }
  });

  // Update markers
  updateVertexMarkers(object);

  // Add shape matching to animation loop for this object
  animation.enabled = true;
  animation.play = true;
}



export {
  objListFolder
}





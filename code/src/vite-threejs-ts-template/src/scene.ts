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
  TextureLoader,
  RepeatWrapping,
  Object3D

} from 'three'
import { DragControls } from 'three/addons/controls/DragControls.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import Stats from 'stats.js'
import * as animations from './helpers/animations'
import { toggleFullScreen } from './helpers/fullscreen'
import { resizeRendererToDisplaySize } from './helpers/responsiveness'
import { createGridTexture } from './helpers/plane'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import './style.css'
import {getVerticesFromObject} from './helpers/shapeMatching'

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

const animation = { enabled: true, play: false }
const loader = new OBJLoader();
const dragableObject: Object3D[] = [] ;
const vertexMarkers: Mesh[] = [];


loader.load(
	// resource URL
	'teapot.obj',
	// called when resource is loaded
	function ( object ) {
    object.scale.set(0.01, 0.01, 0.01);
    console.log(getVerticesFromObject(object));
		scene.add( object );
		dragableObject.push(object);


	},
	// called when loading is in progress
	function ( xhr ) {

		console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' );

	},
	// called when loading has errors
	function ( error ) {

		console.log( 'An error happened', error );

	}
);


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
    const sideLength = 1
    const cubeGeometry = new BoxGeometry(sideLength, sideLength, sideLength)
    const cubeMaterial = new MeshStandardMaterial({
      color: '#f69f1f',
      metalness: 0.5,
      roughness: 0.7,
    })
    cube = new Mesh(cubeGeometry, cubeMaterial)
    console.log(getVerticesFromObject(cube))
    cube.castShadow = true
    cube.position.y = 0.5

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
      console.log('dragging:', event.object.name)
      updateVertexMarkers(event.object)
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
    stats = new Stats()
    document.body.appendChild(stats.dom)
  }

  // ==== 🐞 DEBUG GUI ====
  {
    gui = new GUI({ title: '🐞 Debug GUI', width: 300 })

    const cubeOneFolder = gui.addFolder('Cube one')

    cubeOneFolder.add(cube.position, 'x').min(-5).max(5).step(0.5).name('pos x')
    cubeOneFolder
      .add(cube.position, 'y')
      .min(-5)
      .max(5)
      .step(1)
      .name('pos y')
      .onChange(() => (animation.play = false))
      .onFinishChange(() => (animation.play = true))
    cubeOneFolder.add(cube.position, 'z').min(-5).max(5).step(0.5).name('pos z')

    cubeOneFolder.add(cube.material as MeshStandardMaterial, 'wireframe')
    cubeOneFolder.addColor(cube.material as MeshStandardMaterial, 'color')
    cubeOneFolder.add(cube.material as MeshStandardMaterial, 'metalness', 0, 1, 0.1)
    cubeOneFolder.add(cube.material as MeshStandardMaterial, 'roughness', 0, 1, 0.1)

    cubeOneFolder
      .add(cube.rotation, 'x', -Math.PI * 2, Math.PI * 2, Math.PI / 4)
      .name('rotate x')
    cubeOneFolder
      .add(cube.rotation, 'y', -Math.PI * 2, Math.PI * 2, Math.PI / 4)
      .name('rotate y')
      .onChange(() => (animation.play = false))
      .onFinishChange(() => (animation.play = true))
    cubeOneFolder
      .add(cube.rotation, 'z', -Math.PI * 2, Math.PI * 2, Math.PI / 4)
      .name('rotate z')

    cubeOneFolder.add(animation, 'enabled').name('animated')

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

    gui.close()
  }
}

function animate() {
  requestAnimationFrame(animate)

  stats.begin()
  if (animation.enabled && animation.play) {
    // animations.rotate(cube, clock, Math.PI / 3)
    animations.bounce(cube, clock, 1, 0.5, 0.5)
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


export {
  objListFolder
}





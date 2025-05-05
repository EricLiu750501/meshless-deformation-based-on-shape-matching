//
// import * as THREE from 'three';
// import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// import { loadOBJModel } from './js/objloader.js';
// let scene, camera, renderer, controls;
// let currentObject = null;
//
// const modelList = [
//     { name: 'Sample Model Teapot', path: '/objfile/teapot.obj' },
//     // { name: 'Sample Model 2', path: 'objfile/model2.obj' },
//     // { name: 'Sample Model 3', path: 'objfile/model3.obj' }
// ];
//
// init();
//
// function init() {
//     const modelSelect = document.getElementById('modelSelect');
//
//     modelList.forEach(model => {
//         const option = document.createElement('option');
//         option.value = model.path;
//         option.textContent = model.name;
//         modelSelect.appendChild(option);
//     });
//
//     modelSelect.addEventListener('change', function () {
//         const path = this.value;
//         if (path) {
//             loadOBJModel(path);
//             console.log(path);
//         }
//     });
//     scene = new THREE.Scene();
//     scene.background = new THREE.Color(0x222222);
//
//     camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
//     camera.position.set(0, 1, 5);
//     
//     renderer = new THREE.WebGLRenderer({ antialias: true });
//     renderer.setSize(window.innerWidth, window.innerHeight);
//     document.getElementById('canvas-container').appendChild(renderer.domElement);
//
//     const light = new THREE.DirectionalLight(0xffffff, 1);
//     light.position.set(0, 10, 0)
//     scene.add(light);
//
//     controls = new OrbitControls(camera, renderer.domElement);
//     controls.enableDamping = true; // 讓滑動更平滑
//     controls.dampingFactor = 0.05;
//     controls.screenSpacePanning = false;
//     controls.minDistance = 0.5; // 最小縮小到多近
//     controls.maxDistance = 200;  // 最大拉多遠
//
//     window.addEventListener('resize', onWindowResize, false);
//
//     animate();
// }
//
// function onWindowResize() {
//     camera.aspect = window.innerWidth / window.innerHeight;
//     camera.updateProjectionMatrix();
//     renderer.setSize(window.innerWidth, window.innerHeight);
// }
//
// function animate() {
//     requestAnimationFrame(animate);
//     if (controls) controls.update();
//     if (currentObject) {
//         currentObject.rotation.y += 0.005;
//     }
//     renderer.render(scene, camera);
// }
//
//
//
//
//
//
//
// document.addEventListener('keydown', function (event) {
//     const moveDistance = 0.2; // 每次按鍵移動多少距離
//
//     switch (event.key) {
//         case 'ArrowUp':
//             camera.position.z -= moveDistance;
//             break;
//         case 'ArrowDown':
//             camera.position.z += moveDistance;
//             break;
//         case 'ArrowLeft':
//             camera.position.x -= moveDistance;
//             break;
//         case 'ArrowRight':
//             camera.position.x += moveDistance;
//             break;
//     }
//
//     // 通知 OrbitControls 更新 target（避免視角跟位置不同步）
//     if (controls) controls.update();
// });
// function centerAndFit(object) {
//     const box = new THREE.Box3();
//     object.traverse(function (child) {
//         if (child.isMesh) {
//             child.geometry.computeBoundingBox();
//             const childBox = child.geometry.boundingBox.clone();
//             childBox.applyMatrix4(child.matrixWorld);
//             box.union(childBox);
//         }
//     });
//
//     const size = new THREE.Vector3();
//     box.getSize(size);
//     const center = new THREE.Vector3();
//     box.getCenter(center);
//
//     // 移動到 (0,0,0)
//     object.position.sub(center);
//
//     // 自動調整攝影機
//     const maxDim = Math.max(size.x, size.y, size.z);
//     const fov = camera.fov * (Math.PI / 180);
//     let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
//     cameraZ *= 1.5;
//     cameraZ = Math.max(cameraZ, 5); // 最少5單位遠一點
//
//     camera.position.set(0, cameraZ / 3, cameraZ);
//     camera.lookAt(0, 0, 0);
//
//     if (controls) {
//         controls.target.set(0, 0, 0);
//         controls.update();
//     }
// }


import * as THREE from 'three';

function main() {

	const canvas = document.querySelector( '#c' );
	const renderer = new THREE.WebGLRenderer( { antialias: true, canvas } );

	const fov = 45;
	const aspect = 2; // the canvas default
	const near = 0.1;
	const far = 100;
	const camera = new THREE.PerspectiveCamera( fov, aspect, near, far );
	camera.position.set( 0, 10, 20 );
	camera.lookAt( 0, 0, 0 );

	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 'white' );

	const loader = new THREE.TextureLoader();

	{

		const planeSize = 40;

		const texture = loader.load( 'https://threejs.org/manual/examples/resources/images/checker.png' );
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.magFilter = THREE.NearestFilter;
		texture.colorSpace = THREE.SRGBColorSpace;
		const repeats = planeSize / 2;
		texture.repeat.set( repeats, repeats );

		const planeGeo = new THREE.PlaneGeometry( planeSize, planeSize );
		const planeMat = new THREE.MeshBasicMaterial( {
			map: texture,
			side: THREE.DoubleSide,
		} );
		planeMat.color.setRGB( 1.5, 1.5, 1.5 );
		const mesh = new THREE.Mesh( planeGeo, planeMat );
		mesh.rotation.x = Math.PI * - .5;
		scene.add( mesh );

	}

	const shadowTexture = loader.load( 'https://threejs.org/manual/examples/resources/images/roundshadow.png' );
	const sphereShadowBases = [];
	{

		const sphereRadius = 1;
		const sphereWidthDivisions = 32;
		const sphereHeightDivisions = 16;
		const sphereGeo = new THREE.SphereGeometry( sphereRadius, sphereWidthDivisions, sphereHeightDivisions );

		const planeSize = 1;
		const shadowGeo = new THREE.PlaneGeometry( planeSize, planeSize );

		const numSpheres = 15;
		for ( let i = 0; i < numSpheres; ++ i ) {

			// make a base for the shadow and the sphere.
			// so they move together.
			const base = new THREE.Object3D();
			scene.add( base );

			// add the shadow to the base
			// note: we make a new material for each sphere
			// so we can set that sphere's material transparency
			// separately.
			const shadowMat = new THREE.MeshBasicMaterial( {
				map: shadowTexture,
				transparent: true, // so we can see the ground
				depthWrite: false, // so we don't have to sort
			} );
			const shadowMesh = new THREE.Mesh( shadowGeo, shadowMat );
			shadowMesh.position.y = 0.001; // so we're above the ground slightly
			shadowMesh.rotation.x = Math.PI * - .5;
			const shadowSize = sphereRadius * 4;
			shadowMesh.scale.set( shadowSize, shadowSize, shadowSize );
			base.add( shadowMesh );

			// add the sphere to the base
			const u = i / numSpheres;
			const sphereMat = new THREE.MeshPhongMaterial();
			sphereMat.color.setHSL( u, 1, .75 );
			const sphereMesh = new THREE.Mesh( sphereGeo, sphereMat );
			sphereMesh.position.set( 0, sphereRadius + 2, 0 );
			base.add( sphereMesh );

			// remember all 3 plus the y position
			sphereShadowBases.push( { base, sphereMesh, shadowMesh, y: sphereMesh.position.y } );

		}

	}

	{

		const skyColor = 0xB1E1FF; // light blue
		const groundColor = 0xB97A20; // brownish orange
		const intensity = 0.75;
		const light = new THREE.HemisphereLight( skyColor, groundColor, intensity );
		scene.add( light );

	}

	{

		const color = 0xFFFFFF;
		const intensity = 2.5;
		const light = new THREE.DirectionalLight( color, intensity );
		light.position.set( 0, 10, 5 );
		light.target.position.set( - 5, 0, 0 );
		scene.add( light );
		scene.add( light.target );

	}

	function resizeRendererToDisplaySize( renderer ) {

		const canvas = renderer.domElement;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const needResize = canvas.width !== width || canvas.height !== height;
		if ( needResize ) {

			renderer.setSize( width, height, false );

		}

		return needResize;

	}

	function render( time ) {

		time *= 0.001; // convert to seconds

		resizeRendererToDisplaySize( renderer );

		{

			const canvas = renderer.domElement;
			camera.aspect = canvas.clientWidth / canvas.clientHeight;
			camera.updateProjectionMatrix();

		}

		sphereShadowBases.forEach( ( sphereShadowBase, ndx ) => {

			const { base, sphereMesh, shadowMesh, y } = sphereShadowBase;

			// u is a value that goes from 0 to 1 as we iterate the spheres
			const u = ndx / sphereShadowBases.length;

			// compute a position for there base. This will move
			// both the sphere and its shadow
			const speed = time * .2;
			const angle = speed + u * Math.PI * 2 * ( ndx % 1 ? 1 : - 1 );
			const radius = Math.sin( speed - ndx ) * 10;
			base.position.set( Math.cos( angle ) * radius, 0, Math.sin( angle ) * radius );

			// yOff is a value that goes from 0 to 1
			const yOff = Math.abs( Math.sin( time * 2 + ndx ) );
			// move the sphere up and down
			sphereMesh.position.y = y + THREE.MathUtils.lerp( - 2, 2, yOff );
			// fade the shadow as the sphere goes up
			shadowMesh.material.opacity = THREE.MathUtils.lerp( 1, .25, yOff );

		} );

		renderer.render( scene, camera );

		requestAnimationFrame( render );

	}

	requestAnimationFrame( render );

}

main();


import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export function loadOBJModel(path) {
    const loader = new OBJLoader();

    loader.load(
        path,
        function (object) {
            if (currentObject) {
                scene.remove(currentObject);
            }

            object.traverse(function (child) {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
                }
            });

            centerAndFit(object);  // <== 加這一行

            scene.add(object);
            currentObject = object;
        },
        function (xhr) {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        function (error) {
            console.error('An error happened:', error);
        }
    );
}

document.getElementById('fileInput').addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const contents = e.target.result;

        const loader = new OBJLoader();
        const object = loader.parse(contents);

        if (currentObject) {
            scene.remove(currentObject);
        }

        object.traverse(function (child) {
            if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
            }
        });

        object.scale.set(0.1, 0.1, 0.1);
        object.position.set(10, 0, 0);
        scene.add(object);
        currentObject = object;
    };
    reader.readAsText(file);
});

import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { Object3D } from 'three';
import { objListFolder } from '../scene.ts';

const fileInput = document.getElementById('fileInput') as HTMLInputElement;

let objList: Object3D[] = []

const loader = new OBJLoader();

let params = {
      selectedObject: objList[0]
    }

function loadOBJ(file: File) {
  const reader = new FileReader();

  reader.onload = (e) => {
    const contents = e.target?.result as string;
    const object = loader.parse(contents);
    
    // 儲存到 objList
    objList.push(object); 
  };

  reader.readAsText(file);
}


// 當選擇檔案時觸發
fileInput.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    loadOBJ(file);
    params = {
        selectedObject: objList[0]
    }
    console.log('Loaded OBJ:', objList);
    updateGuiSelection(objListFolder, params);
  }
});

function updateGuiSelection(objListFolder:any, params:any) {
    objListFolder.destroy();
    // objListFolder = gui.addFolder('OBJ Files');
    objListFolder.add(params, 'selectedObject', objList);
    objListFolder.open();


}


export { objList, updateGuiSelection };

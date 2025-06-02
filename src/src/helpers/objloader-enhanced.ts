import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { LoadingManager, Group, Mesh, MeshStandardMaterial } from 'three'

export class EnhancedOBJLoader {
  private loader: OBJLoader

  constructor(manager?: LoadingManager) {
    this.loader = new OBJLoader(manager)
  }

  async loadFromFile(file: File): Promise<Group> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onload = (event) => {
        const content = event.target?.result as string
        if (content) {
          try {
            const object = this.loader.parse(content)
            this.setupMaterials(object)
            resolve(object)
          } catch (error) {
            reject(error)
          }
        } else {
          reject(new Error('Failed to read file'))
        }
      }
      
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }

  async loadFromURL(url: string): Promise<Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (object) => {
          this.setupMaterials(object)
          resolve(object)
        },
        (progress) => {
          console.log('Loading progress:', progress)
        },
        (error) => {
          reject(error)
        }
      )
    })
  }

  private setupMaterials(object: Group) {
    object.traverse((child) => {
      if (child instanceof Mesh) {
        // Apply default material if none exists
        if (!child.material) {
          child.material = new MeshStandardMaterial({
            color: '#f69f1f',
            metalness: 0.3,
            roughness: 0.7,
          })
        }
        
        // Enable shadows
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }
}

// Legacy functions for backward compatibility
export function loadOBJ(url: string) {
  console.log('Loading OBJ:', url)
}

export const objList: any[] = []
export function updateGuiSelection(folder: any, params: any) {
  // Legacy function - parameters used for future implementation
  console.log('updateGuiSelection called with folder:', folder?.name || 'unknown', 'params:', Object.keys(params || {}));
}

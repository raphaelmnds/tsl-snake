import * as THREE from 'three/webgpu'
import { Fn, uniform, positionLocal, vec3, mx_noise_float, mix } from 'three/tsl'
import Experience from '../Experience'

export default class Terrain
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.debug = this.experience.debug

        if(this.debug.active)
        {
            this.debugFolder = this.debug.gui.addFolder('terrain')
            this.debugFolder.close()
        }

        this.uniforms = {
            frequency: uniform(0.15),
            amplitude: uniform(1.5),
            colorTop: uniform(new THREE.Color('#1b5531')),
            colorBottom: uniform(new THREE.Color('#30482e'))
        }

        this.elevationNode = Fn(([xz]) =>
        {
            return mx_noise_float(xz.mul(this.uniforms.frequency)).mul(this.uniforms.amplitude)
        })

        this.setDebug()
        this.setMesh()
    }

    setDebug()
    {
        if(this.debug.active)
        {
            this.debugFolder.add(this.uniforms.frequency, 'value').min(0).max(2).step(0.001).name('frequency')
            this.debugFolder.add(this.uniforms.amplitude, 'value').min(0).max(5).step(0.001).name('amplitude')

            const debugObject = {
                colorTop: `#${this.uniforms.colorTop.value.getHexString()}`,
                colorBottom: `#${this.uniforms.colorBottom.value.getHexString()}`
            }

            this.debugFolder.addColor(debugObject, 'colorTop').onChange(() => this.uniforms.colorTop.value.set(debugObject.colorTop))
            this.debugFolder.addColor(debugObject, 'colorBottom').onChange(() => this.uniforms.colorBottom.value.set(debugObject.colorBottom))
        }
    }

    setMesh()
    {
        this.size = 20

        const geometry = new THREE.PlaneGeometry(this.size, this.size, 128, 128)
        geometry.rotateX(-Math.PI * 0.5)

        const material = new THREE.MeshBasicNodeMaterial({ wireframe: false })
        
        const elevation = this.elevationNode(positionLocal.xz)
        const mixFactor = elevation.div(this.uniforms.amplitude).mul(0.5).add(0.5).clamp(0, 1) // Remap elevation from [-amplitude, amplitude] to [0, 1]

        material.positionNode = positionLocal.add(vec3(0, elevation, 0))
        material.colorNode = mix(this.uniforms.colorBottom, this.uniforms.colorTop, mixFactor)
        material.side = THREE.DoubleSide

        this.mesh = new THREE.Mesh(geometry, material)
        this.mesh.castShadow = true
        this.mesh.receiveShadow = true
        this.scene.add(this.mesh)
    }

    // CPU: for objects moved in JS
    getElevation(x, z) { /* see below */ }
}

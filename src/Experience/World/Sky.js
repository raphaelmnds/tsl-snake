import * as THREE from 'three/webgpu'
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js'

import Experience from '../Experience'

export default class Sky
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.renderer = this.experience.renderer
        this.debug = this.experience.debug

        this.parameters = {
            turbidity: 0,
            rayleigh: 0.36,
            mieCoefficient: 0.1,
            mieDirectionalG: 1,
            elevation: 0,
            azimuth: -180,
            exposure: 0.55,
            cloudCoverage: 0.4,
            cloudDensity: 0.4,
            cloudElevation: 0.5,
            showSunDisc: true
        }

        this.setMesh()
        this.setDebug()
        this.apply()
    }

    setMesh()
    {
        this.mesh = new SkyMesh()
        this.mesh.scale.setScalar(450000)
        this.scene.add(this.mesh)

        this.sun = new THREE.Vector3()

        // Clouds and sun disc uniforms only exist in newer three versions
        this.hasClouds = this.mesh.cloudCoverage !== undefined
        this.hasSunDisc = this.mesh.showSunDisc !== undefined
    }

    apply()
    {
        const sky = this.mesh
        const parameters = this.parameters

        sky.turbidity.value = parameters.turbidity
        sky.rayleigh.value = parameters.rayleigh
        sky.mieCoefficient.value = parameters.mieCoefficient
        sky.mieDirectionalG.value = parameters.mieDirectionalG

        if(this.hasClouds)
        {
            sky.cloudCoverage.value = parameters.cloudCoverage
            sky.cloudDensity.value = parameters.cloudDensity
            sky.cloudElevation.value = parameters.cloudElevation
        }

        if(this.hasSunDisc)
            sky.showSunDisc.value = parameters.showSunDisc

        const phi = THREE.MathUtils.degToRad(90 - parameters.elevation)
        const theta = THREE.MathUtils.degToRad(parameters.azimuth)

        this.sun.setFromSphericalCoords(1, phi, theta)
        sky.sunPosition.value.copy(this.sun)

        this.renderer.instance.toneMappingExposure = parameters.exposure
    }

    setDebug()
    {
        if(!this.debug.active)
            return

        const onChange = () => this.apply()

        this.debugFolder = this.debug.gui.addFolder('sky')
        this.debugFolder.close()

        this.debugFolder.add(this.parameters, 'turbidity', 0, 20, 0.1).onChange(onChange)
        this.debugFolder.add(this.parameters, 'rayleigh', 0, 4, 0.001).onChange(onChange)
        this.debugFolder.add(this.parameters, 'mieCoefficient', 0, 0.1, 0.001).onChange(onChange)
        this.debugFolder.add(this.parameters, 'mieDirectionalG', 0, 1, 0.001).onChange(onChange)
        this.debugFolder.add(this.parameters, 'elevation', 0, 90, 0.1).onChange(onChange)
        this.debugFolder.add(this.parameters, 'azimuth', -180, 180, 0.1).onChange(onChange)
        this.debugFolder.add(this.parameters, 'exposure', 0, 1, 0.0001).onChange(onChange)

        if(this.hasSunDisc)
            this.debugFolder.add(this.parameters, 'showSunDisc').onChange(onChange)

        if(this.hasClouds)
        {
            const cloudsFolder = this.debugFolder.addFolder('clouds')
            cloudsFolder.add(this.parameters, 'cloudCoverage', 0, 1, 0.01).name('coverage').onChange(onChange)
            cloudsFolder.add(this.parameters, 'cloudDensity', 0, 1, 0.01).name('density').onChange(onChange)
            cloudsFolder.add(this.parameters, 'cloudElevation', 0, 1, 0.01).name('elevation').onChange(onChange)
        }
    }
}

import * as THREE from 'three/webgpu'

import Experience from "./Experience";

export default class Renderer
{
    constructor()
    {
        this.experience = new Experience()
        this.canvas = this.experience.canvas
        this.sizes = this.experience.sizes
        this.scene = this.experience.scene
        this.camera = this.experience.camera
        this.setInstance()
    }
    
    setInstance()
    {
        this.instance = new THREE.WebGPURenderer({
            canvas: this.canvas,
            antialias: true
        })
        this.instance.shadowMap.enabled = true
        this.instance.shadowMap.type = THREE.PCFSoftShadowMap
        this.instance.setClearColor('#211d20')
        this.instance.toneMapping = THREE.ACESFilmicToneMapping
        this.instance.setSize(this.sizes.width, this.sizes.height)
        this.instance.setPixelRatio(this.sizes.pixelRatio)

        // WebGPU backend initializes asynchronously
        this.ready = false
        this.instance.init().then(() =>
        {
            this.ready = true
        })
    }

    resize()
    {
        this.instance.setSize(this.sizes.width, this.sizes.height)
        this.instance.setPixelRatio(this.sizes.pixelRatio)
    }

    update()
    {
        if(!this.ready)
        {
            return
        }

        this.instance.render(this.scene, this.camera.instance)
    }
}

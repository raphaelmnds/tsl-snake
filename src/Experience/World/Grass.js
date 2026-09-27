import * as THREE from 'three/webgpu'
import { Fn, instancedArray, instanceIndex, hash, float, vec2, vec3, uniform, cameraPosition, positionLocal, uv, mix, mx_noise_float, Loop, If } from 'three/tsl'

import Experience from '../Experience'

export default class Grass
{
    constructor(terrain, snake, wind)
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.debug = this.experience.debug
        this.terrain = terrain
        this.snake = snake
        this.wind = wind

        if(this.debug.active)
        {
            this.debugFolder = this.debug.gui.addFolder('grass')
            this.debugFolder.close()
        }

        this.setGeometry()
        this.setInstances()
        this.setMaterial()
        this.setMesh()
        this.setDebug()
    }

    setDebug()
    {
        if(this.debug.active)
        {
            const bladesFolder = this.debugFolder.addFolder("blades")
            bladesFolder.add(this.uniforms.width, 'value').min(0.001).max(0.5).step(0.001).name('width')
            bladesFolder.add(this.uniforms.height, 'value').min(0.01).max(2).step(0.01).name('height')
            bladesFolder.add(this.uniforms.taper, 'value').min(0.1).max(4).step(0.01).name('taper')

            const debugObject = {
                colorBottom: `#${this.uniforms.colorBottom.value.getHexString()}`,
                colorTop: `#${this.uniforms.colorTop.value.getHexString()}`,
                colorTint: `#${this.uniforms.colorTint.value.getHexString()}`
            }

            bladesFolder.addColor(debugObject, 'colorBottom').onChange(() => this.uniforms.colorBottom.value.set(debugObject.colorBottom))
            bladesFolder.addColor(debugObject, 'colorTop').onChange(() => this.uniforms.colorTop.value.set(debugObject.colorTop))

            const heightFolder = this.debugFolder.addFolder("height noise")
            heightFolder.add(this.uniforms.heightNoiseFrequency, 'value').min(0).max(10).step(0.01).name('heightNoiseFrequency')
            heightFolder.add(this.uniforms.heightNoiseAmplitude, 'value').min(0).max(2).step(0.01).name('heightNoiseAmplitude')

            const colorNoiseFolder = this.debugFolder.addFolder("color noise")
            colorNoiseFolder.add(this.uniforms.colorNoiseFrequency, 'value').min(0).max(10).step(0.01).name('colorNoiseFrequency')
            colorNoiseFolder.add(this.uniforms.colorNoiseAmplitude, 'value').min(0).max(2).step(0.01).name('colorNoiseAmplitude')
            colorNoiseFolder.add(this.uniforms.tintStrength, 'value').min(0).max(5).step(0.01).name('tintStrength')
            colorNoiseFolder.addColor(debugObject, 'colorTint').onChange(() => this.uniforms.colorTint.value.set(debugObject.colorTint))

            const bendFolder = this.debugFolder.addFolder("snake bend")
            bendFolder.add(this.uniforms.bendRadius, 'value').min(0.01).max(2).step(0.01).name('bendRadius')
            bendFolder.add(this.uniforms.bendStrength, 'value').min(0).max(2).step(0.01).name('bendStrength')
            bendFolder.add(this.uniforms.shrinkRadius, 'value').min(0.01).max(2).step(0.01).name('shrinkRadius')
            bendFolder.add(this.uniforms.shrinkHeight, 'value').min(0).max(1).step(0.01).name('shrinkHeight')
        }
    }

    setGeometry()
    {
        this.geometry = new THREE.PlaneGeometry(1, 1, 1, 4)
        this.geometry.translate(0, 0.5, 0)
    }


    setInstances()
    {
        this.gridSize = 250
        this.count = this.gridSize * this.gridSize
        const spacing = this.terrain.size / this.gridSize

        this.positions = instancedArray(this.count, 'vec3')
        this.bends = instancedArray(this.count, 'vec3') // per blade : x, y = push direction, z = distance to the snake

        this.computeUpdate = Fn(() =>
        {
            // position
            const index = instanceIndex.toFloat()
            const column = index.mod(this.gridSize)
            const row = index.div(this.gridSize).floor()
            const jitter = vec2(
                hash(instanceIndex),
                hash(instanceIndex.add(this.count))
            ).sub(0.5)
            const xz = vec2(column, row).sub((this.gridSize - 1) / 2).add(jitter).mul(spacing)
            const elevation = this.terrain.elevationNode(xz)
            this.positions.element(instanceIndex).assign(vec3(xz.x, elevation, xz.y))

            // bend
            // Find the closest snake sample : check every sample, keep it each time one is nearer than the best so far
            const closestDistance = float(9999).toVar() // distance from this blade's base to the nearest snake sample
            const closestPoint = vec2(0).toVar() // position (x, z) of that nearest sample

            Loop(this.snake.sampleCount, ({ i }) =>
            {
                const sample = this.snake.samplesUniform.element(i).xz // x and z of i sample 
                const distance = xz.distance(sample) // distance between blade base and sample pos

                If(distance.lessThan(closestDistance), () =>
                {
                    closestDistance.assign(distance)
                    closestPoint.assign(sample)
                })
            })

            // Save direction and distance, the material turns them into bend and height
            const direction = xz.sub(closestPoint).normalize() // from the sample to the blade
            this.bends.element(instanceIndex).assign(vec3(direction, closestDistance)) // overwrite bends array : x, y = direction, z = distance


        })().compute(this.count)
    }

    setMaterial()
    {
        this.uniforms = {
            width: uniform(0.1),
            height: uniform(0.5),
            taper: uniform(0.8),
            colorBottom: uniform(new THREE.Color('#1f4d1a')),
            colorTop: uniform(new THREE.Color('#8fd14f')),

            heightNoiseFrequency: uniform(1.5),
            heightNoiseAmplitude: uniform(0.5),

            colorTint: uniform(new THREE.Color('#ec6d18')),
            colorNoiseFrequency: uniform(0.26),
            colorNoiseAmplitude: uniform(0.5),
            tintStrength: uniform(1.73),

            bendRadius: uniform(0.3),
            bendStrength: uniform(0.4),
            shrinkRadius: uniform(0.4),
            shrinkHeight: uniform(0) // height multiplier on the body : 0 = no blade, 1 = full height
        }

        this.material = new THREE.MeshBasicNodeMaterial()
        this.material.side = THREE.DoubleSide

        const bladePosition = this.positions.element(instanceIndex)

        const toCamera = cameraPosition.xz.sub(bladePosition.xz).normalize()
        const right = vec3(toCamera.y.negate(), 0, toCamera.x)

        const shape = positionLocal.y.oneMinus().pow(this.uniforms.taper)

        const localX = positionLocal.x.mul(shape).mul(this.uniforms.width)

        /** Height variation */
        const heightNoise = mx_noise_float(bladePosition.xz.mul(this.uniforms.heightNoiseFrequency).add(100))
        const heightFactor = heightNoise.mul(this.uniforms.heightNoiseAmplitude).add(1).max(0.05) // never flat or upside down

        const localY = positionLocal.y.mul(this.uniforms.height).mul(heightFactor)

        /** Snake bending */
        const bend = this.bends.element(instanceIndex) // retrieve bends infos with index
        const snakeDirection = bend.xy // from the snake to the blade
        const snakeDistance = bend.z // distance value

        const bendAmount = snakeDistance.div(this.uniforms.bendRadius).oneMinus().max(0) // how close to the snake : 1 on body → 0 at radius
        const tipWeight = positionLocal.y.pow(2) // create bend weight for blade : 0 at base, 1 at the tip = the base stays planted
        // bend : bend direction * bend strength with radius * push strength * tip weight
        const bendOffset = vec3(snakeDirection.x, 0, snakeDirection.y).mul(bendAmount).mul(this.uniforms.bendStrength).mul(tipWeight)

        /** Wind bending */
        const wind = this.wind.offsetNode(bladePosition.xz) // push (x, z) at the blade base : the whole blade leans together
        const windOffset = vec3(wind.x, 0, wind.y).mul(tipWeight) // same tip weight as the snake : the base stays planted

        /** Snake shrink */
        const shrinkProgress = snakeDistance.div(this.uniforms.shrinkRadius).min(1) // how close to the snake : 0 on body → 1 the radius
        const shrink = mix(this.uniforms.shrinkHeight, 1, shrinkProgress) // height multiplier : shrinkHeight on the body → 1 far away

        this.material.positionNode = bladePosition
            .add(right.mul(localX))
            .add(vec3(0, localY, 0).add(bendOffset).add(windOffset).mul(shrink)) // shrink multiply = scale the height and the bends together

        const color = mix(this.uniforms.colorBottom, this.uniforms.colorTop, uv().y)

        /** Color noise */
        const colorNoise = mx_noise_float(bladePosition.xz.mul(this.uniforms.colorNoiseFrequency).add(200))
        const colorFactor = colorNoise.mul(0.5).add(0.5).mul(this.uniforms.colorNoiseAmplitude).clamp(0, 1)

        const tintedColor = color.mul(this.uniforms.colorTint)
        const finalColor = mix(color, tintedColor, colorFactor.mul(this.uniforms.tintStrength))
        
        this.material.colorNode = finalColor
    }

    setMesh()
    {
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.count = this.count
        this.mesh.frustumCulled = false
        this.scene.add(this.mesh)
    }

    update()
    {
        const renderer = this.experience.renderer

        if(!renderer.ready) return

        renderer.instance.compute(this.computeUpdate)
    }
}

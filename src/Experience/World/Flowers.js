import * as THREE from 'three/webgpu'
import { Fn, instancedArray, instanceIndex, hash, float, vec2, vec3, uniform, texture, mx_noise_float, max, Loop, If, deltaTime } from 'three/tsl'

import Experience from '../Experience'

export default class Flowers
{
    constructor(terrain, snake, wind)
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.debug = this.experience.debug
        this.ressources = this.experience.ressources
        this.terrain = terrain
        this.snake = snake
        this.wind = wind

        if(this.debug.active)
        {
            this.debugFolder = this.debug.gui.addFolder('flowers')
            this.debugFolder.close()
        }

        this.count = 4000

        this.types = [
            { texture: 'flower1Texture', rarity: 1 },
            { texture: 'flower2Texture', rarity: 1 },
            { texture: 'flower3Texture', rarity: 3 },
            { texture: 'flower4Texture', rarity: 2 },
            { texture: 'flower5Texture', rarity: 1 },
            { texture: 'flower5Texture', rarity: 5 },
        ]

        this.setUniforms()
        this.setCounts()
        this.setOffsets()
        this.sprites = this.types.map((type) => this.setSprite(type))
        this.setDebug()
    }

    setUniforms()
    {
        this.uniforms = {
            size: uniform(0.25),
            sizeVariation: uniform(0.5),
            posY: uniform(0.2),

            groupFrequency: uniform(0.35),
            groupThreshold: uniform(0.25),
            groupEdge: uniform(0.15),

            alphaThreshold: uniform(0.1),

            snakeRadius: uniform(0.5),
            snakeStrength: uniform(10),
            returnSpeed: uniform(1),
            windStrength: uniform(0.3)
        }
    }

    setCounts()
    {
        // all flower type weights : 1 / rarity
        const totalWeight = this.types.reduce((sum, type) => sum + 1 / type.rarity, 0)
        console.log(totalWeight)

        let offset = 0
        for(const type of this.types)
        {
            type.count = Math.round(this.count * (1 / type.rarity) / totalWeight) // each type's share of the global count
            type.offset = offset // first index of this type
            offset += type.count
        }

        this.totalCount = offset // can differ from count because of the rounding
    }

    getBasePosition(index)
    {
        const random = vec2(
            hash(index),
            hash(index.add(this.count))
        )

        return random.sub(0.5).mul(this.terrain.size)
    }

    // snake push, kept from frame to frame : each flower remembers how far it has been pushed
    setOffsets()
    {
        this.offsets = instancedArray(this.totalCount, 'vec2') // per flower : x, z offset from its base position

        this.computeUpdate = Fn(() =>
        {
            const offset = this.offsets.element(instanceIndex)
            const current = this.getBasePosition(instanceIndex).add(offset) // where the flower is now

            // closest snake sample to the current position
            const closestDistance = float(9999).toVar()
            const closestPoint = vec2(0).toVar()

            Loop(this.snake.sampleCount, ({ i }) =>
            {
                const sample = this.snake.samplesUniform.element(i).xz
                const distance = current.distance(sample)

                If(distance.lessThan(closestDistance), () =>
                {
                    closestDistance.assign(distance)
                    closestPoint.assign(sample)
                })
            })

            If(closestDistance.lessThan(this.uniforms.snakeRadius), () =>
            {
                // inside radius : push out towards radius edge, from current pos so no flipping
                const direction = current.sub(closestPoint).add(vec2(0.0001, 0)).normalize() // tiny offset avoids normalizing 0
                const depth = this.uniforms.snakeRadius.sub(closestDistance) // how far inside radius
                const push = direction.mul(depth).mul(this.uniforms.snakeStrength.mul(deltaTime).min(1)) // never more than depth in one frame

                offset.addAssign(push)
            }).Else(() =>
            {
                // outside : ease back to base position
                offset.subAssign(offset.mul(this.uniforms.returnSpeed.mul(deltaTime).min(1)))
            })
        })().compute(this.totalCount)
    }

    setMaterial(type)
    {
        const flowerTexture = this.ressources.items[type.texture]
        flowerTexture.colorSpace = THREE.SRGBColorSpace

        const material = new THREE.SpriteNodeMaterial()
        material.alphaTest = 0.5

        const index = instanceIndex.add(type.offset)

        // random pos on terrain, one per sprite
        const xz = this.getBasePosition(index)

        // groups : only sprites landing where noise is high enough kept
        const groupNoise = mx_noise_float(xz.mul(this.uniforms.groupFrequency).add(300))
        const groupFactor = groupNoise.smoothstep(this.uniforms.groupThreshold, this.uniforms.groupThreshold.add(this.uniforms.groupEdge)) // 0 outside group, 1 in center

        // scale
        const sizeRandom = hash(index.add(this.count * 2)).sub(0.5).mul(this.uniforms.sizeVariation).add(1)
        const scale = this.uniforms.size.mul(sizeRandom).mul(groupFactor) // scale 0 outside groups = hidden

        // snake : ofsset from compute shader
        const snakeOffset = this.offsets.element(index)

        // wind : same as grass, scaled down
        const windOffset = this.wind.offsetNode(xz).mul(this.uniforms.windStrength)

        const movedXz = xz.add(snakeOffset).add(windOffset)
        const elevation = this.terrain.elevationNode(movedXz)

        material.scaleNode = scale
        material.positionNode = vec3(movedXz.x, elevation.add(this.uniforms.posY).add(scale.mul(0.5)), movedXz.y)

        // color
        const sample = texture(flowerTexture)
        const brightness = max(sample.r, max(sample.g, sample.b))
        const mask = brightness.smoothstep(0, this.uniforms.alphaThreshold)

        material.colorNode = sample.rgb
        material.opacityNode = mask

        return material
    }

    setSprite(type)
    {
        const sprite = new THREE.Sprite(this.setMaterial(type))
        sprite.count = type.count
        sprite.frustumCulled = false
        this.scene.add(sprite)

        return sprite
    }

    setDebug()
    {
        if(this.debug.active)
        {
            this.debugFolder.add(this.uniforms.size, 'value').min(0.01).max(1).step(0.01).name('size')
            this.debugFolder.add(this.uniforms.sizeVariation, 'value').min(0).max(1).step(0.01).name('sizeVariation')
            this.debugFolder.add(this.uniforms.posY, 'value').min(-1).max(1).step(0.001).name('posY')
            this.debugFolder.add(this.uniforms.groupFrequency, 'value').min(0).max(2).step(0.01).name('groupFrequency')
            this.debugFolder.add(this.uniforms.groupThreshold, 'value').min(-1).max(1).step(0.01).name('groupThreshold')
            this.debugFolder.add(this.uniforms.groupEdge, 'value').min(0.01).max(1).step(0.01).name('groupEdge')
            this.debugFolder.add(this.uniforms.alphaThreshold, 'value').min(0.01).max(1).step(0.01).name('alphaThreshold')

            const moveFolder = this.debugFolder.addFolder('snake & wind')
            moveFolder.add(this.uniforms.snakeRadius, 'value').min(0.01).max(2).step(0.01).name('snakeRadius')
            moveFolder.add(this.uniforms.snakeStrength, 'value').min(0).max(30).step(0.1).name('snakeStrength')
            moveFolder.add(this.uniforms.returnSpeed, 'value').min(0).max(5).step(0.01).name('returnSpeed')
            moveFolder.add(this.uniforms.windStrength, 'value').min(0).max(2).step(0.01).name('windStrength')
        }
    }

    update()
    {
        const renderer = this.experience.renderer

        if(!renderer.ready) return

        renderer.instance.compute(this.computeUpdate)
    }
}

import * as THREE from 'three/webgpu'
import { Fn, uniform, uniformArray, positionLocal, positionGeometry, normalGeometry, normalLocal, vec3, mix, cross, normalize } from 'three/tsl'

import Experience from '../Experience'

export default class Snake
{
    constructor(terrain)
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.debug = this.experience.debug
        this.time = this.experience.time
        this.terrain = terrain

        if(this.debug.active)
        {
            this.debugFolder = this.debug.gui.addFolder('snake')
            this.debugFolder.close()
        }

        this.setUniforms()
        this.setModel()
        this.setCurve()
        this.setTrail()
        this.setMaterial()
        this.setMesh()
        this.setDebug()
    }

    setUniforms()
    {
        this.uniforms = {
            scale: uniform(0.26),
            lift: uniform(0) // how much to raise the snake so its belly touches the ground, set in updateCurve
        }
    }

    // take the blender model (a group with one mesh per material) and measure it
    setModel()
    {
        this.model = this.experience.ressources.items.snakeModel.scene
        const box = new THREE.Box3().setFromObject(this.model) // box around all the pieces : min and max of x, y, z

        this.modelMinY = box.min.y // tail end
        this.modelLength = box.max.y - this.modelMinY // tail → head
        this.modelBelly = -box.min.z // distance from the middle of the model to its lowest point (belly side)
    }

    setCurve()
    {
        this.controlCount = 7 // handles
        this.sampleCount = 100 // points along curve
        this.length = 4.65 // shape of the S only : length vs side swing, the real size comes from the model
        this.amplitude = 0.6

        this.controlPoints = Array.from({ length: this.controlCount }, () => new THREE.Vector3())
        this.curve = new THREE.CatmullRomCurve3(this.controlPoints)

        // samples : N positions along the curve
        this.samples = Array.from({ length: this.sampleCount }, () => new THREE.Vector3())
        this.samplesUniform = uniformArray(this.samples, 'vec3') // array of 100 vec3

        this.updateCurve()
    }

    // place points in a S shape, then overwrite control points & samples arrays
    updateCurve()
    {
        for(let i = 0; i < this.controlCount; i++)
        {
            const t = i / (this.controlCount - 1) // get each point
            const x = Math.sin(t * Math.PI * 2) * this.amplitude // sin waves every 2π, so multiply by 2π to get one sin wave between 0-1
            const z = (t - 0.5) * this.length // t - 0.5 to center, and * length to strech to -1 - 1
            this.controlPoints[i].set(x, 0, z) // set the positions and the CatmullRomCurve3 updates instantly
        }
        this.curve.updateArcLengths() // the curve caches its length, so tell it the points moved

        this.updateSize()
        const resize = this.snakeLength / this.curve.getLength() // calculate curve ratio (to fit snake length)

        for(const point of this.controlPoints)
            point.multiplyScalar(resize) // apply ratio to every point = resize the curve
        this.curve.updateArcLengths() // points moved, so re-measure the curve length

        // walks along the curve and create 100 points (vec3) at equal distances from each other
        const points = this.curve.getSpacedPoints(this.sampleCount - 1) // 99 gaps means 100 points.

        for(let i = 0; i < this.sampleCount; i++)
            this.samples[i].copy(points[i]) // moves positions to the array
    }

    // everything that depends on the scale : separated from the S so the scale can change while the snake is somewhere else
    updateSize()
    {
        this.snakeLength = this.modelLength * this.uniforms.scale.value // snake length in the scene (model length × scale)
        this.spacing = this.snakeLength / (this.sampleCount - 1) // distance between 2 samples, used to lay the body on the trail
        this.uniforms.lift.value = this.modelBelly * this.uniforms.scale.value // belly depth at the scaled size
    }

    setMaterial()
    {
        // replace a point Y with the terrain height
        const withElevation = (point) => vec3(point.x, this.terrain.elevationNode(point.xz), point.z)

        // runs once per model vertex, built once and shared by every piece of the model
        this.positionNode = Fn(() =>
        {
            /** Vertex progress on model geometry */
            // take the y pos of the vertex in the model and turn it into a progress value between 0-1 (tail 0, head 1)
            const progress = positionGeometry.y.sub(this.modelMinY).div(this.modelLength)

            /** Vertex progress between 2 curve samples */
            const segment = progress.mul(this.sampleCount - 1) // turn progress 0 → 1 into a sample number 0 → 99
            const index = segment.floor().min(this.sampleCount - 2) // sample just before the vertex, capped at 98 with .min so index + 1 stays inside the array
            const segmentProgress = segment.sub(index) // how far the vertex is between sample index and index + 1 (0 → 1)
            
            /** Before and after samples positions (on terrain) */
            // the two samples around the vertex, glued to the terrain (toInt because array index must be a whole number)
            const start = withElevation(this.samplesUniform.element(index.toInt()))
            const end = withElevation(this.samplesUniform.element(index.toInt().add(1)))

            /** Center of the ring */
            const centerXZ = mix(start.xz, end.xz, segmentProgress) // vec2 : x and z pos of the ring center, the one of the vertex between start and end at segmentProgress
            const center = vec3(centerXZ.x, this.terrain.elevationNode(centerXZ).add(this.uniforms.lift).add(0.01), centerXZ.y) // and create the ring center pos with x & z and the y on the terrain (height + lift + little space)

            /** Orientation of the snake in the segment */
            const tangent = normalize(end.sub(start)) // forward : direction from start to end, normalized so its length is 1 (le vecteur longe la pente, et se penche)
            const side = normalize(cross(tangent, vec3(0, 1, 0))) // left/right : perpendicular to forward and to world up, so always horizontal
            const up = cross(side, tangent) // snake's own up : perpendicular to forward and side (se penche en arrière avec la pente)

            /** Rotate from cylinder to snake */
            // swap the cylinder axes for the snake ones by multiplying the vector number to each matching snake arrow, then adding them up (adding 3 vectors creates a new one : normal cylinder vector → snake vector)
            const toCurveFrame = (vector) =>
                side.mul(vector.x)          // cylinder x (right)   →  side     (snake's right)
                .add(up.mul(vector.z))      // cylinder z (front)   →  up       (snake's up)
                .add(tangent.mul(vector.y)) // cylinder y (height)  →  tangent  (snake's forward)

            /** Turn the normals the same way so light hits the snake correctly */
            normalLocal.assign(toCurveFrame(normalGeometry)) // .assign replaces the normal the lighting uses with the rotated one

            // vector from the center to our vertex, in the upright model's axes (y = 0 because center already handles the position along the snake, scaled to the curve size)
            const ring = vec3(positionGeometry.x, 0, positionGeometry.z).mul(this.uniforms.scale)
            
            // then toCurveFrame(ring) rotates it to match the snake's direction (snake center to surface)
            // and add the vector to the center pos to get our vertex pos
            return center.add(toCurveFrame(ring))
        })()
    }

    // give each piece of the model a node material with its blender color and our shared bending
    setMesh()
    {
        this.model.traverse((child) =>
        {
            if(!child.isMesh) return

            const blenderMaterial = child.material
            child.material = new THREE.MeshStandardNodeMaterial({
                color: blenderMaterial.color,
                roughness: blenderMaterial.roughness,
                metalness: blenderMaterial.metalness,
                side: blenderMaterial.side
            })
            child.material.positionNode = this.positionNode

            child.frustumCulled = false
            child.castShadow = true
        })

        this.scene.add(this.model)
    }

    setTrail()
    {
        this.speed = 3
        this.turnSpeed = 6.27 // radians per second : how fast the head can rotate towards the target
        this.arriveDistance = 0.05 // close enough to the target to stop

        // wiggle : the head swings left / right around the heading while it moves, the trail records it as a S
        this.waves = 2 // number of S waves along the body
        this.wiggleAngle = 1.1 // max swing in radians (~86°) : bigger = wider S

        this.direction = new THREE.Vector2() // reused every frame : head → target

        this.resetTrail()
    }

    // trail : every position the head went through, ordered tail → head (the last point is the head)
    // it starts as the current samples (the S shape), so the body doesn't move until the head does
    resetTrail()
    {
        this.target = null
        this.trail = this.samples.map((sample) => sample.clone()) // array of positions tail → head (last point is head)
        this.wiggleAmount = 1 // current wiggle strength (0 → 1), eases in when leaving and out when arriving

        // heading : direction of the whole snake
        const head = this.samples[this.sampleCount - 1]
        const neck = this.samples[this.sampleCount - 2]
        const tail = this.samples[0]
        this.heading = Math.atan2(head.z - tail.z, head.x - tail.x)

        // wigglePhase : where we are in the sine wave (a counter that only goes up)
        const neckAngle = Math.atan2(head.z - neck.z, head.x - neck.x) // where the nose actually points, neck to head angle != heading
        let startSwing = neckAngle - this.heading // how far the nose is turned away from the middle line
        startSwing = Math.atan2(Math.sin(startSwing), Math.cos(startSwing)) // wrap in [-π, π] : a difference of 350° becomes -10° (same direction, the short way)
        this.wigglePhase = Math.asin(THREE.MathUtils.clamp(startSwing / this.wiggleAngle, -1, 1)) // only used once to rotate the head at the start, clamp because asin only accepts -1 to 1
    }

    setTarget(point)
    {
        this.target = new THREE.Vector2(point.x, point.z)
        console.log('snake target', this.target.x.toFixed(2), this.target.y.toFixed(2))
    }

    update()
    {
        if(!this.target) return

        this.moveHead()
        this.updateSamples()
    }

    moveHead()
    {
        const head = this.trail[this.trail.length - 1] // get head point from trail array
        const deltaSeconds = this.time.delta / 1000 // delta is in ms

        this.direction.set(this.target.x - head.x, this.target.y - head.z) // direction from head to target (vec2 because we only move x & z)
        const distance = this.direction.length()

        // arrived : stop moving until the next click
        if(distance < this.arriveDistance)
        {
            this.target = null
            return
        }

        const targetAngle = Math.atan2(this.direction.y, this.direction.x) // angle the head should face to look at the target

        // how much we still have to turn, wrapped in [-π, π] so it always turns the short way (atan2(sin, cos) does the wrapping)
        let angleDiff = targetAngle - this.heading // number, not vector. positive or negative value influence the turn
        angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff)) // calculate the shortest angle to turn to face the target

        const maxTurn = this.turnSpeed * deltaSeconds // angle = speed * time, 
        this.heading += THREE.MathUtils.clamp(angleDiff, -maxTurn, maxTurn) // turn the direction but only as much as maxTurn allows

        // moving
        // speed multiplier: the snake moves forward more slowly when the target isn't in front of it
        const facing = THREE.MathUtils.mapLinear(Math.cos(angleDiff), -1, 1, 0.2, 1) // Math.cos(angleDiff): "target in front = 1, target behind = -1, and mapLinear convert the angle to a new range (the multiplier one)

        // arrival
        // distance at which we start slowing down
        const slowDistance = 2 * this.speed / this.turnSpeed // turning radius = speed / turnSpeed, 2x is the diameter,

        // how close we are from the target, as a number from 0 to 1
        const arrival = THREE.MathUtils.clamp(distance / slowDistance, 0, 1)

        // distance the head moves forward in this frame
        const step = Math.min(this.speed * facing * arrival * deltaSeconds, distance)
        // × facing: slower if the target is behind (a tighter U-turn)
        // × arrival: slower as we get close (so we don't miss it)
        // Math.min(..., distance): never move more than the dist to the target, so we don't go past it

        // wiggle
        const wavelength = this.snakeLength / this.waves // distance for one full left-right swing
        this.wigglePhase += step / wavelength * Math.PI * 2 // moves the wiggle counter forward, goes slower if we move slower
        // step / wavelength: fraction of one wave we travelled
        // * Math.PI * 2 : converts to sin units, a sine does 1 circle every 2π, so 100% of a wave means 2π.

        const wantedWiggle = THREE.MathUtils.clamp(distance / wavelength, 0, 1) // wiggle strength we want right now based on the distance (wiggle less closer to target)
        this.wiggleAmount += (wantedWiggle - this.wiggleAmount) * Math.min(deltaSeconds * 4, 1) // strength we actually use, moves towards wantedWiggle gradually

        // final angle : turning direction + turn left or right * how far we turn * turn strength
        const moveAngle = this.heading + Math.sin(this.wigglePhase) * this.wiggleAngle * this.wiggleAmount

        // push new moving head pos into array (the other points will follow)
        const newHead = head.clone()
        // move head positions to new pos
        newHead.x += Math.cos(moveAngle) * step
        newHead.z += Math.sin(moveAngle) * step

        this.trail.push(newHead)
    }

    // lay the 100 samples on the trail : sample i sits (99 - i) × spacing behind the head, measured along the trail
    updateSamples()
    {
        let pointIndex = this.trail.length - 1 // trail point we are standing on, starting from the head
        let walked = 0 // distance walked along the trail from the head to trail[pointIndex]

        // from head (99) to tail (0) over the samples
        for(let i = this.sampleCount - 1; i >= 0; i--)
        {
            const wanted = (this.sampleCount - 1 - i) * this.spacing // distance of this point to the head

            // walk back along the trail points(pointIndex), to find where to place each sample
            while(pointIndex > 0)
            {
                // dist between our trail point and the next one towards the tail (head to tail)
                const segmentLength = this.trail[pointIndex].distanceTo(this.trail[pointIndex - 1])

                // is the sample in this segment : walked (where i am, segment start) + segmentLength (where i'll be, segment end) >= wanted (where the sample must be along the body, written as a distance from the head)
                // yes → the sample dist from the head is between start and end, place the sample here / no → the mark is further back, walk the whole segment and test the next one
                if(walked + segmentLength >= wanted)
                {
                    // the sample is in this segment : place it between the 2 points
                    const t = segmentLength > 0 ? (wanted - walked) / segmentLength : 0 // (wanted - walked) : how far into the segment, and / segmentLength : turn into a fraction
                    this.samples[i].lerpVectors(this.trail[pointIndex], this.trail[pointIndex - 1], t) // places the sample ...% from the segment start
                    break
                }

                walked += segmentLength
                pointIndex--
            }

            // walked back to first point of the trail without finding the sample's distance = trail shorter than snake = stack on the last point
            if(pointIndex === 0)
                this.samples[i].copy(this.trail[0])
        }

        // loop finished, removes every trail point behind the tail
        if(pointIndex > 1)
            this.trail.splice(0, pointIndex - 1)
    }

    setDebug()
    {
        if(!this.debug.active) return

        // scale : resize and lay the body again on the trail where it is (if it grows, the tail waits on the trail end until the head has moved enough)
        this.debugFolder.add(this.uniforms.scale, 'value').min(0.01).max(1).step(0.001).name('scale').onChange(() =>
        {
            this.updateSize()
            this.updateSamples()
        })

        // starting S : only used before the first move, so changing it resets the snake to the center with the new S
        const reset = () =>
        {
            this.updateCurve()
            this.resetTrail()
        }

        const startFolder = this.debugFolder.addFolder('start shape')
        startFolder.add(this, 'length').min(0.1).max(10).step(0.01).onChange(reset)
        startFolder.add(this, 'amplitude').min(0).max(3).step(0.01).onChange(reset)
        startFolder.add({ reset }, 'reset')

        const movementFolder = this.debugFolder.addFolder('movement')
        movementFolder.add(this, 'speed').min(0.1).max(5).step(0.01)
        movementFolder.add(this, 'turnSpeed').min(0.5).max(10).step(0.01)
        movementFolder.add(this, 'arriveDistance').min(0.01).max(0.5).step(0.001)
        movementFolder.add(this, 'waves').min(0.25).max(4).step(0.01)
        movementFolder.add(this, 'wiggleAngle').min(0).max(1.5).step(0.01)
    }
}

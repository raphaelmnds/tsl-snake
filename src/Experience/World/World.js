import Experience from '../Experience'
import Environment from './Environment'
import Terrain from './Terrain'
import Grass from './Grass'
import Flowers from './Flowers'
import Sphere from './Sphere'
import Snake from './Snake'
import Wind from './Wind'
import Marker from './Marker'
import Raycaster from '../Raycaster'

export default class World
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience .scene
        this.ressources = this.experience.ressources
        
        this.movingObjects = []

        this.environment = new Environment()
        this.terrain = new Terrain()
        this.wind = new Wind()
        this.marker = new Marker(this.terrain)
        this.raycaster = new Raycaster(this.terrain)

        this.raycaster.on('move', (point) =>
        {
            this.marker.setPosition(point)
        })

        this.raycaster.on('click', (point) =>
        {
            this.marker.click()

            // the snake loads with the ressources, so it may not exist yet
            if(this.snake)
                this.snake.setTarget(point)
        })

        this.ressources.on('loaded', () => 
        {
            this.snake = new Snake(this.terrain)
            this.grass = new Grass(this.terrain, this.snake, this.wind)
            this.flowers = new Flowers(this.terrain, this.snake, this.wind)
        })
    }

    update()
    {
        if (this.grass) {
            this.grass.update()       
        }

        if(this.flowers)
            this.flowers.update()

        if(this.snake)
            this.snake.update()
    }
}

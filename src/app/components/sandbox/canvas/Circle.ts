import { CanvasObject } from './CanvasObject';
import { createAnimation } from './AnimationHelper';

const PI_2 = Math.PI * 2;
const animatablePropertiesTuple = [
  'position'
];
const animatablePropertiesNumber = [
  'radius',
  'strokeWeight'
];

export class Circle implements CanvasObject {
  position: [number, number] = [0, 0];
  isHidden: boolean = false;
  isDragEnabled: boolean = false;

  private _radius: number = 0;
  private _radius2: number = 0;
  strokeDash: Array<number> = [];
  strokeWeight: number = 1;
  strokeStyle: string = '#000';
  fillStyle: string = '#FFF';

  private animations: Array<Function> = [];

  get radius(): number {
    return this._radius;
  }

  set radius(r: number) {
    this._radius = r;
    this._radius2 = r * r;
  }

  draw(context: CanvasRenderingContext2D, timestamp: number) {
    if (this.isHidden) {
      return;
    }
    let newAnimations = [];
    this.animations.forEach((animation) => {
      let result = animation(timestamp);
      if (result !== false) {
        newAnimations.push(animation);
      }
    });
    this.animations = newAnimations;

    context.beginPath();
    context.setLineDash(this.strokeDash);
    context.strokeStyle = this.strokeStyle;
    context.fillStyle = this.fillStyle;

    context.arc(
      this.position[0],
      this.position[1],
      this._radius,
      0,
      PI_2,
      true
    );

    context.fill();
    if (this.strokeWeight > 0) {
      context.lineWidth = this.strokeWeight;
      context.stroke();
    }
  }

  addAnimations(duration: number, properties: any) {
    return createAnimation(
      this,
      this.animations,
      duration,
      animatablePropertiesTuple,
      animatablePropertiesNumber,
      properties
    );
  }

  isPositionHit(posX: number, posY: number): boolean {
    if (this.isHidden) {
      return false;
    }
    let dx = posX - this.position[0];
    let dy = posY - this.position[1];
    let d = dx * dx + dy * dy;
    return d < this._radius2;
  }
}

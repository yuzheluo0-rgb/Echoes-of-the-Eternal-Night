import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { WorldBloom } from './WorldBloom';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

class WorldAntialias extends ShaderPass {
  constructor() { super(FXAAShader); }
  override setSize(width: number, height: number) { this.uniforms.resolution.value.set(1 / Math.max(width, 1), 1 / Math.max(height, 1)); }
}

class LandscapeAO extends GTAOPass {
  exclusions: THREE.Object3D[];
  private view = new THREE.Matrix4();
  private projection = new THREE.Matrix4();
  private valid = false;
  private composite = new THREE.ShaderMaterial({
    uniforms: { colorMap: { value: null }, aoMap: { value: null }, intensity: { value: .7 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform sampler2D colorMap; uniform sampler2D aoMap; uniform float intensity; void main(){vec4 color=texture2D(colorMap,vUv);gl_FragColor=vec4(color.rgb*mix(vec3(1.0),texture2D(aoMap,vUv).rgb,intensity),color.a);}',
    depthTest: false, depthWrite: false,
  });
  private quad = new FullScreenQuad(this.composite);
  constructor(scene: THREE.Scene, camera: THREE.Camera, exclusions: THREE.Object3D[]) {
    super(scene, camera, 512, 512);
    this.exclusions = exclusions; this.blendIntensity = .7;
    this.output = GTAOPass.OUTPUT.Off;
    this.updateGtaoMaterial({ radius: .3, distanceExponent: 1.4, thickness: .18, scale: 1, samples: 8, screenSpaceRadius: false });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 3, radiusExponent: 2, rings: 2, samples: 8 });
  }
  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, delta: number, mask: boolean) {
    // Only static terrain contributes: reuse its occlusion until the camera changes.
    // Foliage alpha must not become solid rectangles in the normal override pass.
    const moved = this.camera.matrixWorld.elements.some((n, i) => Math.abs(n - this.view.elements[i]) > .0001);
    const zoomed = this.camera.projectionMatrix.elements.some((n, i) => Math.abs(n - this.projection.elements[i]) > .000001);
    if (!this.valid || moved || zoomed) {
      const visibility = this.exclusions.map(object => object.visible);
      const shadowUpdate = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
      this.exclusions.forEach(object => { object.visible = false; });
      try { super.render(renderer, write, read, delta, mask); this.view.copy(this.camera.matrixWorld); this.projection.copy(this.camera.projectionMatrix); this.valid = true; }
      finally { this.exclusions.forEach((object, i) => { object.visible = visibility[i]; }); renderer.shadowMap.autoUpdate = shadowUpdate; }
    }
    this.composite.uniforms.colorMap.value = read.texture; this.composite.uniforms.aoMap.value = this.pdRenderTarget.texture; this.composite.uniforms.intensity.value = this.blendIntensity;
    const clear = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    try { this.quad.render(renderer); } finally { renderer.autoClear = clear; }
  }
  override setSize(width: number, height: number) { this.valid = false; super.setSize(Math.max(1, Math.round(width * .4)), Math.max(1, Math.round(height * .4))); }
  override dispose() { this.composite.dispose(); this.quad.dispose(); super.dispose(); }
}
export function createWorldPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, exclusions: THREE.Object3D[]) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, target);
  const render = new RenderPass(scene, camera), ao = new LandscapeAO(scene, camera, exclusions), bloom = new WorldBloom(), output = new OutputPass(), antialias = new WorldAntialias();
  composer.addPass(render); composer.addPass(ao); composer.addPass(bloom); composer.addPass(output); composer.addPass(antialias);
  return {
    composer,
    setDetailed: (detailed: boolean) => {
      ao.enabled = detailed; antialias.enabled = !detailed;
      for (const buffer of [composer.renderTarget1, composer.renderTarget2]) {
        const samples = detailed ? 2 : 0;
        if (buffer.samples !== samples) { buffer.samples = samples; buffer.dispose(); }
      }
    },
    dispose: () => { render.dispose(); ao.dispose(); bloom.dispose(); output.dispose(); antialias.dispose(); composer.dispose(); },
  };
}

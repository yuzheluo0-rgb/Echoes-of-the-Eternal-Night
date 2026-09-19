import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

const vertexShader = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';

/** Quarter-size highlights and two blur passes retain the lantern glow. */
export class WorldBloom extends Pass {
  private a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private b = this.a.clone();
  private extract = new THREE.ShaderMaterial({
    vertexShader, depthTest: false, depthWrite: false,
    uniforms: { source: { value: null } },
    fragmentShader: `varying vec2 vUv; uniform sampler2D source;
      void main(){vec3 c=texture2D(source,vUv).rgb;float l=dot(c,vec3(.2126,.7152,.0722));gl_FragColor=vec4(c*smoothstep(1.1,1.3,l),1.);}`,
  });
  private blur = new THREE.ShaderMaterial({
    vertexShader, depthTest: false, depthWrite: false,
    uniforms: { source: { value: null }, direction: { value: new THREE.Vector2() } },
    fragmentShader: `varying vec2 vUv;uniform sampler2D source;uniform vec2 direction;
      void main(){vec3 c=texture2D(source,vUv).rgb*.227027;
        c+=(texture2D(source,vUv+direction*1.384615).rgb+texture2D(source,vUv-direction*1.384615).rgb)*.316216;
        c+=(texture2D(source,vUv+direction*3.230769).rgb+texture2D(source,vUv-direction*3.230769).rgb)*.070270;
        gl_FragColor=vec4(c,1.);}`,
  });
  private composite = new THREE.ShaderMaterial({
    vertexShader, depthTest: false, depthWrite: false,
    uniforms: { source: { value: null }, glow: { value: this.a.texture } },
    fragmentShader: 'varying vec2 vUv;uniform sampler2D source;uniform sampler2D glow;void main(){vec4 c=texture2D(source,vUv);gl_FragColor=vec4(c.rgb+texture2D(glow,vUv).rgb*.13,c.a);}',
  });
  private quad = new FullScreenQuad(this.extract);

  override setSize(width: number, height: number) {
    this.a.setSize(Math.max(1, Math.ceil(width / 4)), Math.max(1, Math.ceil(height / 4)));
    this.b.setSize(this.a.width, this.a.height);
  }
  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const clear = renderer.autoClear; renderer.autoClear = false;
    const draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
      this.quad.material = material; renderer.setRenderTarget(target); this.quad.render(renderer);
    };
    try {
      this.extract.uniforms.source.value = read.texture; draw(this.extract, this.a);
      this.blur.uniforms.source.value = this.a.texture; this.blur.uniforms.direction.value.set(1.6 / this.a.width, 0); draw(this.blur, this.b);
      this.blur.uniforms.source.value = this.b.texture; this.blur.uniforms.direction.value.set(0, 1.6 / this.a.height); draw(this.blur, this.a);
      this.composite.uniforms.source.value = read.texture; draw(this.composite, this.renderToScreen ? null : write);
    } finally { renderer.autoClear = clear; }
  }
  override dispose() { this.a.dispose(); this.b.dispose(); this.extract.dispose(); this.blur.dispose(); this.composite.dispose(); this.quad.dispose(); }
}

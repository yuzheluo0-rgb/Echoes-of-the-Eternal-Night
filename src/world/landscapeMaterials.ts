import * as THREE from 'three';
import type { Biome } from './worldData';

export function alpineMaterial(rock: THREE.Texture, snow: THREE.Texture, normal: THREE.Texture, roughness: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({ color: '#d4d2c4', map: rock, normalMap: normal, normalScale: new THREE.Vector2(.45, .45), roughnessMap: roughness, roughness: .94 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uSnow = { value: snow };
    shader.vertexShader = 'varying vec3 vLandscapePosition; varying vec3 vLandscapeNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandscapePosition = (modelMatrix * vec4(position,1.0)).xyz; vLandscapeNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = 'uniform sampler2D uSnow; varying vec3 vLandscapePosition; varying vec3 vLandscapeNormal;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 w = pow(abs(vLandscapeNormal), vec3(4.0)); w /= max(w.x+w.y+w.z,0.001);
      vec3 stone = texture2D(map,vLandscapePosition.yz*1.1).rgb*w.x + texture2D(map,vLandscapePosition.xz*1.1).rgb*w.y + texture2D(map,vLandscapePosition.xy*1.1).rgb*w.z;
      float stoneLuma = dot(stone,vec3(.299,.587,.114)); stone = mix(stone,vec3(stoneLuma)*vec3(.78,.89,1.01),.88);
      float snowline = smoothstep(1.05, 2.35, vLandscapePosition.y + sin(vLandscapePosition.x*4.0+vLandscapePosition.z*3.0)*0.15);
      float accumulation = smoothstep(0.12,0.66,vLandscapeNormal.y) * snowline;
      vec3 freshSnow = texture2D(uSnow,vLandscapePosition.xz*.7).rgb * vec3(.9,.97,1.02);
      diffuseColor.rgb *= mix(stone*.93, freshSnow*1.18, accumulation);
    `);
  };
  return material;
}

export function shoreWater(biome: Biome, detail: THREE.Texture) {
  const color = biome === 'blood' ? '#692534' : biome === 'fog' ? '#718e99' : '#237987';
  const material = new THREE.MeshPhysicalMaterial({ color, roughness: .24, metalness: .03, clearcoat: .7, clearcoatRoughness: .2, envMapIntensity: .75 });
  const time = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.uWaterTime = time;
    shader.uniforms.uWaterDetail = { value: detail };
    shader.uniforms.uShallow = { value: new THREE.Color(biome === 'blood' ? '#6c2938' : biome === 'fog' ? '#819ca3' : '#478b83') };
    shader.uniforms.uDeep = { value: new THREE.Color(biome === 'blood' ? '#270e17' : biome === 'fog' ? '#536f7e' : '#123f54') };
    shader.vertexShader = 'attribute float shoreDepth; varying vec3 vSeaPosition; varying float vSeaDepth; uniform float uWaterTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vSeaDepth = shoreDepth; vSeaPosition = position;
      transformed.y += (sin(position.x*3.1 + uWaterTime*.8)*sin(position.z*2.4-uWaterTime*.6)*.012 + sin(position.x*8.0+position.z*7.0+uWaterTime*1.3)*.004)*smoothstep(0.0,.18,shoreDepth);
    `);
    shader.fragmentShader = 'varying vec3 vSeaPosition; varying float vSeaDepth; uniform float uWaterTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform sampler2D uWaterDetail;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      if (vSeaDepth < .006) discard;
      vec2 p = vSeaPosition.xz;
      float swell = sin(p.x*3.1 + uWaterTime*.8)*sin(p.y*2.4-uWaterTime*.6);
      float fineWave = sin(p.x*12.0+p.y*8.0+uWaterTime*1.7)*sin(p.y*13.0-p.x*4.0-uWaterTime);
      float coast = 1.0-smoothstep(.008,.047,vSeaDepth);
      float foam = coast * smoothstep(-.35,.65,sin(vSeaDepth*110.0-uWaterTime*1.3+swell*2.0));
      vec3 seaColor = mix(uShallow, uDeep, smoothstep(.015,.32,vSeaDepth));
      float smallWaves = texture2D(uWaterDetail,p*.38+vec2(uWaterTime*.008,-uWaterTime*.005)).g;
      diffuseColor.rgb = seaColor*(.9+fineWave*.045+smallWaves*.38) + vec3(.65,.75,.69)*foam*.23;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      vec2 wavePosition = vSeaPosition.xz;
      float dx = cos(wavePosition.x*3.1+sin(wavePosition.y*2.0)+uWaterTime*.8)*sin(wavePosition.y*2.4-uWaterTime*.6)*.19 + cos(wavePosition.x*13.0+wavePosition.y*9.0+uWaterTime*1.6)*.057;
      float dz = sin(wavePosition.x*3.1+uWaterTime*.8)*cos(wavePosition.y*2.4-uWaterTime*.6)*.19 + cos(wavePosition.x*8.0-wavePosition.y*11.0+uWaterTime)*.057;
      normal = normalize(mat3(viewMatrix)*vec3(-dx,1.0,-dz));
    `);
  };
  return { material, time };
}

/** Procedural light and fog sit over the full-resolution painting, not a downscaled copy. */
export interface LightOptions { reduced: boolean; paused: boolean; entering: boolean }
export interface LightField { configure: (options: LightOptions) => void; dispose: () => void }

const VERTEX = `
attribute vec2 position;
varying vec2 screenUV;
void main() {
  screenUV = vec2(position.x * .5 + .5, .5 - position.y * .5);
  gl_Position = vec4(position, 0., 1.);
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 screenUV;
uniform sampler2D noiseMap;
uniform sampler2D sceneMap;
uniform vec4 imageRect;
uniform float clock;
uniform float approach;

float noise(vec2 p) {
  // Smooth interpolation in a tiny repeating texture is cheaper than per-pixel hash noise.
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3. - 2. * f);
  return texture2D(noiseMap, (cell + f + .5) / 64.).r;
}
float mist(vec2 p) {
  mat2 turn = mat2(.8, -.6, .6, .8);
  float n = .57 * noise(p);
  p = turn * p * 2.03 + 13.1;
  n += .28 * noise(p);
  p = turn * p * 2.07 - 7.8;
  return n + .15 * noise(p);
}
float ellipse(vec2 p, vec2 center, vec2 radius) {
  vec2 d = (p - center) / radius;
  return exp(-dot(d, d) * 2.);
}
float flame(float phase) {
  return .83 + .09 * sin(clock * 3.1 + phase) + .05 * sin(clock * 7.3 + phase * 2.7);
}
float candle(vec2 uv, vec2 point, float phase) {
  return ellipse(uv, point, vec2(.012, .024)) * flame(phase);
}
void layer(inout vec4 result, vec3 color, float alpha) {
  alpha = clamp(alpha, 0., .75);
  result.rgb = color * alpha + result.rgb * (1. - alpha);
  result.a = alpha + result.a * (1. - alpha);
}
void main() {
  vec2 uv = (screenUV - imageRect.xy) / imageRect.zw;
  float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  vec3 original = texture2D(sceneMap, clamp(uv, .001, .999)).rgb;
  float luminance = dot(original, vec3(.2126, .7152, .0722));
  float t = clock * 1.65;
  vec4 result = vec4(0.);

  // Shadowed clouds move independently of the architecture and the title.
  float cloudMask = (1. - smoothstep(.25, .49, uv.y)) * (1. - smoothstep(.51, .72, uv.x));
  float clouds = mist(uv * vec2(6., 4.1) + vec2(t * .035, t * -.009));
  layer(result, vec3(.018, .035, .043), cloudMask * smoothstep(.32, .73, clouds) * .24);

  // Two advected density fields have different depth, direction, and wind speed.
  vec2 flow = vec2(t * -.046, t * .011);
  float curl = noise(uv * vec2(3.5, 4.) + vec2(t * .023, -t * .008));
  float distant = mist(uv * vec2(6.5, 4.4) + flow + vec2(curl * 1.2, curl * .65));
  float valley = exp(-pow((uv.y - .65 - sin(uv.x * 8. + t * .14) * .045) * 5.8, 2.));
  float sea = 1. - smoothstep(.57, .78, uv.x);
  float fog = smoothstep(.30, .78, distant) * valley * (.16 + sea * .24);
  // Bright existing fog transmits light; black foreground masonry occludes it.
  fog *= .45 + smoothstep(.025, .24, luminance) * .55;
  layer(result, vec3(.39, .47, .49), fog);
  float nearMist = mist(uv * vec2(4.6, 8.5) + vec2(t * .068, -t * .017) + curl * .8);
  float lower = exp(-pow((uv.y - .83 + sin(uv.x * 5. - t * .2) * .035) * 9., 2.));
  layer(result, vec3(.32, .40, .42), smoothstep(.39, .76, nearMist) * lower * .20);

  // Rays originate at the illuminated edge of the eclipse, rather than the screen centre.
  vec2 fromSun = (uv - vec2(.563, .155)) * vec2(1.7779, 1.);
  float distance = length(fromSun);
  float direction = dot(normalize(fromSun + .00001), normalize(vec2(-.56, .83)));
  float cone = smoothstep(.69, .96, direction);
  float angle = atan(fromSun.y, fromSun.x);
  float shafts = pow(noise(vec2(angle * 26. + t * .018, t * .085)), 3.);
  shafts += pow(noise(vec2(angle * 58. - t * .027, t * .039 + 17.)), 5.) * .32;
  float air = .45 + distant * .65;
  float rays = cone * shafts * exp(-distance * 2.4) * smoothstep(.045, .2, distance) * air;
  layer(result, vec3(.91, .79, .54), rays * .39);

  // The corona follows the original image. Luminance masking leaves the spires silhouetted.
  vec2 eclipse = (uv - vec2(.649, .197)) * vec2(1.7779, 1.);
  float rimDistance = abs(length(eclipse) - .187);
  float rim = exp(-rimDistance * 170.) + exp(-rimDistance * 31.) * .24;
  float coronalWind = .78 + .13 * sin(atan(eclipse.y, eclipse.x) * 7. - t * .33) + .09 * sin(t * .61);
  float transmission = smoothstep(.19, .66, luminance);
  layer(result, vec3(1., .78, .42), rim * transmission * coronalWind * .41);

  // Golden door light pools onto the wet bridge, with a slow, irregular shimmer.
  float breath = .81 + .11 * sin(t * .58) + .055 * sin(t * 1.13 + .7);
  float door = ellipse(uv, vec2(.738, .416), vec2(.042, .104));
  float halo = ellipse(uv, vec2(.738, .42), vec2(.093, .18));
  layer(result, vec3(1., .69, .32), (door * .28 + halo * .075) * breath * (1. + approach * .22));
  float depth = clamp((uv.y - .46) / .53, 0., 1.);
  float path = .756 + .027 * sin(depth * 5.) - depth * depth * .15;
  float wetPath = exp(-pow((uv.x - path) / (.008 + depth * .057), 2.));
  float wetStone = smoothstep(.13, .51, luminance) * smoothstep(.012, .15, original.r - original.b);
  float ripple = .60 + .20 * sin(uv.y * 99. - t * .91) + .1 * sin(uv.y * 181. + t * .64);
  layer(result, vec3(.94, .67, .32), wetPath * wetStone * ripple * step(.465, uv.y) * .19);

  float candles = candle(uv, vec2(.954, .620), 1.2)
    + candle(uv, vec2(.883, .810), 3.8)
    + candle(uv, vec2(.811, .691), 6.1)
    + candle(uv, vec2(.594, .646), 4.4)
    + candle(uv, vec2(.617, .630), 8.1)
    + candle(uv, vec2(.748, .524), 2.7);
  layer(result, vec3(1., .62, .24), candles * .39);
  // The canvas is premultiplied. The painting beneath remains at its native resolution.
  gl_FragColor = result * inside;
}`;

interface Resources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  vertex: WebGLShader;
  fragment: WebGLShader;
  noise: WebGLTexture;
  scene: WebGLTexture;
  time: WebGLUniformLocation | null;
  rect: WebGLUniformLocation | null;
  approach: WebGLUniformLocation | null;
}

export function createLightField(canvas: HTMLCanvasElement): LightField {
  const host = canvas.parentElement!;
  let gl: WebGLRenderingContext | null = null;
  try { gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' }); } catch { /* The CSS scene is the fallback. */ }
  if (!gl) {
    canvas.dataset.renderer = 'fallback';
    return { configure: () => {}, dispose: () => {} };
  }
  const gpu = gl;
  let resources: Resources | undefined;
  let options: LightOptions = { reduced: false, paused: false, entering: false };
  let frame = 0;
  let last = 0;
  let elapsed = 19;
  let disposed = false;
  let lost = false;
  let loaded = false;
  let approach = 0;
  const plate = new Image();
  plate.decoding = 'async';

  function shader(type: number, source: string) {
    const value = gpu.createShader(type);
    if (!value) throw new Error('Cannot create scene shader');
    gpu.shaderSource(value, source);
    gpu.compileShader(value);
    if (!gpu.getShaderParameter(value, gpu.COMPILE_STATUS)) {
      const reason = gpu.getShaderInfoLog(value);
      gpu.deleteShader(value);
      throw new Error(reason || 'Cannot compile scene shader');
    }
    return value;
  }
  function texture(unit: number) {
    const value = gpu.createTexture();
    if (!value) throw new Error('Cannot create scene texture');
    gpu.activeTexture(gpu.TEXTURE0 + unit);
    gpu.bindTexture(gpu.TEXTURE_2D, value);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MIN_FILTER, gpu.LINEAR);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MAG_FILTER, gpu.LINEAR);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_S, unit ? gpu.CLAMP_TO_EDGE : gpu.REPEAT);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_T, unit ? gpu.CLAMP_TO_EDGE : gpu.REPEAT);
    return value;
  }
  function release() {
    if (!resources) return;
    gpu.deleteProgram(resources.program);
    gpu.deleteBuffer(resources.buffer);
    gpu.deleteShader(resources.vertex);
    gpu.deleteShader(resources.fragment);
    gpu.deleteTexture(resources.noise);
    gpu.deleteTexture(resources.scene);
    resources = undefined;
  }
  function resize() {
    if (disposed || lost || !resources) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    // Only low-frequency light is rasterized here. The high-resolution image stays in CSS.
    const scale = Math.min(.8, Math.sqrt(760000 / (width * height)));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gpu.viewport(0, 0, w, h);
    const style = getComputedStyle(host);
    const parts = style.backgroundSize.split(' ');
    let imageHeight = Math.max(width / (1672 / 941), height);
    if (parts[0] === 'auto' && parts[1]?.endsWith('%')) imageHeight = height * parseFloat(parts[1]) / 100;
    const imageWidth = imageHeight * 1672 / 941;
    const positions = style.backgroundPosition.split(' ');
    const x = positions[0]?.endsWith('%') ? parseFloat(positions[0]) / 100 : 0;
    const y = positions[1]?.endsWith('%') ? parseFloat(positions[1]) / 100 : 0;
    gpu.useProgram(resources.program);
    gpu.uniform4f(resources.rect, (width - imageWidth) * x / width, (height - imageHeight) * y / height, imageWidth / width, imageHeight / height);
    if (loaded) paint();
  }
  function paint() {
    if (!resources || !loaded || lost || disposed) return;
    gpu.useProgram(resources.program);
    gpu.uniform1f(resources.time, options.reduced ? 19 : elapsed);
    gpu.uniform1f(resources.approach, approach);
    gpu.drawArrays(gpu.TRIANGLES, 0, 6);
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || options.reduced || options.paused || document.hidden || !loaded) return;
    frame = requestAnimationFrame(tick);
    if (last && now - last < 32) return;
    const delta = last ? Math.min((now - last) / 1000, .1) : 0;
    elapsed += delta;
    approach += ((options.entering ? 1 : 0) - approach) * Math.min(delta * 1.5, 1);
    last = now;
    paint();
  }
  function synchronize() {
    cancelAnimationFrame(frame); frame = 0; last = 0;
    if (disposed || lost || !loaded) return;
    paint();
    if (!options.reduced && !options.paused && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function upload() {
    if (disposed || lost || !resources || !plate.naturalWidth) return;
    gpu.activeTexture(gpu.TEXTURE1);
    gpu.bindTexture(gpu.TEXTURE_2D, resources.scene);
    gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, gpu.RGBA, gpu.UNSIGNED_BYTE, plate);
    loaded = true;
    canvas.dataset.renderer = 'webgl';
    resize(); synchronize();
  }
  function initialize() {
    try {
      release();
      const vertex = shader(gpu.VERTEX_SHADER, VERTEX);
      let fragment: WebGLShader;
      try { fragment = shader(gpu.FRAGMENT_SHADER, FRAGMENT); } catch (error) { gpu.deleteShader(vertex); throw error; }
      const program = gpu.createProgram()!;
      gpu.attachShader(program, vertex); gpu.attachShader(program, fragment); gpu.linkProgram(program);
      if (!gpu.getProgramParameter(program, gpu.LINK_STATUS)) {
        gpu.deleteShader(vertex); gpu.deleteShader(fragment); gpu.deleteProgram(program);
        throw new Error('Cannot link scene shader');
      }
      gpu.useProgram(program);
      const buffer = gpu.createBuffer()!;
      gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
      gpu.bufferData(gpu.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gpu.STATIC_DRAW);
      const position = gpu.getAttribLocation(program, 'position');
      gpu.enableVertexAttribArray(position); gpu.vertexAttribPointer(position, 2, gpu.FLOAT, false, 0, 0);
      const noise = texture(0);
      const data = new Uint8Array(64 * 64 * 4);
      let seed = 0x38f28ca7;
      for (let i = 0; i < data.length; i += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        data[i] = data[i + 1] = data[i + 2] = seed & 255; data[i + 3] = 255;
      }
      gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, 64, 64, 0, gpu.RGBA, gpu.UNSIGNED_BYTE, data);
      const scene = texture(1);
      gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, 1, 1, 0, gpu.RGBA, gpu.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gpu.uniform1i(gpu.getUniformLocation(program, 'noiseMap'), 0);
      gpu.uniform1i(gpu.getUniformLocation(program, 'sceneMap'), 1);
      resources = { program, buffer, vertex, fragment, noise, scene, time: gpu.getUniformLocation(program, 'clock'), rect: gpu.getUniformLocation(program, 'imageRect'), approach: gpu.getUniformLocation(program, 'approach') };
      gpu.disable(gpu.DEPTH_TEST); gpu.disable(gpu.BLEND);
      resize();
      if (plate.complete && plate.naturalWidth) upload();
    } catch (error) {
      release(); canvas.dataset.renderer = 'fallback';
      console.warn('The scene is using its CSS lighting fallback.', error);
    }
  }
  function contextLost(event: Event) {
    event.preventDefault(); lost = true; loaded = false;
    // Context loss already invalidates every GPU object. Do not delete those handles after restoration.
    resources = undefined;
    cancelAnimationFrame(frame); frame = 0;
    canvas.dataset.renderer = 'fallback';
  }
  function contextRestored() { lost = false; initialize(); }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  document.addEventListener('visibilitychange', synchronize);
  window.addEventListener('pageshow', synchronize);
  window.addEventListener('focus', synchronize);
  initialize();
  plate.onload = upload;
  plate.onerror = () => { canvas.dataset.renderer = 'fallback'; };
  plate.src = '/assets/threshold-scene.webp';
  return {
    configure(next) { options = next; resize(); synchronize(); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      plate.onload = null; plate.onerror = null;
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      document.removeEventListener('visibilitychange', synchronize);
      window.removeEventListener('pageshow', synchronize);
      window.removeEventListener('focus', synchronize);
      if (!lost) { gpu.clearColor(0, 0, 0, 0); gpu.clear(gpu.COLOR_BUFFER_BIT); }
      release();
    },
  };
}

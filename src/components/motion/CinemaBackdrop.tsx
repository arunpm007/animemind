'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * The z0 plane: a single soft key light from the upper left, plus film grain.
 *
 * This is the lighting rule from the design system made literal rather than a
 * decorative flourish. A CSS radial-gradient can fake the falloff but it
 * bands badly on a dark background at this size — the eye is very good at
 * spotting stepped gradients in shadow. Doing it in a shader gives smooth
 * falloff and lets the grain be sampled per-pixel, which is also what hides
 * any residual banding.
 *
 * The grain is the point, cinematically: a perfectly clean dark field looks
 * like an empty div, while a very slightly noisy one reads as a projected
 * image. It is kept under 4% amplitude so it registers as texture, not noise.
 */

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uTime;
  uniform vec2  uResolution;
  uniform vec3  uKey;      // accent colour of the focused work
  uniform float uIntensity;

  // Cheap hash noise. Good enough for grain; a texture lookup would cost more
  // than it buys at this amplitude.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2(uv.x * aspect, uv.y);

    // The key. Fixed upper-left, drifting by a few pixels over ~40s so the
    // frame breathes without ever reading as animation.
    vec2 key = vec2(0.18 * aspect, 0.92);
    key += vec2(sin(uTime * 0.05) * 0.015, cos(uTime * 0.04) * 0.01);

    float d = distance(p, key);
    // Two falloffs: a tight core and a wide wash. One alone looks like either
    // a spotlight or a fog, never like a lit room.
    float core = exp(-d * d * 3.2);
    float wash = exp(-d * 1.05) * 0.4;
    float light = (core * 0.55 + wash) * uIntensity;

    // A faint counter-bounce from the lower right, as a bounce card would give.
    float bounce = exp(-distance(p, vec2(0.92 * aspect, 0.06)) * 2.4) * 0.07;

    vec3 col = uKey * (light + bounce);

    // Vignette, subtle. Anything stronger starts to look like a filter.
    float vig = smoothstep(1.25, 0.25, distance(uv, vec2(0.5)));
    col *= mix(0.82, 1.0, vig);

    // Grain, animated so it does not read as a static dirty screen.
    float g = hash(gl_FragCoord.xy + fract(uTime) * 100.0);
    col += (g - 0.5) * 0.035;

    gl_FragColor = vec4(col, 1.0);
  }
`;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0.18, 0.2, 0.28];
  return [
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255,
  ];
}

function Light({ accent, intensity }: { accent: string; intensity: number }) {
  const ref = useRef<THREE.ShaderMaterial>(null);
  const { size, viewport } = useThree();
  const target = useMemo(() => new THREE.Color(), []);
  const current = useRef(new THREE.Color(0.1, 0.12, 0.18));

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uKey: { value: new THREE.Vector3(0.1, 0.12, 0.18) },
      uIntensity: { value: intensity },
    }),
    [intensity],
  );

  useFrame((state, delta) => {
    const u = ref.current?.uniforms;
    if (!u) return;
    u.uTime.value = state.clock.elapsedTime;
    u.uResolution.value.set(size.width * viewport.dpr, size.height * viewport.dpr);

    // Ease toward the new accent rather than cutting. A hard colour change
    // between pages reads as a flash; over ~0.6s it reads as a light being
    // re-gelled, which is the intent.
    const [r, g, b] = hexToRgb(accent);
    target.setRGB(r, g, b);
    current.current.lerp(target, Math.min(delta * 1.8, 1));
    u.uKey.value.set(current.current.r, current.current.g, current.current.b);
    u.uIntensity.value += (intensity - u.uIntensity.value) * Math.min(delta * 3, 1);
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={ref}
        vertexShader={vertex}
        fragmentShader={fragment}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

export interface CinemaBackdropProps {
  /** Hex accent of whatever the page is about. */
  accent?: string | null;
  /** 0 keeps the field nearly black; 1 is a fully lit room. */
  intensity?: number;
}

/**
 * Can this browser actually give us a WebGL context?
 *
 * `prefers-reduced-motion` is a preference; this is a capability, and they are
 * not the same question. Hardware acceleration can be switched off, a GPU can
 * be blocklisted, a VM or locked-down work laptop may have no 3D at all. In
 * those cases Three.js throws during renderer construction and — because that
 * happens inside React's render tree — it takes the whole PAGE down, not just
 * the backdrop. A decorative light must never be able to do that.
 *
 * Probed once on a throwaway canvas, which is cheap and definitive.
 */
function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    // Release it immediately; browsers cap simultaneous contexts and we only
    // wanted to know whether one was obtainable.
    (gl as WebGLRenderingContext)
      .getExtension('WEBGL_lose_context')
      ?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** The flat, dependency-free background. Always a valid thing to show. */
function FlatBackdrop({ accent }: { accent?: string | null }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background: `radial-gradient(120% 90% at 18% 0%, ${accent ?? '#1a1d27'}22, transparent 60%), var(--color-bg)`,
      }}
    />
  );
}

/**
 * Last line of defence.
 *
 * The probe above catches the common case, but a context can also be lost at
 * runtime — GPU reset, driver update, too many contexts open across tabs. This
 * boundary turns any such failure into the flat background instead of a crash
 * screen on top of the user's library.
 */
class BackdropBoundary extends Component<
  { accent?: string | null; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Worth knowing about, not worth interrupting anyone over.
    console.warn('CinemaBackdrop disabled:', error);
  }

  render() {
    if (this.state.failed) return <FlatBackdrop accent={this.props.accent} />;
    return this.props.children;
  }
}

export function CinemaBackdrop({ accent, intensity = 0.55 }: CinemaBackdropProps) {
  // 'probing' until the client has checked, so the server and the first client
  // render agree and there is no hydration mismatch.
  const [mode, setMode] = useState<'probing' | 'webgl' | 'flat'>('probing');

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

    const decide = () => {
      // Preference first (cheaper, and the user asked), capability second.
      if (mq.matches) return setMode('flat');
      setMode(detectWebGL() ? 'webgl' : 'flat');
    };

    decide();
    mq.addEventListener('change', decide);
    return () => mq.removeEventListener('change', decide);
  }, []);

  if (mode !== 'webgl') return <FlatBackdrop accent={accent} />;

  return (
    <BackdropBoundary accent={accent}>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <Canvas
          // Capped DPR: this is an out-of-focus background, so rendering it at
          // retina resolution spends battery on detail nobody can see.
          dpr={[1, 1.5]}
          gl={{ antialias: false, alpha: false, powerPreference: 'low-power' }}
          orthographic
          camera={{ position: [0, 0, 1] }}
          style={{ position: 'absolute', inset: 0 }}
          // A lost context must degrade, not throw.
          onCreated={({ gl }) => {
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              setMode('flat');
            });
          }}
        >
          <Light accent={accent ?? '#2a2f3d'} intensity={intensity} />
        </Canvas>
      </div>
    </BackdropBoundary>
  );
}

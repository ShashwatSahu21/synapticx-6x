import { useState, useEffect, useRef, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { fetchSystemStatus } from "../api";

// ── Utility ───────────────────────────────────────────────────────────────────
const d2r = (deg) => ((deg - 90) * Math.PI) / 180;

function useSmoothAngle(target, speed = 0.08) {
  const ref = useRef(target);
  useFrame(() => { ref.current += (target - ref.current) * speed; });
  return ref;
}

// ── Joint ring ────────────────────────────────────────────────────────────────
function JointRing({ radius = 0.18, color = "#00d4ff" }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.02, 8, 32]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} transparent opacity={0.6} />
    </mesh>
  );
}

// ── Segment ───────────────────────────────────────────────────────────────────
function Segment({ length, radius = 0.08, color = "#1a2a4a", emissive = "#0a1020" }) {
  return (
    <mesh position={[0, length / 2, 0]}>
      <capsuleGeometry args={[radius, length, 4, 12]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.15} roughness={0.3} metalness={0.85} />
    </mesh>
  );
}

// ── Gripper finger ────────────────────────────────────────────────────────────
function GripperFinger({ side }) {
  const dir = side === "left" ? 1 : -1;
  return (
    <group position={[dir * 0.04, 0, 0]}>
      <mesh position={[dir * 0.02, 0.12, 0]}>
        <boxGeometry args={[0.03, 0.24, 0.03]} />
        <meshStandardMaterial color="#2a3a5a" emissive="#00d4ff" emissiveIntensity={0.1} roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[dir * 0.02, 0.24, 0]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color="#00d4ff" emissive="#00d4ff" emissiveIntensity={0.5} roughness={0.2} metalness={0.8} />
      </mesh>
    </group>
  );
}

// ── Full arm assembly ─────────────────────────────────────────────────────────
function ArmAssembly({ angles }) {
  const base     = useSmoothAngle(d2r(angles.base));
  const shoulder = useSmoothAngle(d2r(angles.shoulder));
  const elbow    = useSmoothAngle(d2r(angles.elbow));
  const wrist    = useSmoothAngle(d2r(angles.wrist));
  const roll     = useSmoothAngle(d2r(angles.gripper));
  const grip     = useSmoothAngle(d2r(angles.auxiliary));

  const baseRef = useRef(), shoulderRef = useRef(), elbowRef = useRef();
  const wristRef = useRef(), rollRef = useRef(), gripLRef = useRef(), gripRRef = useRef();

  useFrame(() => {
    if (baseRef.current) baseRef.current.rotation.y = base.current;
    if (shoulderRef.current) shoulderRef.current.rotation.z = shoulder.current;
    if (elbowRef.current) elbowRef.current.rotation.z = -elbow.current; // Inverted for physical bot sync
    if (wristRef.current) wristRef.current.rotation.z = wrist.current;
    if (rollRef.current) rollRef.current.rotation.y = roll.current;
    const g = grip.current * 0.5;
    if (gripLRef.current) gripLRef.current.rotation.z = g;
    if (gripRRef.current) gripRRef.current.rotation.z = -g;
  });

  return (
    <group>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.35, 0.4, 0.12, 32]} />
        <meshStandardMaterial color="#0d1525" emissive="#00d4ff" emissiveIntensity={0.04} roughness={0.2} metalness={0.95} />
      </mesh>
      <mesh position={[0, 0.13, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.33, 0.008, 8, 48]} />
        <meshStandardMaterial color="#00d4ff" emissive="#00d4ff" emissiveIntensity={1.2} transparent opacity={0.5} />
      </mesh>
      <group ref={baseRef} position={[0, 0.12, 0]}>
        <JointRing radius={0.14} />
        <Segment length={0.4} radius={0.1} color="#141e35" />
        <group ref={shoulderRef} position={[0, 0.4, 0]}>
          <JointRing radius={0.12} color="#00aaff" />
          <Segment length={0.55} radius={0.085} color="#162040" />
          <group ref={elbowRef} position={[0, 0.55, 0]}>
            <JointRing radius={0.1} color="#0088dd" />
            <Segment length={0.45} radius={0.07} color="#182448" />
            <group ref={wristRef} position={[0, 0.45, 0]}>
              <JointRing radius={0.08} color="#0066bb" />
              <Segment length={0.2} radius={0.055} color="#1a2850" />
              <group ref={rollRef} position={[0, 0.2, 0]}>
                <JointRing radius={0.06} color="#a78bfa" />
                <group position={[0, 0.05, 0]}>
                  <mesh>
                    <boxGeometry args={[0.1, 0.05, 0.06]} />
                    <meshStandardMaterial color="#1a2850" roughness={0.3} metalness={0.9} />
                  </mesh>
                  <group ref={gripLRef}><GripperFinger side="left" /></group>
                  <group ref={gripRRef}><GripperFinger side="right" /></group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

// ── Grid floor ────────────────────────────────────────────────────────────────
function FloorGrid() {
  const gridRef = useRef();
  useFrame(({ clock }) => {
    if (gridRef.current) gridRef.current.material.opacity = 0.12 + Math.sin(clock.elapsedTime * 0.5) * 0.03;
  });
  return (
    <group>
      <gridHelper ref={gridRef} args={[4, 20, "#00d4ff", "#0a1a30"]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[5, 5]} />
        <meshStandardMaterial color="#06060f" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

// ── Main 3D panel (Visualization Only) ──────────────────────────────────────────
export default function RoboticArm3D({ height = "100%" }) {
  const [angles, setAngles] = useState({
    base: 90, shoulder: 90, elbow: 90,
    wrist: 90, gripper: 90, auxiliary: 90,
  });
  const [connected, setConnected] = useState(false);
  const pollRef = useRef(null);

  // Poll current angles from backend at 10 Hz
  const load = useCallback(async () => {
    try {
      const res = await fetchSystemStatus();
      if (res.servo_angles) setAngles(res.servo_angles);
      setConnected(res.any_node_connected || false);
    } catch { setConnected(false); }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 100);
    return () => clearInterval(pollRef.current);
  }, [load]);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden"
      style={{
        height: height,
        background: "rgba(13,13,26,0.45)",
        border: "1px solid rgba(255,255,255,0.05)",
        backdropFilter: "blur(12px)",
      }}>

      {/* Header */}
      <div className="absolute top-3 left-4 z-10 pointer-events-none">
        <p className="text-[9px] uppercase tracking-[0.2em] font-mono" style={{ color: "rgba(0,212,255,0.4)" }}>
          Live 3D Telemetry
        </p>
        <h3 className="text-sm font-semibold text-white font-['Outfit'] mt-0.5">
          Robotic Arm — Virtual Twin
        </h3>
      </div>

      {/* Status */}
      <div className="absolute top-3 right-4 z-10 flex items-center gap-2 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full"
          style={{
            background: connected ? "#00d4ff" : "#3a3f5c",
            boxShadow: connected ? "0 0 8px rgba(0,212,255,0.6)" : "none",
          }} />
        <span className="text-[10px] font-mono" style={{ color: connected ? "#00d4ff" : "#3a3f5c" }}>
          {connected ? "SYNCED" : "OFFLINE"}
        </span>
      </div>

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [1.8, 1.6, 1.8], fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}>
        <ambientLight intensity={0.3} />
        <directionalLight position={[3, 5, 3]} intensity={0.8} color="#e0f0ff" castShadow />
        <directionalLight position={[-2, 3, -1]} intensity={0.3} color="#0057ff" />
        <pointLight position={[0, 2, 0]} intensity={0.4} color="#00d4ff" distance={5} />
        <Environment preset="night" />
        <ArmAssembly angles={angles} />
        <FloorGrid />
        <ContactShadows position={[0, -0.01, 0]} opacity={0.35} scale={3} blur={2.5} far={2} color="#001830" />
        <OrbitControls
          makeDefault enablePan={false} enableZoom
          minDistance={1.2} maxDistance={6}
          minPolarAngle={Math.PI * 0.05} maxPolarAngle={Math.PI * 0.48}
          autoRotate={!connected} autoRotateSpeed={0.5}
          dampingFactor={0.08} enableDamping
        />
      </Canvas>

      {/* Angle HUD at bottom */}
      <div className="absolute bottom-3 left-4 right-4 flex justify-between pointer-events-none bg-neural-bg/20 backdrop-blur-sm p-2 rounded-xl border border-white/5">
        {[
          { label: "BASE", val: angles.base, color: "#00d4ff" },
          { label: "SHLD", val: angles.shoulder, color: "#00aaff" },
          { label: "ELBW", val: angles.elbow, color: "#0088dd" },
          { label: "WRST", val: angles.wrist, color: "#0066bb" },
          { label: "ROLL", val: angles.gripper, color: "#a78bfa" },
          { label: "GRIP", val: angles.auxiliary, color: "#34d399" },
        ].map(({ label, val, color }) => (
          <div key={label} className="text-center">
            <p className="text-[8px] font-mono uppercase opacity-40">{label}</p>
            <p className="text-[11px] font-mono font-bold tabular-nums" style={{ color }}>{val.toFixed(0)}°</p>
          </div>
        ))}
      </div>

      {/* Corner decorations */}
      <svg className="absolute top-0 right-0 w-16 h-16 pointer-events-none opacity-20" viewBox="0 0 64 64">
        <path d="M64 0 L64 20 L56 20 L56 8 L44 8 L44 0 Z" fill="none" stroke="#00d4ff" strokeWidth="0.5" />
      </svg>
      <svg className="absolute bottom-0 left-0 w-16 h-16 pointer-events-none opacity-20" viewBox="0 0 64 64">
        <path d="M0 64 L0 44 L8 44 L8 56 L20 56 L20 64 Z" fill="none" stroke="#00d4ff" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

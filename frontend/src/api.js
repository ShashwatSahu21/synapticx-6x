const BASE_URL = "http://localhost:8000";

export const fetchNeuralData = () =>
    fetch(`${BASE_URL}/neural-data`).then((r) => r.json());

export const fetchSystemStatus = () =>
    fetch(`${BASE_URL}/system-status`).then((r) => r.json());

export const fetchLogs = () =>
    fetch(`${BASE_URL}/logs`).then((r) => r.json());

export const updateServos = (angles) =>
    fetch(`${BASE_URL}/servo/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ angles }),
    }).then((r) => r.json());

export const updateSystemStatus = (payload) =>
    fetch(`${BASE_URL}/system-status/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).then((r) => r.json());

// ── COM Port / Connection Manager ────────────────────────────────────────────

export const fetchPorts = () =>
    fetch(`${BASE_URL}/ports`).then((r) => r.json());

export const connectNode = (node, port, baud) =>
    fetch(`${BASE_URL}/ports/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, port, baud }),
    }).then((r) => r.json());

export const disconnectNode = (node, port) =>
    fetch(`${BASE_URL}/ports/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, port }),
    }).then((r) => r.json());

// ── Bio-Signal & Mode API ────────────────────────────────────────────────────

export const fetchBioSignalState = () =>
    fetch(`${BASE_URL}/biosignal-state`).then((r) => r.json());

export const fetchMode = () =>
    fetch(`${BASE_URL}/mode`).then((r) => r.json());

export const setMode = (mode) =>
    fetch(`${BASE_URL}/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
    }).then((r) => r.json());

export const updateBioConfig = (config) =>
    fetch(`${BASE_URL}/biosignal-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
    }).then((r) => r.json());

export const triggerCalibration = () =>
    fetch(`${BASE_URL}/biosignal-calibrate`, {
        method: "POST",
    }).then((r) => r.json());

// ── Teach & Replay — Sequence Management ─────────────────────────────────────

export const setSelectedSequence = (seqId) =>
    fetch(`${BASE_URL}/sequences/selected/${seqId || "none"}`, { method: "POST" }).then((r) => r.json());

export const getSelectedSequence = () =>
    fetch(`${BASE_URL}/sequences/selected`).then((r) => r.json());

export const captureWaypoint = () =>
    fetch(`${BASE_URL}/sequences/capture`, { method: "POST" }).then((r) => r.json());

export const fetchSequences = () =>
    fetch(`${BASE_URL}/sequences`).then((r) => r.json());

export const createSequence = (name, loop = false, speed = 1.0) =>
    fetch(`${BASE_URL}/sequences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, loop, speed }),
    }).then((r) => r.json());

export const getSequence = (seqId) =>
    fetch(`${BASE_URL}/sequences/${seqId}`).then((r) => r.json());

export const updateSequence = (seqId, updates) =>
    fetch(`${BASE_URL}/sequences/${seqId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
    }).then((r) => r.json());

export const deleteSequence = (seqId) =>
    fetch(`${BASE_URL}/sequences/${seqId}`, { method: "DELETE" }).then((r) => r.json());

export const duplicateSequence = (seqId) =>
    fetch(`${BASE_URL}/sequences/${seqId}/duplicate`, { method: "POST" }).then((r) => r.json());

// ── Waypoint Management ──────────────────────────────────────────────────────

export const addWaypoint = (seqId, label = null, angles = null, delay_ms = 1000, transition_ms = 800) =>
    fetch(`${BASE_URL}/sequences/${seqId}/waypoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, angles, delay_ms, transition_ms }),
    }).then((r) => r.json());

export const updateWaypoint = (seqId, wpIdx, updates) =>
    fetch(`${BASE_URL}/sequences/${seqId}/waypoints/${wpIdx}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
    }).then((r) => r.json());

export const deleteWaypoint = (seqId, wpIdx) =>
    fetch(`${BASE_URL}/sequences/${seqId}/waypoints/${wpIdx}`, { method: "DELETE" }).then((r) => r.json());

export const takeSnapshot = () =>
    fetch(`${BASE_URL}/sequences/snapshot`, { method: "POST" }).then((r) => r.json());

// ── Playback Control ─────────────────────────────────────────────────────────

export const playSequence = (seqId, loop = false, speed = 1.0) =>
    fetch(`${BASE_URL}/sequences/${seqId}/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loop, speed }),
    }).then((r) => r.json());

export const stopPlayback = () =>
    fetch(`${BASE_URL}/sequences/stop`, { method: "POST" }).then((r) => r.json());

export const pausePlayback = () =>
    fetch(`${BASE_URL}/sequences/pause`, { method: "POST" }).then((r) => r.json());

export const fetchPlaybackState = () =>
    fetch(`${BASE_URL}/sequences/playback`).then((r) => r.json());

// ── Shape & Task Generation ──────────────────────────────────────────────────

export const generateShape = (shape, options = {}) =>
    fetch(`${BASE_URL}/sequences/generate-shape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shape, ...options }),
    }).then((r) => r.json());

export const generateTask = (task, options = {}) =>
    fetch(`${BASE_URL}/sequences/generate-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, ...options }),
    }).then((r) => r.json());

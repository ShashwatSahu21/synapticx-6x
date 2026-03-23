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

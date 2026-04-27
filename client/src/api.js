const BASE = '/api';

async function apiRequest(url, opts = {}) {
  const res = await fetch(url, opts);
  let parsed = {};
  try {
    parsed = await res.json();
  } catch (_) {
    /* empty body or non-JSON */
  }
  if (!res.ok) {
    const detail = parsed?.detail;
    let msg;
    if (typeof detail === 'string') {
      msg = detail;
    } else if (detail !== undefined && detail !== null) {
      msg = JSON.stringify(detail);
    } else {
      msg = `${res.status} ${res.statusText}`.trim();
    }
    throw new Error(msg);
  }
  return parsed;
}

export async function fetchFleet() {
  return apiRequest(`${BASE}/fleet`);
}

export async function fetchMetrics() {
  return apiRequest(`${BASE}/fleet/metrics`);
}

export async function fetchAircraft(tail) {
  const t = encodeURIComponent(tail);
  return apiRequest(`${BASE}/aircraft/${t}`);
}

export async function fetchCamera(tail) {
  const t = encodeURIComponent(tail);
  return apiRequest(`${BASE}/aircraft/${t}/camera`, { cache: 'no-store' });
}

export async function fetchManuals(tail) {
  const t = encodeURIComponent(tail);
  return apiRequest(`${BASE}/aircraft/${t}/manuals`);
}

export async function fetchInspections(tail) {
  const t = encodeURIComponent(tail);
  return apiRequest(`${BASE}/aircraft/${t}/inspections`, { cache: 'no-store' });
}

export async function toggleInspectionItem(tail, itemId, notes) {
  const ta = encodeURIComponent(tail);
  const id = encodeURIComponent(itemId);
  return apiRequest(`${BASE}/aircraft/${ta}/inspections/${id}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
}

export async function acknowledgeAlert(tail, index) {
  const ta = encodeURIComponent(tail);
  return apiRequest(`${BASE}/aircraft/${ta}/alerts/${index}/acknowledge`, {
    method: 'POST',
  });
}

export async function completeWorkOrder(tail, index) {
  const ta = encodeURIComponent(tail);
  return apiRequest(`${BASE}/aircraft/${ta}/workorders/${index}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });
}

export async function createWorkOrder(tail, { title, type, priority, days }) {
  const ta = encodeURIComponent(tail);
  return apiRequest(`${BASE}/aircraft/${ta}/workorders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, type, priority, days }),
  });
}

/**
 * Send a captured exterior photo to the FastAPI backend; Gemini analyzes fuselage / paint / visible damage.
 * @param {Blob|File} imageBlob - JPEG/PNG from canvas or file input
 * @param {{ runId?: string, aircraftContext?: string, aircraftTail?: string, zoneId?: string }} [opts]
 */
export async function analyzeExteriorImage(imageBlob, opts = {}) {
  const form = new FormData();
  form.append('file', imageBlob, imageBlob instanceof File ? imageBlob.name : 'exterior.jpg');
  if (opts.runId) form.append('run_id', opts.runId);
  if (opts.aircraftContext) form.append('aircraft_context', opts.aircraftContext);
  if (opts.aircraftTail) form.append('aircraft_tail', opts.aircraftTail);
  if (opts.zoneId) form.append('zone_id', opts.zoneId);
  return apiRequest(`${BASE}/analysis/exterior`, {
    method: 'POST',
    body: form,
  });
}

/**
 * Analyze all unreviewed zone captures for this tail (stills in zone_captures with no result row for that file yet).
 * @param {string} aircraftTail
 * @param {{ aircraftContext?: string, maxFrames?: number }} [opts]
 */
export async function analyzeAllPendingExterior(aircraftTail, opts = {}) {
  return apiRequest(`${BASE}/analysis/exterior/pending`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      aircraft_tail: aircraftTail,
      aircraft_context: opts.aircraftContext || null,
      max_frames: opts.maxFrames ?? 50,
    }),
  });
}

/**
 * @param {string} tail
 * @param {string} captureId - zone capture id from the API
 */
export async function deleteExteriorZonePhoto(tail, captureId) {
  return apiRequest(
    `${BASE}/aircraft/${encodeURIComponent(tail)}/exterior-zone-photos/${encodeURIComponent(captureId)}`,
    { method: 'DELETE' },
  );
}

export async function postExteriorZonePhoto(tail, zoneId, imageBlob) {
  const form = new FormData();
  form.append('file', imageBlob, imageBlob instanceof File ? imageBlob.name : 'zone.jpg');
  return apiRequest(
    `${BASE}/aircraft/${encodeURIComponent(tail)}/exterior-zones/${encodeURIComponent(zoneId)}/photo`,
    { method: 'POST', body: form },
  );
}

export async function sendChatMessage(messages, aircraftContext = null) {
  return apiRequest(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      aircraft_context: aircraftContext ? JSON.stringify(aircraftContext) : null,
    }),
  });
}

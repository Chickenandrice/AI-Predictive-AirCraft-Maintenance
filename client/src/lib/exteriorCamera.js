/** True when the page may use getUserMedia (https, localhost, or 127.0.0.1). Plain http://LAN_IP is not. */
export function isCameraSecureContext() {
  if (typeof window === 'undefined') return true;
  return window.isSecureContext === true;
}

/** False when browser hides mediaDevices (typical: opened as http://192.168.x.x). */
export function isGetUserMediaAvailable() {
  return Boolean(
    typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia,
  );
}

export function cameraUnavailableMessage() {
  if (isGetUserMediaAvailable()) return null;
  if (!isCameraSecureContext()) {
    return (
      'This address is not a “secure context,” so the browser hides the camera API. ' +
      'Use the https:// URL shown in the Vite terminal (accept the certificate warning once), ' +
      'or use “Upload”.'
    );
  }
  return 'Camera API not available in this browser. Use “Upload”.';
}

/** getUserMedia errors often show as "Permission denied" — browser/OS, not the API. */
export function cameraErrorMessage(err) {
  const name = err?.name || '';
  const msg = (err?.message || '').toLowerCase();
  if (name === 'NotAllowedError' || msg.includes('permission denied')) {
    return (
      'Camera blocked: allow this site in the browser address bar (camera icon). ' +
      'Use “Upload image” if the camera is unavailable.'
    );
  }
  if (name === 'NotFoundError' || msg.includes('no camera')) {
    return 'No camera found. Use “Upload image”.';
  }
  if (name === 'NotReadableError' || msg.includes('could not start')) {
    return 'Camera is in use by another app. Close it and reload.';
  }
  return err?.message || 'Camera unavailable';
}

export async function openCameraStream() {
  const preferRear = {
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    audio: false,
  };
  const simple = { video: true, audio: false };
  try {
    return await navigator.mediaDevices.getUserMedia(preferRear);
  } catch (first) {
    try {
      return await navigator.mediaDevices.getUserMedia(simple);
    } catch {
      throw first;
    }
  }
}

export function buildAircraftContext(ac) {
  if (!ac) return '';
  const parts = [
    ac.tailNumber && `Tail: ${ac.tailNumber}`,
    ac.name && `Aircraft: ${ac.name}`,
    ac.bayLocation && `Location: ${ac.bayLocation}`,
    ac.route && `Route: ${ac.route}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** Query keys: tail, name, bay, route (from remote-capture URL). Values are already decoded by URLSearchParams. */
export function buildAircraftContextFromParams(params) {
  const tail = params.get('tail');
  const name = params.get('name');
  const bay = params.get('bay');
  const route = params.get('route');
  const parts = [
    tail && `Tail: ${tail}`,
    name && `Aircraft: ${name}`,
    bay && `Location: ${bay}`,
    route && `Route: ${route}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * When the page URL has no explicit port, Vite dev is assumed to be 5173 on localhost;
 * for a public host (e.g. Railway HTTPS) the default is to omit the port (443).
 */
export function defaultRemoteCapturePort() {
  if (typeof window === 'undefined') return '';
  const explicit = window.location.port;
  if (explicit) return explicit;
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return '5173';
  return '';
}

export function buildRemoteCaptureUrl({ host, port, protocol, params }) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) q.set(k, v);
  });
  const qs = q.toString();
  const path = `/remote-capture${qs ? `?${qs}` : ''}`;
  const p = port ? `:${port}` : '';
  return `${protocol}//${host}${p}${path}`;
}

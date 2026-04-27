import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeAllPendingExterior, analyzeExteriorImage, deleteExteriorZonePhoto, postExteriorZonePhoto } from '../api';
import {
  buildAircraftContext,
  buildRemoteCaptureUrl,
  defaultRemoteCapturePort,
  cameraErrorMessage,
  cameraUnavailableMessage,
  openCameraStream,
} from '../lib/exteriorCamera';
import PhotoLightbox from './PhotoLightbox';
import ConfirmDialog from './ConfirmDialog';
import ZonePhotoCaption from './ZonePhotoCaption';

export default function CameraPanel({ cameraData, aircraft, onExteriorAnalyzed }) {
  const [selectedZone, setSelectedZone] = useState(null);
  const [pendingZonePhotos, setPendingZonePhotos] = useState([]);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const zoneFileInputRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [camError, setCamError] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [zoneSaving, setZoneSaving] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const [remoteHost, setRemoteHost] = useState(() => {
    try {
      const s = sessionStorage.getItem('aeromindRemoteCaptureHost');
      if (s) return s;
    } catch (_) {
      /* ignore */
    }
    if (typeof window === 'undefined') return '';
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' ? '' : h;
  });
  const [remotePort, setRemotePort] = useState(() => defaultRemoteCapturePort());
  const [remoteCopied, setRemoteCopied] = useState(false);
  const [removingZonePhotoId, setRemovingZonePhotoId] = useState(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);
  const removeZoneInFlight = useRef(false);

  const persistRemoteHost = (v) => {
    setRemoteHost(v);
    try {
      sessionStorage.setItem('aeromindRemoteCaptureHost', v);
    } catch (_) {
      /* ignore */
    }
  };

  useEffect(() => {
    let mediaStream;
    (async () => {
      const blocked = cameraUnavailableMessage();
      if (blocked) {
        setCamError(blocked);
        return;
      }
      try {
        mediaStream = await openCameraStream();
        setStream(mediaStream);
      } catch (e) {
        setCamError(cameraErrorMessage(e));
      }
    })();
    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) {
      el.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    setPendingZonePhotos([]);
  }, [aircraft?.tailNumber]);

  useEffect(() => {
    const serverIds = new Set();
    (cameraData?.exterior_zone_photos || []).forEach((g) => {
      (g.photos || []).forEach((p) => {
        if (p?.id) serverIds.add(p.id);
      });
    });
    setPendingZonePhotos((prev) => prev.filter((p) => !serverIds.has(p.id)));
  }, [cameraData]);

  const photosByZone = useMemo(() => {
    const map = {};
    (cameraData?.exterior_zone_photos || []).forEach((g) => {
      map[g.zoneId] = [...(g.photos || [])];
    });
    pendingZonePhotos.forEach((p) => {
      if (!p.zoneId) return;
      if (!map[p.zoneId]) map[p.zoneId] = [];
      if (!map[p.zoneId].some((x) => x.id === p.id)) {
        map[p.zoneId].unshift(p);
      }
    });
    return map;
  }, [cameraData, pendingZonePhotos]);

  const removeZonePhoto = useCallback(
    async (p) => {
      if (!p?.id || !aircraft?.tailNumber) return;
      if (removeZoneInFlight.current) return;
      removeZoneInFlight.current = true;
      setLightbox((prev) => (prev && prev.url === p.imageUrl ? null : prev));
      setRemovingZonePhotoId(p.id);
      setAnalysisError(null);
      try {
        await deleteExteriorZonePhoto(aircraft.tailNumber, p.id);
        setPendingZonePhotos((prev) => prev.filter((x) => x.id !== p.id));
        onExteriorAnalyzed?.();
      } catch (e) {
        setAnalysisError(e?.message || String(e));
      } finally {
        removeZoneInFlight.current = false;
        setRemovingZonePhotoId(null);
      }
    },
    [aircraft?.tailNumber, onExteriorAnalyzed],
  );

  const analyzeAllPending = useCallback(async () => {
    if (!aircraft?.tailNumber) {
      setAnalysisError('Aircraft tail is not set.');
      return;
    }
    setAnalysisError(null);
    setLastResult(null);
    setAnalyzing(true);
    try {
      const ctx = buildAircraftContext(aircraft);
      const data = await analyzeAllPendingExterior(aircraft.tailNumber, {
        aircraftContext: ctx || undefined,
      });
      setLastResult(data);
      onExteriorAnalyzed?.();
    } catch (e) {
      setAnalysisError(e?.message || String(e));
    } finally {
      setAnalyzing(false);
    }
  }, [aircraft, onExteriorAnalyzed]);

  const runAnalysisOnBlob = useCallback(
    async (blob) => {
      setAnalysisError(null);
      setLastResult(null);
      setAnalyzing(true);
      try {
        const ctx = buildAircraftContext(aircraft);
        const data = await analyzeExteriorImage(blob, {
          aircraftContext: ctx || undefined,
          aircraftTail: aircraft?.tailNumber || undefined,
          zoneId: selectedZone || undefined,
        });
        setLastResult(data);
        const zc = data?.zone_capture;
        if (zc?.id && zc.zone_id) {
          setPendingZonePhotos((prev) => {
            const f0 = data?.per_frame?.[0];
            const row = {
              id: zc.id,
              zoneId: zc.zone_id,
              capturedAt: zc.captured_at,
              imageUrl: zc.image_url,
              ...(f0
                ? {
                    inspection: {
                      issueType: f0.issue_type,
                      confidence: f0.confidence,
                      flagged: f0.flagged,
                      notes: f0.notes || null,
                    },
                  }
                : {}),
            };
            return [row, ...prev.filter((p) => p.id !== row.id)];
          });
        }
        onExteriorAnalyzed?.();
      } catch (e) {
        setAnalysisError(e?.message || String(e));
      } finally {
        setAnalyzing(false);
      }
    },
    [aircraft, onExteriorAnalyzed, selectedZone],
  );

  const saveBlobToZoneOnly = useCallback(
    async (blob) => {
      if (!aircraft?.tailNumber || !selectedZone) {
        setAnalysisError('Select an inspection zone first.');
        return;
      }
      setAnalysisError(null);
      setZoneSaving(true);
      try {
        const res = await postExteriorZonePhoto(aircraft.tailNumber, selectedZone, blob);
        if (res?.capture?.id && res.capture.zoneId) {
          const c = res.capture;
          setPendingZonePhotos((prev) => {
            const row = {
              id: c.id,
              zoneId: c.zoneId,
              capturedAt: c.capturedAt,
              imageUrl: c.imageUrl,
            };
            return [row, ...prev.filter((p) => p.id !== row.id)];
          });
        }
        onExteriorAnalyzed?.();
      } catch (e) {
        setAnalysisError(e?.message || String(e));
      } finally {
        setZoneSaving(false);
      }
    },
    [aircraft?.tailNumber, onExteriorAnalyzed, selectedZone],
  );

  const analyzeFromVideo = useCallback(() => {
    analyzeAllPending();
  }, [analyzeAllPending]);

  const captureToZoneNoAi = useCallback(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) {
      setAnalysisError('Video not ready.');
      return;
    }
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        if (!blob) setAnalysisError('Could not encode image from preview.');
        else saveBlobToZoneOnly(blob);
      },
      'image/jpeg',
      0.92,
    );
  }, [saveBlobToZoneOnly]);

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !f.type.startsWith('image/')) return;
    runAnalysisOnBlob(f);
  };

  const onPickZoneFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !f.type.startsWith('image/')) return;
    saveBlobToZoneOnly(f);
  };

  const remoteParams = {
    ...(aircraft?.tailNumber && { tail: String(aircraft.tailNumber) }),
    ...(aircraft?.name && { name: String(aircraft.name) }),
    ...(aircraft?.bayLocation && { bay: String(aircraft.bayLocation) }),
    ...(aircraft?.route && { route: String(aircraft.route) }),
    ...(selectedZone && { zone_id: selectedZone }),
  };

  const remoteUrl =
    typeof window !== 'undefined' && remoteHost.trim()
      ? buildRemoteCaptureUrl({
          host: remoteHost.trim(),
          port: (remotePort.trim() || defaultRemoteCapturePort()).replace(/^:/, ''),
          protocol: window.location.protocol,
          params: remoteParams,
        })
      : '';

  const copyRemoteUrl = () => {
    if (!remoteUrl) return;
    navigator.clipboard.writeText(remoteUrl).then(
      () => {
        setRemoteCopied(true);
        window.setTimeout(() => setRemoteCopied(false), 2000);
      },
      () => {},
    );
  };

  const nFrames = lastResult?.per_frame?.length ?? 0;
  const bestFrame = useMemo(() => {
    if (!lastResult?.per_frame?.length) return null;
    return lastResult.per_frame.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  }, [lastResult]);

  if (!cameraData) return <div className="empty-state">Loading camera / inspection zones…</div>;

  const { cameraStatus, zones } = cameraData;
  const activeZone = selectedZone ? zones.find((z) => z.id === selectedZone) : null;
  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const zoneBusy = analyzing || zoneSaving;

  return (
    <div className="fade-in">
      <PhotoLightbox
        url={lightbox?.url}
        inspection={lightbox?.inspection}
        zoneName={lightbox?.zoneName}
        tail={aircraft?.tailNumber}
        onWorkOrderCreated={onExteriorAnalyzed}
        onClose={() => setLightbox(null)}
      />
      <ConfirmDialog
        open={!!deleteConfirmTarget}
        title="Remove this image?"
        message="It will be removed from this zone. The file will be deleted if it is not used by another zone capture."
        confirmText="Remove"
        onCancel={() => setDeleteConfirmTarget(null)}
        onConfirm={() => {
          const p = deleteConfirmTarget;
          setDeleteConfirmTarget(null);
          if (p) void removeZonePhoto(p);
        }}
      />

      <div className="camera-status">
        <div className="cam-stat">
          <div className="cam-stat-label">Battery</div>
          <div className="cam-stat-value" style={{ color: 'var(--green)' }}>{cameraStatus.battery}</div>
        </div>
        <div className="cam-stat">
          <div className="cam-stat-label">Signal</div>
          <div className="cam-stat-value" style={{ color: 'var(--green)' }}>{cameraStatus.signal}</div>
        </div>
        <div className="cam-stat">
          <div className="cam-stat-label">Gyro</div>
          <div className="cam-stat-value" style={{ color: 'var(--teal)' }}>{cameraStatus.gyroAlignment}</div>
        </div>
        <div className="cam-stat">
          <div className="cam-stat-label">Mode</div>
          <div className="cam-stat-value" style={{ color: 'var(--blue)' }}>{cameraStatus.mode}</div>
        </div>
      </div>

      <details className="remote-camera-details">
        <summary>Phone / remote camera (same Wi‑Fi)</summary>
        <div className="remote-camera-body">
          <p className="remote-camera-help">
            Open the link on your phone’s browser. Use the <strong>https://</strong> URL from the dev
            server (Vite uses a local certificate — accept the warning once on each device). Plain{' '}
            <code>http://192.168…</code> will not expose the camera on the phone.
          </p>
          {isLocalhost && (
            <p className="remote-camera-warn">
              You are on <strong>localhost</strong> — enter this computer’s LAN IPv4 (e.g. from{' '}
              <code>ipconfig</code>) so the phone can open the URL.
            </p>
          )}
          <label className="remote-camera-label">Station host (IPv4 or hostname)</label>
          <input
            className="remote-camera-input"
            type="text"
            placeholder="192.168.x.x"
            value={remoteHost}
            onChange={(e) => persistRemoteHost(e.target.value)}
            autoComplete="off"
          />
          <label className="remote-camera-label">Web app port</label>
          <input
            className="remote-camera-input"
            type="text"
            placeholder={isLocalhost ? '5173' : 'leave empty for default (443)'}
            value={remotePort}
            onChange={(e) => setRemotePort(e.target.value)}
          />
          {remoteUrl ? (
            <>
              <div className="remote-camera-url" title={remoteUrl}>{remoteUrl}</div>
              <div className="remote-camera-actions">
                <button type="button" className="cam-btn active" onClick={copyRemoteUrl}>
                  {remoteCopied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <div className="remote-camera-qr-wrap">
                <span className="remote-camera-qr-note">Scan (requires internet for QR image)</span>
                <img
                  className="remote-camera-qr"
                  width={180}
                  height={180}
                  alt="QR code linking to remote capture URL"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(remoteUrl)}`}
                />
              </div>
            </>
          ) : (
            <p className="remote-camera-muted">Enter a host above to build the phone link.</p>
          )}
        </div>
      </details>

      <p className="cam-zone-hint">
        <strong>Capture</strong> saves the current frame to the selected zone.{' '}
        <strong>Analyze (unreviewed captures)</strong> runs Gemini on every zone-saved image for {aircraft?.tailNumber || 'this aircraft'} that
        has no analysis yet (unreviewed). Use <strong>Upload (analyze)</strong> to analyze a single new file.
      </p>

      <div className="camera-viewer">
        <div className="camera-feed" style={{ padding: 0, background: '#0a0c12' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: stream ? 'block' : 'none',
            }}
          />
          {!stream && (
            <div className="empty-state" style={{ minHeight: 280, border: 'none' }}>
              {camError || 'Starting camera…'}
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="camera-overlay">
            <span>LIVE · {activeZone ? activeZone.name : 'EXTERIOR CAPTURE'}</span>
            <span>{aircraft?.tailNumber || '—'} · Gemini exterior check</span>
          </div>
          <div className="camera-overlay-right">
            <span>{activeZone ? `${activeZone.findings} zone findings` : '—'}</span>
          </div>
        </div>
        <div className="camera-controls camera-controls-wrap">
          <button
            type="button"
            className="cam-btn active"
            disabled={zoneBusy || !stream || !selectedZone}
            onClick={captureToZoneNoAi}
            title={!selectedZone ? 'Select a zone first' : undefined}
          >
            {zoneSaving ? 'Saving…' : 'Capture'}
          </button>
          <button
            type="button"
            className="cam-btn cam-btn-analyze-unreviewed"
            disabled={zoneBusy || !aircraft?.tailNumber}
            onClick={analyzeFromVideo}
            title={
              !aircraft?.tailNumber
                ? 'Aircraft not loaded'
                : 'Run Gemini on every unreviewed zone-saved photo for this tail (batches of up to 50; run again if more remain).'
            }
          >
            {analyzing ? 'Analyzing…' : 'Analyze (unreviewed captures)'}
          </button>
          <button
            type="button"
            className="cam-btn"
            disabled={zoneBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload (analyze)
          </button>
          <button
            type="button"
            className="cam-btn"
            disabled={zoneBusy || !selectedZone}
            onClick={() => zoneFileInputRef.current?.click()}
            title={!selectedZone ? 'Select a zone first' : undefined}
          >
            Upload (save to zone)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onPickFile}
          />
          <input
            ref={zoneFileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onPickZoneFile}
          />
        </div>
      </div>

      {(analysisError || lastResult) && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {analysisError && (
            <div style={{ color: 'var(--red)', marginBottom: 8 }}>{analysisError}</div>
          )}
          {lastResult && !analysisError && nFrames === 0 && lastResult.message && (
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{lastResult.message}</div>
          )}
          {lastResult && !analysisError && nFrames > 0 && bestFrame && (
            <>
              <div className="section-title" style={{ marginTop: 0 }}>Gemini exterior assessment</div>
              {nFrames > 1 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                  {nFrames} image(s) analyzed — details below are for the highest-confidence frame.
                </div>
              )}
              {lastResult.message && (
                <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8, lineHeight: 1.45 }}>{lastResult.message}</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
                Issue: <strong style={{ color: 'var(--text)' }}>{lastResult.summary_issue_type}</strong>
                {' · '}
                Confidence: {(lastResult.summary_confidence * 100).toFixed(0)}%
                {lastResult.flagged && (
                  <span style={{ color: 'var(--amber)', marginLeft: 8 }}>Flagged for review</span>
                )}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{bestFrame.notes}</div>
            </>
          )}
        </div>
      )}

      <div className="section-title">Inspection zones</div>
      <div className="camera-zones">
        {zones.map((zone) => {
          const zPhotos = photosByZone[zone.id] || [];
          return (
            <div
              key={zone.id}
              className={`cam-zone zone-${zone.status}${selectedZone === zone.id ? ' active' : ''}`}
              style={selectedZone === zone.id ? { boxShadow: '0 0 0 2px var(--blue)', borderColor: 'var(--blue-border)' } : {}}
            >
              <button
                type="button"
                className="cam-zone-select-hit"
                onClick={() => setSelectedZone(zone.id)}
              >
                <div className="cam-zone-name">{zone.name}</div>
                <div className="cam-zone-desc">{zone.description}</div>
                <div className="cam-zone-meta">
                  <span>Last: {zone.lastInspected}</span>
                  {zone.findings > 0 && (
                    <span className="cam-zone-findings has-findings">{zone.findings} findings</span>
                  )}
                </div>
              </button>
              {zPhotos.length > 0 && (
                <div className="cam-zone-photos">
                  {zPhotos.map((p) => (
                    <div className="cam-zone-photo-item" key={p.id || p.imageUrl}>
                      <div className="cam-zone-thumb-wrap">
                        <button
                          type="button"
                          className="cam-zone-thumb"
                          onClick={() =>
                            setLightbox({
                              url: p.imageUrl,
                              inspection: p.inspection ?? null,
                              zoneName: zone.name,
                            })
                          }
                        >
                          <img src={p.imageUrl} alt="" loading="lazy" />
                        </button>
                        {p.id ? (
                          <button
                            type="button"
                            className="zone-photo-remove"
                            title="Remove image"
                            disabled={removingZonePhotoId === p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmTarget(p);
                            }}
                            aria-label="Remove image"
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                      <ZonePhotoCaption inspection={p.inspection} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

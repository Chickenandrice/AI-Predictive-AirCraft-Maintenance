import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createWorkOrder,
  fetchAircraft,
  fetchCamera,
  fetchFleet,
  fetchInspections,
  postExteriorZonePhoto,
  toggleInspectionItem,
} from '../api';
import {
  buildAircraftContext,
  cameraErrorMessage,
  cameraUnavailableMessage,
  openCameraStream,
} from '../lib/exteriorCamera';

/**
 * Phone-only field page: /remote-capture?tail=…&zone_id=…
 * — zone capture to the station API and ground walk-around checklist (analysis runs on the station).
 */
export default function RemoteCapture() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTail = (searchParams.get('tail') || '').trim();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [camError, setCamError] = useState(null);
  const [zoneSaving, setZoneSaving] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [lastOk, setLastOk] = useState(null);

  const [fleet, setFleet] = useState([]);
  const [fleetLoading, setFleetLoading] = useState(true);
  const [fleetError, setFleetError] = useState(null);

  const [zones, setZones] = useState([]);
  const [zonesError, setZonesError] = useState(null);
  const [loadingZones, setLoadingZones] = useState(false);
  const [acDetail, setAcDetail] = useState(null);

  const [selectedZone, setSelectedZone] = useState(() =>
    (searchParams.get('zone_id') || '').trim(),
  );

  const [woTitle, setWoTitle] = useState('');
  const [woType, setWoType] = useState('Corrective');
  const [woPriority, setWoPriority] = useState('medium');
  const [woDays, setWoDays] = useState(7);
  const [woError, setWoError] = useState(null);
  const [woSubmitting, setWoSubmitting] = useState(false);
  const [woSuccess, setWoSuccess] = useState(null);

  const [inspections, setInspections] = useState(null);
  const [inspLoading, setInspLoading] = useState(false);
  const [inspError, setInspError] = useState(null);
  const [togglingInspId, setTogglingInspId] = useState(null);
  const inspToggleBusy = useRef(false);

  const changeAircraft = useCallback(
    (tail) => {
      const next = new URLSearchParams(searchParams);
      if (tail) next.set('tail', tail);
      else next.delete('tail');
      next.delete('zone_id');
      setSearchParams(next, { replace: true });
      setSelectedZone('');
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    let cancelled = false;
    setFleetLoading(true);
    setFleetError(null);
    fetchFleet()
      .then((rows) => {
        if (!cancelled) setFleet(Array.isArray(rows) ? rows : []);
      })
      .catch((e) => {
        if (!cancelled) setFleetError(e?.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setFleetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) el.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!activeTail) {
      setZones([]);
      setZonesError(null);
      setLoadingZones(false);
      setAcDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingZones(true);
    setZonesError(null);
    Promise.all([fetchCamera(activeTail), fetchAircraft(activeTail)])
      .then(([cam, ac]) => {
        if (cancelled) return;
        setZones(Array.isArray(cam?.zones) ? cam.zones : []);
        setAcDetail(ac && ac.tailNumber ? ac : null);
      })
      .catch((e) => {
        if (!cancelled) setZonesError(e?.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingZones(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTail]);

  useEffect(() => {
    if (!selectedZone || !zones.length) return;
    if (!zones.some((z) => z.id === selectedZone)) setSelectedZone('');
  }, [zones, selectedZone]);

  const aircraftContext = useMemo(() => {
    if (acDetail) return buildAircraftContext(acDetail);
    const row = fleet.find((f) => f.tailNumber === activeTail);
    if (row) {
      return buildAircraftContext({
        tailNumber: row.tailNumber,
        name: row.name,
        bayLocation: row.bayLocation,
        route: row.route,
      });
    }
    return '';
  }, [acDetail, fleet, activeTail]);

  const refreshAircraftDetail = useCallback(() => {
    if (!activeTail) return;
    fetchAircraft(activeTail)
      .then((ac) => setAcDetail(ac && ac.tailNumber ? ac : null))
      .catch(() => {});
  }, [activeTail]);

  useEffect(() => {
    if (!activeTail) {
      setInspections(null);
      setInspError(null);
      return;
    }
    let cancelled = false;
    setInspLoading(true);
    setInspError(null);
    fetchInspections(activeTail)
      .then((data) => {
        if (!cancelled) setInspections(Array.isArray(data?.checklist) ? data.checklist : []);
      })
      .catch((e) => {
        if (!cancelled) setInspError(e?.message || String(e));
      })
      .finally(() => {
        if (!cancelled) setInspLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTail]);

  const handleInspToggle = useCallback(
    async (itemId) => {
      if (!activeTail || inspToggleBusy.current) return;
      inspToggleBusy.current = true;
      setTogglingInspId(itemId);
      setInspError(null);
      try {
        await toggleInspectionItem(activeTail, itemId, null);
        const data = await fetchInspections(activeTail);
        setInspections(Array.isArray(data?.checklist) ? data.checklist : []);
      } catch (e) {
        setInspError(e?.message || String(e));
      } finally {
        setTogglingInspId(null);
        inspToggleBusy.current = false;
      }
    },
    [activeTail],
  );

  const saveBlobToZone = useCallback(
    async (blob) => {
      if (!activeTail || !selectedZone) {
        setAnalysisError('Select an inspection zone before saving a capture.');
        return;
      }
      setAnalysisError(null);
      setLastOk(null);
      setZoneSaving(true);
      try {
        await postExteriorZonePhoto(activeTail, selectedZone, blob);
        setLastOk('capture');
      } catch (e) {
        setAnalysisError(e?.message || String(e));
      } finally {
        setZoneSaving(false);
      }
    },
    [activeTail, selectedZone],
  );

  const grabFrameBlob = useCallback((onBlob) => {
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
        if (!blob) setAnalysisError('Could not encode image.');
        else onBlob(blob);
      },
      'image/jpeg',
      0.92,
    );
  }, []);

  const captureFromVideo = useCallback(() => {
    grabFrameBlob((blob) => saveBlobToZone(blob));
  }, [grabFrameBlob, saveBlobToZone]);

  const handleAddWorkOrder = async (e) => {
    e.preventDefault();
    if (!activeTail) {
      setWoError('Select an aircraft first.');
      return;
    }
    if (!woTitle.trim()) {
      setWoError('Enter a title for the work order.');
      return;
    }
    setWoSubmitting(true);
    setWoError(null);
    setWoSuccess(null);
    try {
      await createWorkOrder(activeTail, {
        title: woTitle.trim(),
        type: woType,
        priority: woPriority,
        days: Number(woDays) || 7,
      });
      setWoTitle('');
      setWoType('Corrective');
      setWoPriority('medium');
      setWoDays(7);
      setWoSuccess('Work order added. It appears on the station for this tail.');
      refreshAircraftDetail();
    } catch (err) {
      setWoError(err?.message || String(err));
    } finally {
      setWoSubmitting(false);
    }
  };

  const zoneBusy = zoneSaving;
  const activeZone = selectedZone ? zones.find((z) => z.id === selectedZone) : null;
  const workOrders = Array.isArray(acDetail?.workOrders) ? acDetail.workOrders : [];

  const inspProgress = useMemo(() => {
    if (!inspections || inspections.length === 0) {
      return { total: 0, completed: 0, passed: 0, failed: 0, skipped: 0, pct: 0 };
    }
    let total = 0;
    let completed = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    inspections.forEach((zone) => {
      (zone.items || []).forEach((it) => {
        total += 1;
        if (it.status !== 'pending') completed += 1;
        if (it.status === 'pass') passed += 1;
        if (it.status === 'fail') failed += 1;
        if (it.status === 'skip') skipped += 1;
      });
    });
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, passed, failed, skipped, pct };
  }, [inspections]);

  const checkLabel = { pending: '', pass: '✓', fail: '✕', skip: '—' };
  const statusLabel = { pending: 'PENDING', pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };
  const statusColor = { pending: 'var(--muted)', pass: 'var(--green)', fail: 'var(--red)', skip: 'var(--amber)' };

  return (
    <div className="remote-capture-page">
      <div className="remote-capture-head">
        <div>
          <div className="remote-capture-title">Exterior & walk-around (phone)</div>
          <p className="remote-capture-tagline">
            Zone photos to the station and ground checklist — same Wi‑Fi as the station · use HTTPS
          </p>
        </div>
      </div>

      {fleetLoading && (
        <p className="remote-capture-muted" style={{ marginTop: 12 }}>Loading fleet…</p>
      )}
      {fleetError && (
        <div className="remote-capture-banner remote-capture-error" style={{ marginTop: 12 }}>
          {fleetError}
        </div>
      )}
      {!fleetLoading && !fleetError && fleet.length === 0 && (
        <div className="remote-capture-banner remote-capture-error" style={{ marginTop: 12 }}>
          No aircraft in fleet. Add data on the station, then reload this page.
        </div>
      )}

      {!fleetLoading && !fleetError && fleet.length > 0 && (
        <div className="remote-capture-zone-block">
          <label className="remote-capture-label" htmlFor="remote-aircraft-select">
            Aircraft
          </label>
          <select
            id="remote-aircraft-select"
            className="remote-capture-select"
            value={activeTail}
            onChange={(e) => changeAircraft(e.target.value)}
          >
            <option value="">Select aircraft…</option>
            {fleet.map((row) => (
              <option key={row.tailNumber} value={row.tailNumber}>
                {row.tailNumber} — {row.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {aircraftContext && (
        <div className="remote-capture-context">{aircraftContext}</div>
      )}

      {activeTail && (
        <details className="remote-capture-wo-details remote-capture-insp-details" open style={{ marginTop: 12 }}>
          <summary>Ground inspection (walk-around)</summary>
          <div className="remote-capture-wo-body">
            {inspLoading && <p className="remote-capture-muted" style={{ marginTop: 0 }}>Loading checklist…</p>}
            {inspError && (
              <div className="remote-capture-banner remote-capture-error" style={{ marginTop: inspLoading ? 8 : 0 }}>
                {inspError}
              </div>
            )}
            {!inspLoading && !inspError && (!inspections || inspections.length === 0) && (
              <p className="remote-capture-muted" style={{ marginTop: 0 }}>
                No walk-around checklist for this tail.
              </p>
            )}
            {!inspLoading && inspections && inspections.length > 0 && (
              <>
                <p className="remote-capture-muted" style={{ marginTop: 0, lineHeight: 1.45 }}>
                  Tap a line to cycle status (pending → pass → fail → skip). Same data as the station.
                </p>
                <div className="inspection-progress" style={{ marginTop: 10 }}>
                  <div className="inspection-progress-label">Progress</div>
                  <div className="inspection-progress-bar">
                    <div
                      className="inspection-progress-fill"
                      style={{ width: `${inspProgress.pct}%` }}
                    />
                  </div>
                  <div className="inspection-stats" style={{ flexWrap: 'wrap' }}>
                    <div className="inspection-stat">
                      <span className="inspection-stat-dot" style={{ background: 'var(--blue)' }} />
                      {inspProgress.completed}/{inspProgress.total} done ({inspProgress.pct}%)
                    </div>
                    <div className="inspection-stat">
                      <span className="inspection-stat-dot" style={{ background: 'var(--green)' }} />
                      {inspProgress.passed} pass
                    </div>
                    <div className="inspection-stat">
                      <span className="inspection-stat-dot" style={{ background: 'var(--red)' }} />
                      {inspProgress.failed} fail
                    </div>
                    <div className="inspection-stat">
                      <span className="inspection-stat-dot" style={{ background: 'var(--amber)' }} />
                      {inspProgress.skipped} skip
                    </div>
                  </div>
                </div>
                {inspections.map((zone, zi) => {
                  const zdone = (zone.items || []).filter((it) => it.status !== 'pending').length;
                  return (
                    <div className="inspection-zone" key={`${zone.zone ?? 'z'}-${zi}`} style={{ marginTop: 10 }}>
                      <div className="inspection-zone-header">
                        <span>{zone.zone}</span>
                        <span className="inspection-zone-count">
                          {zdone}/{zone.items?.length ?? 0}
                        </span>
                      </div>
                      <div className="inspection-items">
                        {(zone.items || []).map((item) => {
                          const st = item.status || 'pending';
                          const ro = Boolean(item.readOnly);
                          return (
                            <div
                              className={`insp-item${ro ? ' insp-item-readonly' : ''}`}
                              key={item.id}
                              onClick={() => {
                                if (!ro && !togglingInspId) void handleInspToggle(item.id);
                              }}
                              role={ro ? undefined : 'button'}
                            >
                              <button
                                type="button"
                                className={`insp-check ${st}`}
                                disabled={ro || togglingInspId === item.id}
                              >
                                {togglingInspId === item.id ? '…' : (checkLabel[st] ?? '')}
                              </button>
                              <span className="insp-task">
                                {ro && <span className="insp-ai-badge">AI</span>}
                                {item.task}
                              </span>
                              <span
                                className="insp-status-label"
                                style={{ color: statusColor[st] || 'var(--muted)' }}
                              >
                                {statusLabel[st] ?? st}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </details>
      )}

      {activeTail && (
        <div className="remote-capture-zone-block">
          <label className="remote-capture-label" htmlFor="remote-zone-select">
            Inspection zone
          </label>
          {loadingZones && (
            <p className="remote-capture-muted" style={{ marginTop: 4 }}>Loading zones…</p>
          )}
          {zonesError && (
            <div className="remote-capture-banner remote-capture-error" style={{ marginTop: 8 }}>
              {zonesError}
            </div>
          )}
          {!loadingZones && !zonesError && zones.length > 0 && (
            <select
              id="remote-zone-select"
              className="remote-capture-select"
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
            >
              <option value="">— Select zone —</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          )}
          {!loadingZones && !zonesError && zones.length === 0 && (
            <p className="remote-capture-muted" style={{ marginTop: 4 }}>No camera zones for this tail.</p>
          )}
          <p className="remote-capture-muted" style={{ marginTop: 8, lineHeight: 1.45 }}>
            <strong>Capture</strong> saves the current frame to the selected zone. Run analysis from the station PC if needed.
          </p>
        </div>
      )}

      <div className="camera-viewer" style={{ marginTop: 12 }}>
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
          {stream && activeTail && (
            <div className="camera-overlay" style={{ fontSize: 10 }}>
              <span>{activeZone ? activeZone.name : 'Zone not set'}</span>
              <span>{activeTail}</span>
            </div>
          )}
        </div>
        <div className="camera-controls" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="cam-btn active"
            disabled={zoneBusy || !stream || !activeTail || !selectedZone}
            onClick={captureFromVideo}
          >
            {zoneSaving ? 'Saving…' : 'Capture'}
          </button>
        </div>
      </div>

      {activeTail && (
        <details className="remote-capture-wo-details" style={{ marginTop: 16 }}>
          <summary>Work orders</summary>
          <div className="remote-capture-wo-body">
            <div className="section-title" style={{ marginTop: 0, fontSize: 11 }}>New work order</div>
            <form className="wo-add-form" onSubmit={handleAddWorkOrder}>
              <input
                className="wo-add-input wo-add-title"
                type="text"
                placeholder="Title (e.g. Dent repair — left wing)"
                value={woTitle}
                onChange={(e) => setWoTitle(e.target.value)}
                maxLength={220}
                autoComplete="off"
              />
              <div className="wo-add-row">
                <select
                  className="wo-add-select"
                  value={woType}
                  onChange={(e) => setWoType(e.target.value)}
                  aria-label="Work order type"
                >
                  <option value="Inspection">Inspection</option>
                  <option value="Corrective">Corrective</option>
                  <option value="Scheduled">Scheduled</option>
                  <option value="Deferred">Deferred</option>
                </select>
                <select
                  className="wo-add-select"
                  value={woPriority}
                  onChange={(e) => setWoPriority(e.target.value)}
                  aria-label="Priority"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <label className="wo-add-days-label">
                  <span className="wo-add-days-text">Due in</span>
                  <input
                    className="wo-add-days"
                    type="number"
                    min={1}
                    max={365}
                    value={woDays}
                    onChange={(e) => setWoDays(Number(e.target.value))}
                  />
                  <span className="wo-add-days-text">days</span>
                </label>
              </div>
              {woError && <div className="wo-add-error">{woError}</div>}
              {woSuccess && (
                <div className="remote-capture-banner remote-capture-ok" style={{ marginTop: 8 }}>
                  {woSuccess}
                </div>
              )}
              <button type="submit" className="wo-add-submit" disabled={woSubmitting}>
                {woSubmitting ? 'Adding…' : 'Add work order'}
              </button>
            </form>

            {workOrders.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 16, fontSize: 11 }}>Open on this tail</div>
                <ul className="remote-capture-wo-list">
                  {workOrders.map((wo, i) => (
                    <li key={i} className="remote-capture-wo-li">
                      <span className="remote-capture-wo-li-title">{wo.title}</span>
                      <span className="remote-capture-wo-li-meta">
                        {wo.type} · {String(wo.priority || '').toUpperCase()} · +{wo.days}d
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      )}

      {analysisError && (
        <div className="remote-capture-banner remote-capture-error" style={{ marginTop: 12 }}>{analysisError}</div>
      )}
      {lastOk === 'capture' && !analysisError && (
        <div className="remote-capture-banner remote-capture-ok" style={{ marginTop: 12 }}>
          Photo saved to the zone. It appears under that zone on Exterior capture and Ground Inspection.
        </div>
      )}
    </div>
  );
}

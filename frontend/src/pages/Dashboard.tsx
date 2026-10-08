import { useState, useEffect, useCallback } from 'react';
import { StatCard } from '../components/StatCard';
import { DeviceTable } from '../components/DeviceTable';
import { createScan, getScanHistory } from '../api/scans';
import { getDevices } from '../api/devices';
import type { Host, ScanHistoryItem, ScanResult } from '../types/scan.types';
import type { Device } from '../types/device.types';
import { ApiError } from '../errors/apiErrors';

function toScanResult(item: ScanHistoryItem): ScanResult {
  return {
    target: item.target,
    hosts: item.hosts ?? [],
    total_hosts: item.total_hosts,
    duration_seconds: item.duration_seconds,
    scanned_at: item.scanned_at,
  };
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Fecha desconocida';
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 45) return 'hace un momento';
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours === 1 ? 'hace 1h' : `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function hostIdentity(host: Host): string {
  return (host.mac || host.ip || '').toLowerCase();
}

function compareHosts(current: Host[], previous: Host[]) {
  const cur = new Set(current.map(hostIdentity).filter(Boolean));
  const prev = new Set(previous.map(hostIdentity).filter(Boolean));
  let added = 0;
  let removed = 0;
  cur.forEach((key) => {
    if (!prev.has(key)) added += 1;
  });
  prev.forEach((key) => {
    if (!cur.has(key)) removed += 1;
  });
  return { added, removed };
}

function computeRisk(devices: Device[]) {
  const present = devices.filter((d) => d.is_present);
  const newUntrusted = present.filter((d) => d.is_new && !d.trusted);
  const untrusted = present.filter((d) => !d.trusted);

  if (present.length === 0) {
    return {
      level: 'Bajo',
      accent: 'green' as const,
      subtitle: 'No hay dispositivos en la red',
    };
  }
  if (newUntrusted.length > 0) {
    return {
      level: 'Alto',
      accent: 'red' as const,
      subtitle: `${newUntrusted.length} nuevo${newUntrusted.length === 1 ? '' : 's'} sin marcar como confiable`,
    };
  }
  if (untrusted.length > 0) {
    return {
      level: 'Medio',
      accent: 'amber' as const,
      subtitle: `${untrusted.length} presente${untrusted.length === 1 ? '' : 's'} aún no confiables`,
    };
  }
  return {
    level: 'Bajo',
    accent: 'green' as const,
    subtitle: 'Todos los presentes están marcados como confiables',
  };
}

const iconClass = 'w-5 h-5';

function IconWifi() {
  return (
    <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5l-2 2m-7 7l-2 2m11 0l-2-2m-7-7l-2-2" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3l8 4v5c0 5-3.4 9.4-8 10.5C7.4 21.4 4 17 4 12V7l8-4z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconSwap() {
  return (
    <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

const SCAN_STAGES = ['Iniciando', 'Escaneando', 'Analizando', 'Listo'] as const;

function scanMessage(progress: number): string {
  if (progress < 20) return 'Iniciando escaneo...';
  if (progress < 40) return 'Detectando dispositivos...';
  if (progress < 60) return 'Obteniendo información...';
  if (progress < 80) return 'Analizando fabricantes...';
  if (progress < 95) return 'Finalizando...';
  return '¡Casi listo!';
}

function scanStageIndex(progress: number): number {
  if (progress < 20) return 0;
  if (progress < 60) return 1;
  if (progress < 100) return 2;
  return 3;
}

function ScanProgressOverlay({ progress }: { progress: number }) {
  const shown = Math.round(Math.min(100, Math.max(0, progress)));
  const size = 160;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (shown / 100) * circumference;
  const stage = scanStageIndex(shown);

  return (
    <div className="fixed inset-0 bg-surface/85 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-surface-light border border-surface-border rounded-2xl p-8 text-center max-w-sm w-full mx-4 shadow-2xl">
        <div className="relative w-40 h-40 mx-auto mb-6">
          <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              className="text-surface-border"
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              className="text-primary transition-[stroke-dashoffset] duration-200 ease-out"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-bold text-white tabular-nums">{shown}</span>
            <span className="text-sm text-muted">%</span>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-white mb-1">{scanMessage(shown)}</h3>
        <p className="text-sm text-muted mb-5">Esto puede tardar unos segundos. Por favor espera.</p>

        <div className="w-full h-1.5 bg-surface-border rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-primary rounded-full transition-all duration-200 ease-out"
            style={{ width: `${shown}%` }}
          />
        </div>

        <div className="grid grid-cols-4 gap-1">
          {SCAN_STAGES.map((label, i) => (
            <div key={label} className="flex flex-col items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  i < stage ? 'bg-success' : i === stage ? 'bg-primary' : 'bg-surface-border'
                }`}
              />
              <span
                className={`text-[10px] font-medium ${
                  i === stage ? 'text-primary' : i < stage ? 'text-success' : 'text-muted'
                }`}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [resultado, setResultado] = useState<ScanResult | null>(null);
  const [anterior, setAnterior] = useState<ScanHistoryItem | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [redDisponible, setRedDisponible] = useState(() => navigator.onLine);
  const [cargandoDatos, setCargandoDatos] = useState(() => navigator.onLine);
  const [cargando, setCargando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, setNow] = useState(() => Date.now());

  const aplicarHistorial = useCallback((historial: ScanHistoryItem[]) => {
    if (historial.length > 0) {
      setResultado(toScanResult(historial[0]));
      setAnterior(historial[1] ?? null);
    }
  }, []);

  const cargarDashboard = useCallback(async () => {
    try {
      const [historial, inventario] = await Promise.all([getScanHistory(), getDevices()]);
      aplicarHistorial(historial);
      setDevices(inventario);
      setError(null);
    } catch (err) {
      const mensaje = err instanceof ApiError ? err.message : 'Ocurrió un error inesperado';
      setError(mensaje);
      console.error('Error cargando dashboard:', err);
    } finally {
      setCargandoDatos(false);
    }
  }, [aplicarHistorial]);

  useEffect(() => {
    const actualizarEstadoDeRed = () => {
      const disponible = navigator.onLine;
      setRedDisponible(disponible);
      if (disponible) {
        setCargandoDatos(true);
        void cargarDashboard();
      } else {
        setCargandoDatos(false);
        setCargando(false);
        setProgreso(0);
      }
    };

    window.addEventListener('online', actualizarEstadoDeRed);
    window.addEventListener('offline', actualizarEstadoDeRed);
    const initialLoad = window.setTimeout(() => {
      if (navigator.onLine) void cargarDashboard();
    }, 0);

    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener('online', actualizarEstadoDeRed);
      window.removeEventListener('offline', actualizarEstadoDeRed);
    };
  }, [cargarDashboard]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!cargando) return;
    const id = window.setInterval(() => {
      setProgreso((actual) => {
        if (actual >= 95) return actual;
        const paso = actual < 20 ? 2.4 : actual < 40 ? 1.8 : actual < 60 ? 1.2 : actual < 80 ? 0.8 : 0.35;
        return Math.min(95, actual + paso);
      });
    }, 120);
    return () => window.clearInterval(id);
  }, [cargando]);

  const escanearRed = async () => {
    if (!navigator.onLine) {
      setRedDisponible(false);
      setError(null);
      return;
    }

    setCargando(true);
    setProgreso(0);
    setError(null);
    try {
      await createScan();
      const [historial, inventario] = await Promise.all([getScanHistory(), getDevices()]);
      aplicarHistorial(historial);
      setDevices(inventario);
      setProgreso(100);
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Ocurrió un error inesperado');
      }
      console.error(err);
    } finally {
      setCargando(false);
      setProgreso(0);
    }
  };

  const totalInventario = devices.length;
  const activosInventario = devices.filter((d) => d.is_present).length;
  const activosEscaneo = resultado
    ? resultado.hosts.filter((h) => h.status !== 'down').length
    : 0;
  const activos = totalInventario > 0 ? activosInventario : activosEscaneo;
  const totalActivos = totalInventario > 0 ? totalInventario : resultado?.total_hosts ?? 0;
  const nuevosHoy = devices.filter((d) => isToday(d.first_seen)).length;
  const confiables = devices.filter((d) => d.trusted).length;
  const confiablesPresentes = devices.filter((d) => d.trusted && d.is_present).length;
  const riesgo = computeRisk(devices);
  const cambios =
    resultado && anterior?.hosts
      ? compareHosts(resultado.hosts, anterior.hosts)
      : resultado && anterior
        ? {
            added: Math.max(0, resultado.total_hosts - anterior.total_hosts),
            removed: Math.max(0, anterior.total_hosts - resultado.total_hosts),
          }
        : null;

  const activosPct = totalActivos > 0 ? Math.round((activos / totalActivos) * 100) : 0;
  const activosAccent = activosPct === 100 ? 'green' : activosPct === 0 ? 'red' : 'amber';

  const lastScanAgeMin = resultado
    ? Math.floor(Math.max(0, Date.now() - new Date(resultado.scanned_at).getTime()) / 60_000)
    : Infinity;
  const lastScanAccent = lastScanAgeMin < 15 ? 'green' : lastScanAgeMin < 120 ? 'amber' : 'red';

  const cambiosValue = cambios
    ? cambios.added === 0 && cambios.removed === 0
      ? 'Sin cambios'
      : `+${cambios.added} / −${cambios.removed}`
    : '—';
  const cambiosAccent =
    !cambios || (cambios.added === 0 && cambios.removed === 0)
      ? 'green'
      : cambios.removed > cambios.added
        ? 'red'
        : 'amber';

  const confiablesAccent =
    totalInventario === 0 ? 'slate' : confiables === totalInventario ? 'green' : confiables === 0 ? 'red' : 'amber';

  if (!redDisponible) {
    return (
      <div className="flex min-h-full items-center justify-center bg-surface p-8">
        <div className="max-w-lg text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
            <IconWifi />
          </div>
          <h1 className="mb-3 text-2xl font-bold text-white">Conéctate a una red</h1>
          <p className="text-muted">
            NetGuard necesita una conexión de red activa para detectar dispositivos. Cuando te
            conectes, podrás iniciar el escaneo.
          </p>
        </div>
      </div>
    );
  }

  if (cargandoDatos) {
    return (
      <div className="flex min-h-full items-center justify-center bg-surface p-8">
        <p className="text-muted">Comprobando si hay escaneos guardados...</p>
      </div>
    );
  }

  if (!resultado) {
    return (
      <div className="flex min-h-full items-center justify-center bg-surface p-8">
        <div className="max-w-lg text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <IconWifi />
          </div>
          <h1 className="mb-3 text-2xl font-bold text-white">Aún no hay escaneos</h1>
          <p className="mb-6 text-muted">
            Conéctate a la red que quieres evaluar e inicia un escaneo para ver aquí los
            dispositivos detectados.
          </p>
          {error && (
            <div className="mb-6 rounded-lg border border-danger/30 bg-danger/10 p-4 text-left text-sm text-danger">
              {error}
            </div>
          )}
          <button
            onClick={escanearRed}
            disabled={cargando}
            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-border disabled:text-muted"
          >
            {cargando ? 'Escaneando...' : 'Iniciar primer escaneo'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 bg-surface min-h-full">
      {cargando && <ScanProgressOverlay progress={progreso} />}

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
          <p className="text-muted">Vista general del escaneo de red</p>
        </div>
        <button
          onClick={escanearRed}
          disabled={cargando}
          className={`px-6 py-3 rounded-lg font-medium text-sm transition-all ${
            cargando
              ? 'bg-surface-border text-muted cursor-not-allowed'
              : 'bg-primary hover:opacity-90 text-white'
          }`}
        >
          {cargando ? 'Escaneando...' : 'Iniciar escaneo'}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-danger/10 border border-danger/30 text-danger rounded-lg text-sm">
          {error}
        </div>
      )}

      {resultado && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 mb-8">
          <StatCard
            label="Dispositivos activos"
            value={`${activos} de ${totalActivos}`}
            icon={<IconWifi />}
            accent={activosAccent}
            subtitle={
              totalInventario > 0
                ? `${activosPct}% del inventario está en la red`
                : `${activosPct}% de los hosts del último escaneo`
            }
            progress={{ current: activos, total: totalActivos }}
            change={
              cambios
                ? {
                    text: cambios.added - cambios.removed === 0 ? 'igual que antes' : `${cambios.added - cambios.removed > 0 ? '+' : ''}${cambios.added - cambios.removed} vs anterior`,
                    tone: cambios.added - cambios.removed > 0 ? 'up' : cambios.added - cambios.removed < 0 ? 'down' : 'neutral',
                  }
                : undefined
            }
            tooltip="Cuántos dispositivos del inventario se detectaron en el último escaneo. El porcentaje compara presentes contra el total conocido."
          />

          <StatCard
            label="Nuevos hoy"
            value={nuevosHoy}
            icon={<IconSpark />}
            accent={nuevosHoy > 0 ? 'blue' : 'green'}
            subtitle="Vistos por primera vez en las últimas 24 h"
            badge={nuevosHoy > 0 ? { text: 'Nuevo', accent: 'blue' } : { text: 'Estable', accent: 'green' }}
            tooltip="Dispositivos cuya primera detección ocurrió hoy. Revisa los que no reconozcas antes de marcarlos como confiables."
          />

          <StatCard
            label="Riesgo"
            value={riesgo.level}
            icon={<IconShield />}
            accent={riesgo.accent}
            subtitle={riesgo.subtitle}
            tooltip="Alto: hay dispositivos nuevos sin marcar como confiables. Medio: hay presentes que aún no confías. Bajo: todos los presentes están marcados."
          />

          <StatCard
            label="Último escaneo"
            value={formatRelativeTime(resultado.scanned_at)}
            icon={<IconClock />}
            accent={lastScanAccent}
            subtitle={`${resultado.target} · ${resultado.duration_seconds?.toFixed(1)}s`}
            tooltip="Antigüedad del último escaneo. Verde: menos de 15 min. Amarillo: menos de 2 h. Rojo: la vista puede estar desactualizada."
          />

          <StatCard
            label="Cambios"
            value={cambiosValue}
            icon={<IconSwap />}
            accent={cambiosAccent}
            subtitle={anterior ? 'Respecto al escaneo anterior' : 'Aún no hay un escaneo previo'}
            change={
              cambios
                ? {
                    text: `+${cambios.added} nuevos, −${cambios.removed} ausentes`,
                    tone: cambios.removed > 0 && cambios.added === 0 ? 'down' : cambios.added > 0 ? 'up' : 'neutral',
                  }
                : undefined
            }
            tooltip="Compara las MAC/IP del último escaneo con el anterior: cuántos aparecieron y cuántos dejaron de verse."
          />

          <StatCard
            label="Confiables"
            value={confiables}
            icon={<IconCheck />}
            accent={confiablesAccent}
            subtitle={`${confiablesPresentes} confiables están presentes ahora`}
            progress={
              totalInventario > 0 ? { current: confiables, total: totalInventario } : undefined
            }
            tooltip="Dispositivos que marcaste como confiables en el inventario. Un porcentaje bajo sugiere revisar equipos desconocidos."
          />
        </div>
      )}

      <div className="bg-surface-light border border-surface-border rounded-xl overflow-hidden">
        <div className="p-6 border-b border-surface-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Dispositivos encontrados</h2>
            <p className="text-sm text-muted mt-1">
              {resultado ? `${resultado.total_hosts} dispositivos en la red` : 'Sin datos aún'}
            </p>
          </div>
          {resultado && (
            <span className="text-xs font-medium bg-primary/10 text-primary px-3 py-1.5 rounded-full border border-primary/20">
              {resultado.total_hosts} dispositivos
            </span>
          )}
        </div>
        <div className="p-2">
          {resultado ? (
            <DeviceTable hosts={resultado.hosts} />
          ) : (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-surface-border rounded-full mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-muted font-medium">No hay datos para mostrar</p>
              <p className="text-sm text-muted/80 mt-1">Inicia un escaneo para ver los dispositivos</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

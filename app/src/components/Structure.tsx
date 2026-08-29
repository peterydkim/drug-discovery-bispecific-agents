import { useEffect, useRef, useState } from "react";
import { plddtBand } from "../lib/insilico";

declare global {
  interface Window {
    $3Dmol?: {
      createViewer: (el: HTMLElement, cfg: Record<string, unknown>) => Viewer;
    };
  }
}

interface Viewer {
  addModel: (data: string, format: string) => void;
  setStyle: (sel: Record<string, unknown>, style: Record<string, unknown>) => void;
  zoomTo: () => void;
  render: () => void;
  clear: () => void;
  resize: () => void;
  spin: (axis: string | boolean) => void;
}

/** pLDDT colour scheme, matching the AlphaFold DB convention. */
const PLDDT_BANDS = [
  { min: 90, color: "0x0053D6" },
  { min: 70, color: "0x65CBF3" },
  { min: 50, color: "0xFFDB13" },
  { min: 0, color: "0xFF7D45" },
];

export function StructureViewer({
  pdb,
  colorBy = "plddt",
  height = 320,
}: {
  pdb: string;
  colorBy?: "plddt" | "chain";
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(Boolean(window.$3Dmol));
  const [spinning, setSpinning] = useState(false);
  const viewerRef = useRef<Viewer | null>(null);

  // 3Dmol is loaded from a <script> tag in index.html; it may not have parsed yet.
  useEffect(() => {
    if (ready) return;
    const t = setInterval(() => {
      if (window.$3Dmol) {
        setReady(true);
        clearInterval(t);
      }
    }, 150);
    return () => clearInterval(t);
  }, [ready]);

  useEffect(() => {
    if (!ready || !host.current || !pdb) return;
    const viewer = window.$3Dmol!.createViewer(host.current, { backgroundColor: "0x0e1116" });
    viewerRef.current = viewer;
    viewer.addModel(pdb, "pdb");

    if (colorBy === "plddt") {
      // Normalise: ESMFold writes 0-1 into the B-factor column, AlphaFold 0-100.
      const maxB = Math.max(
        ...pdb
          .split("\n")
          .filter((l) => l.startsWith("ATOM"))
          .map((l) => Number.parseFloat(l.slice(60, 66)))
          .filter(Number.isFinite),
      );
      const scale = maxB <= 1.5 ? 100 : 1;
      const colorfunc = (atom: { b?: number }) => {
        const v = (atom.b ?? 0) * scale;
        return PLDDT_BANDS.find((band) => v >= band.min)!.color.replace("0x", "#");
      };
      viewer.setStyle({}, { cartoon: { colorfunc } });
    } else {
      viewer.setStyle({}, { cartoon: { colorscheme: "chain" } });
    }

    viewer.zoomTo();
    viewer.render();

    const onResize = () => {
      viewer.resize();
      viewer.render();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      viewer.clear();
      viewerRef.current = null;
    };
  }, [ready, pdb, colorBy]);

  return (
    <div className="viewer-wrap">
      <div ref={host} className="viewer" style={{ height }} />
      {!ready && <div className="viewer-fallback">Loading 3Dmol…</div>}
      <div className="viewer-bar">
        {colorBy === "plddt" && (
          <div className="legend">
            {[
              ["#0053D6", "≥90 very high"],
              ["#65CBF3", "70–90 confident"],
              ["#FFDB13", "50–70 low"],
              ["#FF7D45", "<50 very low"],
            ].map(([c, label]) => (
              <span key={label}>
                <i style={{ background: c }} />
                {label}
              </span>
            ))}
          </div>
        )}
        <button
          className="ghost sm"
          onClick={() => {
            const v = viewerRef.current;
            if (!v) return;
            v.spin(spinning ? false : "y");
            setSpinning(!spinning);
          }}
        >
          {spinning ? "Stop" : "Spin"}
        </button>
      </div>
    </div>
  );
}

export function ConfidenceTrack({ track }: { track: number[] }) {
  if (!track.length) return null;
  // Downsample to keep the DOM small on long chains.
  const step = Math.max(1, Math.ceil(track.length / 260));
  const bars: { v: number; i: number }[] = [];
  for (let i = 0; i < track.length; i += step) {
    const slice = track.slice(i, i + step);
    bars.push({ v: slice.reduce((a, b) => a + b, 0) / slice.length, i });
  }
  return (
    <div className="track" title="Per-residue pLDDT">
      {bars.map((b) => (
        <i
          key={b.i}
          style={{
            height: `${Math.max(4, b.v)}%`,
            background: PLDDT_BANDS.find((x) => b.v >= x.min)!.color.replace("0x", "#"),
          }}
          title={`residue ~${b.i + 1}: pLDDT ${b.v.toFixed(0)} (${plddtBand(b.v).label})`}
        />
      ))}
    </div>
  );
}
